"""C29 — retention keeps exactly what is still inside its period (decision 54 ⑶).

Both sides of every boundary, expired sessions, and a period the customer changed.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from typer.testing import CliRunner

from solosquad.cli import app
from solosquad.instance import Instance, build_instance
from solosquad.layout import Solution
from solosquad.maintenance import DAY, run_retention
from solosquad.runtime import RunStatus
from solosquad.web_api.accounts import AccountStore, Role, SessionStage


def _office(tmp_path: Path) -> tuple[Path, Instance]:
    sol = tmp_path / "moa"
    assert CliRunner().invoke(app, ["init", str(sol), "--org", "moa"]).exit_code == 0
    return sol, build_instance(sol, "moa", "hq")


def _closed_thread(inst: Instance, title: str, age_days: float, now: float) -> str:
    store = inst.manager.store
    tid = store.create_thread(title)
    store.set_status(store.create_run(tid, "message", "hi", "user"), RunStatus.SUCCESS)
    store._exec(f"UPDATE {store.T} SET updated = ? WHERE id = ?", (now - age_days * DAY, tid))
    return tid


def _upload(inst: Instance, name: str, age_days: float, now: float) -> str:
    assert inst.workflows is not None
    up = inst.workflows.save_upload(name, b"a,b\n1,2\n")
    meta = inst.workflows.uploads / f"{up['id']}.json"
    meta.write_text(json.dumps({**up, "created": now - age_days * DAY}), encoding="utf-8")
    return str(up["id"])


def _uploads(inst: Instance) -> set[str]:
    assert inst.workflows is not None
    return {p.stem for p in inst.workflows.uploads.glob("*.json")}


def test_both_sides_of_every_default_boundary(tmp_path: Path) -> None:
    _sol, inst = _office(tmp_path)
    now = time.time()
    store = inst.manager.store
    inside = _closed_thread(inst, "two years old", 2 * 365, now)  # business records: 3 years
    outside = _closed_thread(inst, "four years old", 4 * 365, now)
    young = _upload(inst, "89일.csv", 89, now)  # uploads: 90 days
    aged = _upload(inst, "91일.csv", 91, now)
    accounts = AccountStore(tmp_path / "core.db")
    uid = accounts.create_user("kim", "correct horse battery", Role.STAFF).id
    live, _ = accounts.open_session(uid, SessionStage.FULL)
    gone, _ = accounts.open_session(uid, SessionStage.FULL)
    accounts._q(  # one session ran out a minute ago
        "UPDATE sessions SET expires = ? WHERE user_id = ? AND expires = "
        "(SELECT MAX(expires) FROM sessions WHERE user_id = ?)",
        (now - 60, uid, uid),
    )
    for age, action in ((364, "inside a year"), (366, "outside a year")):  # audit: 1 year
        accounts.audit(uid, action, "")
        accounts._q("UPDATE audit SET ts = ? WHERE action = ?", (now - age * DAY, action))

    counts = run_retention(inst, accounts, now=now)

    assert store.thread(inside) is not None and store.thread(outside) is None
    assert _uploads(inst) == {young} and aged not in _uploads(inst)
    assert counts["sessions"] == 1 and counts["uploads"] == 1 and counts["threads"] == 1
    assert sum(accounts.session(t) is not None for t in (live, gone)) == 1  # the live one stays
    left = {e["action"] for e in accounts.audit_log()}
    assert "inside a year" in left and "outside a year" not in left


def test_a_period_the_customer_changed_is_the_one_used(tmp_path: Path) -> None:
    sol, inst = _office(tmp_path)
    ws = Solution(sol).org("moa").workspace("hq")
    cfg = ws.config()
    ws.save_config(  # the customer keeps business records 1 year and uploads 30 days
        cfg.model_copy(
            update={
                "retention": cfg.retention.model_copy(
                    update={"business_records_days": 365, "uploads_days": 30}
                )
            }
        )
    )
    now = time.time()
    store = inst.manager.store
    kept = _closed_thread(inst, "half a year", 180, now)
    purged = _closed_thread(
        inst, "two years — inside the default, outside the customer's", 730, now
    )
    young = _upload(inst, "20일.csv", 20, now)
    _upload(inst, "40일.csv", 40, now)  # inside the default 90, outside the customer's 30

    run_retention(inst, now=now)  # the running instance reads workspace.yaml as it is now

    assert store.thread(kept) is not None and store.thread(purged) is None
    assert _uploads(inst) == {young}
