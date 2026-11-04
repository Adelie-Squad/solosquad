"""One running instance = one workspace (office) of one org (decision 40).

Assembles everything a 24/7 office needs from the customer-solution repo and the data
folder: context, customization, connections, Chief's policy, router, the company graph and
the run manager. Paths are always passed in; nothing assumes a single global company.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from solosquad.assets.bundle import find_bundle_root
from solosquad.company import AgentRuntime, build_company
from solosquad.context import Ledger, Resolver, build_context
from solosquad.context.execution import ExecutionContext
from solosquad.extensions import EngineCustomization, load_customization
from solosquad.routing import Connection, Router, SecretStore, load_connections, load_policy
from solosquad.runtime import RunManager
from solosquad.runtime.manager import load_crons
from solosquad.runtime.store import RunStore
from solosquad.runtime.worktree import ensure_worktree


def default_bundle() -> Path:
    here = Path(__file__).resolve().parent
    found = find_bundle_root(here)
    if found is None:
        raise FileNotFoundError("bundled primitives (agents/, teams/) not found next to the engine")
    return found


@dataclass
class Instance:
    ctx: ExecutionContext
    customization: EngineCustomization
    connections: list[Connection]
    secrets: SecretStore
    ledger: Ledger
    router: Router
    manager: RunManager

    @property
    def secrets_path(self) -> Path:
        return self.secrets.path


def connections_for(ctx: ExecutionContext) -> list[Connection]:
    """Owner's connections, plus any the org added for separate billing (org wins on id clash)."""
    merged = {c.id: c for c in load_connections(ctx.solution.connections_path)}
    merged.update({c.id: c for c in load_connections(ctx.org_root / "connections.yaml")})
    return list(merged.values())


def build_instance(
    solution: Path,
    org: str,
    workspace: str,
    *,
    bundle: Path | None = None,
    data_dir: Path | None = None,
    max_concurrency: int | None = None,
) -> Instance:
    ctx = build_context(solution, org, workspace, bundle or default_bundle(), data_dir)
    ctx.data_dir.mkdir(parents=True, exist_ok=True)
    custom = load_customization(ctx.custom_dir, ctx.engine_version)
    secrets = SecretStore(ctx.data_dir / "secrets.json")
    ledger = Ledger(ctx.data_dir / "ledger.sqlite")
    store = RunStore(ctx.data_dir / "runs.sqlite")
    router = Router(
        connections_for(ctx),
        ctx.workspace_config.execution,
        load_policy(ctx.org_root / "policy.yaml", custom.routing),
        ledger,
        secrets,
        org=org,
    )
    rt = AgentRuntime(ctx, Resolver(ctx), router, ledger, custom)

    def thread_defaults(thread_id: str) -> dict[str, object]:
        meta = (store.thread(thread_id) or {}).get("metadata") or {}
        repo = meta.get("repo")
        if isinstance(repo, str):
            return {"workdir": str(ensure_worktree(Path(repo), ctx.data_dir, thread_id))}
        return {}

    manager = RunManager(
        build_company(rt),
        store,
        timezone=ctx.timezone,
        max_concurrency=max_concurrency or int(custom.config.get("max_concurrency", 4)),
        context=ctx,
        thread_defaults=thread_defaults,
    )
    router.on_escalation = manager.escalate
    return Instance(ctx, custom, router.connections, secrets, ledger, router, manager)


async def start_instance(inst: Instance) -> list[str]:
    return await inst.manager.start(load_crons(inst.ctx.org_root / "crons"))
