"""Demo accounts and their usage — component `demo` of the demo server's `core.db`.

    demo_accounts   one row per issued id: inquiry id · label · locale · expiry · revoked ·
                    the reset generation (`generation` asked for, `seeded` done) · the
                    company's registration number from the inquiry (`company_no`, asked
                    for at the demo login next to the id and password — 2026-11-12)
    demo_sessions   one row per sign-in: started · last seen · device kind · language
    demo_usage      one row per event (PRD §3.6.3 사용 기록), kept apart from the copies —
                    a nightly reset or a removed copy never touches it:

        login · logout · session_end        language · device (desktop · phone)
        page_view                           the screen's path pattern · time on it
        scenario_start · scenario_step ·    workflow · step number · how it started
          scenario_done                     (button · prompt · login · reset)
        approval_click                      card category · tier (owner · team) · yes/no
        prompt                              suggestion number · matched a script · length
        blocked_click                       the locked setting's name
        reset                               처음 상태로 (button) · nightly
        login_refused                       expired (no session is made)

Never kept: the text a visitor types (they may type their real company's data), the raw IP,
a browser fingerprint, a query string. The demo server knows the inquiry id only — names
and contacts stay in the marketing site's D1.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import threading
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from solosquad.demo import check_id, normalize_company_no, org_for
from solosquad.storage import Migration, connect, migrate

COMPONENT = "demo"
PATH_KEEP = 200
KINDS = (
    "login",
    "logout",
    "session_end",
    "login_refused",
    "page_view",
    "scenario_start",
    "scenario_step",
    "scenario_done",
    "approval_click",
    "prompt",
    "blocked_click",
    "reset",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS demo_accounts (
    demo_id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL,
    org TEXT NOT NULL, inquiry_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
    locale TEXT NOT NULL DEFAULT 'ko', created REAL NOT NULL, expires REAL NOT NULL,
    revoked REAL, generation INTEGER NOT NULL DEFAULT 1, seeded INTEGER NOT NULL DEFAULT 0,
    last_reset REAL);
CREATE TABLE IF NOT EXISTS demo_sessions (
    session TEXT PRIMARY KEY, demo_id TEXT NOT NULL, started REAL NOT NULL,
    last REAL NOT NULL, device TEXT, locale TEXT, ended REAL);
CREATE INDEX IF NOT EXISTS demo_sessions_by ON demo_sessions (demo_id, started);
CREATE TABLE IF NOT EXISTS demo_usage (
    ts REAL NOT NULL, demo_id TEXT NOT NULL, session TEXT, kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS demo_usage_by ON demo_usage (demo_id, ts)
"""

COMPANY_NO = "ALTER TABLE demo_accounts ADD COLUMN company_no TEXT NOT NULL DEFAULT ''"

MIGRATIONS = (
    Migration(1, SCHEMA),  # decision 62 — demo accounts and usage
    Migration(2, COMPANY_NO),  # 2026-11-12 — the demo login asks for the company's number
)

_IDS = re.compile(r"^(?:[a-z]+-[0-9a-f]{6,}|wf-[0-9a-f-]+|[0-9a-f]{8,})$")


def path_pattern(path: str) -> str:
    """`/o/samsungdemo/w/hq/chat/t-3f2a…?x=1` → `/o/:org/w/:ws/chat/:id` — the screen, never
    the visitor's ids or a query."""
    parts = [p for p in path.split("?")[0].split("#")[0].split("/") if p][:8]
    out = []
    for i, p in enumerate(parts):
        prev = parts[i - 1] if i else ""
        if prev == "o":
            out.append(":org")
        elif prev == "w" and i >= 3 and parts[i - 3] == "o":
            out.append(":ws")
        elif _IDS.match(p) or p.isdigit():
            out.append(":id")
        else:
            out.append(re.sub(r"[^a-z0-9_\-]", "", p.lower())[:32] or ":id")
    return "/" + "/".join(out)


def device_of(user_agent: str) -> str:
    ua = user_agent.lower()
    return "phone" if any(w in ua for w in ("mobile", "iphone", "android")) else "desktop"


