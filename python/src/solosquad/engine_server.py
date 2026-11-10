"""The engine server — one `serve` process for the whole customer (decision 57 ⑶ · I38).

    engine server   login · web · accounts (`core.db`) · upkeep · snapshots
      └─ workspace runtime x N   one per workspace placed on this server (`Instance`):
                                 its data folder, `office.db`, run manager, crons,
                                 workflows, ledger, artifacts and concurrency limit

`core/server.yaml` `placement` says which orgs and workspaces this server runs (default:
all). A runtime knows only its own data folder and connections and never calls another
runtime. A runtime that fails to build or to start is recorded in `failed` and left out —
the server and every other runtime keep going (K49); its web scope answers 503.
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

from solosquad.instance import Instance, build_instance, start_instance, stop_instance
from solosquad.layout import EngineStore, Placement, ServerConfig, Solution, solosquad_home
from solosquad.routing.eligibility import Entity
from solosquad.routing.vault import SecretStore
from solosquad.snapshots import S3_SECRET_REF
from solosquad.web_api.accounts import AccountStore
from solosquad.web_api.org_store import OrgStore, open_accounts, open_org

Key = tuple[str, str]
"""(org, workspace)"""


@dataclass
class EngineServer:
    solution: Solution
    server: ServerConfig
    accounts: AccountStore
    secrets: SecretStore
    """The customer's own secret store (the snapshot keys) — `data/<id>/secrets.json`."""
    home: Path
    runtimes: dict[Key, Instance] = field(default_factory=dict)
    failed: dict[Key, str] = field(default_factory=dict)
    orgs: dict[str, OrgStore] = field(default_factory=dict)
    placed: list[Key] = field(default_factory=list)
    """Every workspace this server is meant to run, started or not."""

    @property
    def store(self) -> EngineStore:
        return EngineStore(self.home)

    @property
    def solution_id(self) -> str:
        return self.solution.meta().id

    @property
    def data_dir(self) -> Path:
        return self.store.solution_data_dir(self.solution)

    def org_dir(self, org: str) -> Path:
        return self.store.org_data_dir(self.solution.org(org))

    def runtime(self, org: str, workspace: str) -> Instance | None:
        return self.runtimes.get((org, workspace))

    def org_runtimes(self, org: str) -> list[Instance]:
        return [inst for (o, _w), inst in sorted(self.runtimes.items()) if o == org]


def build_engine(
    solution: Path,
    *,
    bundle: Path | None = None,
    home: Path | None = None,
    include: list[str] | None = None,
    max_concurrency: int | None = None,
    build: Callable[..., Instance] = build_instance,
) -> EngineServer:
    """Every placed workspace's runtime. `include` narrows the placement for this run
    (`serve --org/--workspace`). Raises only for what concerns the whole customer — a
    server-settings conflict (C33) or a failed account move (C32): those refuse the start."""
    sol = Solution(solution)
    home = home or solosquad_home()
    server = sol.lift_server_config()
    accounts = open_accounts(sol, home)
    data_dir = EngineStore(home).solution_data_dir(sol)
    secrets = SecretStore(data_dir / "secrets.json")
    secrets.migrate()
    placement = Placement(include=include) if include else server.placement
    engine = EngineServer(sol, server, accounts, secrets, home)
    for ws in sol.workspaces():
        key = (ws.org.name, ws.name)
        if not (server.placement.places(*key) and placement.places(*key)):
            continue
        engine.placed.append(key)
        if ws.org.name not in engine.orgs:
            engine.orgs[ws.org.name] = open_org(sol, ws.org.name, home)
        try:
            engine.runtimes[key] = build(
                sol.root,
                ws.org.name,
                ws.name,
                bundle=bundle,
                data_dir=EngineStore(home).data_dir(ws),
                max_concurrency=max_concurrency,
            )
        except Exception as e:  # one broken workspace never keeps the others down (K49)
            engine.failed[key] = f"{type(e).__name__}: {e}"
    set_holder(engine.runtimes.values(), accounts.company().holder())
    _adopt_snapshot_key(engine)
    return engine


def set_holder(runtimes: Iterable[Instance], holder: Entity | None) -> None:
    """Every router judges its connections against the customer company (회사, decision 45)."""
    for inst in runtimes:
        if inst.router is not None:
            inst.router.holder = holder


def _adopt_snapshot_key(engine: EngineServer) -> None:
    """rev6 kept the snapshot keys in an office's secret store; the target is the
    customer's now (I41), so its keys move to the customer's store once."""
    if engine.secrets.get(S3_SECRET_REF):
        return
    for inst in engine.runtimes.values():
        value = inst.secrets.get(S3_SECRET_REF)
        if value:
            engine.secrets.set(S3_SECRET_REF, value)
            return


async def start_engine(engine: EngineServer) -> dict[Key, list[str]]:
    """Start every runtime → the runs each resumed. A runtime that fails to start is moved
    to `failed` and stopped; the others start regardless."""
    resumed: dict[Key, list[str]] = {}
    for key, inst in list(engine.runtimes.items()):
        try:
            resumed[key] = await start_instance(inst)
        except Exception as e:
            engine.failed[key] = f"{type(e).__name__}: {e}"
            engine.runtimes.pop(key)
            with contextlib.suppress(Exception):
                await stop_instance(inst)
    return resumed


async def stop_engine(engine: EngineServer) -> None:
    for inst in engine.runtimes.values():
        with contextlib.suppress(Exception):
            await stop_instance(inst)
