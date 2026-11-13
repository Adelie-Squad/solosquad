"""On-disk layout of a customer solution (ideation 260803 decisions 40 · 57).

    <solution>/                    one customer = one private git repo
      core/                        what the whole customer shares (decision 57)
        engine.lock                which engine version this customer runs
        solution.yaml              pseudonymous solution id (decision 38)
        server.yaml                the engine server: address · country · type · snapshot
                                   target · customer access default · placement (I41)
        custom/{config,policies,hooks,tools,patches}/   engine customization
        owner/                     owner profile · traits · principles
        connections.yaml           the owner's LLM connections (secrets live elsewhere)
      orgs/<org>/                  one organisation (e.g. a company of the owner)
        org.lock                   org package @ version it started from
        org.yaml                   business info · budget
        team/{agents,skills}/  team/teams.yaml
        knowledge/ workflows/ goals/ crons/
        workspaces/<ws>/           one business unit inside the org (decision 57)
          workspace.yaml           execution · timezone · retention · extra access limits
          local.yaml               folders/apps the FDE may analyze
          repositories/

Outside the repo, under SOLOSQUAD_HOME (default ~/.solosquad/v2 — v1 owns ~/.solosquad):
    engines/<version>/                      engine releases, side by side, per machine
    data/<solution-id>/core.db              people · logins · sessions · assignments (I39)
    data/<solution-id>/<org>/org.db         the org's teams · titles · org audit
    data/<solution-id>/<org>/<ws>/office.db runs · checkpoints · ledger · artifacts

One engine server (`serve`) runs every workspace placed on it — one workspace runtime
each (decision 57 · I38) — behind one login and one web. Every path is still passed in,
never assumed global, so one machine can host many customers on different engines.

Server-natured settings live once, in `core/server.yaml`; `workspace.yaml` keeps only
what differs per business (I41). A rev6 `workspace.yaml` that still carries a server
field is lifted into the server settings when read; two places that disagree are a
`validate` error and stop the server — they are never merged silently (C33 · K50).
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field

from solosquad.assets.text import load_yaml
from solosquad.server_facts import ServerFacts, detect
from solosquad.snapshots import SnapshotTarget

SCHEMA_VERSION = 1
CUSTOM_DIRS = ("config", "policies", "hooks", "tools", "patches")


class LayoutError(Exception):
    pass


class WorkspaceType(StrEnum):
    CLOUD = "cloud"
    INTRANET = "intranet"
    LOCAL = "local"


ServerType = WorkspaceType
"""cloud · intranet · local — a property of the engine server since decision 57 ⑷."""


class _Doc(BaseModel):
    model_config = ConfigDict(extra="allow")
    schema_version: int = SCHEMA_VERSION


class EngineLock(_Doc):
    version: str


class SolutionMeta(_Doc):
    id: str


class OrgLock(_Doc):
    package: str
    version: str


class OrgConfig(_Doc):
    name: str
    display_name: str | None = None
    """The name people read (e.g. "SpaceX"); the web falls back to the id made readable."""
    entity_id: int | None = None
    """소속 법인 (2026-11-14) — the customer's legal entity (core.db `entities`) this 사업
    runs under; every workspace of it follows. Unset = the 대표 법인."""


class AccessPolicy(BaseModel):
    model_config = ConfigDict(extra="allow")
    require_login: bool = True
    two_factor: bool = True
    """Second factor (TOTP) at login — the default since decision 41/46 W3."""
    allowed_networks: list[str] = Field(default_factory=list)


class RetentionPolicy(BaseModel):
    """How long each data class is kept (decision 54) — the customer may change it."""

    model_config = ConfigDict(extra="allow")
    business_records_days: int = 3 * 365
    """Runs, threads and their checkpoints, the ledger, artifacts."""
    uploads_days: int = 90
    audit_days: int = 365


class ExecutionPolicy(BaseModel):
    model_config = ConfigDict(extra="allow")
    allow_external_api: bool = True
    allow_subscription_cli: bool = True
    allow_internal_llm: bool = True
    allow_local_llm: bool = True


class WebPrefs(BaseModel):
    """Web settings that belong to the server. The customer default language (`locale`)
    was retired on 2026-11-11 — each person keeps their own (`users.locale`, default ko).
    An old file's `locale` is still read (extra field) once, by `legacy_web_locale`, and
    then removed (`drop_legacy_web_locale`)."""

    model_config = ConfigDict(extra="allow")


class Placement(BaseModel):
    """Which orgs and workspaces this engine server runs (I38). Each entry is `org` (all of
    its workspaces) or `org/workspace`; empty = everything in the repository."""

    model_config = ConfigDict(extra="allow")
    include: list[str] = Field(default_factory=list)

    def places(self, org: str, workspace: str) -> bool:
        if not self.include:
            return True
        return org in self.include or f"{org}/{workspace}" in self.include


class ServerConfig(_Doc):
    """`core/server.yaml` — what belongs to the engine server, not to one business (I41)."""

    # A `mode: demo` / `demo:` from a retired engine demo server (removed 2026-11-13 — the demo
    # is now frontend-only on the marketing site) is kept as an extra key and ignored.

    public_url: str | None = None
    """The server's HTTPS address (e.g. https://ai.example.co.kr) — passkeys are bound
    to this domain, so they stay off until it is set (decision 47 S4)."""
    server_country: str | None = None
    """ISO country where the server runs (decision 45 region rule), e.g. KR."""
    type: ServerType | None = None
    """The builder's override of where the server runs (local · intranet · cloud). Unset =
    detected (`server_facts`); an old file's `type: local` counts as the builder's choice."""
    cloud: str | None = None
    """Override of the detected cloud provider (aws · gcp · azure · ncp …)."""
    region: str | None = None
    """Override of the detected region (e.g. ap-northeast-2) — the country follows it."""
    agency_access: str | None = None
    """Builder's note: how the agency reaches the customer's cloud (role, account, VPN) — no
    credentials. Not shown in the web (moved from the retired customer profile, 2026-11-11)."""
    snapshot: SnapshotTarget = Field(default_factory=SnapshotTarget)
    """Where the daily snapshot goes — the customer's own bucket (decision 54)."""
    access: AccessPolicy = Field(default_factory=AccessPolicy)
    """The customer's default access policy; a workspace can only narrow it."""
    placement: Placement = Field(default_factory=Placement)
    web: WebPrefs = Field(default_factory=WebPrefs)

    def facts(self) -> ServerFacts:
        """What this server is, detected — with this file's values as overrides."""
        return detect(self.model_dump(mode="json", exclude_none=True))


