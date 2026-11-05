"""Daily upkeep of an office's data (decision 54 · PRD v2.1.0 I35 · I36).

- **retention** — delete what has outlived its data class: business records (threads that
  are idle and closed, with their runs and checkpoints; ledger rows; artifacts) after
  `retention.business_records_days`, uploads after `retention.uploads_days`, the org's
  audit after `retention.audit_days`, expired sessions and stale login failures always.
  A thread with a run still open (pending · running · waiting for approval) is never
  touched, whatever its age.
- **backup** — online copies of `org.db` and `office.db` with a manifest; slice 5 ships the
  folder to the customer's object storage and keeps 30 days.

Every purge is written to the audit log with its counts, so a deletion is never silent.
"""

from __future__ import annotations

import asyncio
import contextlib
import tempfile
import time
from pathlib import Path
from typing import Any

from solosquad.graph.checkpoint import SqliteSaver
from solosquad.instance import Instance
from solosquad.layout import WorkspaceConfig
from solosquad.snapshots import ship
from solosquad.storage import OFFICE_DB, ORG_DB, backup
from solosquad.web_api.accounts import AccountStore

DAY = 86400.0
FIRST_RUN_DELAY_S = 10 * 60
"""Not at boot — a restart loop should not purge on every start."""


def current_config(inst: Instance) -> WorkspaceConfig:
    """workspace.yaml as it is now — the owner may have changed retention or the snapshot
    target in the web after this instance was built; upkeep follows the file."""
    ctx = inst.ctx
    try:
        return ctx.solution.org(ctx.org).workspace(ctx.workspace).config()
    except Exception:  # unreadable for a moment (being saved) — the last known config
        return ctx.workspace_config


def run_retention(
    inst: Instance, accounts: AccountStore | None, *, now: float | None = None
) -> dict[str, Any]:
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


def backup_instance(inst: Instance, org_dir: Path, dest: Path | None = None) -> dict[str, Any]:
    target = dest or inst.ctx.data_dir / "backups" / time.strftime("%Y%m%d-%H%M%S")
    return backup({"org": org_dir / ORG_DB, "office": inst.ctx.data_dir / OFFICE_DB}, target)


def run_snapshot(inst: Instance, org_dir: Path, *, now: float | None = None) -> dict[str, Any]:
    """Back up both databases to a temporary folder and ship it to the configured target."""
    target = current_config(inst).snapshot
    if target.type is None:
        return {"target": None, "skipped": "no snapshot target configured"}
    with tempfile.TemporaryDirectory(prefix="solosquad-snap-") as tmp:
        backup_instance(inst, org_dir, Path(tmp))
        scope = f"{inst.ctx.solution_id}/{inst.ctx.org}/{inst.ctx.workspace}"
        return ship(Path(tmp), target, scope, secret=inst.secrets.get, now=now)


async def maintenance_loop(
    inst: Instance,
    accounts: AccountStore | None,
    *,
    org_dir: Path | None = None,
    interval_s: float = DAY,
) -> None:
    """Runs inside `serve`: once after `FIRST_RUN_DELAY_S`, then every `interval_s`."""
    await asyncio.sleep(FIRST_RUN_DELAY_S)
    while True:
        with contextlib.suppress(Exception):  # upkeep never takes the office down
            await asyncio.to_thread(run_retention, inst, accounts)
        if org_dir is not None:
            try:
                result = await asyncio.to_thread(run_snapshot, inst, org_dir)
                if accounts is not None and result.get("target"):
                    accounts.audit(None, "snapshot", repr(result))
            except Exception as e:  # a failed upload is recorded, never fatal (K47)
                if accounts is not None:
                    accounts.audit(None, "snapshot.failed", f"{type(e).__name__}: {e}")
        await asyncio.sleep(interval_s)
