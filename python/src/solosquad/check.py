"""`solosquad assets validate` and `solosquad doctor` — catch broken wiring before a run.

The engine itself fails soft in several places (an agent that does not parse is left
out of the company, a cron file without `schedule:` is skipped) and hard in one (a bad
crontab stops the office from starting). These checks surface all of it up front.
"""

from __future__ import annotations

import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from apscheduler.triggers.cron import CronTrigger
from pydantic import ValidationError

from solosquad import __version__
from solosquad.artifacts import load_kinds
from solosquad.assets.composition import KNOWN_TEAMS, read_composition
from solosquad.assets.renames import RENAMED_AGENTS, renamed_hint
from solosquad.assets.skill import SkillParseError, parse_skill_md
from solosquad.assets.text import load_yaml, match_frontmatter, normalize_line
from solosquad.assets.validate import Report, validate_skill
from solosquad.company_info import Company
from solosquad.context.execution import ExecutionContext, build_context
from solosquad.context.resolve import Kind, Resolver
from solosquad.entities import LegalEntity, read_entities_at
from solosquad.entities import holders as entity_holders
from solosquad.layout import AccessPolicy, LayoutError, ServerConfig, Solution
from solosquad.routing.connections import load_connections
from solosquad.routing.eligibility import Holders, holder_missing, judge_use, providers_reached
from solosquad.routing.policy import load_policy
from solosquad.routing.vault import SecretStore
from solosquad.screens import parse_screen, screen_issues, screen_path
from solosquad.storage import legacy_files
from solosquad.workflows.definition import load_workflows
from solosquad.workflows.tools import TOOLS

ENTRY_AGENT = "chief"
HARNESS_BINARIES = {"claude-code": "claude", "codex": "codex", "opencode": "opencode"}


def _skill_dirs(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if (p / "SKILL.md").is_file())


def _check_access(r: Report, access: AccessPolicy, where: str) -> None:
    if not access.require_login and not access.allowed_networks:
        r.add(
            "ACCESS_OPEN",
            "require_login: false with no allowed_networks — the server would be"
            " open to the internet without a login (decision 41)",
            "access.require_login",
            path=where,
        )
    elif not access.require_login:
        r.add(
            "ACCESS_NO_LOGIN_IGNORED",
            "require_login: false is not supported in v2.1 — every"
            " web request still needs an account",
            "access.require_login",
            "warn",
            where,
        )
    try:
        from solosquad.web_api.access import parse_networks

        parse_networks(access.allowed_networks)
    except ValueError as e:
        r.add("ACCESS_NETWORK_INVALID", str(e), "access.allowed_networks", path=where)


