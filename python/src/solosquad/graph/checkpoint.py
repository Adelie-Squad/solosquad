"""Checkpointers — the storage seam (decision 19: "the seam goes to storage", §K-3).

Same method names as `langgraph.checkpoint.base.BaseCheckpointSaver`: get_tuple · list ·
put · put_writes, each with an `a`-prefixed async twin. Checkpoints are immutable; a
step's finished tasks are recorded with `put_writes` as they complete, so a crash in the
middle of a step re-runs only the tasks that had not finished.
"""

from __future__ import annotations

import asyncio
import builtins
import re
import threading
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from solosquad.graph import serde
from solosquad.storage import Migration, connect, migrate

Config = dict[str, Any]


@dataclass(frozen=True)
class CheckpointTuple:
    config: Config
    checkpoint: dict[str, Any]
    metadata: dict[str, Any]
    parent_config: Config | None = None
    pending_writes: list[tuple[str, str, Any]] = field(default_factory=list)


def thread_id(config: Config) -> str:
    tid = (config.get("configurable") or {}).get("thread_id")
    if tid is None:
        raise ValueError("a checkpointer needs config['configurable']['thread_id']")
    return str(tid)


def _ns(config: Config) -> str:
    return str((config.get("configurable") or {}).get("checkpoint_ns", ""))


def _cid(config: Config) -> str | None:
    cid = (config.get("configurable") or {}).get("checkpoint_id")
    return str(cid) if cid is not None else None


def _cfg(tid: str, ns: str, cid: str) -> Config:
    return {"configurable": {"thread_id": tid, "checkpoint_ns": ns, "checkpoint_id": cid}}


class BaseCheckpointSaver:
    def get_tuple(self, config: Config) -> CheckpointTuple | None:
        raise NotImplementedError

    def list(
        self, config: Config, *, limit: int | None = None, before: Config | None = None
    ) -> Iterator[CheckpointTuple]:
        raise NotImplementedError

    def put(self, config: Config, checkpoint: dict[str, Any], metadata: dict[str, Any]) -> Config:
        raise NotImplementedError

    def put_writes(self, config: Config, writes: Sequence[tuple[str, Any]], task_id: str) -> None:
        raise NotImplementedError

    def threads(self) -> builtins.list[str]:
        raise NotImplementedError

    async def aget_tuple(self, config: Config) -> CheckpointTuple | None:
        return await asyncio.to_thread(self.get_tuple, config)

    async def alist(
        self, config: Config, *, limit: int | None = None, before: Config | None = None
    ) -> builtins.list[CheckpointTuple]:
        return await asyncio.to_thread(lambda: list(self.list(config, limit=limit, before=before)))

    async def aput(
        self, config: Config, checkpoint: dict[str, Any], metadata: dict[str, Any]
    ) -> Config:
        return await asyncio.to_thread(self.put, config, checkpoint, metadata)

    async def aput_writes(
        self, config: Config, writes: Sequence[tuple[str, Any]], task_id: str
    ) -> None:
        await asyncio.to_thread(self.put_writes, config, writes, task_id)


class InMemorySaver(BaseCheckpointSaver):
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # (thread, ns) -> ordered list of (id, checkpoint_json, metadata_json, parent_id)
        self._cps: dict[tuple[str, str], builtins.list[tuple[str, str, str, str | None]]] = {}
        self._writes: dict[tuple[str, str, str], builtins.list[tuple[str, str, str]]] = {}

    def _tuple(self, tid: str, ns: str, row: tuple[str, str, str, str | None]) -> CheckpointTuple:
        cid, cp, md, parent = row
        writes = [(t, ch, serde.loads(v)) for t, ch, v in self._writes.get((tid, ns, cid), [])]
        return CheckpointTuple(
            _cfg(tid, ns, cid),
            serde.loads(cp),
            serde.loads(md),
            _cfg(tid, ns, parent) if parent else None,
            writes,
        )

    def get_tuple(self, config: Config) -> CheckpointTuple | None:
        tid, ns, cid = thread_id(config), _ns(config), _cid(config)
        with self._lock:
            rows = self._cps.get((tid, ns), [])
            if not rows:
                return None
            row = next((r for r in rows if r[0] == cid), None) if cid else rows[-1]
            return self._tuple(tid, ns, row) if row else None

    def list(
        self, config: Config, *, limit: int | None = None, before: Config | None = None
    ) -> Iterator[CheckpointTuple]:
        tid, ns = thread_id(config), _ns(config)
        with self._lock:
            rows = list(reversed(self._cps.get((tid, ns), [])))
            if before is not None and (bid := _cid(before)):
                rows = [r for r in rows if r[0] < bid]
            out = [self._tuple(tid, ns, r) for r in rows[:limit]]
        yield from out

    def put(self, config: Config, checkpoint: dict[str, Any], metadata: dict[str, Any]) -> Config:
        tid, ns = thread_id(config), _ns(config)
        with self._lock:
            self._cps.setdefault((tid, ns), []).append(
                (checkpoint["id"], serde.dumps(checkpoint), serde.dumps(metadata), _cid(config))
            )
        return _cfg(tid, ns, checkpoint["id"])

    def put_writes(self, config: Config, writes: Sequence[tuple[str, Any]], task_id: str) -> None:
        tid, ns, cid = thread_id(config), _ns(config), _cid(config)
        if cid is None:
            raise ValueError("put_writes needs a checkpoint_id")
        with self._lock:
            bucket = self._writes.setdefault((tid, ns, cid), [])
            bucket.extend((task_id, ch, serde.dumps(v)) for ch, v in writes)

    def threads(self) -> builtins.list[str]:
        with self._lock:
            return sorted({t for t, _ in self._cps})


