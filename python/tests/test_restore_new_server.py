"""C17 — a snapshot restored on a new server brings the office back as it was.

The old VM is gone: a fresh `SOLOSQUAD_HOME`, the customer repo cloned again, and the
snapshot from the customer's own storage. After `snapshot restore` the owner logs in with
the same password, and threads, runs, the ledger and artifacts match the old server.
"""

from __future__ import annotations

import gc
import shutil
import sqlite3
from pathlib import Path

import pytest
from typer.testing import CliRunner

from solosquad.cli import app
from solosquad.context.ledger import LedgerEntry
from solosquad.engine_server import build_engine
from solosquad.maintenance import run_snapshot
from solosquad.runtime import RunStatus
from solosquad.web_api.accounts import Role

PASSWORD = "correct horse battery"
TABLES = ("threads", "runs", "ledger", "artifacts")


def _rows(db: Path) -> dict[str, int]:
    con = sqlite3.connect(db)
    try:
        names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        return {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES
                if t in names}  # fmt: skip
    finally:
        con.close()


def test_restore_on_a_new_server(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    run = CliRunner().invoke
    old_home, new_home = tmp_path / "old-vm", tmp_path / "new-vm"
    monkeypatch.setenv("SOLOSQUAD_HOME", str(old_home))
    sol = tmp_path / "old-vm-repo" / "moa"
    assert run(app, ["init", str(sol), "--org", "moa"]).exit_code == 0
    vault = tmp_path / "customer-bucket"  # stands in for the customer's object storage
    res = run(app, ["snapshot", "set", "--type", "dir", "--path", str(vault), "-s", str(sol)])
    assert res.exit_code == 0, res.output

    # --- the old server: an owner, a finished task, its spend and an artifact
    engine = build_engine(sol)
    engine.accounts.create_user("boss", PASSWORD, Role.OWNER)
    inst = engine.runtimes[("moa", "hq")]
    store = inst.manager.store
    tid = store.create_thread("월 손익 정리")
    store.set_status(
        store.create_run(tid, "message", "손익표 만들어 줘", "user"), RunStatus.SUCCESS
    )
    inst.ledger.record(LedgerEntry(thread_id=tid, org="moa", workspace="hq", agent="finance",
                                   connection_id="c", harness="lite", model=None, cost_usd=0.42))  # fmt: skip
    assert inst.artifacts is not None
    inst.artifacts.save("brief", "손익 요약", {"text": "순이익 1,200만원"})
    before = _rows(inst.ctx.data_dir / "office.db")
    assert before["threads"] == 1 and before["runs"] == 1 and before["ledger"] == 1
    run_snapshot(engine)
    del inst, store, engine
    gc.collect()

    # --- the old VM is gone: a fresh home, the repo cloned again
    monkeypatch.setenv("SOLOSQUAD_HOME", str(new_home))
    clone = tmp_path / "new-vm-repo" / "moa"
    shutil.copytree(sol, clone)
    assert not new_home.exists() or not any(new_home.rglob("*.db"))
    res = run(app, ["snapshot", "restore", "--yes", "-s", str(clone)])
    assert res.exit_code == 0, res.output

    engine = build_engine(clone)
    try:
        token, session = engine.accounts.login("boss", PASSWORD, None, require_second_factor=False)
        assert token and session.user.role is Role.OWNER  # the same password still works
        inst = engine.runtimes[("moa", "hq")]
        after = _rows(inst.ctx.data_dir / "office.db")
        assert after == before
        [thread] = inst.manager.store.threads()
        assert thread["title"] == "월 손익 정리"
        assert [r["status"] for r in inst.manager.store.runs()] == [RunStatus.SUCCESS]
        assert inst.artifacts is not None
        [brief] = inst.artifacts.find(kind="brief")
        assert brief.data == {"text": "순이익 1,200만원"}
        assert new_home in (inst.ctx.data_dir / "office.db").parents  # on the new server's disk
    finally:
        del engine
        gc.collect()
