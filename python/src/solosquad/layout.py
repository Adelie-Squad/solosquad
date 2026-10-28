"""On-disk layout of a customer solution (ideation 260803 decision 40).

    <solution>/                    one customer = one private git repo
      core/                        engine + tools (by version) and the owner
        engine.lock                which engine version this customer runs
        solution.yaml              pseudonymous solution id (decision 38)
        custom/{config,policies,hooks,tools,patches}/   engine customization
        owner/                     owner profile · traits · principles
        connections.yaml           the owner's LLM connections (secrets live elsewhere)
      orgs/<org>/                  one business
        org.lock                   org package @ version it started from
        org.yaml                   business info · logins · budget
        team/{agents,skills}/  team/teams.yaml
        knowledge/ workflows/ goals/ crons/
        workspaces/<ws>/           one office = one execution environment
          workspace.yaml           type (cloud|intranet|local) · access · execution
          local.yaml               folders/apps the FDE may analyze
          repositories/

Outside the repo, under SOLOSQUAD_HOME (default ~/.solosquad):
    engines/<version>/             engine releases, side by side, shared per machine
    data/<solution-id>/<org>/<ws>/ checkpoints · conversations · ledger · secrets

One running instance serves exactly one workspace; every path is passed in, never
assumed global, so one machine can host many customers on different engines.
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

SCHEMA_VERSION = 1
CUSTOM_DIRS = ("config", "policies", "hooks", "tools", "patches")


class LayoutError(Exception):
    pass


class WorkspaceType(StrEnum):
    CLOUD = "cloud"
    INTRANET = "intranet"
    LOCAL = "local"


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


class AccessPolicy(BaseModel):
    model_config = ConfigDict(extra="allow")
    require_login: bool = True
    two_factor: bool = False
    allowed_networks: list[str] = Field(default_factory=list)


class ExecutionPolicy(BaseModel):
    model_config = ConfigDict(extra="allow")
    allow_external_api: bool = True
    allow_subscription_cli: bool = True
    allow_internal_llm: bool = True
    allow_local_llm: bool = True


class WorkspaceConfig(_Doc):
    name: str
    type: WorkspaceType = WorkspaceType.LOCAL
    timezone: str = "Asia/Seoul"
    access: AccessPolicy = Field(default_factory=AccessPolicy)
    execution: ExecutionPolicy = Field(default_factory=ExecutionPolicy)


def _read[M: BaseModel](path: Path, model: type[M]) -> M:
    if not path.is_file():
        raise LayoutError(f"missing {path}")
    data = load_yaml(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise LayoutError(f"{path}: expected a mapping")
    return model.model_validate(data)


def _write(path: Path, model: BaseModel) -> None:
    payload: dict[str, Any] = model.model_dump(mode="json")
    path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def solosquad_home() -> Path:
    env = os.environ.get("SOLOSQUAD_HOME")
    return Path(env) if env else Path.home() / ".solosquad"


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
        return self.data_root / ws.org.solution.meta().id / ws.org.name / ws.name


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


def _mkdirs(*paths: Path) -> None:
    for p in paths:
        p.mkdir(parents=True, exist_ok=True)
        keep = p / ".gitkeep"
        if not any(p.iterdir()):
            keep.touch()


def scaffold_solution(root: Path, engine_version: str) -> Solution:
    """Create `core/` for a new customer. Refuses to touch a non-empty directory."""
    if root.exists() and any(root.iterdir()):
        raise LayoutError(f"{root} is not empty")
    sol = Solution(root)
    _mkdirs(sol.owner_dir, *(sol.custom_dir / d for d in CUSTOM_DIRS), sol.orgs_dir)
    _write(sol.core_dir / "engine.lock", EngineLock(version=engine_version))
    _write(sol.core_dir / "solution.yaml", SolutionMeta(id=f"sol-{secrets.token_hex(6)}"))
    sol.connections_path.write_text("schema_version: 1\nconnections: []\n", encoding="utf-8")
    return sol


def scaffold_org(sol: Solution, name: str, package: str, package_version: str) -> Org:
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
    _write(org.root / "org.yaml", OrgConfig(name=name))
    return org


def scaffold_workspace(
    org: Org, name: str, ws_type: WorkspaceType = WorkspaceType.LOCAL
) -> Workspace:
    ws = Workspace(org, name)
    if ws.root.exists():
        raise LayoutError(f"workspace {name!r} already exists in org {org.name!r}")
    _mkdirs(ws.repositories_dir)
    _write(ws.root / "workspace.yaml", WorkspaceConfig(name=name, type=ws_type))
    (ws.root / "local.yaml").write_text(
        "schema_version: 1\nanalysis_allowed_paths: []\nlocal_apps: []\n", encoding="utf-8"
    )
    return ws
