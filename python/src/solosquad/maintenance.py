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
import time
from pathlib import Path
from typing import Any

from solosquad.graph.checkpoint import SqliteSaver
from solosquad.instance import Instance
from solosquad.storage import OFFICE_DB, ORG_DB, backup
from solosquad.web_api.accounts import AccountStore

DAY = 86400.0
FIRST_RUN_DELAY_S = 10 * 60
"""Not at boot — a restart loop should not purge on every start."""


def run_retention(
    inst: Instance, accounts: AccountStore | None, *, now: float | None = None
) -> dict[str, Any]:
    t = time.time() if now is None else now
    rules = inst.ctx.workspace_config.retention
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


async def maintenance_loop(
    inst: Instance, accounts: AccountStore | None, *, interval_s: float = DAY
) -> None:
    """Runs inside `serve`: once after `FIRST_RUN_DELAY_S`, then every `interval_s`."""
    await asyncio.sleep(FIRST_RUN_DELAY_S)
    while True:
        with contextlib.suppress(Exception):  # upkeep never takes the office down
            await asyncio.to_thread(run_retention, inst, accounts)
        await asyncio.sleep(interval_s)