SERVER_FIELDS = ("public_url", "server_country", "type", "snapshot", "web")
"""Fields a rev6 `workspace.yaml` may still carry; read once and lifted into the server."""


class WorkspaceConfig(_Doc):
    name: str
    display_name: str | None = None
    """The name people read (e.g. "Launch Ops"); the web falls back to the id made readable."""
    timezone: str = "Asia/Seoul"
    access: AccessPolicy = Field(default_factory=AccessPolicy)
    """Extra limits for this business on top of the server's default (`allowed_networks`)."""
    execution: ExecutionPolicy = Field(default_factory=ExecutionPolicy)
    retention: RetentionPolicy = Field(default_factory=RetentionPolicy)
    # rev6 leftovers — read for the lift into `core/server.yaml`, never written back
    type: WorkspaceType | None = None
    server_country: str | None = None
    public_url: str | None = None
    snapshot: SnapshotTarget | None = None
    web: WebPrefs | None = None


class ServerConfigConflict(LayoutError):
    """Places disagree on a server-natured value — the FDE has to pick one (K50)."""

    def __init__(self, conflicts: dict[str, dict[str, Any]]) -> None:
        self.conflicts = conflicts
        parts = [
            f"{field}: " + ", ".join(f"{where}={value!r}" for where, value in found.items())
            for field, found in sorted(conflicts.items())
        ]
        super().__init__(
            "server settings differ between places — keep one value in core/server.yaml"
            " and remove the others: " + "; ".join(parts)
        )


