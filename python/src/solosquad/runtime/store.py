"""Threads and runs (sqlite) — the LangGraph Server resource model, one workspace's slice."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class RunStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._lock = threading.Lock()
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS threads (
              id TEXT PRIMARY KEY, title TEXT, metadata TEXT, created REAL, updated REAL);
            CREATE TABLE IF NOT EXISTS runs (
              id TEXT PRIMARY KEY, thread_id TEXT, status TEXT, kind TEXT, input TEXT,
              error TEXT, interrupts TEXT, created REAL, started REAL, ended REAL, source TEXT);
            CREATE INDEX IF NOT EXISTS runs_by_thread ON runs (thread_id, created);
            """
        )

    def _exec(self, sql: str, args: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._db.execute(sql, args).fetchall()]

    def create_thread(
        self, title: str, metadata: dict[str, Any] | None = None, thread_id: str | None = None
    ) -> str:
        tid = thread_id or _id("th")
        now = time.time()
        self._exec(
            "INSERT OR IGNORE INTO threads VALUES (?,?,?,?,?)",
            (tid, title, json.dumps(metadata or {}, ensure_ascii=False), now, now),
        )
        return tid

    def thread(self, tid: str) -> dict[str, Any] | None:
        rows = self._exec("SELECT * FROM threads WHERE id = ?", (tid,))
        if not rows:
            return None
        row = rows[0]
        row["metadata"] = json.loads(row["metadata"] or "{}")
        return row

    def threads(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._exec("SELECT * FROM threads ORDER BY updated DESC LIMIT ?", (limit,))
        for r in rows:
            r["metadata"] = json.loads(r["metadata"] or "{}")
        return rows

    def touch(self, tid: str) -> None:
        self._exec("UPDATE threads SET updated = ? WHERE id = ?", (time.time(), tid))

    def create_run(self, tid: str, kind: str, payload: Any, source: str) -> str:
        rid = _id("run")
        self._exec(
            "INSERT INTO runs (id, thread_id, status, kind, input, created, source)"
            " VALUES (?,?,?,?,?,?,?)",
            (
                rid,
                tid,
                "pending",
                kind,
                json.dumps(payload, ensure_ascii=False),
                time.time(),
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
                "UPDATE runs SET status=?, started=COALESCE(started, ?) WHERE id=?",
                (status, now, rid),
            )
        elif status in ("success", "error", "interrupted", "cancelled"):
            self._exec(
                "UPDATE runs SET status=?, ended=?, error=?, interrupts=? WHERE id=?",
                (status, now, error, json.dumps(interrupts, ensure_ascii=False, default=str), rid),
            )
        else:
            self._exec("UPDATE runs SET status=? WHERE id=?", (status, rid))

    def run(self, rid: str) -> dict[str, Any] | None:
        rows = self._exec("SELECT * FROM runs WHERE id = ?", (rid,))
        return self._decode(rows[0]) if rows else None

    def runs(
        self, *, thread_id: str | None = None, status: str | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        sql = "SELECT * FROM runs WHERE 1=1"
        args: list[Any] = []
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
