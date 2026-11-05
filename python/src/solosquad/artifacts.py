"""Work products — what the company makes, typed, so the web can draw them (W11 · I13).

A conversation is not a ledger: a profit-and-loss table, a sourcing quote or a morning
brief has fields the web renders and a "needs review" mark the owner clears. Kinds are
declared by name with their required fields — two built in for v2.1.0 (`finance.pnl`
for W14 and `brief` for W13), others from the org package (`orgs/<org>/artifact-kinds/
*.yaml`, v2.2.0 fills them). The engine stores; the web renders by kind.
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from solosquad.assets.text import load_yaml
from solosquad.storage import Migration, connect, migrate


@dataclass(frozen=True)
class ArtifactKind:
    name: str
    title: str
    required: tuple[str, ...] = ()
    schema_version: int = 1


BUILT_IN = {
    "finance.pnl": ArtifactKind(
        "finance.pnl",
        "손익표",
        ("period", "currency", "revenue", "expenses", "net_income", "by_account", "needs_review"),
    ),
    "brief": ArtifactKind("brief", "브리핑", ("text",)),
}


def load_kinds(org_root: Path | None) -> dict[str, ArtifactKind]:
    kinds = dict(BUILT_IN)
    folder = org_root / "artifact-kinds" if org_root else None
    if folder is not None and folder.is_dir():
        for path in sorted(folder.glob("*.yaml")):
            data = load_yaml(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("name"), str):
                kinds[data["name"]] = ArtifactKind(
                    data["name"],
                    str(data.get("title") or data["name"]),
                    tuple(str(f) for f in data.get("required") or ()),
                    int(data.get("schema_version") or 1),
                )
    return kinds


@dataclass
class Artifact:
    id: str
    kind: str
    title: str
    data: dict[str, Any]
    thread_id: str | None = None
    run_id: str | None = None
    workflow: str | None = None
    needs_review: bool = False
    reviewed_by: str | None = None
    created: float = field(default_factory=time.time)
    schema_version: int = 1

    def public(self) -> dict[str, Any]:
        return dict(self.__dict__)


SCHEMA = """
CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL,
    thread_id TEXT, run_id TEXT, workflow TEXT, needs_review INTEGER NOT NULL,
    reviewed_by TEXT, created REAL NOT NULL, schema_version INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS artifacts_kind ON artifacts (kind, created);
"""
_COLS = (
    "id, kind, title, data, thread_id, run_id, workflow, needs_review, reviewed_by, created,"
    " schema_version"
)


def _row(r: Any) -> Artifact:
    return Artifact(
        r[0], r[1], r[2], json.loads(r[3]), r[4], r[5], r[6], bool(r[7]), r[8], r[9], r[10]
    )


class ArtifactStore:
    def __init__(self, path: Path, kinds: dict[str, ArtifactKind] | None = None) -> None:
        self._db = connect(path)
        migrate(self._db, "artifacts", [Migration(1, SCHEMA)], path=path)
        self._lock = threading.Lock()
        self.kinds = kinds or dict(BUILT_IN)

    def _q(self, sql: str, args: tuple[Any, ...] = ()) -> list[Any]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def save(
        self,
        kind: str,
        title: str,
        data: dict[str, Any],
        *,
        thread_id: str | None = None,
        run_id: str | None = None,
        workflow: str | None = None,
        needs_review: bool = False,
    ) -> Artifact:
        spec = self.kinds.get(kind)
        if spec is None:
            raise ValueError(f"unknown artifact kind {kind!r} (known: {sorted(self.kinds)})")
        missing = [f for f in spec.required if f not in data]
        if missing:
            raise ValueError(f"{kind} artifact is missing {missing}")
        art = Artifact(
            f"art-{secrets.token_hex(6)}",
            kind,
            title or spec.title,
            data,
            thread_id,
            run_id,
            workflow,
            needs_review,
            schema_version=spec.schema_version,
        )
        self._q(
            f"INSERT INTO artifacts ({_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (art.id, art.kind, art.title, json.dumps(data, ensure_ascii=False, default=str),
             thread_id, run_id, workflow, int(needs_review), None, art.created,
             art.schema_version),
        )  # fmt: skip
        return art

    def get(self, aid: str) -> Artifact:
        rows = self._q(f"SELECT {_COLS} FROM artifacts WHERE id = ?", (aid,))
        if not rows:
            raise KeyError(f"no artifact {aid}")
        return _row(rows[0])

    def find(
        self,
        *,
        kind: str | None = None,
        thread_id: str | None = None,
        workflow: str | None = None,
        needs_review: bool | None = None,
        since: float | None = None,
        limit: int = 50,
    ) -> list[Artifact]:
        sql = f"SELECT {_COLS} FROM artifacts WHERE 1=1"
        args: list[Any] = []
        for col, val in (("kind", kind), ("thread_id", thread_id), ("workflow", workflow)):
            if val is not None:
                sql += f" AND {col} = ?"
                args.append(val)
        if needs_review is not None:
            sql += " AND needs_review = ?"
            args.append(int(needs_review))
        if since is not None:
            sql += " AND created >= ?"
            args.append(since)
        sql += " ORDER BY created DESC LIMIT ?"
        args.append(limit)
        return [_row(r) for r in self._q(sql, tuple(args))]

    def purge(self, before: float) -> int:
        with self._lock:
            return self._db.execute("DELETE FROM artifacts WHERE created < ?", (before,)).rowcount

    def mark_reviewed(self, aid: str, by: str) -> Artifact:
        self.get(aid)
        self._q("UPDATE artifacts SET needs_review = 0, reviewed_by = ? WHERE id = ?", (by, aid))
        return self.get(aid)
