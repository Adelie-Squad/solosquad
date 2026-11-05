"""Decision 54 — storage layer: two scope databases, migrations, retention, backup."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import stat
import sys
import time
from pathlib import Path

import pytest
from typer.testing import CliRunner

from solosquad.check import doctor_checks
from solosquad.cli import app
from solosquad.context.ledger import LedgerEntry
from solosquad.instance import build_instance
from solosquad.layout import EngineStore, Solution, solosquad_home
from solosquad.maintenance import DAY, backup_instance, run_retention
from solosquad.runtime import RunStatus
from solosquad.storage import (
    SNAPSHOT_KEEP,
    Migration,
    MigrationFailed,
    SchemaTooNew,
    connect,
    current_version,
    migrate,
)
from solosquad.web_api.accounts import AccountStore, Role

# ---------------------------------------------------------------------- migrations


def test_migrations_apply_once_and_forward_only(tmp_path: Path) -> None:
    path = tmp_path / "office.db"
    db = connect(path)
    v1 = [Migration(1, "CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1)")]
    assert migrate(db, "comp", v1, path=path) == 1
    assert migrate(db, "comp", v1, path=path) == 1  # nothing to do, no snapshot
    assert not (tmp_path / "snapshots").exists()
    v2 = [*v1, Migration(2, "ALTER TABLE t ADD COLUMN b TEXT")]
    assert migrate(db, "comp", v2, path=path) == 2
    snaps = list((tmp_path / "snapshots").glob("office.comp-v1.*.db"))
    assert len(snaps) == 1  # the file as it was before v2
    old = sqlite3.connect(snaps[0])
    assert [r[1] for r in old.execute("PRAGMA table_info(t)")] == ["a"]
    with pytest.raises(SchemaTooNew):
        migrate(db, "comp", v1, path=path)  # an older engine meets a newer file


def test_a_failing_migration_rolls_back(tmp_path: Path) -> None:
    db = connect(tmp_path / "x.db")
    migrate(db, "c", [Migration(1, "CREATE TABLE t (a INTEGER)")])

    def boom(conn: sqlite3.Connection) -> None:
        conn.execute("INSERT INTO t VALUES (5)")
        raise RuntimeError("disk on fire")

    with pytest.raises(MigrationFailed, match="v2"):
        migrate(db, "c", [Migration(1, "CREATE TABLE t (a INTEGER)"), Migration(2, boom)])
    assert current_version(db, "c") == 1
    assert db.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 0


def test_snapshots_keep_only_the_newest(tmp_path: Path) -> None:
    path = tmp_path / "office.db"
    db = connect(path)
    steps: list[Migration] = []
    for v in range(1, SNAPSHOT_KEEP + 3):
        steps.append(Migration(v, f"CREATE TABLE t{v} (a INTEGER)"))
        migrate(db, "c", steps, path=path)
        time.sleep(0.01)
    assert len(list((tmp_path / "snapshots").glob("office.*.db"))) == SNAPSHOT_KEEP


def test_accounts_file_from_before_versioning(tmp_path: Path) -> None:
    """An org file written by PR #19's in-place column step has no schema_versions yet."""
    path = tmp_path / "org.db"
    legacy = sqlite3.connect(path)
    legacy.executescript(
        "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,"
        " display TEXT NOT NULL, role TEXT NOT NULL, pw_hash TEXT NOT NULL, totp_secret TEXT,"
        " totp_last_step INTEGER, pending_totp TEXT, locale TEXT NOT NULL DEFAULT 'ko',"
        " disabled INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, title TEXT, teams TEXT);"
        "INSERT INTO users (id, username, display, role, pw_hash, created, title)"
        " VALUES ('u-1','kim','Kim','staff','x',0,'MD')"
    )
    legacy.close()
    store = AccountStore(path)
    assert current_version(connect(path), "accounts") == 2
    assert store.user("u-1").title == "MD"


# ---------------------------------------------------------------------- one office · one file


def _solution(tmp_path: Path) -> Path:
    sol = tmp_path / "moa"
    assert CliRunner().invoke(app, ["init", str(sol), "--org", "moa"]).exit_code == 0
    return sol