def validate_definitions(
    ctx: ExecutionContext,
    report: Report | None = None,
    *,
    holders: Holders | None = None,
    org_entity: int | None = None,
) -> Report:
    """Every agent/skill a workspace can see, its teams, crons, policy and connections."""
    r = report or Report()
    resolver = Resolver(ctx)
    kinds: tuple[Kind, ...] = ("agents", "skills")

    for kind in kinds:
        for layer, root in resolver._roots(kind):
            for d in _skill_dirs(root):
                path = d / "SKILL.md"
                try:
                    spec = parse_skill_md(path.read_text(encoding="utf-8"), str(path))
                except SkillParseError as e:
                    r.add("PARSE_ERROR", str(e), path=str(path))
                    continue
                # Customer-authored layers get the strict naming gate; the package is
                # already gated in CI (golden + v1 rules), so only re-check what it owns.
                r.issues += validate_skill(
                    spec, dir_name=d.name, strict_name=layer != "package"
                ).errors
                if layer != "package":
                    r.issues += validate_skill(spec, dir_name=d.name, strict_name=True).warnings

    agents = resolver.available("agents")
    if ENTRY_AGENT not in agents:
        r.add("ENTRY_MISSING", f"no {ENTRY_AGENT!r} agent — the company has no entry point")

    for name, res in agents.items():
        declared = res.spec.extra.get("handoffs")
        if declared is None:
            continue
        if not isinstance(declared, list):
            r.add(
                "HANDOFFS_MALFORMED",
                "handoffs must be a list of agent names",
                "handoffs",
                path=str(res.path),
            )
            continue
        for target in declared:
            if target not in agents:
                hint = renamed_hint(target) if isinstance(target, str) else None
                r.add(
                    "HANDOFF_UNKNOWN",
                    f"{name} hands off to unknown agent {target!r}"
                    + (f" — {hint}" if hint else ""),
                    "handoffs",
                    path=str(res.path),
                )

    for team in KNOWN_TEAMS:
        for root in (ctx.org_root / "team", ctx.bundle_root):
            path = root / "teams" / team / "composition.yaml"
            if not path.is_file():
                continue
            comp = read_composition(path)
            if comp is None:
                r.add("TEAM_MALFORMED", f"team {team!r} composition does not parse", path=str(path))
                break
            if comp.legacy_main is not None:
                r.add(
                    "TEAM_MAIN_IGNORED",
                    f"team {team!r} names a lead `main: {comp.legacy_main}` — teams have no "
                    "lead (decision 58); it is read as a member. List it under `members:` "
                    "and drop `main:`",
                    "main",
                    "warn",
                    str(path),
                )
            for member in comp.members:
                if member and member not in agents:
                    hint = renamed_hint(member)
                    r.add(
                        "TEAM_MEMBER_RENAMED" if hint else "TEAM_MEMBER_UNKNOWN",
                        f"team {team!r} lists unknown agent {member!r}"
                        + (f" — {hint}" if hint else ""),
                        severity="warn",
                        path=str(path),
                    )
            break

    for name, res in agents.items():
        if res.layer != "package" and name in RENAMED_AGENTS and name != ENTRY_AGENT:
            r.add(
                "AGENT_RENAMED",
                f"{res.layer} agent {name!r} uses a bundled id that changed — "
                f"{renamed_hint(name)}"
                + (
                    ""
                    if name == "engineer"
                    else f"; rename the folder to {RENAMED_AGENTS[name]!r} (and `name:`) "
                    "to keep inheriting package updates"
                ),
                "name",
                "warn",
                str(res.path),
            )

    for res in resolver.unattributed_overrides():
        r.add(
            "OVERRIDE_NOT_ATTRIBUTED",
            f"{res.name} overrides a package template without `derived_from:` — updates "
            "cannot show what changed underneath",
            "derived_from",
            "warn",
            str(res.path),
        )

    crons_dir = ctx.org_root / "crons"
    for path in sorted(crons_dir.glob("*.md")) if crons_dir.is_dir() else []:
        text = normalize_line(path.read_text(encoding="utf-8"))
        fm = match_frontmatter(text)
        try:
            meta = load_yaml(fm.text) if fm else None
        except Exception as e:  # yaml errors of every kind
            r.add("CRON_PARSE_ERROR", str(e), path=str(path))
            continue
        schedule = meta.get("schedule") if isinstance(meta, dict) else None
        if not isinstance(schedule, str):
            r.add(
                "CRON_NO_SCHEDULE",
                "no `schedule:` in frontmatter — the engine skips this file",
                "schedule",
                "warn",
                str(path),
            )
            continue
        try:
            CronTrigger.from_crontab(schedule, timezone=ctx.timezone)
        except ValueError as e:
            r.add(
                "CRON_SCHEDULE_INVALID",
                f"{schedule!r}: {e} — the office would not start",
                "schedule",
                path=str(path),
            )

    defs, wf_errors = load_workflows(ctx.org_root / "workflows")
    for err in wf_errors:
        r.add("WORKFLOW_INVALID", err, path=str(ctx.org_root / "workflows"))
    artifact_kinds = load_kinds(ctx.org_root)
    for wf in defs.values():
        where = str(ctx.org_root / "workflows" / f"{wf.name}.yaml")
        if wf.schedule:
            try:
                CronTrigger.from_crontab(wf.schedule, timezone=ctx.timezone)
            except ValueError as e:
                r.add(
                    "WORKFLOW_SCHEDULE_INVALID",
                    f"{wf.name}: {wf.schedule!r}: {e}",
                    "schedule",
                    path=where,
                )
            if any(i.required and i.type == "upload" for i in wf.inputs):
                r.add(
                    "WORKFLOW_SCHEDULE_NEEDS_UPLOAD",
                    f"{wf.name} is scheduled but needs an"
                    " uploaded file — it only runs from the web",
                    "schedule",
                    "warn",
                    where,
                )
        for step in wf.steps:
            if step.tool and step.tool not in TOOLS:
                r.add(
                    "WORKFLOW_TOOL_UNKNOWN",
                    f"{wf.name}.{step.id}: no tool {step.tool!r}",
                    "steps",
                    path=where,
                )
            if step.save_as and step.save_as.kind not in artifact_kinds:
                r.add(
                    "WORKFLOW_KIND_UNKNOWN",
                    f"{wf.name}.{step.id}: no artifact kind {step.save_as.kind!r}",
                    "steps",
                    path=where,
                )
            if step.agent and step.agent not in agents:
                r.add(
                    "WORKFLOW_AGENT_UNKNOWN",
                    f"{wf.name}.{step.id}: no agent {step.agent!r}",
                    "steps",
                    path=where,
                )

    screens_dir = ctx.org_root / "screens"
    for path in sorted(screens_dir.glob("*.yaml")) if screens_dir.is_dir() else []:
        try:
            screen_path(ctx.org_root, path.stem)
            screen = parse_screen(path.read_text(encoding="utf-8"))
        except (ValidationError, ValueError) as e:
            r.add("SCREEN_INVALID", str(e).splitlines()[0], path=str(path))
            continue
        for code, message, severity in screen_issues(screen):
            r.add(code, message, "widgets", "warn" if severity == "warn" else "error", str(path))

    _check_access(r, ctx.workspace_config.access, "workspace.yaml")

    known_conn: set[str] = set()
    server = ctx.server.facts().country
    book = holders or Holders()
    user = book.entity(org_entity)
    for path in (ctx.solution.connections_path, ctx.org_root / "connections.yaml"):
        try:
            conns = load_connections(path)
        except Exception as e:  # pydantic and yaml errors alike — report, never crash
            r.add("CONNECTIONS_INVALID", str(e).splitlines()[0], path=str(path))
            continue
        known_conn |= {c.id for c in conns}
        for c in conns:
            reached = providers_reached(c.provider, c.harness, c.models)
            owner = book.entity(c.entity_id)
            verdict = judge_use(c.provider, c.harness, c.models, owner, user, server)
            if c.entity_id is not None and book.by_id and c.entity_id not in book.by_id:
                r.add(
                    "CONNECTION_ENTITY_UNKNOWN",
                    f"{c.id}: entity_id {c.entity_id} is not a registered entity (법인) —"
                    " the 대표 법인 is used",
                    "entity_id",
                    "warn",
                    str(path),
                )
            if not verdict.ok:
                r.add(
                    "CONNECTION_INELIGIBLE",
                    f"{c.id}: {verdict.reason} ({verdict.source})",
                    "company",
                    path=str(path),
                )
            elif holder_missing(c.provider, c.harness, c.models, owner, user):
                r.add(
                    "CONNECTION_COMPANY_UNKNOWN",
                    f"{c.id} reaches {', '.join(sorted(reached))} but its entity's country"
                    " (법인 소재지) is not entered yet (decision 45)",
                    "company",
                    "warn",
                    str(path),
                )

    policy_path = ctx.org_root / "policy.yaml"
    try:
        policy = load_policy(policy_path)
    except Exception as e:  # pydantic and yaml errors alike — report, never crash
        r.add("POLICY_INVALID", str(e).splitlines()[0], path=str(policy_path))
    else:
        for agent in policy.agents:
            if agent not in agents:
                r.add(
                    "POLICY_UNKNOWN_AGENT",
                    f"policy names unknown agent {agent!r}",
                    severity="warn",
                    path=str(policy_path),
                )
        prefs = [policy.default, *policy.agents.values(), *policy.tags.values()]
        for conn in {c for p in prefs for c in p.connections}:
            if conn not in known_conn:
                r.add(
                    "POLICY_UNKNOWN_CONNECTION",
                    f"policy names unknown connection {conn!r}",
                    severity="warn",
                    path=str(policy_path),
                )
    return r


