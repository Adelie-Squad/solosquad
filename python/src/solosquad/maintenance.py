"""Daily upkeep of the customer's data (decision 54 · PRD v2.1.0 I35 · I36 · I38).

Since decision 57 one engine server runs every workspace of the customer, so upkeep runs
once for the customer, over three scopes:

- **retention** — per workspace runtime, by that workspace's `retention` rules: business
  records (threads that are idle and closed, with their runs and checkpoints; ledger rows;
  artifacts) after `business_records_days`, uploads after `uploads_days`. A thread with a
  run still open (pending · running · waiting for approval) is never touched, whatever its
  age. Then each org's audit (`org.db`) and the customer's login audit, expired sessions
  and stale login failures (`core.db`) — audit kept for the longest `audit_days` of the
  workspaces it covers, so no business loses audit it asked to keep.
- **backup** — online copies of `core.db`, every `org.db` and every `office.db`, all pinned
  to the same moment (PR #29 · I36), with a manifest; the snapshot job ships the folder to
  the customer's object storage and keeps `keep_days`.

Every purge is written to the audit log with its counts, so a deletion is never silent.
One runtime's failure is recorded and never stops the others (K49).
"""

from __future__ import annotations

import asyncio
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from solosquad.graph.checkpoint import SqliteSaver
from solosquad.instance import Instance
from solosquad.layout import ServerConfig, WorkspaceConfig
from solosquad.snapshots import ship
from solosquad.storage import CORE_DB, OFFICE_DB, ORG_DB, backup
from solosquad.web_api.accounts import AccountStore

if TYPE_CHECKING:
    from solosquad.engine_server import EngineServer

DAY = 86400.0
FIRST_RUN_DELAY_S = 10 * 60
"""Not at boot — a restart loop should not purge on every start."""


def current_config(inst: Instance) -> WorkspaceConfig:
    """workspace.yaml as it is now — the owner may have changed retention in the web after
    this runtime was built; upkeep follows the file."""
    ctx = inst.ctx
    try:
        return ctx.solution.org(ctx.org).workspace(ctx.workspace).config()
    except Exception:  # unreadable for a moment (being saved) — the last known config
        return ctx.workspace_config


def current_server(sol_root: Path, fallback: ServerConfig) -> ServerConfig:
    """core/server.yaml as it is now (the snapshot target lives there since I41)."""
    from solosquad.layout import Solution

    try:
        return Solution(sol_root).server_config()
    except Exception:
        return fallback


def run_retention(
    inst: Instance, accounts: AccountStore | None = None, *, now: float | None = None
) -> dict[str, Any]:
    """One workspace's business records; with `accounts`, also the login data (one office)."""
    t = time.time() if now is None else now
    rules = current_config(inst).retention
    before = t - rules.business_records_days * DAY
    out: dict[str, Any] = {}

    removed: list[str] = []
    stores = [(inst.manager.store, inst.manager.graph.checkpointer)]
    if inst.workflows is not None:
        stores.append((inst.workflows.manager.store, inst.workflows.graph.checkpointer))
    for runs, saver in stores:
        gone = runs.purge(before)
        if isinstance(saver, SqliteSaver):
            for tid in gone:
                saver.delete_thread(tid)
        removed += gone
    out["threads"] = len(removed)
    out["ledger"] = inst.ledger.purge(before)
    out["artifacts"] = inst.artifacts.purge(before) if inst.artifacts else 0
    out["uploads"] = (
        inst.workflows.purge_uploads(t - rules.uploads_days * DAY) if inst.workflows else 0
    )
    if accounts is not None:
        out.update(accounts.purge(audit_days=rules.audit_days, now=t))
        accounts.audit(None, "retention.purge", repr(out))
    return out


def run_customer_retention(engine: EngineServer, *, now: float | None = None) -> dict[str, Any]:
    """Retention for every runtime, every org and the customer — once, together (I38)."""
    t = time.time() if now is None else now
    out: dict[str, Any] = {}
    days: dict[str, int] = {}
    for (org, ws), inst in sorted(engine.runtimes.items()):
        key = f"{org}/{ws}"
        days[org] = max(days.get(org, 0), current_config(inst).retention.audit_days)
        try:
            counts = run_retention(inst, now=t)
        except Exception as e:  # one workspace never stops the others' upkeep (K49)
            out[key] = {"error": f"{type(e).__name__}: {e}"}
            continue
        out[key] = counts
        if org in engine.orgs:
            engine.orgs[org].audit(None, "retention.purge", repr(counts), workspace=ws)
    for org, store in engine.orgs.items():
        if org in days:
            out[f"{org}:audit"] = store.purge(audit_days=days[org], now=t)
    longest = max(days.values(), default=WorkspaceConfig(name="-").retention.audit_days)
    out["core"] = engine.accounts.purge(audit_days=longest, now=t)
    engine.accounts.audit(None, "retention.purge", repr(out))
    return out


def backup_files(engine: EngineServer) -> dict[str, Path]:
    """Every database of the customer under a stable name: `core`, `org~<org>`,
    `office~<org>~<ws>` — `~` keeps the names apart whatever the org is called."""
    files = {"core": engine.data_dir / CORE_DB}
    for org in sorted(engine.orgs):
        files[f"org~{org}"] = engine.org_dir(org) / ORG_DB
    for org, ws in sorted(engine.runtimes):
        files[f"office~{org}~{ws}"] = engine.runtimes[(org, ws)].ctx.data_dir / OFFICE_DB
    return files


def backup_customer(engine: EngineServer, dest: Path | None = None) -> dict[str, Any]:
    target = dest or engine.data_dir / "backups" / time.strftime("%Y%m%d-%H%M%S")
    return backup(backup_files(engine), target)


def run_snapshot(engine: EngineServer, *, now: float | None = None) -> dict[str, Any]:
    """Back up every database at one moment to a temporary folder and ship it."""
    target = current_server(engine.solution.root, engine.server).snapshot
    if target.type is None:
        return {"target": None, "skipped": "no snapshot target configured"}
    with tempfile.TemporaryDirectory(prefix="solosquad-snap-") as tmp:
        backup_customer(engine, Path(tmp))
        return ship(Path(tmp), target, engine.solution_id, secret=engine.secrets.get, now=now)


async def maintenance_loop(engine: EngineServer, *, interval_s: float = DAY) -> None:
    """Runs inside `serve`: once after `FIRST_RUN_DELAY_S`, then every `interval_s`."""
    await asyncio.sleep(FIRST_RUN_DELAY_S)
    while True:
        try:
            await asyncio.to_thread(run_customer_retention, engine)
        except Exception as e:  # upkeep never takes the server down
            engine.accounts.audit(None, "retention.failed", f"{type(e).__name__}: {e}")
        try:
            result = await asyncio.to_thread(run_snapshot, engine)
            if result.get("target"):
                engine.accounts.audit(None, "snapshot", repr(result))
        except Exception as e:  # a failed upload is recorded, never fatal (K47)
            engine.accounts.audit(None, "snapshot.failed", f"{type(e).__name__}: {e}")
        await asyncio.sleep(interval_s)
