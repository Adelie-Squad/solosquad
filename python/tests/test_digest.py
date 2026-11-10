"""The dashboard's 자리를 비운 동안 (2026-11-10 · DESIGN.md `### 대시보드` · PRD v2.1.0 §digest).

`last_seen` rule — the digest window is (`seen_until`, now]:
- `last_active` = the newest request a person made: a change (POST/PUT/PATCH/DELETE) or a read
  the web marks `X-Presence: 1` (the person touched the page lately). A background refresh
  after a live event is not presence — a tab left open overnight is not "being here".
- A sign-in, or the first presence after 30 minutes, starts a new visit: `seen_until` moves to
  the end of the previous visit. Inside a visit nothing moves — a reload keeps the digest.
- 확인했어요 (`POST /api/me/digest/ack {until}`) moves `seen_until` to that `until`.
- Never here before = no window (`basis` first) — the web greets instead.
"""

from __future__ import annotations

import asyncio
import sqlite3
import time
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from company_fixtures import reply
from engine_fixtures import Customer
from test_approvals import _asks, _waiting
from test_scopes import Web
from test_web_tasks import Office

from solosquad.engine_server import start_engine, stop_engine
from solosquad.runtime import RunStatus
from solosquad.runtime.manager import load_crons
from solosquad.storage import connect
from solosquad.web_api.accounts import (
    AWAY_GAP_S,
    COMPONENT,
    AccountStore,
    Assignment,
    Role,
)
from solosquad.web_api.app import NOT_FOUND_BODY

PRESENT = {"x-presence": "1"}


def _uid(accounts: AccountStore, name: str) -> str:
    return next(u.id for u in accounts.users() if u.username == name)


def _away_since(accounts: AccountStore, uid: str, t: float) -> None:
    """As if the person left at `t` and has just come back: the digest starts there."""
    with accounts.lock:
        accounts.connection().execute(
            "UPDATE presence SET seen_until = ?, basis = 'away' WHERE user_id = ?", (t, uid)
        )


# ---------------------------------------------------------------------- the rule


def test_presence_visits_and_acknowledge(tmp_path: Path) -> None:
    store = AccountStore(tmp_path / "core.db")
    uid = store.create_user("boss", "correct horse battery", Role.OWNER).id
    assert store.presence(uid) is None
    t0 = 1_000_000.0
    first = store.touch(uid, t0)
    assert (first.basis, first.seen_until, first.visit_start) == ("first", None, t0)
    # inside a visit only last_active moves — a reload does not end the digest
    same = store.touch(uid, t0 + AWAY_GAP_S - 1)
    assert (same.basis, same.seen_until, same.visit_start) == ("first", None, t0)
    # away longer than the gap → a new visit: the digest starts where the last one ended
    back = store.touch(uid, t0 + 3 * AWAY_GAP_S)
    assert back.basis == "away" and back.seen_until == t0 + AWAY_GAP_S - 1
    assert back.visit_start == t0 + 3 * AWAY_GAP_S
    # 확인했어요 → from the digest's `until`, never in the future, never backwards
    now = t0 + 3 * AWAY_GAP_S + 10
    acked = store.acknowledge(uid, now - 5, now)
    assert acked.basis == "acknowledged" and acked.seen_until == now - 5
    assert store.acknowledge(uid, now + 999, now).seen_until == now
    assert store.acknowledge(uid, 1.0, now).seen_until == now  # an old `until` keeps it
    # a sign-in always starts a new visit, even inside the gap
    signed = store.touch(uid, now + 60, new_visit=True)
    assert signed.basis == "away" and signed.seen_until == now
    assert store.presence(uid) == signed


def test_people_already_here_start_from_their_newest_audited_action(tmp_path: Path) -> None:
    path = tmp_path / "core.db"
    store = AccountStore(path)
    uid = store.create_user("boss", "correct horse battery", Role.OWNER).id
    store.audit(uid, "login", "203.0.113.5")
    when = store.audit_log()[0]["ts"]
    db = store.connection()
    with store.lock:  # back to the v4 schema, as a core.db from before this change
        db.execute("DROP TABLE presence")
        db.execute("UPDATE schema_versions SET version = 4 WHERE component = ?", (COMPONENT,))
    again = AccountStore(path)
    found = again.presence(uid)
    assert found is not None and found.basis == "away" and found.seen_until == when
    assert connect(path).execute("SELECT COUNT(*) FROM presence").fetchone()[0] == 1


