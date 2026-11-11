"""`ExecutionContext` — the one immutable "who and where" of a run (§B4; graph `context_schema`)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from solosquad.layout import (
    EngineStore,
    ServerConfig,
    Solution,
    WorkspaceConfig,
    WorkspaceType,
    solosquad_home,
)


@dataclass(frozen=True)
class ExecutionContext:
    solution_root: Path
    solution_id: str
    org: str
    workspace: str
    workspace_type: WorkspaceType
    """The engine server's type (I41) — every workspace on one server shares it."""
    timezone: str
    engine_version: str
    data_dir: Path
    bundle_root: Path
    """Package templates the org started from (today: the bundled primitives)."""
    workspace_config: WorkspaceConfig
    server: ServerConfig
    """`core/server.yaml` as it was when this runtime was built."""

    @property
    def solution(self) -> Solution:
        return Solution(self.solution_root)

    @property
    def org_root(self) -> Path:
        return self.solution.orgs_dir / self.org

    @property
    def workspace_root(self) -> Path:
        return self.org_root / "workspaces" / self.workspace

    @property
    def custom_dir(self) -> Path:
        return self.solution.custom_dir

    @property
    def db_path(self) -> Path:
        """The office database (decision 54) — every engine table of this workspace."""
        return self.data_dir / "office.db"


def build_context(
    solution_root: Path,
    org: str,
    workspace: str,
    bundle_root: Path,
    data_dir: Path | None = None,
    home: Path | None = None,
    *,
    server: ServerConfig | None = None,
) -> ExecutionContext:
    """`server` = the server settings to use; read (strictly — C33) when not given."""
    sol = Solution(solution_root)
    ws = sol.org(org).workspace(workspace)
    cfg = ws.config()
    srv = server if server is not None else sol.server_config()
    store = EngineStore(home or solosquad_home())
    return ExecutionContext(
        solution_root=solution_root,
        solution_id=sol.meta().id,
        org=org,
        workspace=workspace,
        workspace_type=srv.type or WorkspaceType(srv.facts().where),
        timezone=cfg.timezone,
        engine_version=sol.engine_lock().version,
        data_dir=data_dir or store.data_dir(ws),
        bundle_root=bundle_root,
        workspace_config=cfg,
        server=srv,
    )