def company_missing(company: Company) -> list[str]:
    fields = (
        ("구분", company.kind),
        ("법인명/상호", company.name),
        ("대표자", company.representative),
        ("소재지 나라", company.country),
    )
    return [label for label, ok in fields if not ok]


def read_entities(solution: Path) -> list[LegalEntity]:
    """The legal entities from the data folder's `core.db`, read-only — none if unknown."""
    from solosquad.web_api.org_store import core_path

    try:
        return read_entities_at(core_path(Solution(solution)))
    except Exception:  # no data folder yet, a locked file — the entities are just unknown
        return []


def read_company(solution: Path) -> Company:
    """The 대표 법인 in the rev7 company shape — empty if unknown."""
    primary = next((e for e in read_entities(solution) if e.is_primary), None)
    return primary.company() if primary else Company()


def validate_solution(solution: Path, bundle: Path) -> dict[str, Report]:
    """One report per `<org>/<workspace>`, plus `""` for problems reading the layout."""
    out: dict[str, Report] = {}
    base = Report()
    sol = Solution(solution)
    try:
        sol.engine_lock()
        sol.meta()
    except LayoutError as e:
        base.add("LAYOUT", str(e))
        return {"": base}
    server_path = str(sol.server_config_path)
    for field, places in sorted(sol.server_conflicts().items()):
        found = ", ".join(f"{where}={value!r}" for where, value in places.items())
        base.add(  # C33 · K50 — never merged automatically; the FDE picks one value
            "SERVER_CONFIG_CONFLICT",
            f"{field} differs between places ({found}) — keep one value in core/server.yaml",
            field,
            path=server_path,
        )
    if sol.has_legacy_server_fields():
        base.add(
            "SERVER_CONFIG_LEGACY",
            "workspace.yaml still carries server settings (public_url · server_country ·"
            " type · snapshot · web) — `serve` moves them to core/server.yaml",
            severity="warn",
            path=server_path,
        )
    try:
        server = sol.server_config(strict=False)
    except ValidationError as e:
        base.add("SERVER_CONFIG_INVALID", str(e).splitlines()[0], path=server_path)
        server = ServerConfig()
    _check_access(base, server.access, server_path)
    entities = read_entities(solution)
    book = entity_holders(entities)
    primary = next((e for e in entities if e.is_primary), None)
    company = primary.company() if primary else Company()
    for org in sol.orgs():
        try:
            org.lock()
            org_entity = org.config().entity_id
        except LayoutError as e:
            base.add("LAYOUT", str(e))
            continue
        if org_entity is not None and book.by_id and org_entity not in book.by_id:
            base.add(
                "ORG_ENTITY_UNKNOWN",
                f"{org.name}: entity_id {org_entity} is not a registered entity (법인) —"
                " the 대표 법인 is used",
                "entity_id",
                "warn",
                str(org.root / "org.yaml"),
            )
        for ws in org.workspaces():
            key = f"{org.name}/{ws.name}"
            try:
                ctx = build_context(solution, org.name, ws.name, bundle, server=server)
            except (LayoutError, ValidationError) as e:
                rep = Report()
                rep.add("LAYOUT", str(e).splitlines()[0])
                out[key] = rep
                continue
            out[key] = validate_definitions(ctx, holders=book, org_entity=org_entity)
    if not company.complete:
        base.add(
            "COMPANY_INCOMPLETE",
            "회사 still needs: "
            + ", ".join(company_missing(company))
            + " — set it in the web (설정, 회사) or `solosquad company set`",
            severity="warn",
        )
    if base.issues or not out:
        out[""] = base
    return out