def parse_expiry(text: str, now: float | None = None) -> float:
    """`14d` · `48h` · `2w` · `2026-12-31` → an epoch time."""
    t = time.time() if now is None else now
    m = re.fullmatch(r"\s*(\d+)\s*([hdw])\s*", text or "")
    if m:
        n, unit = int(m.group(1)), m.group(2)
        if n <= 0:
            raise ValueError("an expiry must be in the future")
        return t + n * {"h": 3600, "d": 86400, "w": 7 * 86400}[unit]
    import datetime as dt

    try:
        day = dt.datetime.fromisoformat((text or "").strip())
    except ValueError as e:
        raise ValueError(f"expiry {text!r} must look like 14d, 48h, 2w or 2026-12-31") from e
    value = day.timestamp() + (86399 if day.time() == dt.time() else 0)
    if value <= t:
        raise ValueError("an expiry must be in the future")
    return value


@dataclass(frozen=True)
class DemoAccount:
    demo_id: str
    user_id: str
    org: str
    inquiry_id: str
    label: str
    locale: str
    created: float
    expires: float
    revoked: float | None
    generation: int
    seeded: int
    last_reset: float | None
    company_no: str = ""
    """Normalized (`normalize_company_no`); '' on an account issued before 2026-11-12, which
    the demo login then refuses until it is issued again."""

    def status(self, now: float | None = None) -> str:
        t = time.time() if now is None else now
        if self.revoked is not None:
            return "revoked"
        if self.expires <= t:
            return "expired"
        return "active"

    def active(self, now: float | None = None) -> bool:
        return self.status(now) == "active"

    @property
    def ready(self) -> bool:
        """Its copy is seeded for the generation asked for."""
        return self.seeded >= self.generation

    def public(self) -> dict[str, Any]:
        return {**self.__dict__, "status": self.status()}


_COLS = (
    "demo_id, user_id, org, inquiry_id, label, locale, created, expires, revoked, generation,"
    " seeded, last_reset, company_no"
)


class DemoStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._db = connect(path)
        migrate(self._db, COMPONENT, MIGRATIONS, path=path)
        self._lock = threading.Lock()

    def _q(self, sql: str, args: tuple[Any, ...] = ()) -> list[Any]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    # ------------------------------------------------------------------ accounts

    def add(
        self,
        demo_id: str,
        user_id: str,
        inquiry_id: str,
        expires: float,
        label: str = "",
        locale: str = "ko",
        now: float | None = None,
        *,
        company_no: str,
    ) -> DemoAccount:
        check_id(demo_id)
        if not inquiry_id.strip():
            raise ValueError("an inquiry id is required — the demo is issued from an inquiry")
        number = normalize_company_no(company_no)
        try:
            self._q(
                f"INSERT INTO demo_accounts (key, {_COLS})"
                " VALUES (?,?,?,?,?,?,?,?,?,NULL,1,0,NULL,?)",
                (demo_id.lower(), demo_id, user_id, org_for(demo_id), inquiry_id.strip(),
                 label.strip()[:80], locale, time.time() if now is None else now, expires,
                 number),
            )  # fmt: skip
        except sqlite3.IntegrityError as e:
            raise ValueError(f"demo id {demo_id!r} is already issued") from e
        found = self.get(demo_id)
        assert found is not None
        return found

    def taken(self, demo_id: str) -> bool:
        return bool(self._q("SELECT 1 FROM demo_accounts WHERE key = ?", (demo_id.lower(),)))

    def get(self, demo_id: str) -> DemoAccount | None:
        rows = self._q(
            f"SELECT {_COLS} FROM demo_accounts WHERE key = ?", (demo_id.strip().lower(),)
        )
        return DemoAccount(*rows[0]) if rows else None

    def by_user(self, user_id: str) -> DemoAccount | None:
        rows = self._q(f"SELECT {_COLS} FROM demo_accounts WHERE user_id = ?", (user_id,))
        return DemoAccount(*rows[0]) if rows else None

    def accounts(self) -> list[DemoAccount]:
        rows = self._q(f"SELECT {_COLS} FROM demo_accounts ORDER BY created")
        return [DemoAccount(*r) for r in rows]

    def revoke(self, demo_id: str, now: float | None = None) -> None:
        self._q(
            "UPDATE demo_accounts SET revoked = ? WHERE key = ? AND revoked IS NULL",
            (time.time() if now is None else now, demo_id.lower()),
        )

    def extend(self, demo_id: str, expires: float) -> None:
        self._q("UPDATE demo_accounts SET expires = ? WHERE key = ?", (expires, demo_id.lower()))

    def request_reset(self, demo_id: str) -> int:
        """Ask for a fresh copy → the generation now asked for (the running server applies
        it, or the CLI when no server runs, and marks it `seeded`)."""
        self._q(
            "UPDATE demo_accounts SET generation = MAX(generation, seeded) + 1 WHERE key = ?",
            (demo_id.lower(),),
        )
        found = self.get(demo_id)
        return found.generation if found else 0

    def mark_seeded(self, demo_id: str, generation: int, now: float | None = None) -> None:
        self._q(
            "UPDATE demo_accounts SET seeded = MAX(seeded, ?), last_reset = ? WHERE key = ?",
            (generation, time.time() if now is None else now, demo_id.lower()),
        )

    # ------------------------------------------------------------------ usage

    def record(
        self,
        demo_id: str,
        kind: str,
        detail: dict[str, Any] | None = None,
        *,
        session: str | None = None,
        now: float | None = None,
    ) -> None:
        if kind not in KINDS:
            raise ValueError(f"unknown usage kind {kind!r}")
        t = time.time() if now is None else now
        self._q(
            "INSERT INTO demo_usage (ts, demo_id, session, kind, detail) VALUES (?,?,?,?,?)",
            (t, demo_id, session, kind, json.dumps(detail or {}, ensure_ascii=False)),
        )
        if session is not None:
            self.seen(session, now=t)

    def open_session(
        self,
        demo_id: str,
        session: str,
        *,
        device: str = "desktop",
        locale: str = "ko",
        now: float | None = None,
    ) -> None:
        t = time.time() if now is None else now
        self._q(
            "INSERT OR IGNORE INTO demo_sessions (session, demo_id, started, last, device, locale)"
            " VALUES (?,?,?,?,?,?)",
            (session, demo_id, t, t, device, locale),
        )

    def seen(self, session: str, now: float | None = None) -> None:
        self._q(
            "UPDATE demo_sessions SET last = MAX(last, ?) WHERE session = ? AND ended IS NULL",
            (time.time() if now is None else now, session),
        )

    def last_seen(self, demo_id: str) -> float | None:
        rows = self._q("SELECT MAX(last) FROM demo_sessions WHERE demo_id = ?", (demo_id,))
        return float(rows[0][0]) if rows and rows[0][0] is not None else None

    def end_idle_sessions(self, idle_s: float, now: float | None = None) -> int:
        """A session nobody used for `idle_s` ends → `session_end` (with its length)."""
        t = time.time() if now is None else now
        rows = self._q(
            "SELECT session, demo_id, started, last FROM demo_sessions"
            " WHERE ended IS NULL AND last < ?",
            (t - idle_s,),
        )
        for session, demo_id, started, last in rows:
            self._q("UPDATE demo_sessions SET ended = ? WHERE session = ?", (last, session))
            self.record(demo_id, "session_end", {"seconds": round(last - started)}, now=last)
        return len(rows)

    def end_session(self, session: str, now: float | None = None) -> None:
        self._q(
            "UPDATE demo_sessions SET ended = ? WHERE session = ? AND ended IS NULL",
            (time.time() if now is None else now, session),
        )

    def purge_usage(self, demo_id: str) -> None:
        self._q("DELETE FROM demo_usage WHERE demo_id = ?", (demo_id,))
        self._q("DELETE FROM demo_sessions WHERE demo_id = ?", (demo_id,))

    def events(
        self, demo_id: str | None = None, *, since: float = 0.0, limit: int = 100_000
    ) -> list[dict[str, Any]]:
        where, args = ("AND demo_id = ?", (demo_id,)) if demo_id else ("", ())
        rows = self._q(
            "SELECT ts, demo_id, session, kind, detail FROM demo_usage"
            f" WHERE ts >= ? {where} ORDER BY ts LIMIT ?",
            (since, *args, limit),
        )
        return [
            {"ts": r[0], "demo_id": r[1], "session": r[2], "kind": r[3],
             "detail": json.loads(r[4] or "{}")}
            for r in rows
        ]  # fmt: skip

    def sessions(self, demo_id: str) -> list[dict[str, Any]]:
        rows = self._q(
            "SELECT session, started, last, device, locale FROM demo_sessions"
            " WHERE demo_id = ? ORDER BY started",
            (demo_id,),
        )
        return [
            {"session": r[0], "started": r[1], "last": r[2], "seconds": r[2] - r[1],
             "device": r[3], "locale": r[4]}
            for r in rows
        ]  # fmt: skip

    def summary(self, acct: DemoAccount, since: float = 0.0) -> dict[str, Any]:
        """One account's usage, joinable to the inquiry by `inquiry_id` (PRD §3.6.3 요약)."""
        ev = self.events(acct.demo_id, since=since)
        kinds = Counter(e["kind"] for e in ev)
        screens = Counter(str(e["detail"].get("path")) for e in ev if e["kind"] == "page_view")
        clicks = [e["detail"] for e in ev if e["kind"] == "approval_click"]
        done = sorted(
            {str(e["detail"].get("workflow")) for e in ev if e["kind"] == "scenario_done"}
        )
        blocked = Counter(str(e["detail"].get("name")) for e in ev if e["kind"] == "blocked_click")
        prompts = [e["detail"] for e in ev if e["kind"] == "prompt"]
        sessions = self.sessions(acct.demo_id)
        logins = [e["ts"] for e in ev if e["kind"] == "login"]
        first = min(logins) if logins else None
        return {
            "demo_id": acct.demo_id,
            "inquiry_id": acct.inquiry_id,
            "label": acct.label,
            "status": acct.status(),
            "created": acct.created,
            "expires": acct.expires,
            "first_login": first,
            "days_to_first_login": round((first - acct.created) / 86400, 1) if first else None,
            "logins": kinds["login"],
            "refused": kinds["login_refused"],
            "sessions": len(sessions),
            "total_minutes": round(sum(s["seconds"] for s in sessions) / 60, 1),
            "last_seen": max((s["last"] for s in sessions), default=None),
            "devices": dict(Counter(str(s["device"]) for s in sessions)),
            "screens": dict(screens.most_common()),
            "scenario_starts": kinds["scenario_start"],
            "scenarios_done": done,
            "approvals_approved": sum(1 for c in clicks if c.get("value") == "approved"),
            "approvals_declined": sum(1 for c in clicks if c.get("value") == "declined"),
            "prompts": len(prompts),
            "prompts_matched": sum(1 for p in prompts if p.get("matched")),
            "blocked": dict(blocked.most_common()),
            "resets": kinds["reset"],
        }


