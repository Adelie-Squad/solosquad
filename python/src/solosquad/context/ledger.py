"""Token and cost ledger (M26) — one row per harness activation.

Read by Chief's budget policy (decision 35), the web cost views (v2.1.0), the FDE
improvement cycle and the agency usage summary (metadata only, v2.3.0).
"""

from __future__ import annotations

import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from solosquad.storage import Migration, connect, migrate

COLUMNS = (
    "ts", "thread_id", "org", "workspace", "agent", "connection_id", "harness", "model",
    "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
    "cost_usd", "estimated", "duration_ms", "stop_reason",
)  # fmt: skip


@dataclass(frozen=True)
class LedgerEntry:
    thread_id: str
    org: str
    workspace: str
    agent: str
    connection_id: str
    harness: str
    model: str | None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0
    estimated: bool = False
    duration_ms: int = 0
    stop_reason: str | None = None
    ts: float = field(default_factory=time.time)


class Ledger:
    def __init__(self, path: Path | str) -> None:
        self._db = connect(path)
        self._lock = threading.Lock()
        migrate(
            self._db,
            "ledger",
            [
                Migration(
                    1,
                    "CREATE TABLE IF NOT EXISTS ledger (ts REAL, thread_id TEXT, org TEXT,"
                    " workspace TEXT, agent TEXT, connection_id TEXT, harness TEXT, model TEXT,"
                    " input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,"
                    " cache_write_tokens INTEGER, cost_usd REAL, estimated INTEGER,"
                    " duration_ms INTEGER, stop_reason TEXT);"
                    " CREATE INDEX IF NOT EXISTS ledger_ts ON ledger (ts)",
                )
            ],
            path=None if str(path) == ":memory:" else path,
        )

    def purge(self, before: float) -> int:
        with self._lock:
            return self._db.execute("DELETE FROM ledger WHERE ts < ?", (before,)).rowcount

    def record(self, entry: LedgerEntry) -> None:
        row = asdict(entry)
        with self._lock:
            self._db.execute(
                f"INSERT INTO ledger ({', '.join(COLUMNS)})"
                f" VALUES ({', '.join('?' * len(COLUMNS))})",
                [row[c] if c != "estimated" else int(row[c]) for c in COLUMNS],
            )

    def spend(self, *, since: float = 0.0, **where: str) -> float:
        clauses = ["ts >= ?"] + [f"{k} = ?" for k in where if k in COLUMNS]
        args: list[Any] = [since, *(v for k, v in where.items() if k in COLUMNS)]
        with self._lock:
            row = self._db.execute(
                f"SELECT COALESCE(SUM(cost_usd), 0) FROM ledger WHERE {' AND '.join(clauses)}", args
            ).fetchone()
        return float(row[0])

    def totals(self, by: str, *, since: float = 0.0) -> dict[str, dict[str, float]]:
        if by not in COLUMNS:
            raise ValueError(f"cannot group by {by!r}")
        with self._lock:
            rows = self._db.execute(
                f"SELECT {by}, COUNT(*), SUM(input_tokens + output_tokens + cache_read_tokens"
                f" + cache_write_tokens), SUM(cost_usd) FROM ledger WHERE ts >= ? GROUP BY {by}",
                (since,),
            ).fetchall()
        return {
            str(k): {"calls": n, "tokens": float(t or 0), "cost_usd": float(c or 0)}
            for k, n, t, c in rows
        }

    def entries(self, *, thread_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        sql = f"SELECT {', '.join(COLUMNS)} FROM ledger"
        args: list[Any] = []
        if thread_id:
            sql += " WHERE thread_id = ?"
            args.append(thread_id)
        sql += " ORDER BY ts DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            rows = self._db.execute(sql, args).fetchall()
        return [dict(zip(COLUMNS, r, strict=True)) for r in rows]


def month_start(now: float | None = None) -> float:
    t = time.localtime(now if now is not None else time.time())
    return time.mktime((t.tm_year, t.tm_mon, 1, 0, 0, 0, 0, 0, -1))
