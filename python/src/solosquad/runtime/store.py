"""Threads and runs (sqlite) — the LangGraph Server resource model, one workspace's slice."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from solosquad.storage import Migration, connect, migrate


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class RunStore:
    """Threads and runs in a shared scope database (decision 54).

    `prefix` keeps two run models apart in one file — the company's (`""`) and the
    workflow engine's (`"wf_"`).
    """

    def __init__(self, path: Path, *, prefix: str = "") -> None:
        if prefix and not re.fullmatch(r"[a-z]+_", prefix):
            raise ValueError(f"table prefix must look like 'wf_', not {prefix!r}")
        self.path = path
        self.T = f"{prefix}threads"
        self.R = f"{prefix}runs"
        self._db = connect(path)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        migrate(
            self._db,
            f"{prefix}runs",
            [
                Migration(
                    1,
                    f"""
                    CREATE TABLE IF NOT EXISTS {self.T} (
                      id TEXT PRIMARY KEY, title TEXT, metadata TEXT, created REAL, updated REAL);
                    CREATE TABLE IF NOT EXISTS {self.R} (
                      id TEXT PRIMARY KEY, thread_id TEXT, status TEXT, kind TEXT, input TEXT,
                      error TEXT, interrupts TEXT, created REAL, started REAL, ended REAL,
                      source TEXT);
                    CREATE INDEX IF NOT EXISTS {prefix}runs_by_thread
                      ON {self.R} (thread_id, created)
                    """,
                )
            ],
            path=path,
        )

    def purge(self, before: float) -> list[str]:
        """Delete threads idle since `before` with no run still open → the thread ids removed."""
        open_ = ("pending", "running", "interrupted")
        old = [
            r["id"]
            for r in self._exec(
                f"SELECT id FROM {self.T} WHERE updated < ? AND id NOT IN"
                f" (SELECT thread_id FROM {self.R} WHERE status IN (?,?,?))",
                (before, *open_),
            )
        ]
        for tid in old:
            self._exec(f"DELETE FROM {self.R} WHERE thread_id = ?", (tid,))
            self._exec(f"DELETE FROM {self.T} WHERE id = ?", (tid,))
        return old

    def _exec(self, sql: str, args: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._db.execute(sql, args).fetchall()]

    def create_thread(
        self, title: str, metadata: dict[str, Any] | None = None, thread_id: str | None = None
    ) -> str:
        tid = thread_id or _id("th")
        now = time.time()
        self._exec(
            f"INSERT OR IGNORE INTO {self.T} VALUES (?,?,?,?,?)",
            (tid, title, json.dumps(metadata or {}, ensure_ascii=False), now, now),
        )
        return tid

    def thread(self, tid: str) -> dict[str, Any] | None:
        rows = self._exec(f"SELECT * FROM {self.T} WHERE id = ?", (tid,))
        if not rows:
            return None
        row = rows[0]
        row["metadata"] = json.loads(row["metadata"] or "{}")
        return row

    def threads(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._exec(f"SELECT * FROM {self.T} ORDER BY updated DESC LIMIT ?", (limit,))
        for r in rows:
            r["metadata"] = json.loads(r["metadata"] or "{}")
        return rows

    def touch(self, tid: str) -> None:
        self._exec(f"UPDATE {self.T} SET updated = ? WHERE id = ?", (time.time(), tid))

    def create_run(
        self, tid: str, kind: str, payload: Any, source: str, *, created: float | None = None
    ) -> str:
        """`created` is the run's place in its thread's order — a crash-resume run passes
        the crashed run's, so it is not overtaken by input sent after it."""
        rid = _id("run")
        self._exec(
            f"INSERT INTO {self.R} (id, thread_id, status, kind, input, created, source)"
            " VALUES (?,?,?,?,?,?,?)",
            (
                rid,
                tid,
                "pending",
                kind,
                json.dumps(payload, ensure_ascii=False),
                time.time() if created is None else created,
                source,
            ),
        )
        return rid

    def set_status(
        self, rid: str, status: str, *, error: str | None = None, interrupts: Any = None
    ) -> None:
        now = time.time()
        if status == "running":
            self._exec(
                f"UPDATE {self.R} SET status=?, started=COALESCE(started, ?) WHERE id=?",
                (status, now, rid),
            )
        elif status in ("success", "error", "interrupted", "cancelled"):
            self._exec(
                f"UPDATE {self.R} SET status=?, ended=?, error=?, interrupts=? WHERE id=?",
                (status, now, error, json.dumps(interrupts, ensure_ascii=False, default=str), rid),
            )
        else:
            self._exec(f"UPDATE {self.R} SET status=? WHERE id=?", (status, rid))

    def run(self, rid: str) -> dict[str, Any] | None:
        rows = self._exec(f"SELECT * FROM {self.R} WHERE id = ?", (rid,))
        return self._decode(rows[0]) if rows else None

    def runs(
        self,
        *,
        thread_id: str | None = None,
        status: str | None = None,
        since: float | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Newest first. `since` = runs created at or after that time ("since you last looked")."""
        sql = f"SELECT * FROM {self.R} WHERE 1=1"
        args: list[Any] = []
        if since is not None:
            sql += " AND created >= ?"
            args.append(since)
        if thread_id:
            sql += " AND thread_id = ?"
            args.append(thread_id)
        if status:
            sql += " AND status = ?"
            args.append(status)
        sql += " ORDER BY created DESC LIMIT ?"
        args.append(limit)
        return [self._decode(r) for r in self._exec(sql, tuple(args))]

    @staticmethod
    def _decode(row: dict[str, Any]) -> dict[str, Any]:
        row["input"] = json.loads(row["input"]) if row.get("input") else None
        row["interrupts"] = json.loads(row["interrupts"]) if row.get("interrupts") else None
        return row