def _read[M: BaseModel](path: Path, model: type[M]) -> M:
    if not path.is_file():
        raise LayoutError(f"missing {path}")
    data = load_yaml(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise LayoutError(f"{path}: expected a mapping")
    return model.model_validate(data)


def _dump(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _write(path: Path, model: BaseModel, *, drop: tuple[str, ...] = ()) -> None:
    payload: dict[str, Any] = model.model_dump(mode="json")
    for key in drop:
        payload.pop(key, None)
    _dump(path, payload)


def _raw(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    data = load_yaml(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _normal(field: str, value: Any) -> Any:
    """A server value as the server model stores it — `None` when it was left unset."""
    if value is None:
        return None
    if field == "snapshot":
        target = SnapshotTarget.model_validate(value)
        return target.model_dump(mode="json") if target.type is not None else None
    if field == "web":
        return WebPrefs.model_validate(value).model_dump(mode="json")
    if field == "type":
        return WorkspaceType(value).value
    if field == "server_country":
        return str(value).upper()
    return value


def solosquad_home() -> Path:
    env = os.environ.get("SOLOSQUAD_HOME")
    return Path(env) if env else Path.home() / ".solosquad" / "v2"


@dataclass(frozen=True)
class EngineStore:
    home: Path

    @property
    def engines_dir(self) -> Path:
        return self.home / "engines"

    @property
    def data_root(self) -> Path:
        return self.home / "data"

    def engine_path(self, version: str) -> Path:
        return self.engines_dir / version

    def versions(self) -> list[str]:
        if not self.engines_dir.is_dir():
            return []
        return sorted(p.name for p in self.engines_dir.iterdir() if p.is_dir())

    def data_dir(self, ws: Workspace) -> Path:
        return self.org_data_dir(ws.org) / ws.name

    def org_data_dir(self, org: Org) -> Path:
        """The org's folder — `org.db` (teams · titles · org audit) and its workspaces."""
        return self.solution_data_dir(org.solution) / org.name

    def solution_data_dir(self, sol: Solution) -> Path:
        """The customer's folder — `core.db` (people · logins · assignments, I39)."""
        return self.data_root / sol.meta().id


@dataclass(frozen=True)
class Solution:
    root: Path

    @property
    def core_dir(self) -> Path:
        return self.root / "core"

    @property
    def custom_dir(self) -> Path:
        return self.core_dir / "custom"

    @property
    def owner_dir(self) -> Path:
        return self.core_dir / "owner"

    @property
    def connections_path(self) -> Path:
        return self.core_dir / "connections.yaml"

    @property
    def server_config_path(self) -> Path:
        return self.core_dir / "server.yaml"

    @property
    def profile_path(self) -> Path:
        return self.core_dir / "profile.yaml"

    @property
    def orgs_dir(self) -> Path:
        return self.root / "orgs"

    def engine_lock(self) -> EngineLock:
        return _read(self.core_dir / "engine.lock", EngineLock)

    def meta(self) -> SolutionMeta:
        return _read(self.core_dir / "solution.yaml", SolutionMeta)

    def orgs(self) -> list[Org]:
        if not self.orgs_dir.is_dir():
            return []
        return [Org(self, p.name) for p in sorted(self.orgs_dir.iterdir()) if p.is_dir()]

    def org(self, name: str) -> Org:
        org = Org(self, name)
        if not org.root.is_dir():
            raise LayoutError(f"no org {name!r} in {self.root}")
        return org

    def workspaces(self) -> list[Workspace]:
        return [ws for org in self.orgs() for ws in org.workspaces()]

    # ------------------------------------------------------------------ server settings (I41)

    def _server_sources(self) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        """→ (what core/server.yaml says, {field: {place: value}} still kept elsewhere)."""
        explicit = _raw(self.server_config_path)
        found: dict[str, dict[str, Any]] = {}
        for ws in self.workspaces():
            raw = _raw(ws.root / "workspace.yaml")
            for field in SERVER_FIELDS:
                value = _normal(field, raw.get(field))
                if value is not None:
                    found.setdefault(field, {})[f"{ws.org.name}/{ws.name}"] = value
        server = _raw(self.profile_path).get("server")
        country = server.get("country") if isinstance(server, dict) else None
        if country:  # the customer profile kept its own copy until rev7 (I28 · I32)
            found.setdefault("server_country", {})["core/profile.yaml"] = str(country).upper()
        return explicit, found

    def server_conflicts(self) -> dict[str, dict[str, Any]]:
        """Every server field that two places (server.yaml included) give differently."""
        explicit, found = self._server_sources()
        out: dict[str, dict[str, Any]] = {}
        for field, places in found.items():
            values = dict(places)
            if explicit.get(field) is not None:
                values["core/server.yaml"] = _normal(field, explicit[field])
            if len({repr(v) for v in values.values()}) > 1:
                out[field] = values
        return out

    def has_legacy_server_fields(self) -> bool:
        return bool(self._server_sources()[1])

    def server_config(self, *, strict: bool = True) -> ServerConfig:
        """The server settings with any rev6 leftovers lifted in. `strict` raises on a
        disagreement (C33); otherwise server.yaml, then the first place, wins — for
        `validate`, which reports the conflict itself."""
        explicit, found = self._server_sources()
        if strict:
            conflicts = self.server_conflicts()
            if conflicts:
                raise ServerConfigConflict(conflicts)
        merged = dict(explicit)
        for field, places in found.items():
            if _normal(field, merged.get(field)) is None and places:
                merged[field] = next(iter(places.values()))
        return ServerConfig.model_validate(merged)

    def save_server_config(self, cfg: ServerConfig) -> None:
        """Write the server settings and drop every leftover copy — one value, one place."""
        _write(self.server_config_path, cfg)
        for ws in self.workspaces():
            path = ws.root / "workspace.yaml"
            raw = _raw(path)
            if any(field in raw for field in SERVER_FIELDS):
                _dump(path, {k: v for k, v in raw.items() if k not in SERVER_FIELDS})
        profile = _raw(self.profile_path)
        server = profile.get("server")
        if isinstance(server, dict) and "country" in server:
            server.pop("country")
            _dump(self.profile_path, profile)

    def lift_server_config(self) -> ServerConfig:
        """Make the lift permanent (at `serve`) — raises `ServerConfigConflict` first."""
        cfg = self.server_config()
        if self.has_legacy_server_fields() or not self.server_config_path.is_file():
            self.save_server_config(cfg)
        return cfg

    def legacy_web_locale(self) -> str | None:
        """The retired customer default language (`web.locale`) if a file still holds it —
        server.yaml first, then a rev6 workspace.yaml."""
        for path in (
            self.server_config_path,
            *(ws.root / "workspace.yaml" for ws in self.workspaces()),
        ):
            web = _raw(path).get("web")
            if isinstance(web, dict) and web.get("locale"):
                return str(web["locale"])
        return None

    def drop_legacy_web_locale(self) -> bool:
        """Remove `web.locale` everywhere once the accounts carry it (2026-11-11)."""
        dropped = False
        for path in (
            self.server_config_path,
            *(ws.root / "workspace.yaml" for ws in self.workspaces()),
        ):
            raw = _raw(path)
            web = raw.get("web")
            if isinstance(web, dict) and "locale" in web:
                web.pop("locale")
                if not web:
                    raw.pop("web")
                _dump(path, raw)
                dropped = True
        return dropped

    def update_server_config(self, **changes: Any) -> ServerConfig:
        """Set some server fields. Setting a field settles a disagreement about it; one
        about any other field still stops the write (K50)."""
        left = {k: v for k, v in self.server_conflicts().items() if k not in changes}
        if left:
            raise ServerConfigConflict(left)
        cfg = self.server_config(strict=False).model_copy(update=changes)
        self.save_server_config(ServerConfig.model_validate(cfg.model_dump(mode="json")))
        return self.server_config()

    def update_server_country(self, country: str | None) -> ServerConfig:
        return self.update_server_config(server_country=country.upper() if country else None)


@dataclass(frozen=True)
class Org:
    solution: Solution
    name: str

    @property
    def root(self) -> Path:
        return self.solution.orgs_dir / self.name

    @property
    def team_dir(self) -> Path:
        return self.root / "team"

    @property
    def workspaces_dir(self) -> Path:
        return self.root / "workspaces"

    def lock(self) -> OrgLock:
        return _read(self.root / "org.lock", OrgLock)

    def config(self) -> OrgConfig:
        return _read(self.root / "org.yaml", OrgConfig)

    def set_entity(self, entity_id: int | None) -> None:
        """Write the 소속 법인 into `org.yaml`, keeping every other key as it is."""
        path = self.root / "org.yaml"
        doc = _raw(path)
        if entity_id is None:
            doc.pop("entity_id", None)
        else:
            doc["entity_id"] = entity_id
        _dump(path, doc)

    def workspaces(self) -> list[Workspace]:
        if not self.workspaces_dir.is_dir():
            return []
        return [
            Workspace(self, p.name) for p in sorted(self.workspaces_dir.iterdir()) if p.is_dir()
        ]

    def workspace(self, name: str) -> Workspace:
        ws = Workspace(self, name)
        if not ws.root.is_dir():
            raise LayoutError(f"no workspace {name!r} in org {self.name!r}")
        return ws


@dataclass(frozen=True)
class Workspace:
    org: Org
    name: str

    @property
    def root(self) -> Path:
        return self.org.workspaces_dir / self.name

    @property
    def repositories_dir(self) -> Path:
        return self.root / "repositories"

    def config(self) -> WorkspaceConfig:
        return _read(self.root / "workspace.yaml", WorkspaceConfig)

    def save_config(self, cfg: WorkspaceConfig) -> None:
        """Business settings only. A rev6 file is lifted into `core/server.yaml` first, so
        dropping its server fields here never loses a value."""
        if self.org.solution.has_legacy_server_fields():
            self.org.solution.lift_server_config()
        _write(self.root / "workspace.yaml", cfg, drop=SERVER_FIELDS)


def _mkdirs(*paths: Path) -> None:
    for p in paths:
        p.mkdir(parents=True, exist_ok=True)
        keep = p / ".gitkeep"
        if not any(p.iterdir()):
            keep.touch()


def scaffold_solution(
    root: Path,
    engine_version: str,
    owner_templates: Path | None = None,
    server_type: ServerType | None = None,
) -> Solution:
    """Create `core/` for a new customer. Refuses to touch a non-empty directory.

    `owner_templates` (the bundle's `user/`) seeds `core/owner/` with editable starters.
    """
    if root.exists() and any(root.iterdir()):
        raise LayoutError(f"{root} is not empty")
    sol = Solution(root)
    sol.owner_dir.mkdir(parents=True)
    if owner_templates is not None and owner_templates.is_dir():
        for src in sorted(owner_templates.glob("*.md")):
            (sol.owner_dir / src.name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    _mkdirs(sol.owner_dir, *(sol.custom_dir / d for d in CUSTOM_DIRS), sol.orgs_dir)
    _write(sol.core_dir / "engine.lock", EngineLock(version=engine_version))
    _write(sol.core_dir / "solution.yaml", SolutionMeta(id=f"sol-{secrets.token_hex(6)}"))
    _write(sol.server_config_path, ServerConfig(type=server_type))
    sol.connections_path.write_text("schema_version: 1\nconnections: []\n", encoding="utf-8")
    return sol


def display_name(value: str | None) -> str | None:
    """A display name as stored: trimmed, one line, at most 60 characters; blank = none."""
    if value is None:
        return None
    text = " ".join(value.split())
    if len(text) > 60:
        raise LayoutError("a display name is at most 60 characters")
    return text or None


def scaffold_org(
    sol: Solution, name: str, package: str, package_version: str, display: str | None = None
) -> Org:
    shown = display_name(display)
    org = Org(sol, name)
    if org.root.exists():
        raise LayoutError(f"org {name!r} already exists")
    t = org.team_dir
    _mkdirs(
        t / "agents",
        t / "skills",
        *(org.root / d for d in ("knowledge", "workflows", "goals", "crons")),
    )
    _mkdirs(org.workspaces_dir)
    (t / "teams.yaml").write_text("schema_version: 1\nteams: {}\n", encoding="utf-8")
    _write(org.root / "org.lock", OrgLock(package=package, version=package_version))
    _write(org.root / "org.yaml", OrgConfig(name=name, display_name=shown))
    return org


def scaffold_workspace(org: Org, name: str, display: str | None = None) -> Workspace:
    shown = display_name(display)
    ws = Workspace(org, name)
    if ws.root.exists():
        raise LayoutError(f"workspace {name!r} already exists in org {org.name!r}")
    _mkdirs(ws.repositories_dir)
    cfg = WorkspaceConfig(name=name, display_name=shown)
    _write(ws.root / "workspace.yaml", cfg, drop=SERVER_FIELDS)
    (ws.root / "local.yaml").write_text(
        "schema_version: 1\nanalysis_allowed_paths: []\nlocal_apps: []\n", encoding="utf-8"
    )
    return ws
