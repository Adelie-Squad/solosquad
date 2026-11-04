"""`ExecutionContext` — the one immutable "who and where" of a run (§B4; graph `context_schema`)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from solosquad.layout import EngineStore, Solution, WorkspaceConfig, WorkspaceType, solosquad_home


@dataclass(frozen=True)
class ExecutionContext:
    solution_root: Path
    solution_id: str
    org: str
    workspace: str
    workspace_type: WorkspaceType
    timezone: str
    engine_version: str
    data_dir: Path
    bundle_root: Path
    """Package templates the org started from (today: the bundled primitives)."""
    workspace_config: WorkspaceConfig

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
        return self.data_dir / "state.sqlite"


def build_context(
    solution_root: Path,
    org: str,
    workspace: str,
    bundle_root: Path,
    data_dir: Path | None = None,
    home: Path | None = None,
) -> ExecutionContext:
    sol = Solution(solution_root)
    ws = sol.org(org).workspace(workspace)
    cfg = ws.config()
    store = EngineStore(home or solosquad_home())
    return ExecutionContext(
        solution_root=solution_root,
        solution_id=sol.meta().id,
        org=org,
        workspace=workspace,
        workspace_type=cfg.type,
        timezone=cfg.timezone,
        engine_version=sol.engine_lock().version,
        data_dir=data_dir or store.data_dir(ws),
        bundle_root=bundle_root,
        workspace_config=cfg,
    )