# ---------------------------------------------------------------------- the endpoint


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Office]:
    o = Office(tmp_path)
    o.company.scripts["max"] = lambda req: reply("done")
    await o.manager.start()
    await o.wf.start()
    yield o
    await o.wf.stop()
    await o.manager.stop()


async def _chat(o: Office, c: Any, h: dict[str, str], title: str) -> tuple[str, str]:
    tid = (await c.post("/api/threads", json={"title": title}, headers=h)).json()["thread_id"]
    rid = (await c.post(f"/api/threads/{tid}/runs", json={"input": "go"}, headers=h)).json()[
        "run_id"
    ]
    await o.manager.wait(rid, 5)
    return tid, rid


async def test_first_visit_is_a_welcome_and_presence_needs_a_person(office: Office) -> None:
    async with office.client() as boss:
        await office.login(boss, "boss", Role.OWNER)
        uid = _uid(office.accounts, "boss")
        d = (await boss.get("/api/me/digest")).json()
        assert d["basis"] == "first" and d["since"] is None and d["counts"]["finished"] == 0
        # a background read does not count as being here; one the person made does
        with office.accounts.lock:
            office.accounts.connection().execute(
                "UPDATE presence SET last_active = ? WHERE user_id = ?",
                (time.time() - 2 * AWAY_GAP_S, uid),
            )
        office.web.rebuild()  # a fresh server: no "touched a minute ago" memory
        old = office.accounts.presence(uid)
        async with office.web.client() as same:
            same.cookies = boss.cookies
            await same.get("/api/me")
            assert office.accounts.presence(uid) == old
            await same.get("/api/me", headers=PRESENT)
            now = office.accounts.presence(uid)
            assert now is not None and old is not None
            assert now.basis == "away" and now.seen_until == old.last_active


async def test_owner_digest_lists_what_happened_while_away(office: Office) -> None:
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.login(kim, "kim", Role.STAFF)
        boss_id, kim_id = _uid(office.accounts, "boss"), _uid(office.accounts, "kim")
        before_tid, _ = await _chat(office, boss, hb, "어제 일")
        await asyncio.sleep(0.01)
        left = time.time()
        _away_since(office.accounts, boss_id, left)
        await asyncio.sleep(0.01)

        # while away: a conversation finishes, a schedule runs, one fails, approvals arrive
        done_tid, _ = await _chat(office, kim, hk, "정산 정리")
        sales = next(
            c for c in load_crons(office.company.ctx.org_root / "crons") if c.name == "sales"
        )
        cron_rid = await office.manager.fire_cron(sales)
        await office.manager.wait(cron_rid, 5)
        broken = office.manager.store.create_thread("깨진 일")
        bad = office.manager.store.create_run(broken, "input", "x", "user:kim")
        office.manager.store.set_status(bad, "error", error="harness exploded")
        office.company.scripts["max"] = _asks("review")
        await boss.patch(f"/api/people/{kim_id}", json={"teams": ["core"]}, headers=hb)
        waiting_tid = await _waiting(office, kim, hk)
        office.company.scripts["max"] = _asks("transfer")
        await _waiting(office, kim, hk)
        office.company.scripts["max"] = _asks("review")
        answered_tid = await _waiting(office, kim, hk)
        async with office.client("203.0.113.9") as kim2:
            hk2 = await office.login_existing(kim2, "kim")  # fresh session sees the team
            office.company.scripts["max"] = lambda req: reply("done")
            r = await kim2.post(
                f"/api/threads/{answered_tid}/resume", json={"value": "declined"}, headers=hk2
            )
            assert r.status_code == 201
            await office.manager.wait(r.json()["run_id"], 5)

            d = (await boss.get("/api/me/digest")).json()
            assert d["basis"] == "away" and d["since"] == left and d["until"] > left
            finished = {w["thread_id"] for w in d["finished"]}
            assert done_tid in finished and before_tid not in finished  # the window holds
            assert all(w["org"] == "tesla" and w["workspace"] == "hq" for w in d["finished"])
            assert not any(w["cron"] for w in d["finished"])  # scheduled ones are listed apart
            assert [s["name"] for s in d["scheduled"]] == ["sales"]
            assert d["scheduled"][0]["kind"] == "cron"
            assert [f["run_id"] for f in d["failed"]] == [bad]
            assert d["failed"][0]["error"] == "harness exploded"
            # both waiting cards are the owner's to answer; the answered one is not waiting
            mine = {a["thread_id"] for a in d["approvals_mine"]}
            assert waiting_tid in mine and answered_tid not in mine and len(mine) == 2
            assert d["approvals_others"] == []
            assert [(x["approver"], x["decision"], x["thread_id"]) for x in d["decided"]] == [
                ("kim", "declined", answered_tid)
            ]
            assert d["counts"]["approvals_mine"] == 2 and d["cap"] == 20
            assert d["cost"]["spent_usd"] > 0
            assert [o["org"] for o in d["cost"]["orgs"]] == ["tesla"]

            # kim (team core) sees the transfer as someone else's turn, and not her own answer
            k = (await kim2.get("/api/me/digest", params={"since": str(left)})).json()
            assert {a["card"]["category"] for a in k["approvals_others"]} == {"transfer"}
            assert {a["card"]["category"] for a in k["approvals_mine"]} == {"review"}
            assert k["decided"] == []

        # a reload keeps it; 확인했어요 ends it
        assert (await boss.get("/api/me/digest")).json()["counts"] == d["counts"]
        ack = await boss.post("/api/me/digest/ack", json={"until": d["until"]}, headers=hb)
        assert ack.status_code == 200, ack.text
        assert ack.json() == {"seen_until": d["until"], "basis": "acknowledged"}
        after = (await boss.get("/api/me/digest")).json()
        assert after["basis"] == "acknowledged" and after["counts"]["finished"] == 0
        assert after["approvals_mine"] == []  # still in 승인 대기, no longer news