def test_an_office_writes_one_database(tmp_path: Path) -> None:
    inst = build_instance(_solution(tmp_path), "moa", "hq")
    data = inst.ctx.data_dir
    assert sorted(p.name for p in data.glob("*.sqlite")) == []
    db = data / "office.db"
    assert db.is_file()
    if sys.platform != "win32":  # Windows protects files with ACLs, not POSIX modes
        assert stat.S_IMODE(db.stat().st_mode) == 0o600
    tables = {
        r[0]
        for r in sqlite3.connect(db).execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert {"threads", "runs", "checkpoints", "writes", "store", "ledger", "artifacts",
            "wf_threads", "wf_runs", "wf_checkpoints", "wf_writes", "schema_versions"} <= tables  # fmt: skip
    versions = dict(sqlite3.connect(db).execute("SELECT component, version FROM schema_versions"))
    assert versions == {"runs": 1, "wf_runs": 1, "checkpoints": 1, "wf_checkpoints": 1,
                        "store": 1, "ledger": 1, "artifacts": 1}  # fmt: skip


# ---------------------------------------------------------------------- retention · backup


async def test_retention_removes_only_what_has_aged_out(tmp_path: Path) -> None:
    sol = _solution(tmp_path)
    inst = build_instance(sol, "moa", "hq")
    org_dir = EngineStore(solosquad_home()).org_data_dir(Solution(sol).org("moa"))
    accounts = AccountStore(org_dir / "org.db")
    now = time.time()
    old = now - 4 * 365 * DAY
    store = inst.manager.store

    closed = store.create_thread("old and done")
    store.set_status(store.create_run(closed, "message", "hi", "user"), RunStatus.SUCCESS)
    waiting = store.create_thread("old but waiting for approval")
    rid = store.create_run(waiting, "message", "hi", "user")
    store.set_status(rid, RunStatus.INTERRUPTED)
    fresh = store.create_thread("recent")
    store._exec(f"UPDATE {store.T} SET updated = ? WHERE id IN (?, ?)", (old, closed, waiting))
    for ts in (old, now):
        inst.ledger.record(LedgerEntry(thread_id="t", org="moa", workspace="hq", agent="chief",
                                       connection_id="c", harness="lite", model=None, ts=ts))  # fmt: skip
    art = inst.artifacts.save("brief", "old", {"text": "x"})  # type: ignore[union-attr]
    inst.artifacts._q("UPDATE artifacts SET created = ? WHERE id = ?", (old, art.id))  # type: ignore[union-attr]
    up = inst.workflows.save_upload("원장.csv", b"a,b\n1,2\n")  # type: ignore[union-attr]
    meta = inst.workflows.uploads / f"{up['id']}.json"  # type: ignore[union-attr]
    meta.write_text(json.dumps({**up, "created": now - 100 * DAY}), encoding="utf-8")
    user = accounts.create_user("kim", "correct horse battery", Role.STAFF)
    accounts.audit(user.id, "ancient", "")
    accounts._q("UPDATE audit SET ts = ? WHERE action = 'ancient'", (now - 400 * DAY,))

    counts = run_retention(inst, accounts, now=now)
    assert counts["threads"] == 1 and counts["ledger"] == 1 and counts["artifacts"] == 1
    assert counts["uploads"] == 1 and counts["audit"] == 1
    assert store.thread(closed) is None
    assert store.thread(waiting) is not None and store.thread(fresh) is not None
    assert accounts.audit_log()[0]["action"] == "retention.purge"


def test_backup_copies_both_databases_with_a_manifest(tmp_path: Path) -> None:
    sol = _solution(tmp_path)
    inst = build_instance(sol, "moa", "hq")
    org_dir = EngineStore(solosquad_home()).org_data_dir(Solution(sol).org("moa"))
    AccountStore(org_dir / "org.db").create_user("boss", "correct horse battery", Role.OWNER)
    inst.manager.store.create_thread("t")
    manifest = backup_instance(inst, org_dir, tmp_path / "bk")
    assert [f["name"] for f in manifest["files"]] == ["org", "office"]
    for f in manifest["files"]:
        copy = tmp_path / "bk" / f["file"]
        assert hashlib.sha256(copy.read_bytes()).hexdigest() == f["sha256"]
    assert sqlite3.connect(tmp_path / "bk" / "org.db").execute(
        "SELECT username FROM users"
    ).fetchall() == [("boss",)]
    assert json.loads((tmp_path / "bk" / "manifest.json").read_text())["schema_version"] == 1
    res = CliRunner().invoke(app, ["backup", "-s", str(sol), "--to", str(tmp_path / "bk2")])
    assert res.exit_code == 0 and "office:" in res.output


def test_doctor_reports_leftover_per_component_files(tmp_path: Path, repo_root: Path) -> None:
    sol = _solution(tmp_path)
    inst = build_instance(sol, "moa", "hq")
    (inst.ctx.data_dir / "runs.sqlite").write_bytes(b"")
    checks = {c.name: c for c in doctor_checks(sol, repo_root)}
    assert (
        checks["legacy:moa/hq"].status == "warn" and "runs.sqlite" in checks["legacy:moa/hq"].detail
    )
