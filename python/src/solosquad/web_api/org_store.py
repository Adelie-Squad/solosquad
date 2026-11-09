"""The org's own records — `org.db` — and the one-time move of rev6 accounts to `core.db`.

Decision 57 · PRD v2.1.0 I39: a person has one account for the whole customer (`core.db`),
but what they are *in an org* — its teams, their title there — and what was done in that
org (approval policy, connections, workflow switches, approvals …) belong to the org:

    org_members (user_id, title, teams)   the basis of team-tier approval (decision 55)
    org_audit   (ts, user_id, workspace, action, detail)

Until rev6 the accounts themselves lived in each `org.db` (component `accounts`). The
first start of a rev7 engine moves them (C32 · K51):

1. both files are snapshotted (`storage.snapshot`) before anything is written;
2. people · password hashes · one-time-code secrets · passkeys · sessions · login
   failures and the audit log are copied into `core.db` in one transaction, and each
   person is assigned to that org with the role they had there;
3. their title and teams stay in `org.db` (`org_members`), and the old account tables
   are dropped from it — again in one transaction.

A username already taken in `core.db` by someone else (the same name in two orgs) stops
the move with an error that names both: nothing is merged on a guess. Any failure leaves
the original `org.db` as it was and refuses the start (I34).
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from solosquad.layout import EngineStore, Solution, solosquad_home
from solosquad.storage import (
    CORE_DB,
    ORG_DB,
    Migration,
    MigrationFailed,
    columns,
    connect,
    migrate,
    snapshot,
)
from solosquad.web_api.accounts import (
    LEGACY_COMPONENT,
    LEGACY_MIGRATIONS,
    AccountStore,
    Role,
)

ORG_SCHEMA = """
CREATE TABLE IF NOT EXISTS org_members (
    user_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', teams TEXT NOT NULL DEFAULT '[]',
    updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS org_audit (
    ts REAL NOT NULL, user_id TEXT, workspace TEXT, action TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS org_audit_ts ON org_audit (ts)
"""
ORG_MIGRATIONS = (Migration(1, ORG_SCHEMA),)
ORG_COMPONENT = "org"
LEGACY_TABLES = ("users", "sessions", "audit", "login_failures", "passkeys",
                 "webauthn_challenges")  # fmt: skip


class OrgStore:
    def __init__(self, path: Path, org: str) -> None:
        self.path = path
        self.org = org
        self._db = connect(path)
        migrate(self._db, ORG_COMPONENT, ORG_MIGRATIONS, path=path)
        self._lock = threading.Lock()

    def _q(self, sql: str, args: tuple[Any, ...] = ()) -> list[Any]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    # ------------------------------------------------------------------ members

    def member(self, uid: str) -> tuple[str, tuple[str, ...]]:
        """→ (title, teams) of a person in this org; empty when never set."""
        rows = self._q("SELECT title, teams FROM org_members WHERE user_id = ?", (uid,))
        if not rows:
            return "", ()
        return rows[0][0] or "", tuple(json.loads(rows[0][1] or "[]"))

    def members(self) -> dict[str, tuple[str, tuple[str, ...]]]:
        rows = self._q("SELECT user_id, title, teams FROM org_members")
        return {r[0]: (r[1] or "", tuple(json.loads(r[2] or "[]"))) for r in rows}

    def set_member(
        self, uid: str, *, title: str | None = None, teams: list[str] | None = None
    ) -> tuple[str, tuple[str, ...]]:
        old_title, old_teams = self.member(uid)
        new_title = title.strip()[:80] if title is not None else old_title
        new_teams = (
            sorted({t.strip() for t in teams if t.strip()})
            if teams is not None
            else list(old_teams)
        )
        self._q(
            "INSERT INTO org_members (user_id, title, teams, updated) VALUES (?,?,?,?)"
            " ON CONFLICT(user_id) DO UPDATE SET title = excluded.title,"
            " teams = excluded.teams, updated = excluded.updated",
            (uid, new_title, json.dumps(new_teams), time.time()),
        )
        return self.member(uid)

    # ------------------------------------------------------------------ audit

    def audit(
        self, user_id: str | None, action: str, detail: str = "", *, workspace: str | None = None
    ) -> None:
        self._q(
            "INSERT INTO org_audit (ts, user_id, workspace, action, detail) VALUES (?,?,?,?,?)",
            (time.time(), user_id, workspace, action, detail),
        )

    def audit_log(self, limit: int = 200) -> list[dict[str, Any]]:
        rows = self._q(
            "SELECT ts, user_id, workspace, action, detail FROM org_audit ORDER BY ts DESC LIMIT ?",
            (limit,),
        )
        return [
            {"ts": r[0], "user_id": r[1], "workspace": r[2], "action": r[3], "detail": r[4]}
            for r in rows
        ]

    def audit_between(
        self, action: str, since: float, until: float, limit: int = 200
    ) -> list[dict[str, Any]]:
        """One action's records after `since` and at or before `until`, newest first."""
        rows = self._q(
            "SELECT ts, user_id, workspace, action, detail FROM org_audit"
            " WHERE action = ? AND ts > ? AND ts <= ? ORDER BY ts DESC LIMIT ?",
            (action, since, until, limit),
        )
        return [
            {"ts": r[0], "user_id": r[1], "workspace": r[2], "action": r[3], "detail": r[4]}
            for r in rows
        ]

    def purge(self, *, audit_days: int, now: float | None = None) -> int:
        t = time.time() if now is None else now
        with self._lock:
            return int(
                self._db.execute(
                    "DELETE FROM org_audit WHERE ts < ?", (t - audit_days * 86400,)
                ).rowcount
            )


# ---------------------------------------------------------------------- rev6 → rev7 move


def _tables(db: sqlite3.Connection) -> set[str]:
    return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _rows(db: sqlite3.Connection, table: str) -> tuple[list[str], list[tuple[Any, ...]]]:
    if table not in _tables(db):
        return [], []
    cur = db.execute(f"SELECT * FROM {table}")
    return [d[0] for d in cur.description], list(cur.fetchall())


def _copy_rows(core: sqlite3.Connection, table: str, cols: list[str], rows: list[Any]) -> None:
    if not rows:
        return
    keep = [c for c in cols if c in columns(core, table)]
    idx = [cols.index(c) for c in keep]
    marks = ",".join("?" * len(keep))
    verb = "INSERT OR IGNORE" if table in ("users", "sessions", "passkeys") else "INSERT"
    core.executemany(
        f"{verb} INTO {table} ({','.join(keep)}) VALUES ({marks})",
        [tuple(r[i] for i in idx) for r in rows],
    )


def migrate_org_accounts(core: AccountStore, org: str, org_db: Path) -> int:
    """Move a rev6 `org.db`'s accounts into `core.db` → how many people moved (0 = none
    there). Raises `MigrationFailed`; the org file is then untouched."""
    if not org_db.is_file():
        return 0
    # read-only: not even the journal mode changes until the copy in core.db is committed
    legacy = sqlite3.connect(f"{org_db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        if "users" not in _tables(legacy):
            return 0
        have = (
            legacy.execute(
                "SELECT version FROM schema_versions WHERE component = ?", (LEGACY_COMPONENT,)
            ).fetchone()
            if "schema_versions" in _tables(legacy)
            else None
        )
        old = have is not None and int(have[0]) >= len(LEGACY_MIGRATIONS)
    finally:
        legacy.close()
    if not old:  # a file from before PR #19's passkeys: bring it to the rev6 shape first
        upgrade = connect(org_db)
        try:
            migrate(upgrade, LEGACY_COMPONENT, LEGACY_MIGRATIONS, path=org_db)
        finally:
            upgrade.close()
    legacy = sqlite3.connect(f"{org_db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        data = {t: _rows(legacy, t) for t in LEGACY_TABLES}
    finally:
        legacy.close()

    ucols, users = data["users"]
    by = {c: i for i, c in enumerate(ucols)}
    db = core.connection()
    with core.lock:
        taken = {r[1]: r[0] for r in db.execute("SELECT id, username FROM users")}
    clashes = [
        u[by["username"]]
        for u in users
        if u[by["username"]] in taken and taken[u[by["username"]]] != u[by["id"]]
    ]
    if clashes:
        raise MigrationFailed(
            f"cannot move the accounts of org {org!r} into core.db: username(s)"
            f" {sorted(clashes)} already belong to someone else (another org) — rename"
            " one of them in its org.db, then start again. Nothing was changed."
        )

    snapshot(core.path, "pre-core-move")
    snapshot(org_db, "pre-core-move")
    try:
        with core.lock:
            db.execute("BEGIN IMMEDIATE")
            try:
                for table in LEGACY_TABLES:
                    cols, rows = data[table]
                    _copy_rows(db, table, cols, rows)
                for u in users:
                    db.execute(
                        "INSERT OR IGNORE INTO assignments (user_id, org, workspace, role,"
                        " created) VALUES (?, ?, '', ?, ?)",
                        (u[by["id"]], org, Role(u[by["role"]]).value, time.time()),
                    )
                db.execute(
                    "INSERT OR REPLACE INTO migrated_orgs (org, users, ts) VALUES (?,?,?)",
                    (org, len(users), time.time()),
                )
                db.execute("COMMIT")
            except Exception:
                db.execute("ROLLBACK")
                raise
    except Exception as e:
        raise MigrationFailed(f"moving the accounts of org {org!r} to core.db failed: {e}") from e

    target = connect(org_db)
    try:
        migrate(target, ORG_COMPONENT, ORG_MIGRATIONS)
        target.execute("BEGIN IMMEDIATE")
        try:
            for u in users:
                teams = u[by["teams"]] if "teams" in by else None
                target.execute(
                    "INSERT OR REPLACE INTO org_members (user_id, title, teams, updated)"
                    " VALUES (?,?,?,?)",
                    (u[by["id"]], (u[by["title"]] if "title" in by else "") or "",
                     teams or "[]", time.time()),
                )  # fmt: skip
            for table in LEGACY_TABLES:
                target.execute(f"DROP TABLE IF EXISTS {table}")
            target.execute("DELETE FROM schema_versions WHERE component = ?", (LEGACY_COMPONENT,))
            target.execute("COMMIT")
        except Exception:
            target.execute("ROLLBACK")
            raise
    except Exception as e:
        raise MigrationFailed(
            f"accounts of org {org!r} are in core.db but org.db could not be finished: {e}"
            " — start again to finish (the move is repeatable)"
        ) from e
    finally:
        target.close()
    return len(users)


def core_path(sol: Solution, home: Path | None = None) -> Path:
    return EngineStore(home or solosquad_home()).solution_data_dir(sol) / CORE_DB


def org_path(sol: Solution, org: str, home: Path | None = None) -> Path:
    return EngineStore(home or solosquad_home()).org_data_dir(sol.org(org)) / ORG_DB


def _legacy_usernames(org_db: Path) -> dict[str, str]:
    """username → id in a rev6 `org.db` (read-only; empty when there is nothing to move)."""
    if not org_db.is_file():
        return {}
    conn = sqlite3.connect(f"{org_db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        if "users" not in _tables(conn):
            return {}
        return {r[0]: r[1] for r in conn.execute("SELECT username, id FROM users")}
    finally:
        conn.close()


def open_accounts(sol: Solution, home: Path | None = None) -> AccountStore:
    """The customer's `core.db`, with every rev6 org's accounts moved in first (C32).

    Every org is checked before any is moved: the same username in two orgs stops the
    whole move, so no org is left half-way."""
    owners: dict[str, list[str]] = {}
    for org in sol.orgs():
        for name, uid in _legacy_usernames(org_path(sol, org.name, home)).items():
            owners.setdefault(name, []).append(f"{org.name}:{uid}")
    clashes = {n: where for n, where in owners.items() if len({w.split(":")[1] for w in where}) > 1}
    if clashes:
        listed = "; ".join(
            f"{name} in {', '.join(w.split(':')[0] for w in where)}"
            for name, where in sorted(clashes.items())
        )
        raise MigrationFailed(
            f"cannot move the accounts into core.db — the same username is in more than one"
            f" org ({listed}). Rename one of them in its org.db, then start again."
            " Nothing was changed."
        )
    core = AccountStore(core_path(sol, home))
    for org in sol.orgs():
        migrate_org_accounts(core, org.name, org_path(sol, org.name, home))
    return core


def open_org(sol: Solution, org: str, home: Path | None = None) -> OrgStore:
    return OrgStore(org_path(sol, org, home), org)
