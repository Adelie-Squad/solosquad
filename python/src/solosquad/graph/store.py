"""Long-term store (`compile(store=...)`, `runtime.store`) — namespaced key/value documents."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Namespace = tuple[str, ...]


@dataclass(frozen=True)
class Item:
    namespace: Namespace
    key: str
    value: dict[str, Any]
    updated_at: float


class BaseStore:
    def put(self, namespace: Namespace, key: str, value: dict[str, Any]) -> None:
        raise NotImplementedError

    def get(self, namespace: Namespace, key: str) -> Item | None:
        raise NotImplementedError

    def delete(self, namespace: Namespace, key: str) -> None:
        raise NotImplementedError

    def search(self, namespace_prefix: Namespace, *, limit: int = 10) -> list[Item]:
        raise NotImplementedError


class InMemoryStore(BaseStore):
    def __init__(self) -> None:
        self._data: dict[tuple[Namespace, str], Item] = {}
        self._lock = threading.Lock()

    def put(self, namespace: Namespace, key: str, value: dict[str, Any]) -> None:
        with self._lock:
            self._data[(tuple(namespace), key)] = Item(tuple(namespace), key, value, time.time())

    def get(self, namespace: Namespace, key: str) -> Item | None:
        with self._lock:
            return self._data.get((tuple(namespace), key))

    def delete(self, namespace: Namespace, key: str) -> None:
        with self._lock:
            self._data.pop((tuple(namespace), key), None)

    def search(self, namespace_prefix: Namespace, *, limit: int = 10) -> list[Item]:
        p = tuple(namespace_prefix)
        with self._lock:
            items = [i for (ns, _), i in self._data.items() if ns[: len(p)] == p]
        return sorted(items, key=lambda i: i.updated_at, reverse=True)[:limit]


class SqliteStore(BaseStore):
    def __init__(self, path: Path | str) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._lock = threading.Lock()
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS store (ns TEXT, key TEXT, value TEXT, updated_at REAL,"
            " PRIMARY KEY (ns, key))"
        )

    @staticmethod
    def _ns(namespace: Namespace) -> str:
        return "\x1f".join(namespace)

    def put(self, namespace: Namespace, key: str, value: dict[str, Any]) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO store VALUES (?,?,?,?)",
                (self._ns(namespace), key, json.dumps(value, ensure_ascii=False), time.time()),
            )

    def get(self, namespace: Namespace, key: str) -> Item | None:
        with self._lock:
            row = self._db.execute(
                "SELECT value, updated_at FROM store WHERE ns=? AND key=?",
                (self._ns(namespace), key),
            ).fetchone()
        return Item(tuple(namespace), key, json.loads(row[0]), row[1]) if row else None

    def delete(self, namespace: Namespace, key: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM store WHERE ns=? AND key=?", (self._ns(namespace), key))

    def search(self, namespace_prefix: Namespace, *, limit: int = 10) -> list[Item]:
        prefix = self._ns(namespace_prefix)
        with self._lock:
            rows = self._db.execute(
                "SELECT ns, key, value, updated_at FROM store WHERE ns = ? OR ns LIKE ?"
                " ORDER BY updated_at DESC LIMIT ?",
                (prefix, prefix + "\x1f%", limit),
            ).fetchall()
        return [Item(tuple(ns.split("\x1f")), k, json.loads(v), t) for ns, k, v, t in rows]
