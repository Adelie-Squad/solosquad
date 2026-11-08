"""The calendar — 일정 at the customer level (decision 60 · PRD v2.1.0 §3.1 일정).

One component (`calendar`) in the customer's `core.db` (decision 54 · I33), next to the
accounts — the calendar belongs to the whole account (company), above the org level:

    항목 (item, `parent_id` NULL)          e.g. "2차 모두의 창업"
      └─ 세부 항목 (sub-item, one level)    e.g. 지원 · 오리엔테이션 · 1라운드 제출 · 멘토링
    할 일 (to-do) under either level        e.g. 사업계획서 작성/제출 — done flag, due, assignee

An entry is **work** (`org` set, optionally a workspace) or **personal** (`owner_id` only).
Personal entries are their owner's alone — nobody else lists them, opens them or hears of
them, the customer's owner included (decision 60 ⒟). Work entries are seen and written by
whoever may enter their org (and workspace, when set): the store takes that judgement as a
callable from the web layer, so the scope rule stays in one place (`ScopeGate` · `role_in`).

구분 (category — one per entry) and 태그 (tags — many) are labels kept per org for work and per
person for personal entries. Colours are keys of a fixed palette (`PALETTE`), never hex — the
web maps each key to a design token. A scope without labels is seeded once: from the org's
`orgs/<org>/calendar/presets.yaml` when there is one (an FDE writes it, v2.2), else from the
small generic default below.
"""

from __future__ import annotations

import re
import secrets
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from solosquad.storage import Migration, connect, migrate
from solosquad.web_api.errors import CodedError, ErrorCode

COMPONENT = "calendar"
KINDS = ("work", "personal")
STATUSES = ("planned", "active", "done", "canceled")
PALETTE = ("blue", "teal", "green", "gold", "orange", "rose", "gray")
LABEL_TYPES = ("category", "tag")
AGENT_ACCESS = ("off", "busy", "full")
"""How much agents may read of a person's personal entries — the person chooses
(decision 60 rev, 2026-11-09). `off` (the default): nothing · `busy`: time blocks only,
no titles or notes · `full`: titles, times and notes. People never see them either way."""
TITLE_MAX = 200
NOTES_MAX = 4000
LABEL_MAX = 40
PRESET_FILE = Path("calendar") / "presets.yaml"

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS cal_items (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, org TEXT, workspace TEXT, owner_id TEXT,
    parent_id TEXT, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', start TEXT,
    end TEXT, category_id TEXT, status TEXT NOT NULL DEFAULT 'planned',
    position INTEGER NOT NULL DEFAULT 0, created_by TEXT, created REAL NOT NULL,
    updated REAL NOT NULL);
CREATE INDEX IF NOT EXISTS cal_items_scope ON cal_items (kind, org, owner_id);
CREATE INDEX IF NOT EXISTS cal_items_parent ON cal_items (parent_id);
CREATE TABLE IF NOT EXISTS cal_item_tags (
    item_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (item_id, tag_id));