async def test_digest_window_boundaries(office: Office) -> None:
    async with office.client() as boss:
        hb = await office.login(boss, "boss", Role.OWNER)
        _tid, rid = await _chat(office, boss, hb, "경계")
        ended = office.manager.store.run(rid)["ended"]  # type: ignore[index]
        # (since, until]: a run that ended exactly at `since` is before the window
        at = (await boss.get("/api/me/digest", params={"since": repr(ended)})).json()
        assert rid not in {w["run_id"] for w in at["finished"]}
        just = (await boss.get("/api/me/digest", params={"since": repr(ended - 0.001)})).json()
        assert rid in {w["run_id"] for w in just["finished"]}
        # `since` is a time in the past, or auto
        for bad in ("yesterday", str(time.time() + 3600), "-5"):
            r = await boss.get("/api/me/digest", params={"since": bad})
            assert r.status_code == 400 and r.json()["code"] == "digest_since_invalid"
        assert (await boss.get("/api/me/digest", params={"since": "auto"})).status_code == 200
        r = await boss.post("/api/me/digest/ack", json={"until": "now"}, headers=hb)
        assert r.status_code == 400 and r.json()["code"] == "digest_until_invalid"
        assert (await boss.post("/api/me/digest/ack", json={})).status_code == 403  # CSRF


async def test_digest_has_no_answer_without_a_person(office: Office) -> None:
    async with office.client() as anon:
        r = await anon.get("/api/me/digest")
        assert r.status_code == 401 and r.json()["code"] == "unauthorized"
    async with office.web.client("127.0.0.1", authorization="Bearer tok") as cli:
        r = await cli.get("/api/me/digest")
        assert r.status_code == 404 and r.json() == NOT_FOUND_BODY  # the CLI token is no one
        assert (await cli.post("/api/me/digest/ack", json={})).status_code == 404


# ---------------------------------------------------------------------- scopes


@pytest.fixture
async def web(tmp_path: Path) -> AsyncIterator[Web]:
    w = Web(Customer(tmp_path))
    await start_engine(w.engine)
    yield w
    await stop_engine(w.engine)