# ---------------------------------------------------------------------- doctor

Status = Literal["ok", "warn", "fail"]


@dataclass(frozen=True)
class Check:
    name: str
    status: Status
    detail: str


def doctor_checks(solution: Path, bundle: Path | None) -> list[Check]:
    """Environment checks that need no LLM call: interpreter, bundle, layout, CLIs, data."""
    out: list[Check] = []
    ok = sys.version_info >= (3, 12)
    out.append(Check("python", "ok" if ok else "fail", sys.version.split()[0]))
    out.append(Check("engine", "ok", __version__))
    if bundle is None:
        out.append(Check("bundle", "fail", "agents/ + teams/ not found next to the engine"))
        return out
    out.append(Check("bundle", "ok", str(bundle)))

    sol = Solution(solution)
    try:
        lock = sol.engine_lock()
    except LayoutError as e:
        out.append(Check("solution", "fail", str(e)))
        return out
    same = lock.version == __version__
    out.append(
        Check(
            "engine.lock",
            "ok" if same else "warn",
            lock.version if same else f"{lock.version} (running {__version__})",
        )
    )

    conns = []
    for path in [sol.connections_path, *(o.root / "connections.yaml" for o in sol.orgs())]:
        try:
            conns += load_connections(path)
        except Exception as e:
            out.append(Check("connections", "fail", f"{path}: {str(e).splitlines()[0]}"))
    active = [c for c in conns if c.active]
    out.append(
        Check(
            "connections",
            "ok" if active else "warn",
            f"{len(active)} active of {len(conns)}" if conns else "none — add one",
        )
    )
    for harness in sorted({c.harness for c in active}):
        binary = HARNESS_BINARIES.get(harness)
        if binary is None:
            continue
        found = shutil.which(binary)
        out.append(Check(f"cli:{binary}", "ok" if found else "fail", found or "not on PATH"))

    reports = validate_solution(solution, bundle)
    errors = sum(len(r.errors) for r in reports.values())
    warns = sum(len(r.warnings) for r in reports.values())
    status: Status = "fail" if errors else "warn" if warns else "ok"
    out.append(Check("definitions", status, f"{errors} errors · {warns} warnings"))
    todo = company_missing(read_company(solution))
    out.append(Check("company", "warn" if todo else "ok",
                     "missing: " + ", ".join(todo) if todo else "complete"))  # fmt: skip
    try:
        facts = Solution(solution).server_config(strict=False).facts()
        where = (
            facts.where
            if facts.where != "cloud"
            else f"{facts.cloud or 'cloud'} {facts.region or ''}"
        )
        out.append(Check("server", "ok" if facts.country else "warn",
                         f"{where.strip()} · country {facts.country or 'unknown'}"))  # fmt: skip
    except Exception as e:
        out.append(Check("server", "fail", str(e).splitlines()[0]))

    from solosquad.layout import EngineStore, solosquad_home

    home = solosquad_home()
    for org in sol.orgs():
        for ws in org.workspaces():
            try:
                data = EngineStore(home).data_dir(ws)
            except LayoutError as e:
                out.append(Check(f"data:{org.name}/{ws.name}", "fail", str(e)))
                continue
            probe = data if data.exists() else home
            writable = os.access(probe, os.W_OK) if probe.exists() else True
            legacy = legacy_files(data) + legacy_files(data.parent)
            if legacy:
                out.append(
                    Check(
                        f"legacy:{org.name}/{ws.name}",
                        "warn",
                        "per-component files from before org.db/office.db: "
                        + ", ".join(p.name for p in legacy),
                    )
                )
            vault = SecretStore(data / "secrets.json")
            try:
                plain = vault.is_plaintext()
            except ValueError as e:
                out.append(Check(f"secrets:{org.name}/{ws.name}", "fail", str(e)))
            else:
                if vault.path.is_file():
                    out.append(
                        Check(
                            f"secrets:{org.name}/{ws.name}",
                            "warn" if plain else "ok",
                            "plaintext — the engine encrypts it at next start"
                            if plain
                            else f"encrypted · key {vault.key_source()} — keep a copy of the key",
                        )
                    )
            out.append(
                Check(
                    f"data:{org.name}/{ws.name}",
                    "ok" if writable else "fail",
                    str(data) + ("" if writable else " — not writable"),
                )
            )
    return out