class SqliteSaver(BaseCheckpointSaver):
    """Stdlib sqlite3 (decision 13). One connection, serialized by a lock; WAL for crash safety."""

    def __init__(self, path: Path | str, *, prefix: str = "") -> None:
        """`prefix` lets two graphs share one office.db (the company's and `wf_` workflows)."""
        if prefix and not re.fullmatch(r"[a-z]+_", prefix):
            raise ValueError(f"table prefix must look like 'wf_', not {prefix!r}")
        self.path = str(path)
        self.C = f"{prefix}checkpoints"
        self.W = f"{prefix}writes"
        self._lock = threading.Lock()
        self._db = connect(self.path)
        self._db.execute("PRAGMA synchronous=NORMAL")
        migrate(
            self._db,
            f"{prefix}checkpoints",
            [
                Migration(
                    1,
                    f"""
                    CREATE TABLE IF NOT EXISTS {self.C} (
                      thread_id TEXT, ns TEXT, id TEXT, parent_id TEXT, checkpoint TEXT,
                      metadata TEXT, PRIMARY KEY (thread_id, ns, id));
                    CREATE TABLE IF NOT EXISTS {self.W} (
                      thread_id TEXT, ns TEXT, checkpoint_id TEXT, task_id TEXT, seq INTEGER,
                      channel TEXT, value TEXT,
                      PRIMARY KEY (thread_id, ns, checkpoint_id, task_id, seq))
                    """,
                )
            ],
            path=None if self.path == ":memory:" else self.path,
        )

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def _tuple(self, tid: str, ns: str, row: tuple[str, str | None, str, str]) -> CheckpointTuple:
        cid, parent, cp, md = row
        writes = self._db.execute(
            f"SELECT task_id, channel, value FROM {self.W}"
            " WHERE thread_id=? AND ns=? AND checkpoint_id=? ORDER BY task_id, seq",
            (tid, ns, cid),
        ).fetchall()
        return CheckpointTuple(
            _cfg(tid, ns, cid),
            serde.loads(cp),
            serde.loads(md),
            _cfg(tid, ns, parent) if parent else None,
            [(t, ch, serde.loads(v)) for t, ch, v in writes],
        )

    def get_tuple(self, config: Config) -> CheckpointTuple | None:
        tid, ns, cid = thread_id(config), _ns(config), _cid(config)
        with self._lock:
            if cid:
                row = self._db.execute(
                    f"SELECT id, parent_id, checkpoint, metadata FROM {self.C}"
                    " WHERE thread_id=? AND ns=? AND id=?",
                    (tid, ns, cid),
                ).fetchone()
            else:
                row = self._db.execute(
                    f"SELECT id, parent_id, checkpoint, metadata FROM {self.C}"
                    " WHERE thread_id=? AND ns=? ORDER BY id DESC LIMIT 1",
                    (tid, ns),
                ).fetchone()
            return self._tuple(tid, ns, row) if row else None

    def list(
        self, config: Config, *, limit: int | None = None, before: Config | None = None
    ) -> Iterator[CheckpointTuple]:
        tid, ns = thread_id(config), _ns(config)
        sql = f"SELECT id, parent_id, checkpoint, metadata FROM {self.C} WHERE thread_id=? AND ns=?"
        args: builtins.list[Any] = [tid, ns]
        if before is not None and (bid := _cid(before)):
            sql += " AND id < ?"
            args.append(bid)
        sql += " ORDER BY id DESC"
        if limit is not None:
            sql += " LIMIT ?"
            args.append(limit)
        with self._lock:
            rows = self._db.execute(sql, args).fetchall()
            out = [self._tuple(tid, ns, r) for r in rows]
        yield from out

    def put(self, config: Config, checkpoint: dict[str, Any], metadata: dict[str, Any]) -> Config:
        tid, ns = thread_id(config), _ns(config)
        with self._lock:
            self._db.execute(
                f"INSERT OR REPLACE INTO {self.C} VALUES (?,?,?,?,?,?)",
                (
                    tid,
                    ns,
                    checkpoint["id"],
                    _cid(config),
                    serde.dumps(checkpoint),
                    serde.dumps(metadata),
                ),
            )
        return _cfg(tid, ns, checkpoint["id"])

    def put_writes(self, config: Config, writes: Sequence[tuple[str, Any]], task_id: str) -> None:
        tid, ns, cid = thread_id(config), _ns(config), _cid(config)
        if cid is None:
            raise ValueError("put_writes needs a checkpoint_id")
        with self._lock:
            start = self._db.execute(
                f"SELECT COALESCE(MAX(seq), -1) + 1 FROM {self.W}"
                " WHERE thread_id=? AND ns=? AND checkpoint_id=? AND task_id=?",
                (tid, ns, cid, task_id),
            ).fetchone()[0]
            self._db.executemany(
                f"INSERT INTO {self.W} VALUES (?,?,?,?,?,?,?)",
                [
                    (tid, ns, cid, task_id, start + i, ch, serde.dumps(v))
                    for i, (ch, v) in enumerate(writes)
                ],
            )

    def threads(self) -> builtins.list[str]:
        with self._lock:
            return [
                r[0]
                for r in self._db.execute(f"SELECT DISTINCT thread_id FROM {self.C} ORDER BY 1")
            ]

    def delete_thread(self, thread_id: str) -> None:
        with self._lock:
            self._db.execute(f"DELETE FROM {self.C} WHERE thread_id = ?", (thread_id,))
            self._db.execute(f"DELETE FROM {self.W} WHERE thread_id = ?", (thread_id,))