async def test_digest_covers_only_the_scopes_a_person_may_enter(web: Web) -> None:
    async with web.client() as boss, web.client("203.0.113.9") as kim:
        hb = await web.login(boss, "elon", Role.OWNER)
        await web.login(kim, "kim", assignments=[Assignment("tesla", "cars", Role.STAFF)])
        left = time.time()
        accounts = web.engine.accounts
        for name in ("elon", "kim"):
            _away_since(accounts, _uid(accounts, name), left)
        await asyncio.sleep(0.01)
        rids: dict[str, str] = {}
        for scope, text in (("tesla/cars", "hello"), ("tesla/charging", "hello"),
                            ("spacex/rocket", "boom")):  # fmt: skip
            org, ws = scope.split("/")
            base = f"/api/o/{org}/w/{ws}"
            tid = (await boss.post(f"{base}/threads", json={"title": scope}, headers=hb)).json()[
                "thread_id"
            ]
            r = await boss.post(f"{base}/threads/{tid}/runs", json={"input": text}, headers=hb)
            rids[scope] = r.json()["run_id"]
        for scope, rid in rids.items():
            rt = web.config.runtimes[tuple(scope.split("/"))]  # type: ignore[index]
            for _ in range(250):
                if (rt.manager.store.run(rid) or {}).get("status") in (
                    RunStatus.SUCCESS,
                    RunStatus.ERROR,
                ):
                    break
                await asyncio.sleep(0.02)

        owner = (await boss.get("/api/me/digest")).json()
        seen = {f"{w['org']}/{w['workspace']}" for w in owner["finished"]}
        assert seen == {"tesla/cars", "tesla/charging"}
        assert [f"{w['org']}/{w['workspace']}" for w in owner["failed"]] == ["spacex/rocket"]
        assert {o["org"] for o in owner["cost"]["orgs"]} == {"tesla", "spacex"}

        staff = (await kim.get("/api/me/digest")).json()
        assert [f"{w['org']}/{w['workspace']}" for w in staff["finished"]] == ["tesla/cars"]
        assert staff["failed"] == [] and staff["counts"]["finished"] == 1
        assert [o["org"] for o in staff["cost"]["orgs"]] == ["tesla"]
        # a scope taken away holds from the very next request
        accounts.set_assignments(
            _uid(accounts, "kim"), [Assignment("tesla", "charging", Role.STAFF)]
        )
        moved = (await kim.get("/api/me/digest")).json()
        assert [f"{w['org']}/{w['workspace']}" for w in moved["finished"]] == ["tesla/charging"]


def test_presence_table_is_in_core_db(tmp_path: Path) -> None:
    path = tmp_path / "core.db"
    AccountStore(path)
    names = {r[0] for r in sqlite3.connect(path).execute("SELECT name FROM sqlite_master")}
    assert "presence" in names


async def test_calendar_entries_that_came_due(office: Office) -> None:
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.login(kim, "kim", Role.STAFF)
        kim_id = _uid(office.accounts, "kim")
        zone = ZoneInfo(office.manager.timezone)

        def day(n: int) -> str:
            return (datetime.now(zone) + timedelta(days=n)).strftime("%Y-%m-%d")

        async def item(c: Any, h: dict[str, str], **data: Any) -> str:
            r = await c.post("/api/calendar/items", json=data, headers=h)
            assert r.status_code == 201, r.text
            return str(r.json()["id"])

        began = await item(boss, hb, kind="work", org="tesla", title="오리엔테이션", start=day(-1))
        await item(boss, hb, kind="work", org="tesla", title="다음 주", start=day(7))
        await item(boss, hb, kind="work", org="tesla", title="지난달", start=day(-20))
        await item(kim, hk, kind="personal", title="김대리 개인", start=day(-1))
        for todo in ({"title": "제출", "due": day(-1)},
                     {"title": "김대리 몫", "due": day(-1), "assignee_id": kim_id}):  # fmt: skip
            r = await boss.post(f"/api/calendar/items/{began}/todos", json=todo, headers=hb)
            assert r.status_code == 201, r.text
        since = str(time.time() - 2 * 86400)
        d = (await boss.get("/api/me/digest", params={"since": since})).json()
        assert [(c["type"], c["title"]) for c in d["calendar"]] == [
            ("item", "오리엔테이션"),
            ("todo", "제출"),
        ]
        assert d["calendar"][1]["item_title"] == "오리엔테이션" and d["counts"]["calendar"] == 2
        k = (await kim.get("/api/me/digest", params={"since": since})).json()
        # an unassigned to-do is everyone's; one assigned to kim only hers
        assert {c["title"] for c in k["calendar"]} == {
            "오리엔테이션",
            "김대리 개인",
            "제출",
            "김대리 몫",
        }