SUMMARY_COLUMNS = (
    "demo_id", "inquiry_id", "label", "status", "created", "expires", "first_login",
    "days_to_first_login", "logins", "refused", "sessions", "total_minutes", "last_seen",
    "devices", "scenario_starts", "scenarios_done", "approvals_approved",
    "approvals_declined", "prompts", "prompts_matched", "blocked", "resets", "screens",
)  # fmt: skip


def _iso(ts: Any) -> str:
    if ts is None:
        return ""
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(float(ts)))


def summaries_csv(rows: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(SUMMARY_COLUMNS)
    for r in rows:
        out = []
        for c in SUMMARY_COLUMNS:
            v = r.get(c)
            if c in ("created", "expires", "first_login", "last_seen"):
                v = _iso(v)
            elif isinstance(v, dict | list):
                v = json.dumps(v, ensure_ascii=False)
            out.append(v)
        w.writerow(out)
    return buf.getvalue()


def events_csv(events: list[dict[str, Any]], inquiry: dict[str, str]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(("ts", "demo_id", "inquiry_id", "session", "kind", "detail"))
    for e in events:
        w.writerow(
            (_iso(e["ts"]), e["demo_id"], inquiry.get(e["demo_id"], ""), e["session"] or "",
             e["kind"], json.dumps(e["detail"], ensure_ascii=False))
        )  # fmt: skip
    return buf.getvalue()
