"""Decision 60 — the account's calendar (일정): 항목 → 세부 항목 → 할 일, 구분 · 태그, work and
personal entries, presets, the date-range listing, the audit, the live notes — and the
owner's choice of how much agents may read of their personal entries.

Who sees what: work entries = whoever may enter their org (and workspace); personal
entries = their owner only, among people. Anything else answers the identical 404 body.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from test_ops_api import Office as OpsOffice

from solosquad.calendars import (
    PALETTE,
    CalendarStore,
    NotVisible,
    PresetError,
    Viewer,
    load_preset,
    seed_demo,
)
from solosquad.storage import connect
from solosquad.web_api.accounts import Assignment, Role
from solosquad.web_api.app import NOT_FOUND_BODY

DAY = "2026-11-09"


class Office(OpsOffice):
    """tesla/hq running, plus a second org `spacex` placed here (not started) — enough for
    the calendar, which never needs a runtime."""

    def __init__(self, tmp: Path) -> None:
        super().__init__(tmp)
        self.web.config.failed[("spacex", "hq")] = "not started in tests"
        self.web.rebuild()
        self.app = self.web.app

    async def staff_in(
        self, c: httpx.AsyncClient, name: str, org: str, ws: str | None = None
    ) -> dict[str, str]:
        h = await self.login(c, name, Role.STAFF)
        uid = self.uid(name)
        self.accounts.set_assignments(uid, [Assignment(org, ws, Role.STAFF)])
        return h

    def uid(self, name: str) -> str:
        return next(u.id for u in self.accounts.users() if u.username == name)


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Office]:
    o = Office(tmp_path)
    await o.manager.start()
    yield o
    await o.manager.stop()


async def _make(c: httpx.AsyncClient, h: dict[str, str], **body: Any) -> dict[str, Any]:
    r = await c.post("/api/calendar/items", json=body, headers=h)
    assert r.status_code == 201, r.text
    out: dict[str, Any] = r.json()
    return out


async def _range(c: httpx.AsyncClient, **q: Any) -> dict[str, Any]:
    r = await c.get("/api/calendar/items", params={"from": "2026-11-01", "to": "2026-11-30", **q})
    assert r.status_code == 200, r.text
    out: dict[str, Any] = r.json()
    return out


# ---------------------------------------------------------------------- the store


def test_the_migration_creates_the_calendar_component_in_core_db(tmp_path: Path) -> None:
    path = tmp_path / "core.db"
    CalendarStore(path).close()
    db = connect(path)
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"cal_items", "cal_todos", "cal_labels", "cal_item_tags", "cal_agent_access"} <= tables
    versions = dict(db.execute("SELECT component, version FROM schema_versions").fetchall())
    assert versions["calendar"] == 1
    CalendarStore(path).close()  # opening again is a no-op


def test_two_levels_and_to_dos(tmp_path: Path) -> None:
    store = CalendarStore(tmp_path / "core.db")
    who = Viewer("u-1", lambda _o, _w: True)
    top = store.create_item(who, {"kind": "work", "org": "solo", "title": "2차 모두의 창업"})
    sub = store.create_item(who, {"parent_id": top["id"], "title": "1라운드 제출",
                                  "start": "2026-11-14", "end": "2026-11-21"})  # fmt: skip
    assert (sub["kind"], sub["org"], sub["parent_id"]) == ("work", "solo", top["id"])
    with pytest.raises(ValueError) as e:  # a third level is refused
        store.create_item(who, {"parent_id": sub["id"], "title": "too deep"})
    assert getattr(e.value, "code", None) == "calendar_parent_invalid"
    todo, _ = store.create_todo(sub["id"], who, {"title": "사업계획서 작성/제출",
                                "due": "2026-11-18"}, assignable=lambda _u: True)  # fmt: skip
    store.update_todo(todo["id"], who, {"done": True}, assignable=lambda _u: True)
    detail = store.detail(top["id"], who)
    assert [c["title"] for c in detail["children"]] == ["1라운드 제출"]
    assert detail["child_todos"][0]["done"] is True
    # deleting the item takes its sub-items and to-dos with it
    store.delete_item(top["id"], who)
    with pytest.raises(NotVisible):
        store.item(sub["id"], who)
    assert store.todos_of([sub["id"]]) == []


def test_dates_are_checked(tmp_path: Path) -> None:
    store = CalendarStore(tmp_path / "core.db")
    who = Viewer("u-1", lambda _o, _w: True)
    for bad in (
        {"start": "2026-13-01"},
        {"start": "tomorrow"},
        {"end": "2026-11-02"},  # an end without a start
        {"start": "2026-11-05", "end": "2026-11-02"},
        {"start": "2026-11-05", "end": "2026-11-06T10:00"},  # a date and a time mixed
    ):
        with pytest.raises(ValueError) as e:
            store.create_item(who, {"kind": "personal", "title": "x", **bad})
        assert getattr(e.value, "code", None) == "calendar_date_invalid", bad
    timed = store.create_item(who, {"kind": "personal", "title": "x",
                                    "start": "2026-11-05T09:00", "end": "2026-11-05T10:00"})  # fmt: skip
    assert timed["all_day"] is False


def test_preset_loader(tmp_path: Path) -> None:
    assert load_preset(tmp_path) is None
    (tmp_path / "calendar").mkdir()
    f = tmp_path / "calendar" / "presets.yaml"
    f.write_text(
        "format_version: 1\ncategories:\n  - {name: 지원, color: blue}\n  - 개발\n"
        "tags: [서류, {name: 인터뷰, color: rose}]\n",
        encoding="utf-8",
    )
    p = load_preset(tmp_path)
    assert p is not None
    assert [(c.name, c.color) for c in p.categories] == [("지원", "blue"), ("개발", "teal")]
    assert [(t.name, t.color) for t in p.tags] == [("서류", "blue"), ("인터뷰", "rose")]
    for broken in ("categories: [{color: blue}]\n", "tags: [{name: x, color: purple}]\n",
                   "format_version: 2\n", "- just a list\n"):  # fmt: skip
        f.write_text(broken, encoding="utf-8")
        with pytest.raises(PresetError):
            load_preset(tmp_path)


def test_demo_seed_mirrors_the_users_example(tmp_path: Path) -> None:
    store = CalendarStore(tmp_path / "core.db")
    seed_demo(store, "solosquad", "u-1", today=DAY)
    who = Viewer("u-1", lambda o, _w: o == "solosquad")
    found = store.list_range(who, start="2026-11-01", end="2026-12-31")
    titles = [i["title"] for i in found["items"]]
    assert "2차 모두의 창업" in titles and "치과 예약" in titles
    top = next(i for i in found["items"] if i["title"] == "2차 모두의 창업")
    detail = store.detail(top["id"], who)
    assert [c["title"] for c in detail["children"]] == [
        "지원",
        "오리엔테이션",
        "1라운드 제출",
        "멘토링",
    ]
    assert {t["title"] for t in detail["child_todos"]} >= {
        "사업계획서 작성/제출",
        "창업활동보고서 작성/제출",
    }
    labels = store.labels(who, ["solosquad"], preset_for=lambda _o: None,  # type: ignore[arg-type,return-value]
                          personal_preset=None)["labels"]  # fmt: skip
    names = {(lb["type"], lb["name"]) for lb in labels}
    assert {("category", n) for n in ("지원", "개발", "영업", "인사", "네트워킹")} <= names
    assert {("tag", "서류"), ("tag", "인터뷰")} <= names


# ---------------------------------------------------------------------- the API


async def test_permissions_matrix(office: Office) -> None:
    """Owner: every org. Staff of tesla: tesla only. Nobody: someone else's personal entry —
    every refusal is the identical 404 body, for reading and for writing."""
    async with (
        office.client() as boss,
        office.client("203.0.113.9") as kim,
        office.client("203.0.113.10") as lee,
    ):
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.staff_in(kim, "kim", "tesla")
        hl = await office.staff_in(lee, "lee", "tesla", "hq")
        tesla = await _make(boss, hb, kind="work", org="tesla", title="충전소 오픈",
                            start="2026-11-10")  # fmt: skip
        spacex = await _make(boss, hb, kind="work", org="spacex", title="발사 준비",
                             start="2026-11-11")  # fmt: skip
        mine = await _make(boss, hb, kind="personal", title="치과", start="2026-11-12")
        kims = await _make(kim, hk, kind="personal", title="kim 개인", start="2026-11-12")
        # the owner sees both orgs and their own personal entry — not kim's
        seen = {i["title"] for i in (await _range(boss))["items"]}
        assert seen == {"충전소 오픈", "발사 준비", "치과"}
        # kim (whole tesla) sees tesla and her own
        seen = {i["title"] for i in (await _range(kim))["items"]}
        assert seen == {"충전소 오픈", "kim 개인"}
        # lee (tesla/hq only) sees org-level tesla entries; none of the others
        assert {i["title"] for i in (await _range(lee))["items"]} == {"충전소 오픈"}
        # an entry of another workspace of tesla is not lee's
        other = await _make(boss, hb, kind="work", org="tesla", workspace="hq",
                            title="hq 일", start="2026-11-13")  # fmt: skip
        assert "hq 일" in {i["title"] for i in (await _range(lee))["items"]}
        del other
        refused = [
            (kim, hk, spacex["id"]),
            (kim, hk, mine["id"]),
            (boss, hb, kims["id"]),  # the customer's owner too
            (lee, hl, kims["id"]),
            (kim, hk, "ci-doesnotexist"),
        ]
        for c, h, iid in refused:
            for method, json_body in (("GET", None), ("PATCH", {"title": "x"}), ("DELETE", None)):
                r = await c.request(method, f"/api/calendar/items/{iid}", json=json_body, headers=h)
                assert (r.status_code, r.json()) == (404, NOT_FOUND_BODY), (method, iid)
            r = await c.post(f"/api/calendar/items/{iid}/todos", json={"title": "t"}, headers=h)
            assert (r.status_code, r.json()) == (404, NOT_FOUND_BODY)
        # writing into an org that is not yours reads like an org that is not there
        r = await kim.post("/api/calendar/items", json={"kind": "work", "org": "spacex",
                           "title": "x"}, headers=hk)  # fmt: skip
        assert (r.status_code, r.json()) == (404, NOT_FOUND_BODY)
        # staff may write their org's entries
        r = await kim.patch(f"/api/calendar/items/{tesla['id']}", json={"status": "active"},
                            headers=hk)  # fmt: skip
        assert r.status_code == 200 and r.json()["status"] == "active"
        # a to-do of a personal entry can name no one but its owner
        r = await kim.post(f"/api/calendar/items/{kims['id']}/todos",
                           json={"title": "t", "assignee_id": office.uid("boss")}, headers=hk)  # fmt: skip
        assert r.json()["code"] == "calendar_assignee_invalid"
        # a to-do of a work entry: people of that org only
        r = await boss.post(f"/api/calendar/items/{spacex['id']}/todos",
                            json={"title": "t", "assignee_id": office.uid("kim")}, headers=hb)  # fmt: skip
        assert r.json()["code"] == "calendar_assignee_invalid"
        r = await boss.post(f"/api/calendar/items/{tesla['id']}/todos",
                            json={"title": "t", "assignee_id": office.uid("kim")}, headers=hb)  # fmt: skip
        assert r.status_code == 201


async def test_listing_filters_and_to_dos_in_range(office: Office) -> None:
    async with office.client() as boss:
        h = await office.login(boss, "boss", Role.OWNER)
        labels = (await boss.get("/api/calendar/labels", params={"org": "tesla"})).json()
        cats = [
            lb for lb in labels["labels"] if lb["type"] == "category" and lb["scope"] == "tesla"
        ]
        tags = [lb for lb in labels["labels"] if lb["type"] == "tag" and lb["scope"] == "tesla"]
        assert labels["seeded"]["org:tesla"] == "default" and cats and tags
        top = await _make(boss, h, kind="work", org="tesla", title="프로그램",
                          start="2026-10-20", end="2026-12-10", category_id=cats[0]["id"])  # fmt: skip
        sub = await _make(boss, h, parent_id=top["id"], title="제출", start="2026-11-14",
                          end="2026-11-21", tag_ids=[tags[0]["id"]])  # fmt: skip
        await _make(boss, h, kind="work", org="tesla", title="12월", start="2026-12-15")
        await _make(boss, h, kind="work", org="tesla", title="날짜 없음")
        r = await boss.post(f"/api/calendar/items/{sub['id']}/todos",
                            json={"title": "계획서", "due": "2026-11-18"}, headers=h)  # fmt: skip
        todo = r.json()["todo"]
        got = await _range(boss)
        # spans that start before the month still overlap it
        assert [i["title"] for i in got["items"]] == ["프로그램", "제출"]
        assert [t["title"] for t in got["todos"]] == ["계획서"]
        assert {i["title"] for i in (await _range(boss, undated="true"))["items"]} >= {"날짜 없음"}
        assert [i["title"] for i in (await _range(boss, tag=tags[0]["id"]))["items"]] == ["제출"]
        assert [i["title"] for i in (await _range(boss, category=cats[0]["id"]))["items"]] == [
            "프로그램"
        ]
        assert (await _range(boss, kind="personal"))["items"] == []
        await boss.patch(f"/api/calendar/todos/{todo['id']}", json={"done": True}, headers=h)
        assert (await _range(boss, done="false"))["todos"] == []
        assert (await _range(boss))["todos"][0]["done"] is True
        # a label from another scope is refused
        r = await boss.patch(f"/api/calendar/items/{top['id']}",
                             json={"category_id": tags[0]["id"]}, headers=h)  # fmt: skip
        assert r.json()["code"] == "calendar_label_invalid"
        r = await boss.get("/api/calendar/items", params={"from": "nope", "to": "2026-11-30"})
        assert r.json()["code"] == "calendar_date_invalid"


async def test_labels_edit_and_presets(office: Office) -> None:
    preset_dir = office.web.solution.org("tesla").root / "calendar"
    preset_dir.mkdir(parents=True)
    (preset_dir / "presets.yaml").write_text(
        "categories: [{name: 지원, color: blue}, {name: 개발, color: teal}]\ntags: [서류]\n",
        encoding="utf-8",
    )
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        h = await office.login(boss, "boss", Role.OWNER)
        hk = await office.staff_in(kim, "kim", "tesla")
        got = (await boss.get("/api/calendar/labels")).json()
        assert got["seeded"]["org:tesla"] == "calendar/presets.yaml"
        tesla = [lb for lb in got["labels"] if lb["scope"] == "tesla"]
        assert [lb["name"] for lb in tesla] == ["지원", "개발", "서류"]
        # spacex has no preset → the generic default; the person → personal default
        assert got["seeded"]["org:spacex"] == "default"
        assert any(lb["scope_kind"] == "user" for lb in got["labels"])
        # seeded once: a second call adds nothing
        again = (await boss.get("/api/calendar/labels")).json()
        assert again["seeded"] == {} and len(again["labels"]) == len(got["labels"])
        # add · rename · recolour · archive (staff of the org may)
        r = await kim.post("/api/calendar/labels",
                           json={"type": "tag", "org": "tesla", "name": "인터뷰", "color": "rose"},
                           headers=hk)  # fmt: skip
        assert r.status_code == 201, r.text
        lid = r.json()["id"]
        r = await kim.post("/api/calendar/labels",
                           json={"type": "tag", "org": "tesla", "name": "인터뷰"}, headers=hk)  # fmt: skip
        assert r.json()["code"] == "calendar_label_exists"
        r = await kim.patch(f"/api/calendar/labels/{lid}",
                            json={"name": "면접", "color": "gold", "archived": True}, headers=hk)  # fmt: skip
        assert (r.json()["name"], r.json()["color"], r.json()["archived"]) == ("면접", "gold", True)
        r = await kim.patch(f"/api/calendar/labels/{lid}", json={"color": "#ff0000"}, headers=hk)
        assert r.json()["code"] == "calendar_color_invalid"
        # kim cannot touch spacex's labels; nobody touches someone else's personal labels
        spacex = next(lb for lb in got["labels"] if lb["scope"] == "spacex")
        mine = next(lb for lb in got["labels"] if lb["scope_kind"] == "user")
        for lb in (spacex, mine):
            r = await kim.patch(f"/api/calendar/labels/{lb['id']}", json={"name": "x"}, headers=hk)
            assert (r.status_code, r.json()) == (404, NOT_FOUND_BODY)
        kim_labels = (await kim.get("/api/calendar/labels")).json()["labels"]
        assert {lb["scope"] for lb in kim_labels if lb["scope_kind"] == "org"} == {"tesla"}
        assert all(lb["scope"] == office.uid("kim") for lb in kim_labels
                   if lb["scope_kind"] == "user")  # fmt: skip
        # reorder
        ids = [lb["id"] for lb in tesla if lb["type"] == "category"]
        r = await boss.post("/api/calendar/reorder", json={"type": "labels", "ids": ids[::-1]},
                            headers=h)  # fmt: skip
        assert r.status_code == 200
        order = [lb["name"] for lb in (await boss.get("/api/calendar/labels", params={"org": "tesla"})).json()["labels"]
                 if lb["type"] == "category" and lb["scope"] == "tesla"]  # fmt: skip
        assert order == ["개발", "지원"]
    assert PALETTE[0] == "blue"


async def test_a_broken_preset_falls_back_to_the_default_and_says_why(office: Office) -> None:
    d = office.web.solution.org("tesla").root / "calendar"
    d.mkdir(parents=True)
    (d / "presets.yaml").write_text("categories: nope\n", encoding="utf-8")
    async with office.client() as boss:
        await office.login(boss, "boss", Role.OWNER)
        got = (await boss.get("/api/calendar/labels", params={"org": "tesla"})).json()
        assert got["seeded"]["org:tesla"] == "default"
        assert "categories must be a list" in got["preset_errors"]["tesla"]


async def test_work_changes_are_audited_personal_ones_are_not(office: Office) -> None:
    async with office.client() as boss:
        h = await office.login(boss, "boss", Role.OWNER)
        work = await _make(boss, h, kind="work", org="tesla", title="오픈", start="2026-11-10")
        await boss.patch(
            f"/api/calendar/items/{work['id']}", json={"title": "오픈 행사"}, headers=h
        )
        r = await boss.post(f"/api/calendar/items/{work['id']}/todos", json={"title": "현수막"},
                            headers=h)  # fmt: skip
        await boss.patch(f"/api/calendar/todos/{r.json()['todo']['id']}", json={"done": True},
                         headers=h)  # fmt: skip
        own = await _make(boss, h, kind="personal", title="비밀 일정", start="2026-11-10")
        await boss.delete(f"/api/calendar/items/{own['id']}", headers=h)
        await boss.delete(f"/api/calendar/items/{work['id']}", headers=h)
        log = office.web.org.audit_log()
        actions = [e["action"] for e in log if e["action"].startswith("calendar.")]
        assert actions == [
            "calendar.delete",
            "calendar.todo.update",
            "calendar.todo.create",
            "calendar.update",
            "calendar.create",
        ]
        assert all(
            work["id"] in (e["detail"] or "") for e in log if e["action"].startswith("calendar.")
        )
        assert not any("비밀" in (e["detail"] or "") for e in log)


async def test_live_notes_reach_only_those_who_may_see(office: Office) -> None:
    """The calendar's event stream: work notes to the org's people, a personal note to its
    owner only, ids and no titles."""
    import solosquad.web_api.app as app_module

    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.staff_in(kim, "kim", "tesla")
        del hk
        hub = None
        # the hub is inside the app; reach it through a stream handler's closure
        for route in office.app.routes[0].routes:  # type: ignore[attr-defined]
            if getattr(route, "path", "") == "/calendar/events":
                cells = route.endpoint.__closure__ or ()
                for cell in cells:
                    if isinstance(cell.cell_contents, app_module.CalendarHub):
                        hub = cell.cell_contents
        assert hub is not None
        boss_v = Viewer(office.uid("boss"), lambda _o, _w: True)
        kim_v = Viewer(office.uid("kim"), lambda o, _w: o == "tesla")
        qb, qk = hub.add(boss_v), hub.add(kim_v)
        await _make(boss, hb, kind="work", org="tesla", title="공유", start="2026-11-10")
        await _make(boss, hb, kind="personal", title="비밀", start="2026-11-10")
        await _make(boss, hb, kind="work", org="spacex", title="스페이스", start="2026-11-10")
        got_b = [qb.get_nowait() for _ in range(qb.qsize())]
        got_k = [qk.get_nowait() for _ in range(qk.qsize())]
        assert [(n["kind"], n["org"]) for n in got_b] == [
            ("work", "tesla"), ("personal", None), ("work", "spacex")]  # fmt: skip
        assert [(n["kind"], n["org"]) for n in got_k] == [("work", "tesla")]
        assert all(set(n) <= {"ts", "event", "kind", "org", "workspace", "item_id"} for n in got_b)
    await asyncio.sleep(0)


# ---------------------------------------------------------------------- agents' read path


async def test_agent_access_levels_people_still_blocked_and_audited(office: Office) -> None:
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.staff_in(kim, "kim", "tesla")
        await _make(kim, hk, kind="personal", title="병원", notes="정기 검진",
                    start="2026-11-12T15:00", end="2026-11-12T16:00")  # fmt: skip
        kim_id = office.uid("kim")
        q = {"from": "2026-11-01", "to": "2026-11-30"}
        # the default is off: an agent reads nothing
        assert (await kim.get("/api/calendar/agent-access")).json() == {"level": "off"}
        view = (await kim.get("/api/calendar/agent-view", params=q)).json()
        assert (view["level"], view["entries"]) == ("off", [])
        # busy: time blocks only — no id, no title, no notes
        r = await kim.put("/api/calendar/agent-access", json={"level": "busy"}, headers=hk)
        assert r.json() == {"level": "busy"}
        view = (await kim.get("/api/calendar/agent-view", params=q)).json()
        assert view["entries"] == [{"start": "2026-11-12T15:00", "end": "2026-11-12T16:00",
                                    "all_day": False, "id": None, "title": None, "notes": None,
                                    "status": None}]  # fmt: skip
        # full: titles, times and notes
        await kim.put("/api/calendar/agent-access", json={"level": "full"}, headers=hk)
        entry = (await kim.get("/api/calendar/agent-view", params=q)).json()["entries"][0]
        assert (entry["title"], entry["notes"]) == ("병원", "정기 검진")
        r = await kim.put("/api/calendar/agent-access", json={"level": "all"}, headers=hk)
        assert r.json()["code"] == "calendar_agent_access_invalid"
        # people never see them, whatever the level — the owner neither
        assert "병원" not in {i["title"] for i in (await _range(boss))["items"]}
        r = await boss.get("/api/calendar/agent-view", params={**q, "user": kim_id})
        assert (r.status_code, r.json()) == (404, NOT_FOUND_BODY)
        # the engine's own token (an agent tool, v2.2) reads at the chosen level
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=office.app, client=("127.0.0.1", 50000)),
            base_url="https://office.example",
            headers={"authorization": "Bearer tok"},
        ) as engine:
            r = await engine.get("/api/calendar/agent-view", params={**q, "user": kim_id})
            assert r.status_code == 200 and r.json()["entries"][0]["title"] == "병원"
            r = await engine.get("/api/calendar/agent-view", params={**q, "user": "u-nobody"})
            assert (r.status_code, r.json()) == (404, NOT_FOUND_BODY)
        # every change of the level is in the customer's audit (who · from → to)
        changes = [e for e in office.accounts.audit_log() if e["action"] == "calendar.agent_access"]
        assert [e["detail"] for e in changes] == ["busy -> full", "off -> busy"]
        assert all(e["user_id"] == kim_id for e in changes)
        del hb


async def test_default_labels_are_written_in_the_requesting_persons_language(
    office: Office,
) -> None:
    """2026-11-11: no customer default language. What the engine writes in a language (here
    the default label names an org is seeded with) follows the person whose request made
    it, else ko."""
    async with office.client() as boss:
        h = await office.login(boss, "boss", Role.OWNER)
        assert (await boss.patch("/api/me", json={"locale": "en"}, headers=h)).status_code == 200
        got = (await boss.get("/api/calendar/labels")).json()
        spacex = {lb["name"] for lb in got["labels"] if lb["scope"] == "spacex"}
        assert spacex == {"Work", "Meeting", "Deadline", "Important", "Documents"}
        mine = {lb["name"] for lb in got["labels"] if lb["scope_kind"] == "user"}
        assert mine == {"Personal", "Health", "Important"}
