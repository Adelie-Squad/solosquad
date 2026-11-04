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
from solosquad.assets.composition import KNOWN_TEAMS, read_composition
from solosquad.assets.skill import SkillParseError, parse_skill_md
from solosquad.assets.text import load_yaml, match_frontmatter, normalize_line
from solosquad.assets.validate import Report, validate_skill
from solosquad.context.execution import ExecutionContext, build_context
from solosquad.context.resolve import Kind, Resolver
from solosquad.layout import LayoutError, Solution
from solosquad.routing.connections import load_connections
from solosquad.routing.policy import load_policy

ENTRY_AGENT = "chief"
HARNESS_BINARIES = {"claude-code": "claude", "codex": "codex", "opencode": "opencode"}


def _skill_dirs(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if (p / "SKILL.md").is_file())


def validate_definitions(ctx: ExecutionContext, report: Report | None = None) -> Report:
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
                r.add(
                    "HANDOFF_UNKNOWN",
                    f"{name} hands off to unknown agent {target!r}",
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
            for member in [comp.main, *comp.members]:
                if member and member not in agents:
                    r.add(
                        "TEAM_MEMBER_UNKNOWN",
                        f"team {team!r} lists unknown agent {member!r}",
                        severity="warn",
                        path=str(path),
                    )
            break

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

    known_conn: set[str] = set()
    for path in (ctx.solution.connections_path, ctx.org_root / "connections.yaml"):
        try:
            known_conn |= {c.id for c in load_connections(path)}
        except Exception as e:  # pydantic and yaml errors alike — report, never crash
            r.add("CONNECTIONS_INVALID", str(e).splitlines()[0], path=str(path))

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
    for org in sol.orgs():
        try:
            org.lock()
            org.config()
        except LayoutError as e:
            base.add("LAYOUT", str(e))
            continue
        for ws in org.workspaces():
            key = f"{org.name}/{ws.name}"
            try:
                ctx = build_context(solution, org.name, ws.name, bundle)
            except (LayoutError, ValidationError) as e:
                rep = Report()
                rep.add("LAYOUT", str(e).splitlines()[0])
                out[key] = rep
                continue
            out[key] = validate_definitions(ctx)
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
            out.append(
                Check(
                    f"data:{org.name}/{ws.name}",
                    "ok" if writable else "fail",
                    str(data) + ("" if writable else " — not writable"),
                )
            )
    return out