CREATE TABLE IF NOT EXISTS cal_todos (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL, title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0, due TEXT, assignee_id TEXT,
    position INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
CREATE INDEX IF NOT EXISTS cal_todos_item ON cal_todos (item_id);
CREATE TABLE IF NOT EXISTS cal_labels (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, scope_kind TEXT NOT NULL, scope TEXT NOT NULL,
    name TEXT NOT NULL, color TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
CREATE INDEX IF NOT EXISTS cal_labels_scope ON cal_labels (scope_kind, scope);
CREATE TABLE IF NOT EXISTS cal_agent_access (
    user_id TEXT PRIMARY KEY, level TEXT NOT NULL, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS cal_seeded (
    scope_kind TEXT NOT NULL, scope TEXT NOT NULL, source TEXT NOT NULL, ts REAL NOT NULL,
    PRIMARY KEY (scope_kind, scope))
"""

MIGRATIONS = (Migration(1, SCHEMA),)  # decision 60 — the manual calendar (v2.1)

MaySee = Callable[[str, str | None], bool]
"""(org, workspace) → may this person see (and write) work entries there."""


# ---------------------------------------------------------------------- presets


@dataclass(frozen=True)
class PresetLabel:
    name: str
    color: str


@dataclass(frozen=True)
class Preset:
    categories: tuple[PresetLabel, ...]
    tags: tuple[PresetLabel, ...]
    source: str
    """`default` or the preset file's path relative to the org."""


DEFAULT_WORK: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    # generic on purpose — an FDE's domain preset (v2.2) replaces it per org
    "ko": (("업무", "회의", "마감"), ("중요", "서류")),
    "en": (("Work", "Meeting", "Deadline"), ("Important", "Documents")),
    "zh-CN": (("工作", "会议", "截止"), ("重要", "文件")),
}
DEFAULT_PERSONAL: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "ko": (("개인", "건강"), ("중요",)),
    "en": (("Personal", "Health"), ("Important",)),
    "zh-CN": (("个人", "健康"), ("重要",)),
}


def default_preset(locale: str, *, personal: bool = False) -> Preset:
    table = DEFAULT_PERSONAL if personal else DEFAULT_WORK
    cats, tags = table.get(locale, table["ko"])
    return Preset(
        tuple(PresetLabel(n, PALETTE[i % len(PALETTE)]) for i, n in enumerate(cats)),
        tuple(PresetLabel(n, "gray") for n in tags),
        "default",
    )


class PresetError(ValueError):
    pass


def _preset_labels(raw: Any, what: str) -> tuple[PresetLabel, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise PresetError(f"{what} must be a list")
    out = []
    for i, entry in enumerate(raw):
        if isinstance(entry, str):
            entry = {"name": entry}
        if not isinstance(entry, dict) or not str(entry.get("name") or "").strip():
            raise PresetError(f"{what}[{i}] needs a name")
        color = str(entry.get("color") or PALETTE[i % len(PALETTE)])
        if color not in PALETTE:
            raise PresetError(f"{what}[{i}]: color must be one of {list(PALETTE)}")
        out.append(PresetLabel(str(entry["name"]).strip()[:LABEL_MAX], color))
    return tuple(out)


def load_preset(org_root: Path) -> Preset | None:
    """`orgs/<org>/calendar/presets.yaml` → its 구분 and tags, or None when there is no file.

        format_version: 1
        categories: [{name: 지원, color: blue}, {name: 개발, color: teal}, 영업]
        tags: [서류, {name: 인터뷰, color: gold}]

    Raises `PresetError` for a file that is there but wrong — the caller falls back to the
    default and reports why, it never seeds half a file."""
    path = org_root / PRESET_FILE
    if not path.is_file():
        return None
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        raise PresetError(f"{PRESET_FILE.as_posix()}: not YAML: {e}") from e
    if not isinstance(data, dict):
        raise PresetError(f"{PRESET_FILE.as_posix()}: expected a mapping")
    version = data.get("format_version", 1)
    if version != 1:
        raise PresetError(f"{PRESET_FILE.as_posix()}: format_version {version!r} is not supported")
    return Preset(
        _preset_labels(data.get("categories"), "categories"),
        _preset_labels(data.get("tags"), "tags"),
        PRESET_FILE.as_posix(),
    )


# ---------------------------------------------------------------------- validation


def _err(code: ErrorCode, message: str, **params: str | int) -> CodedError:
    return CodedError(code, message, **params)


def check_when(value: Any, field_name: str) -> str | None:
    """A date (`2026-11-20`, all day) or a local date-time (`2026-11-20T14:00`), or None."""
    if value is None or value == "":
        return None
    s = str(value)
    if not (_DATE.match(s) or _DATETIME.match(s)):
        raise _err(
            ErrorCode.CALENDAR_DATE_INVALID,
            f"{field_name} must be YYYY-MM-DD or YYYY-MM-DDTHH:MM",
            field=field_name,
        )
    try:
        time.strptime(s, "%Y-%m-%dT%H:%M" if "T" in s else "%Y-%m-%d")
    except ValueError as e:
        raise _err(
            ErrorCode.CALENDAR_DATE_INVALID, f"{field_name}: no such date", field=field_name
        ) from e
    return s


def _title(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        raise _err(ErrorCode.CALENDAR_TITLE_REQUIRED, "a title is required")
    if len(s) > TITLE_MAX:
        raise _err(
            ErrorCode.CALENDAR_TITLE_REQUIRED,
            f"a title is at most {TITLE_MAX} characters",
            max=TITLE_MAX,
        )
    return s


def _day(when: str | None) -> str | None:
    return when[:10] if when else None


def _new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(6)}"


# ---------------------------------------------------------------------- the store


@dataclass
class Viewer:
    """Who is asking: their id and which orgs/workspaces they may enter. `None` id = the
    local CLI token, which has no personal calendar."""

    user_id: str | None
    may_see: MaySee
    names: dict[str, str] = field(default_factory=dict)


class NotVisible(KeyError):
    """No such entry — or one that is not this person's to see. The same answer (C3)."""


class CalendarStore:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._db = connect(path)
        migrate(self._db, COMPONENT, MIGRATIONS, path=Path(path))
        self._lock = threading.Lock()

    def close(self) -> None:
        self._db.close()

    def _q(self, sql: str, args: tuple[Any, ...] = ()) -> list[Any]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def _tx(self, steps: Iterable[tuple[str, tuple[Any, ...]]]) -> None:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                for sql, args in steps:
                    self._db.execute(sql, args)
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    # ------------------------------------------------------------------ rows

    _ITEM_COLS = (
        "id, kind, org, workspace, owner_id, parent_id, title, notes, start, end, category_id,"
        " status, position, created_by, created, updated"
    )

    def _item_row(self, r: Any) -> dict[str, Any]:
        start, end = r[8], r[9]
        return {
            "id": r[0],
            "kind": r[1],
            "org": r[2],
            "workspace": r[3],
            "owner_id": r[4],
            "parent_id": r[5],
            "title": r[6],
            "notes": r[7],
            "start": start,
            "end": end,
            "all_day": not (start and "T" in start),
            "category_id": r[10],
            "status": r[11],
            "position": r[12],
            "created_by": r[13],
            "created": r[14],
            "updated": r[15],
            "tag_ids": [],
        }

    def _with_tags(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not items:
            return items
        by_id = {i["id"]: i for i in items}
        marks = ",".join("?" * len(by_id))
        for item_id, tag_id in self._q(
            f"SELECT item_id, tag_id FROM cal_item_tags WHERE item_id IN ({marks}) ORDER BY rowid",
            tuple(by_id),
        ):
            by_id[item_id]["tag_ids"].append(tag_id)
        return items

    _TODO_COLS = "id, item_id, title, done, due, assignee_id, position, created, updated"

    @staticmethod
    def _todo_row(r: Any) -> dict[str, Any]:
        return {
            "id": r[0],
            "item_id": r[1],
            "title": r[2],
            "done": bool(r[3]),
            "due": r[4],
            "assignee_id": r[5],
            "position": r[6],
            "created": r[7],
            "updated": r[8],
        }

    # ------------------------------------------------------------------ visibility

    @staticmethod
    def visible(item: dict[str, Any], who: Viewer) -> bool:
        if item["kind"] == "personal":
            return who.user_id is not None and item["owner_id"] == who.user_id
        return bool(item["org"]) and who.may_see(item["org"], item["workspace"])

    def _raw_item(self, iid: str) -> dict[str, Any] | None:
        rows = self._q(f"SELECT {self._ITEM_COLS} FROM cal_items WHERE id = ?", (iid,))
        return self._item_row(rows[0]) if rows else None

    def item(self, iid: str, who: Viewer) -> dict[str, Any]:
        found = self._raw_item(iid)
        if found is None or not self.visible(found, who):
            raise NotVisible(iid)
        return self._with_tags([found])[0]

    def detail(self, iid: str, who: Viewer) -> dict[str, Any]:
        """The item, its parent (for the breadcrumbs), its sub-items and its to-dos."""
        item = self.item(iid, who)
        parent = self.item(item["parent_id"], who) if item["parent_id"] else None
        children = self._with_tags(
            [
                self._item_row(r)
                for r in self._q(
                    f"SELECT {self._ITEM_COLS} FROM cal_items WHERE parent_id = ?"
                    " ORDER BY position, created",
                    (iid,),
                )
            ]
        )
        return {
            "item": item,
            "parent": parent,
            "children": children,
            "todos": self.todos_of([iid]),
            "child_todos": self.todos_of([c["id"] for c in children]),
        }

    def todos_of(self, item_ids: list[str]) -> list[dict[str, Any]]:
        if not item_ids:
            return []
        marks = ",".join("?" * len(item_ids))
        return [
            self._todo_row(r)
            for r in self._q(
                f"SELECT {self._TODO_COLS} FROM cal_todos WHERE item_id IN ({marks})"
                " ORDER BY position, created",
                tuple(item_ids),
            )
        ]

    # ------------------------------------------------------------------ listing

    def list_range(
        self,
        who: Viewer,
        *,
        start: str,
        end: str,
        kind: str | None = None,
        org: str | None = None,
        workspace: str | None = None,
        category: str | None = None,
        tag: str | None = None,
        done: bool | None = None,
        undated: bool = False,
    ) -> dict[str, Any]:
        """Entries that overlap the days `start`..`end` (inclusive), and the to-dos due in
        them. `done` False hides finished entries and ticked to-dos. `undated` adds the
        top-level items that have no date yet (the agenda lists them at the end)."""
        s, e = check_when(start, "from"), check_when(end, "to")
        if s is None or e is None:
            raise _err(ErrorCode.CALENDAR_DATE_INVALID, "from and to are required", field="from")
        s, e = s[:10], e[:10]
        rows = [self._item_row(r) for r in self._q(f"SELECT {self._ITEM_COLS} FROM cal_items")]
        mine = [i for i in rows if self.visible(i, who)]
        by_id = {i["id"]: i for i in mine}
        self._with_tags(mine)

        def keep(i: dict[str, Any]) -> bool:
            if kind and i["kind"] != kind:
                return False
            if org and i["org"] != org:
                return False
            if workspace and i["workspace"] != workspace:
                return False
            if category and i["category_id"] != category:
                return False
            if tag and tag not in i["tag_ids"]:
                return False
            return not (done is False and i["status"] in ("done", "canceled"))

        def overlaps(i: dict[str, Any]) -> bool:
            first = _day(i["start"])
            if first is None:
                return False
            last = _day(i["end"]) or first
            return first <= e and last >= s

        items = [
            i
            for i in mine
            if keep(i) and (overlaps(i) or (undated and i["parent_id"] is None and not i["start"]))
        ]
        items.sort(key=lambda i: (i["start"] or "9999", i["position"], i["created"]))
        todos = []
        for t in self.todos_of(list(by_id)):
            owner = by_id[t["item_id"]]
            due = _day(t["due"])
            if due is None or not (s <= due <= e) or not keep(owner):
                continue
            if done is False and t["done"]:
                continue
            todos.append(t)
        todos.sort(key=lambda t: (t["due"], t["position"]))
        parents = {i["parent_id"] for i in items if i["parent_id"]} | {
            by_id[t["item_id"]]["parent_id"] for t in todos if by_id[t["item_id"]]["parent_id"]
        }
        shown = {i["id"] for i in items}
        context = [by_id[p] for p in parents if p in by_id and p not in shown]
        context += [
            by_id[t["item_id"]]
            for t in todos
            if t["item_id"] not in shown and t["item_id"] not in {c["id"] for c in context}
        ]
        return {"start": s, "end": e, "items": items, "todos": todos, "context": context}

    # ------------------------------------------------------------------ items

    def create_item(self, who: Viewer, data: dict[str, Any]) -> dict[str, Any]:
        parent_id = data.get("parent_id") or None
        if parent_id:
            parent = self.item(str(parent_id), who)
            if parent["parent_id"]:
                raise _err(ErrorCode.CALENDAR_PARENT_INVALID, "a sub-item cannot have sub-items")
            kind, org, ws = parent["kind"], parent["org"], parent["workspace"]
        else:
            kind = str(data.get("kind") or "work")
            if kind not in KINDS:
                raise _err(ErrorCode.CALENDAR_KIND_INVALID, f"kind must be one of {list(KINDS)}")
            org = str(data.get("org") or "") or None if kind == "work" else None
            ws = (str(data.get("workspace") or "") or None) if kind == "work" else None
            if kind == "work" and not org:
                raise _err(ErrorCode.CALENDAR_ORG_REQUIRED, "a work entry needs a business (org)")
            if kind == "personal" and who.user_id is None:
                raise _err(ErrorCode.CALENDAR_KIND_INVALID, "personal entries need a person")
        owner = who.user_id if kind == "personal" else None
        probe = {"kind": kind, "org": org, "workspace": ws, "owner_id": owner}
        if not self.visible(probe, who):
            raise NotVisible(org or "")
        title = _title(data.get("title"))
        start = check_when(data.get("start"), "start")
        end = check_when(data.get("end"), "end")
        self._check_span(start, end)
        status = self._status(data.get("status") or "planned")
        category = self._category(probe, data.get("category_id"), who)
        tags = self._tags(probe, data.get("tag_ids"), who)
        iid = _new_id("ci")
        now = time.time()
        pos = self._next_position("cal_items", "parent_id", parent_id)
        notes = str(data.get("notes") or "")[:NOTES_MAX]
        self._tx(
            [
                (
                    f"INSERT INTO cal_items ({self._ITEM_COLS}) VALUES"
                    " (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        iid,
                        kind,
                        org,
                        ws,
                        owner,
                        parent_id,
                        title,
                        notes,
                        start,
                        end,
                        category,
                        status,
                        pos,
                        who.user_id,
                        now,
                        now,
                    ),
                ),
                *[
                    ("INSERT INTO cal_item_tags (item_id, tag_id) VALUES (?,?)", (iid, t))
                    for t in tags
                ],
            ]
        )
        return self.item(iid, who)

    def update_item(self, iid: str, who: Viewer, data: dict[str, Any]) -> dict[str, Any]:
        """Title · notes · dates · 구분 · tags · status — and, for a top-level work item, its
        org/workspace (it must be the person's there too; sub-items follow)."""
        item = self.item(iid, who)
        sets: dict[str, Any] = {}
        moved: tuple[str | None, str | None] | None = None
        if (
            item["kind"] == "work"
            and not item["parent_id"]
            and ("org" in data or "workspace" in data)
        ):
            org = str(data.get("org", item["org"]) or "") or None
            ws = str(data.get("workspace", item["workspace"]) or "") or None
            if not org:
                raise _err(ErrorCode.CALENDAR_ORG_REQUIRED, "a work entry needs a business (org)")
            if not who.may_see(org, ws):
                raise NotVisible(org)
            if (org, ws) != (item["org"], item["workspace"]):
                moved = (org, ws)
                sets["org"], sets["workspace"] = org, ws
        target = {**item, **sets}
        if "title" in data:
            sets["title"] = _title(data["title"])
        if "notes" in data:
            sets["notes"] = str(data["notes"] or "")[:NOTES_MAX]
        start = check_when(data["start"], "start") if "start" in data else item["start"]
        end = check_when(data["end"], "end") if "end" in data else item["end"]
        self._check_span(start, end)
        if "start" in data:
            sets["start"] = start
        if "end" in data:
            sets["end"] = end
        if "status" in data:
            sets["status"] = self._status(data["status"])
        org_changed = moved is not None and moved[0] != item["org"]
        if "category_id" in data:
            sets["category_id"] = self._category(target, data["category_id"], who)
        elif org_changed:
            sets["category_id"] = None  # labels are per org — they do not travel
        tags: list[str] | None = None
        if "tag_ids" in data:
            tags = self._tags(target, data["tag_ids"], who)
        elif org_changed:
            tags = []
        steps: list[tuple[str, tuple[Any, ...]]] = []
        if sets:
            sets["updated"] = time.time()
            cols = ", ".join(f"{k} = ?" for k in sets)
            steps.append((f"UPDATE cal_items SET {cols} WHERE id = ?", (*sets.values(), iid)))
        if moved is not None:
            steps.append(
                ("UPDATE cal_items SET org = ?, workspace = ? WHERE parent_id = ?", (*moved, iid))
            )
            if org_changed:
                steps.append(
                    ("UPDATE cal_items SET category_id = NULL WHERE parent_id = ?", (iid,))
                )
                steps.append(
                    (
                        "DELETE FROM cal_item_tags WHERE item_id IN"
                        " (SELECT id FROM cal_items WHERE parent_id = ?)",
                        (iid,),
                    )
                )
        if tags is not None:
            steps.append(("DELETE FROM cal_item_tags WHERE item_id = ?", (iid,)))
            steps += [
                ("INSERT INTO cal_item_tags (item_id, tag_id) VALUES (?,?)", (iid, t)) for t in tags
            ]
        if steps:
            self._tx(steps)
        return self.item(iid, who)

    def delete_item(self, iid: str, who: Viewer) -> dict[str, Any]:
        """The item, its sub-items and every to-do under them."""
        item = self.item(iid, who)
        ids = [iid] + [
            r[0] for r in self._q("SELECT id FROM cal_items WHERE parent_id = ?", (iid,))
        ]
        marks = ",".join("?" * len(ids))
        self._tx(
            [
                (f"DELETE FROM cal_todos WHERE item_id IN ({marks})", tuple(ids)),
                (f"DELETE FROM cal_item_tags WHERE item_id IN ({marks})", tuple(ids)),
                (f"DELETE FROM cal_items WHERE id IN ({marks})", tuple(ids)),
            ]
        )
        return item

    def _check_span(self, start: str | None, end: str | None) -> None:
        if end and not start:
            raise _err(ErrorCode.CALENDAR_DATE_INVALID, "an end needs a start", field="end")
        if start and end and (("T" in start) != ("T" in end)):
            raise _err(
                ErrorCode.CALENDAR_DATE_INVALID,
                "start and end must both be dates or both be date-times",
                field="end",
            )
        if start and end and end < start:
            raise _err(ErrorCode.CALENDAR_DATE_INVALID, "the end is before the start", field="end")

    @staticmethod
    def _status(value: Any) -> str:
        s = str(value)
        if s not in STATUSES:
            raise _err(ErrorCode.CALENDAR_STATUS_INVALID, f"status must be one of {list(STATUSES)}")
        return s

    def _next_position(self, table: str, column: str, value: str | None) -> int:
        where = f"{column} IS NULL" if value is None else f"{column} = ?"
        args: tuple[Any, ...] = () if value is None else (value,)
        rows = self._q(f"SELECT COALESCE(MAX(position), -1) FROM {table} WHERE {where}", args)
        return int(rows[0][0]) + 1

    # ------------------------------------------------------------------ to-dos

    def todo(self, tid: str, who: Viewer) -> tuple[dict[str, Any], dict[str, Any]]:
        rows = self._q(f"SELECT {self._TODO_COLS} FROM cal_todos WHERE id = ?", (tid,))
        if not rows:
            raise NotVisible(tid)
        todo = self._todo_row(rows[0])
        return todo, self.item(todo["item_id"], who)  # NotVisible when the item is not theirs

    def create_todo(
        self, iid: str, who: Viewer, data: dict[str, Any], *, assignable: Callable[[str], bool]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        item = self.item(iid, who)
        title = _title(data.get("title"))
        due = check_when(data.get("due"), "due")
        assignee = self._assignee(item, data.get("assignee_id"), who, assignable)
        tid = _new_id("ct")
        now = time.time()
        pos = self._next_position("cal_todos", "item_id", iid)
        self._q(
            f"INSERT INTO cal_todos ({self._TODO_COLS}) VALUES (?,?,?,?,?,?,?,?,?)",
            (tid, iid, title, 0, due, assignee, pos, now, now),
        )
        return self.todo(tid, who)[0], item

    def update_todo(
        self, tid: str, who: Viewer, data: dict[str, Any], *, assignable: Callable[[str], bool]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        _todo, item = self.todo(tid, who)
        sets: dict[str, Any] = {}
        if "title" in data:
            sets["title"] = _title(data["title"])
        if "done" in data:
            sets["done"] = 1 if data["done"] else 0
        if "due" in data:
            sets["due"] = check_when(data["due"], "due")
        if "assignee_id" in data:
            sets["assignee_id"] = self._assignee(item, data["assignee_id"], who, assignable)
        if sets:
            sets["updated"] = time.time()
            cols = ", ".join(f"{k} = ?" for k in sets)
            self._q(f"UPDATE cal_todos SET {cols} WHERE id = ?", (*sets.values(), tid))
        return self.todo(tid, who)[0], item

    def delete_todo(self, tid: str, who: Viewer) -> tuple[dict[str, Any], dict[str, Any]]:
        todo, item = self.todo(tid, who)
        self._q("DELETE FROM cal_todos WHERE id = ?", (tid,))
        return todo, item

    @staticmethod
    def _assignee(
        item: dict[str, Any], value: Any, who: Viewer, assignable: Callable[[str], bool]
    ) -> str | None:
        if value is None or value == "":
            return None
        uid = str(value)
        # nobody else may even be named on a personal entry
        ok = uid == who.user_id if item["kind"] == "personal" else assignable(uid)
        if not ok:
            raise _err(
                ErrorCode.CALENDAR_ASSIGNEE_INVALID,
                "the assignee must be a person of this business",
            )
        return uid

    # ------------------------------------------------------------------ reorder

    def reorder(self, who: Viewer, what: str, ids: list[str]) -> str | None:
        """New order for siblings — sub-items of one item, to-dos of one item, or labels of
        one scope. → the org whose work entries changed (for the audit), if any."""
        if not ids or len(set(ids)) != len(ids):
            raise _err(ErrorCode.CALENDAR_REORDER_INVALID, "ids must be a non-empty list")
        if what == "items":
            items = [self.item(i, who) for i in ids]
            parents = {i["parent_id"] for i in items}
            if len(parents) != 1 or None in parents:
                raise _err(ErrorCode.CALENDAR_REORDER_INVALID, "only sub-items of one item")
            table, org = "cal_items", items[0]["org"]
        elif what == "todos":
            pairs = [self.todo(i, who) for i in ids]
            if len({t["item_id"] for t, _ in pairs}) != 1:
                raise _err(ErrorCode.CALENDAR_REORDER_INVALID, "only to-dos of one item")
            table, org = "cal_todos", pairs[0][1]["org"]
        elif what == "labels":
            labels = [self.label(i, who) for i in ids]
            if len({(lb["scope_kind"], lb["scope"]) for lb in labels}) != 1:
                raise _err(ErrorCode.CALENDAR_REORDER_INVALID, "only labels of one scope")
            table = "cal_labels"
            org = labels[0]["scope"] if labels[0]["scope_kind"] == "org" else None
        else:
            raise _err(ErrorCode.CALENDAR_REORDER_INVALID, "type must be items, todos or labels")
        self._tx(
            [(f"UPDATE {table} SET position = ? WHERE id = ?", (n, i)) for n, i in enumerate(ids)]
        )
        return str(org) if org else None

    # ------------------------------------------------------------------ labels

    @staticmethod
    def _label_row(r: Any) -> dict[str, Any]:
        return {
            "id": r[0],
            "type": r[1],
            "scope_kind": r[2],
            "scope": r[3],
            "name": r[4],
            "color": r[5],
            "archived": bool(r[6]),
            "position": r[7],
        }

    _LABEL_COLS = "id, type, scope_kind, scope, name, color, archived, position"

    def _label_visible(self, label: dict[str, Any], who: Viewer) -> bool:
        if label["scope_kind"] == "user":
            return who.user_id is not None and label["scope"] == who.user_id
        return who.may_see(label["scope"], None)

    def label(self, lid: str, who: Viewer) -> dict[str, Any]:
        rows = self._q(f"SELECT {self._LABEL_COLS} FROM cal_labels WHERE id = ?", (lid,))
        if not rows:
            raise NotVisible(lid)
        found = self._label_row(rows[0])
        if not self._label_visible(found, who):
            raise NotVisible(lid)
        return found

    def labels(
        self,
        who: Viewer,
        orgs: list[str],
        *,
        preset_for: Callable[[str], Preset],
        personal_preset: Preset | None,
    ) -> dict[str, Any]:
        """Every label the person may use: each visible org's, and their own — seeding a
        scope the first time it is asked for. → {labels, seeded: {scope: source}}."""
        out: list[dict[str, Any]] = []
        seeded: dict[str, str] = {}
        scopes = [("org", o) for o in orgs if who.may_see(o, None)]
        if who.user_id is not None:
            scopes.append(("user", who.user_id))
        for scope_kind, scope in scopes:
            source = self._seed(
                scope_kind,
                scope,
                (preset_for(scope) if scope_kind == "org" else personal_preset),
            )
            if source:
                seeded[f"{scope_kind}:{scope}"] = source
            out += [
                self._label_row(r)
                for r in self._q(
                    f"SELECT {self._LABEL_COLS} FROM cal_labels WHERE scope_kind = ? AND scope = ?"
                    " ORDER BY type, position, created",
                    (scope_kind, scope),
                )
            ]
        return {"labels": out, "seeded": seeded}

    def _seed(self, scope_kind: str, scope: str, preset: Preset | None) -> str | None:
        """Seed a scope once. → the preset's source when it seeded now."""
        if preset is None or self._q(
            "SELECT 1 FROM cal_seeded WHERE scope_kind = ? AND scope = ?", (scope_kind, scope)
        ):
            return None
        if self._q(
            "SELECT 1 FROM cal_labels WHERE scope_kind = ? AND scope = ? LIMIT 1",
            (scope_kind, scope),
        ):
            have = True
        else:
            have = False
        now = time.time()
        steps: list[tuple[str, tuple[Any, ...]]] = [
            (
                "INSERT OR IGNORE INTO cal_seeded (scope_kind, scope, source, ts) VALUES (?,?,?,?)",
                (scope_kind, scope, "existing" if have else preset.source, now),
            ),
        ]
        if not have:
            for typ, rows in (("category", preset.categories), ("tag", preset.tags)):
                for n, lb in enumerate(rows):
                    steps.append(
                        (
                            f"INSERT INTO cal_labels ({self._LABEL_COLS}, created)"
                            " VALUES (?,?,?,?,?,?,?,?,?)",
                            (_new_id("cl"), typ, scope_kind, scope, lb.name, lb.color, 0, n, now),
                        )
                    )
        self._tx(steps)
        return None if have else preset.source

    def create_label(self, who: Viewer, data: dict[str, Any]) -> dict[str, Any]:
        typ = str(data.get("type") or "")
        if typ not in LABEL_TYPES:
            raise _err(ErrorCode.CALENDAR_LABEL_INVALID, "type must be category or tag")
        if data.get("personal"):
            if who.user_id is None:
                raise _err(ErrorCode.CALENDAR_KIND_INVALID, "personal labels need a person")
            scope_kind, scope = "user", who.user_id
        else:
            org = str(data.get("org") or "")
            if not org:
                raise _err(ErrorCode.CALENDAR_ORG_REQUIRED, "a work label needs a business (org)")
            if not who.may_see(org, None):
                raise NotVisible(org)
            scope_kind, scope = "org", org
        name = self._label_name(data.get("name"))
        color = self._color(data.get("color") or "gray")
        if self._q(
            "SELECT 1 FROM cal_labels WHERE scope_kind = ? AND scope = ? AND type = ? AND name = ?",
            (scope_kind, scope, typ, name),
        ):
            raise _err(ErrorCode.CALENDAR_LABEL_EXISTS, f"{name!r} exists already", name=name)
        lid = _new_id("cl")
        rows = self._q(
            "SELECT COALESCE(MAX(position), -1) FROM cal_labels WHERE scope_kind = ? AND scope = ?"
            " AND type = ?",
            (scope_kind, scope, typ),
        )
        self._q(
            f"INSERT INTO cal_labels ({self._LABEL_COLS}, created) VALUES (?,?,?,?,?,?,?,?,?)",
            (lid, typ, scope_kind, scope, name, color, 0, int(rows[0][0]) + 1, time.time()),
        )
        # a scope someone adds to by hand is not seeded later on top of it
        self._q(
            "INSERT OR IGNORE INTO cal_seeded (scope_kind, scope, source, ts) VALUES (?,?,?,?)",
            (scope_kind, scope, "manual", time.time()),
        )
        return self.label(lid, who)

    def update_label(self, lid: str, who: Viewer, data: dict[str, Any]) -> dict[str, Any]:
        """Rename · recolour · archive (an archived label stays on the entries that carry it,
        but is no longer offered). Labels are never deleted — entries keep their meaning."""
        label = self.label(lid, who)
        sets: dict[str, Any] = {}
        if "name" in data:
            name = self._label_name(data["name"])
            clash = self._q(
                "SELECT 1 FROM cal_labels WHERE scope_kind = ? AND scope = ? AND type = ?"
                " AND name = ? AND id != ?",
                (label["scope_kind"], label["scope"], label["type"], name, lid),
            )
            if clash:
                raise _err(ErrorCode.CALENDAR_LABEL_EXISTS, f"{name!r} exists already", name=name)
            sets["name"] = name
        if "color" in data:
            sets["color"] = self._color(data["color"])
        if "archived" in data:
            sets["archived"] = 1 if data["archived"] else 0
        if sets:
            cols = ", ".join(f"{k} = ?" for k in sets)
            self._q(f"UPDATE cal_labels SET {cols} WHERE id = ?", (*sets.values(), lid))
        return self.label(lid, who)

    @staticmethod
    def _label_name(value: Any) -> str:
        s = str(value or "").strip()
        if not s or len(s) > LABEL_MAX:
            raise _err(
                ErrorCode.CALENDAR_LABEL_INVALID,
                f"a name of 1 to {LABEL_MAX} characters",
                max=LABEL_MAX,
            )
        return s

    @staticmethod
    def _color(value: Any) -> str:
        s = str(value)
        if s not in PALETTE:
            raise _err(ErrorCode.CALENDAR_COLOR_INVALID, f"color must be one of {list(PALETTE)}")
        return s

    def _label_scope(self, item: dict[str, Any]) -> tuple[str, str]:
        if item["kind"] == "personal":
            return "user", str(item["owner_id"])
        return "org", str(item["org"])

    def _category(self, item: dict[str, Any], value: Any, who: Viewer) -> str | None:
        if value is None or value == "":
            return None
        return self._labels_of(item, [str(value)], "category", who)[0]

    def _tags(self, item: dict[str, Any], value: Any, who: Viewer) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise _err(ErrorCode.CALENDAR_LABEL_INVALID, "tag_ids must be a list")
        return self._labels_of(item, list(dict.fromkeys(str(v) for v in value)), "tag", who)

    def _labels_of(self, item: dict[str, Any], ids: list[str], typ: str, who: Viewer) -> list[str]:
        scope = self._label_scope(item)
        for lid in ids:
            rows = self._q("SELECT type, scope_kind, scope FROM cal_labels WHERE id = ?", (lid,))
            if not rows or rows[0][0] != typ or (rows[0][1], rows[0][2]) != scope:
                raise _err(
                    ErrorCode.CALENDAR_LABEL_INVALID,
                    f"{typ} {lid!r} is not one of this entry's {typ}s",
                )
        return ids

    # ------------------------------------------------------------------ agents' read path

    def agent_access(self, uid: str) -> str:
        rows = self._q("SELECT level FROM cal_agent_access WHERE user_id = ?", (uid,))
        return str(rows[0][0]) if rows else "off"

    def set_agent_access(self, uid: str, level: str) -> str:
        if level not in AGENT_ACCESS:
            raise _err(
                ErrorCode.CALENDAR_AGENT_ACCESS_INVALID,
                f"level must be one of {list(AGENT_ACCESS)}",
            )
        self._q(
            "INSERT INTO cal_agent_access (user_id, level, ts) VALUES (?,?,?)"
            " ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, ts = excluded.ts",
            (uid, level, time.time()),
        )
        return level

    def agent_view(self, uid: str, *, start: str, end: str) -> dict[str, Any]:
        """What an agent working for `uid` may read of their personal entries in the days
        `start`..`end` — read-only, at the level the person chose. Work entries are not
        here (an agent reads those through its org). `busy` gives blocks with no title, no
        notes and no id (nothing to look up later); `off` gives nothing at all."""
        level = self.agent_access(uid)
        own = Viewer(uid, lambda _o, _w: False)
        found = self.list_range(own, start=start, end=end, kind="personal")
        entries: list[dict[str, Any]] = []
        for i in found["items"] if level != "off" else []:
            if i["status"] == "canceled":
                continue
            block: dict[str, Any] = {"start": i["start"], "end": i["end"], "all_day": i["all_day"]}
            if level == "full":
                block |= {
                    "id": i["id"],
                    "title": i["title"],
                    "notes": i["notes"],
                    "status": i["status"],
                }
            else:
                block |= {"id": None, "title": None, "notes": None, "status": None}
            entries.append(block)
        return {
            "user_id": uid,
            "level": level,
            "start": found["start"],
            "end": found["end"],
            "entries": entries,
        }

    # ------------------------------------------------------------------ the people's side

    def forget_person_assignments(self, uid: str) -> int:
        """When someone is no longer a person here, the to-dos assigned to them go back to
        nobody (their personal entries stay theirs). → how many were unassigned."""
        with self._lock:
            n = self._db.execute(
                "UPDATE cal_todos SET assignee_id = NULL WHERE assignee_id = ?", (uid,)
            ).rowcount
        return int(n)


# ---------------------------------------------------------------------- demo data


def seed_demo(store: CalendarStore, org: str, owner_id: str | None, *, today: str) -> list[str]:
    """The user's own example (decision 60) — for demos and the web's dev fixtures:

    사업 <org> → 항목 "2차 모두의 창업" → 세부 항목 지원 · 오리엔테이션 · 1라운드 제출 · 멘토링 →
    할 일 사업계획서 작성/제출 · 창업활동보고서 작성/제출 (under 1라운드 제출); 구분 지원 · 개발 ·
    영업 · 인사 · 네트워킹; tags 서류 · 인터뷰 — and two personal entries for `owner_id`.
    `today` (YYYY-MM-DD) anchors the dates so the month on screen has them. → item ids."""
    import datetime as dt

    base = dt.date.fromisoformat(today)

    def day(n: int) -> str:
        return (base + dt.timedelta(days=n)).isoformat()

    who = Viewer(owner_id, lambda _o, _w: True)
    preset = Preset(
        tuple(
            PresetLabel(n, c)
            for n, c in (
                ("지원", "blue"),
                ("개발", "teal"),
                ("영업", "orange"),
                ("인사", "green"),
                ("네트워킹", "gold"),
            )
        ),
        (PresetLabel("서류", "gray"), PresetLabel("인터뷰", "rose")),
        "demo",
    )
    store._seed("org", org, preset)
    labels = store.labels(who, [org], preset_for=lambda _o: preset, personal_preset=None)
    by_name = {(lb["type"], lb["name"]): lb["id"] for lb in labels["labels"] if lb["scope"] == org}
    cat = by_name.get(("category", "지원"))
    doc, interview = by_name.get(("tag", "서류")), by_name.get(("tag", "인터뷰"))
    top = store.create_item(
        who,
        {
            "kind": "work",
            "org": org,
            "title": "2차 모두의 창업",
            "start": day(-6),
            "end": day(40),
            "category_id": cat,
            "status": "active",
            "notes": "모두의 창업 2차 프로그램 — 지원부터 멘토링까지.",
        },
    )
    ids = [top["id"]]
    subs = [
        ("지원", day(-6), day(-2), "done", [doc]),
        ("오리엔테이션", day(1) + "T14:00", day(1) + "T16:00", "planned", []),
        ("1라운드 제출", day(5), day(12), "active", [doc]),
        ("멘토링", day(19) + "T10:00", day(19) + "T11:30", "planned", [interview]),
    ]
    sub_ids: dict[str, str] = {}
    for title, start, end, status, tags in subs:
        sub = store.create_item(
            who,
            {
                "parent_id": top["id"],
                "title": title,
                "start": start,
                "end": end,
                "status": status,
                "category_id": cat,
                "tag_ids": [t for t in tags if t],
            },
        )
        sub_ids[title] = sub["id"]
        ids.append(sub["id"])
    anyone: Callable[[str], bool] = lambda _u: True  # noqa: E731
    for title, due in (("사업계획서 작성/제출", day(9)), ("창업활동보고서 작성/제출", day(12))):
        store.create_todo(
            sub_ids["1라운드 제출"],
            who,
            {"title": title, "due": due, "assignee_id": owner_id},
            assignable=anyone,
        )
    store.create_todo(
        sub_ids["지원"], who, {"title": "지원서 제출", "due": day(-3)}, assignable=anyone
    )
    first = store.todos_of([sub_ids["지원"]])[0]
    store.update_todo(first["id"], who, {"done": True}, assignable=anyone)
    if owner_id is not None:
        for title, start, end in (
            ("치과 예약", day(2) + "T18:30", day(2) + "T19:30"),
            ("가족 여행", day(14), day(16)),
        ):
            ids.append(
                store.create_item(
                    who, {"kind": "personal", "title": title, "start": start, "end": end}
                )["id"]
            )
    return ids


__all__ = [
    "KINDS",
    "PALETTE",
    "STATUSES",
    "CalendarStore",
    "NotVisible",
    "Preset",
    "PresetError",
    "Viewer",
    "default_preset",
    "load_preset",
    "seed_demo",
]
