"""The storage layer (decision 54 · PRD v2.1.0 I33 · I34 · I36).

One SQLite file per scope instead of one per component — three scopes since decision 57:

    <data>/<solution>/core.db                 people · logins · sessions · assignments · login
                                              audit (the customer, I39)
    <data>/<solution>/<org>/org.db            the org's teams · titles · org audit
    <data>/<solution>/<org>/<ws>/office.db    runs · checkpoints · store · ledger · artifacts
                                              (workflow runs/checkpoints under a `wf_` prefix)

Components keep their own connection to the shared file (WAL lets them coexist), and
each declares its schema as numbered migrations. `migrate` records the applied version
per component in `schema_versions`, refuses a file written by a newer engine, and — when
an existing component is about to change — snapshots the file first, so a failed upgrade
leaves a copy to go back to. Migrations only move forward.

`backup` copies both files with SQLite's online backup API (consistent per file while the
engine keeps running) and writes a manifest with sizes and SHA-256; the snapshot job of
slice 5 ships that folder to the customer's object storage.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BUSY_TIMEOUT_MS = 10_000
SNAPSHOT_KEEP = 3
"""Pre-migration snapshots kept per file; older ones are removed after a successful run."""

CORE_DB = "core.db"
ORG_DB = "org.db"
OFFICE_DB = "office.db"
LEGACY_FILES = (
    "accounts.sqlite",
    "runs.sqlite",
    "workflow-runs.sqlite",
    "state.sqlite",
    "workflows.sqlite",
    "store.sqlite",
    "ledger.sqlite",
    "artifacts.sqlite",
)
"""Per-component files from before decision 54 — `doctor` reports any that are left."""


def connect(path: Path | str) -> sqlite3.Connection:
    """The one way the engine opens a database: WAL, a busy timeout, autocommit."""
    p = Path(path)
    if str(path) != ":memory:":
        p.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(p), check_same_thread=False, isolation_level=None)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    if str(path) != ":memory:":
        p.chmod(0o600)  # business records and personal data — owner-only on the VM
    return db


Step = str | Callable[[sqlite3.Connection], None]


@dataclass(frozen=True)
class Migration:
    version: int
    step: Step
    """SQL script, or a function for changes that must look before they leap."""


class SchemaTooNew(RuntimeError):
    pass


class MigrationFailed(RuntimeError):
    pass


def _versions_table(db: sqlite3.Connection) -> None:
    db.execute(
        "CREATE TABLE IF NOT EXISTS schema_versions ("
        " component TEXT PRIMARY KEY, version INTEGER NOT NULL, applied REAL NOT NULL)"
    )


def current_version(db: sqlite3.Connection, component: str) -> int:
    _versions_table(db)
    row = db.execute(
        "SELECT version FROM schema_versions WHERE component = ?", (component,)
    ).fetchone()
    return int(row[0]) if row else 0


def migrate(
    db: sqlite3.Connection,
    component: str,
    migrations: Sequence[Migration],
    *,
    path: Path | str | None = None,
) -> int:
    """Bring `component` up to the newest migration → the version now applied."""
    versions = [m.version for m in migrations]
    if versions != sorted(set(versions)) or (versions and versions[0] < 1):
        raise ValueError(f"{component}: migrations must be numbered 1, 2, … in order")
    newest = versions[-1] if versions else 0
    have = current_version(db, component)
    if have > newest:
        raise SchemaTooNew(
            f"{component} schema v{have} was written by a newer engine (this one knows v{newest})"
        )
    pending = [m for m in migrations if m.version > have]
    if not pending:
        return have
    if have > 0 and path is not None:
        snapshot(Path(path), f"{component}-v{have}")
    for m in pending:
        try:
            db.execute("BEGIN IMMEDIATE")
            if isinstance(m.step, str):
                for statement in _statements(m.step):
                    db.execute(statement)
            else:
                m.step(db)
            db.execute(
                "INSERT INTO schema_versions (component, version, applied) VALUES (?,?,?)"
                " ON CONFLICT(component) DO UPDATE SET version = excluded.version,"
                " applied = excluded.applied",
                (component, m.version, time.time()),
            )
            db.execute("COMMIT")
        except Exception as e:
            db.execute("ROLLBACK")
            raise MigrationFailed(f"{component} migration v{m.version} failed: {e}") from e
    return newest


def _statements(script: str) -> list[str]:
    return [s.strip() for s in script.split(";") if s.strip()]


def columns(db: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in db.execute(f"PRAGMA table_info({table})")}


# ---------------------------------------------------------------------- snapshots · backup


def _copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(str(src))
    target = sqlite3.connect(str(dest))
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()


def snapshot(path: Path, tag: str) -> Path | None:
    """Copy `path` aside before a migration; keep the newest `SNAPSHOT_KEEP` per file."""
    if not path.is_file() or path.stat().st_size == 0:
        return None
    folder = path.parent / "snapshots"
    dest = folder / f"{path.stem}.{tag}.{time.strftime('%Y%m%d%H%M%S')}.db"
    _copy(path, dest)
    dest.chmod(0o600)
    olds = sorted(folder.glob(f"{path.stem}.*.db"), key=lambda p: p.stat().st_mtime)
    for old in olds[:-SNAPSHOT_KEEP]:
        old.unlink(missing_ok=True)
    return dest


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _pin(src: Path) -> sqlite3.Connection:
    """Open `src` inside a read transaction — WAL keeps showing this moment to it while
    the engine goes on writing, so the copy taken later is still this moment."""
    conn = sqlite3.connect(str(src), isolation_level=None)
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    conn.execute("BEGIN")
    conn.execute("SELECT count(*) FROM sqlite_master").fetchall()
    return conn


def _copy_pinned(source: sqlite3.Connection, dest: Path) -> None:
    target = sqlite3.connect(str(dest))
    try:
        source.backup(target)
    finally:
        target.close()


def backup(files: dict[str, Path], dest: Path) -> dict[str, Any]:
    """Online copies of the scope databases into `dest` + `manifest.json`.

    Every source is pinned to the same moment before any is copied (a read transaction
    each), so `org.db` and `office.db` in one backup agree with each other — an approval
    recorded in one and its run in the other are both in, or both out (I36).
    """
    dest.mkdir(parents=True, exist_ok=True)
    pinned: dict[str, tuple[Path, sqlite3.Connection]] = {}
    try:
        for name, src in files.items():
            if src.is_file():
                pinned[name] = (src, _pin(src))
        taken = time.time()
        entries = []
        for name, (src, conn) in pinned.items():
            target = dest / f"{name}.db"
            _copy_pinned(conn, target)
            target.chmod(0o600)
            entries.append(
                {
                    "name": name,
                    "source": str(src),
                    "file": target.name,
                    "bytes": target.stat().st_size,
                    "sha256": _sha256(target),
                    "copied_at": taken,
                }
            )
    finally:
        for _src, conn in pinned.values():
            conn.close()
    manifest = {
        "schema_version": 1,
        "created": time.time(),
        "taken_at": taken,
        "consistent": True,
        "files": entries,
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


def legacy_files(folder: Path) -> list[Path]:
    return [folder / n for n in LEGACY_FILES if (folder / n).is_file()]
