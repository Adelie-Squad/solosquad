"""Demo mode (decision 62 · PRD v2.1.0 §3.6.4) — a demo server, its accounts, the scripted
scenarios, the lock table and usage per account.

    init       server.yaml `mode: demo` · the example company 모아 리빙 · an empty pool
    ids        `<slug>Demo` (and `samsungDemo2`), unique whatever the case
    issue      a copy per account: workflows, two example people, calendar, yesterday's runs
    scenario   steps advance, stop at the decision-51 approval points, a no branches (C60)
    no model   every activation is the scripted harness; the real harnesses never spawn
    web        ?demo=1 login · Me.demo · the lock table → demo_read_only (C59) · chat and
               approvals live · a request runs its scenario · isolation between visitors ·
               demo_expired · the marketing form post with its Origin
    usage      the PRD's events, never the typed text (C61)
    lifecycle  처음 상태로 · reset · revoke · extend · expiry · the runtime wakes and sleeps
"""

from __future__ import annotations

import asyncio
import datetime as dt
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
import pytest
from web_fixtures import plain_client

from solosquad.demo import (
    ORG_WORKSPACE,
    DemoConfig,
    check_id,
    company_no_matches,
    is_demo,
    load_config,
    normalize_company_no,
)
from solosquad.demo.harness import FALLBACK, NAME, SUGGESTIONS, DemoHarness, match_intent, script
from solosquad.demo.scenario import SCENARIOS, Pace, ensure_running
from solosquad.demo.seed import (
    SCRIPTED,
    create_account,
    demo_builder,
    ensure_company,
    init_solution,
    open_stores,
    reset_account,
    seed_account,
    wipe_org,
)
from solosquad.demo.store import DemoStore, parse_expiry, path_pattern, summaries_csv
from solosquad.demo.supervisor import DemoSupervisor, step_recorder
from solosquad.engine_server import EngineServer, build_engine, start_engine, stop_engine
from solosquad.harness.claude_code import ClaudeCodeHarness
from solosquad.harness.codex import CodexHarness
from solosquad.harness.lite import LiteHarness
from solosquad.harness.opencode import OpenCodeHarness
from solosquad.layout import Solution, scaffold_solution, solosquad_home
from solosquad.routing import load_connections
from solosquad.web_api.accounts import AccountStore, Role
from solosquad.web_api.app import CSRF_HEADER, DEMO_READ_ONLY, AppConfig, create_app

MARKETING = "https://solosquad.example"
FAST = DemoConfig(step_seconds=0, chat_seconds=0, marketing_url=MARKETING)
COMPANY_NO = {"samsungDemo": "123-45-67890", "lgDemo": "110111-1234567"}
"""Each inquiry's registration number (fictional) — a 사업자등록번호 and a 법인등록번호."""


@pytest.fixture(autouse=True)
def no_real_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """A demo must never start a model process or call an API (C60)."""

    def refuse(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("a real harness was spawned in demo mode")

    for harness in (ClaudeCodeHarness, CodexHarness, OpenCodeHarness, LiteHarness):
        monkeypatch.setattr(harness, "spawn", refuse)


def make_solution(tmp_path: Path) -> Solution:
    sol = init_solution(tmp_path / "demo", FAST)
    ensure_company(open_stores(sol)[0])
    return sol


async def issue(
    sol: Solution, demo_id: str, build: Any, *, expires: float | None = None
) -> tuple[Any, str]:
    accounts, store = open_stores(sol)
    acct, password = create_account(
        sol, store, accounts, demo_id, f"INQ-{demo_id}", expires or time.time() + 86400,
        company_no=COMPANY_NO.get(demo_id, "1234567890"),
    )  # fmt: skip
    await seed_account(sol, solosquad_home(), acct, accounts, build=build)
    store.mark_seeded(acct.demo_id, acct.generation)
    found = store.get(demo_id)
    assert found is not None
    return found, password


# ---------------------------------------------------------------------- init · ids


def test_init_makes_a_demo_server_with_the_example_company(tmp_path: Path) -> None:
    sol = make_solution(tmp_path)
    assert is_demo(sol)
    server = sol.server_config()
    assert server.mode == "demo" and server.access.two_factor is False
    assert load_config(sol).step_seconds == 0 and load_config(sol).nightly_reset == "04:00"
    accounts, _ = open_stores(sol)
    company = accounts.company()
    assert "모아 리빙" in company.name and "예시" in company.name and company.country == "KR"
    assert load_connections(sol.connections_path) == []  # the pool on disk stays empty
    assert (sol.root / "demo" / "template" / "workflows" / "finance-monthly.yaml").is_file()
    assert sol.orgs() == []  # every visitor gets their own copy at issue


def test_a_customer_server_is_not_a_demo(tmp_path: Path) -> None:
    assert not is_demo(scaffold_solution(tmp_path / "c", "2.1.0"))


@pytest.mark.parametrize(
    "good", ["samsungDemo", "lgDemo", "Hyundai2Demo", "samsungDemo2", "SKDemo"]
)
def test_demo_ids_that_are_accepted(good: str) -> None:
    assert check_id(good) == good


@pytest.mark.parametrize(
    "bad",
    ["samsung", "Demo", "samsungdemo", "samsung-Demo", "삼성Demo", "1samsungDemo",
     "x" * 40 + "Demo", "samsung Demo", "samsungDemo123", ""],
)  # fmt: skip
def test_demo_ids_that_are_refused(bad: str) -> None:
    with pytest.raises(ValueError):
        check_id(bad)


async def test_an_id_is_issued_once_whatever_the_case(tmp_path: Path) -> None:
    sol = make_solution(tmp_path)
    build = demo_builder(FAST)
    await issue(sol, "samsungDemo", build)
    accounts, store = open_stores(sol)
    with pytest.raises(ValueError, match="already issued"):
        create_account(sol, store, accounts, "SamsungDemo", "INQ-2", time.time() + 99,
                       company_no="1234567890")  # fmt: skip
    with pytest.raises(ValueError, match="inquiry"):
        create_account(sol, store, accounts, "otherDemo", " ", time.time() + 99,
                       company_no="1234567890")  # fmt: skip
    with pytest.raises(ValueError, match="company number"):
        create_account(sol, store, accounts, "otherDemo", "INQ-3", time.time() + 99,
                       company_no="12")  # fmt: skip
    assert not store.taken("otherDemo") and not any(
        u.username == "otherdemo" for u in accounts.users()
    )  # a refused number makes no login


@pytest.mark.parametrize(
    ("raw", "stored"),
    [("123-45-67890", "1234567890"), (" 123 45 67890 ", "1234567890"),
     ("110111-1234567", "1101111234567"), ("\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19\uff10", "1234567890"),
     ("91310000-MA1FL", "91310000-MA1FL"), ("hrb-12345", "HRB-12345"),
     ("ab12", "AB12")],
)  # fmt: skip
def test_company_numbers_that_are_accepted(raw: str, stored: str) -> None:
    assert normalize_company_no(raw) == stored


@pytest.mark.parametrize("bad", ["", "   ", "abc", "x" * 31, "123_45_67890", "삼성전자", "12 34"])
def test_company_numbers_that_are_refused(bad: str) -> None:
    with pytest.raises(ValueError):
        normalize_company_no(bad)


def test_the_number_at_login_ignores_dashes_spaces_and_case() -> None:
    assert company_no_matches("1234567890", "123-45-67890")
    assert company_no_matches("1101111234567", "110111 1234567")
    assert company_no_matches("HRB-12345", "hrb12345")
    assert not company_no_matches("1234567890", "1234567891")
    assert not company_no_matches("1234567890", "")
    assert not company_no_matches("", "")  # an account issued without one never matches


def test_a_store_from_before_the_company_number_gains_the_column(tmp_path: Path) -> None:
    from solosquad.demo.store import COMPONENT, MIGRATIONS
    from solosquad.storage import connect, migrate

    path = tmp_path / "core.db"
    db = connect(path)
    migrate(db, COMPONENT, MIGRATIONS[:1], path=path)
    db.execute(
        "INSERT INTO demo_accounts (demo_id, key, user_id, org, inquiry_id, created, expires)"
        " VALUES ('oldDemo', 'olddemo', 'u1', 'olddemo', 'INQ-0', 1, 9e12)"
    )
    db.commit()
    db.close()
    acct = DemoStore(path).get("oldDemo")
    assert acct is not None and acct.company_no == ""  # the demo login refuses it


def test_expiry_forms() -> None:
    now = 1_000_000.0
    assert parse_expiry("14d", now) == now + 14 * 86400
    assert parse_expiry("48h", now) == now + 48 * 3600
    assert parse_expiry("2w", now) == now + 14 * 86400
    with pytest.raises(ValueError):
        parse_expiry("soon", now)


def test_screens_are_kept_as_patterns() -> None:
    assert path_pattern("/o/samsungdemo/w/hq/office?x=1") == "/o/:org/w/:ws/office"
    assert path_pattern("/o/samsungdemo/w/hq/chat/t-3f2a9b10c4d5") == "/o/:org/w/:ws/chat/:id"
    assert path_pattern("/o/samsungdemo/settings/users") == "/o/:org/settings/users"


# ---------------------------------------------------------------------- issue · seed


async def test_issue_seeds_a_fresh_copy(tmp_path: Path) -> None:
    sol = make_solution(tmp_path)
    build = demo_builder(FAST)
    acct, password = await issue(sol, "samsungDemo", build)
    assert len(password) == 16
    org = sol.org("samsungdemo")
    assert org.config().display_name == "모아 리빙 (예시)"
    assert sorted(p.stem for p in (org.root / "workflows").glob("*.yaml")) == sorted(SCENARIOS)
    assert "__FILES__" not in (org.root / "workflows" / "finance-monthly.yaml").read_text("utf-8")
    ws = org.workspace(ORG_WORKSPACE).config()
    assert ws.execution.allow_external_api is False and ws.execution.allow_subscription_cli is False
    accounts, _ = open_stores(sol)
    people = {u.username for u in accounts.users()}
    assert people == {"samsungdemo", "samsungdemo.finance", "samsungdemo.marketing"}
    eng = build_engine(sol.root, build=build)
    rt = eng.runtime("samsungdemo", ORG_WORKSPACE)
    assert rt is not None and rt.artifacts is not None and rt.workflows is not None
    kinds = {a.kind for a in rt.artifacts.find(limit=50)}
    assert {"finance.pnl", "finance.payables", "sourcing.comparison", "sourcing.po",
            "sns.calendar", "sns.posts", "sns.ads", "brief"} <= kinds  # fmt: skip
    po = rt.artifacts.find(kind="sourcing.po", limit=1)[0].data
    assert po["language"] == "zh-CN" and "保温杯" in po["lines"][0]["name_local"]
    pnl = rt.artifacts.find(kind="finance.pnl", limit=1)[0]
    assert pnl.needs_review  # the flagged settlement row
    runs = rt.workflows.manager.store.runs(limit=50)
    assert runs and all(r["created"] < time.time() - 10 * 3600 for r in runs)  # yesterday
    assert not rt.workflows.open_runs()
    pres = accounts.presence(acct.user_id)
    assert pres is not None and pres.last_active < min(r["created"] for r in runs)
    rows = (
        accounts.connection()
        .execute("SELECT title FROM cal_items WHERE org = ?", ("samsungdemo",))
        .fetchall()
    )
    assert "11월 정기 발주 마감" in {r[0] for r in rows}


# ---------------------------------------------------------------------- the scenario


@dataclass
class Demo:
    sol: Solution
    engine: EngineServer
    store: DemoStore
    app: Any
    config: AppConfig
    build: Any
    supervisor: DemoSupervisor

    def client(self, ip: str = "203.0.113.5") -> httpx.AsyncClient:
        return plain_client(self.app, ip)

    async def login(self, c: httpx.AsyncClient, demo_id: str, password: str) -> dict[str, str]:
        """The one way in for a demo account: the marketing demo login's form post."""
        form = {"company_no": {k.lower(): v for k, v in COMPANY_NO.items()}.get(demo_id.lower(), "1234567890"),
                "username": demo_id,
                "password": password}  # fmt: skip
        r = await c.post(
            "/api/auth/demo-login", content=urlencode(form),
            headers={"content-type": "application/x-www-form-urlencoded", "origin": MARKETING,
                     "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile"},
        )  # fmt: skip
        assert r.status_code == 303 and r.headers["location"] == "/dashboard", r.headers
        me = (await c.get("/api/me")).json()
        return {CSRF_HEADER: me["csrf"]}


@pytest.fixture
async def demo(tmp_path: Path) -> AsyncIterator[tuple[Demo, dict[str, str]]]:
    sol = make_solution(tmp_path)
    passwords = {}
    seed_build = demo_builder(FAST)
    for demo_id in ("samsungDemo", "lgDemo"):
        _, pw = await issue(sol, demo_id, seed_build)
        passwords[demo_id] = pw
    _accounts, store = open_stores(sol)
    build = demo_builder(FAST, step_recorder(store))
    engine = build_engine(sol.root, build=build)
    await start_engine(engine)
    cfg = AppConfig.for_engine(engine, "tok", demo=store)
    sup = DemoSupervisor(engine, store, FAST, build, cfg)
    cfg.demo_control = sup
    d = Demo(sol, engine, store, create_app(cfg), cfg, build, sup)
    yield d, passwords
    await stop_engine(engine)


async def wait_for(engine: Any, tid: str, status: str, timeout: float = 20) -> dict[str, Any]:
    end = time.time() + timeout
    while time.time() < end:
        runs = engine.manager.store.runs(thread_id=tid, limit=1)
        if runs and runs[0]["status"] == status:
            return runs[0]  # type: ignore[no-any-return]
        await asyncio.sleep(0.02)
    raise AssertionError(f"thread {tid} never reached {status}")


def card_of(run: dict[str, Any]) -> dict[str, Any]:
    return (run.get("interrupts") or [{}])[0]["value"]  # type: ignore[no-any-return]


def wf_of(d: Demo, org: str = "samsungdemo") -> Any:
    rt = d.engine.runtime(org, ORG_WORKSPACE)
    assert rt is not None and rt.workflows is not None
    return rt.workflows


async def test_finance_pauses_at_the_team_then_the_owner_approval(
    demo: tuple[Demo, dict[str, str]],
) -> None:
    d, _ = demo
    wf = wf_of(d)
    tid, _ = await wf.run_now("finance-monthly", {})
    first = card_of(await wait_for(wf, tid, "interrupted"))
    assert (first["step"], first["category"], first["team"]) == ("review", "review", "business")
    await asyncio.sleep(0.2)
    assert wf.manager.store.runs(thread_id=tid, limit=1)[0]["status"] == "interrupted"  # waits
    await wf.manager.resume(tid, "approved")
    second = card_of(await wait_for(wf, tid, "interrupted"))
    assert second["step"] == "pay" and second["category"] == "payment"
    assert second["title"].startswith("거래처 대금 지급 ₩")
    assert "데모 — 실제로 보내지 않아요" in second["summary"]
    await wf.manager.resume(tid, "approved")
    await wait_for(wf, tid, "success")
    outputs = (await wf.manager.thread_state(tid))["values"]["outputs"]
    assert "paid" in outputs and "hold" not in outputs


@pytest.mark.parametrize(
    ("name", "steps", "decline", "branch"),
    [
        ("product-sourcing", ("shortlist", "order"), "order", "renegotiate"),
        ("sns-marketing", ("publish_ok", "ad_spend"), "ad_spend", "organic"),
        ("finance-monthly", ("review", "pay"), "pay", "hold"),
    ],
)
async def test_a_no_takes_the_scenario_branch(
    demo: tuple[Demo, dict[str, str]], name: str, steps: tuple[str, str], decline: str,
    branch: str,
) -> None:  # fmt: skip
    d, _ = demo
    wf = wf_of(d)
    tid, _ = await wf.run_now(name, {})
    seen = []
    for _ in steps:
        card = card_of(await wait_for(wf, tid, "interrupted"))
        seen.append(card["step"])
        await wf.manager.resume(tid, "declined" if card["step"] == decline else "approved")
    await wait_for(wf, tid, "success")
    assert tuple(seen) == steps
    outputs = (await wf.manager.thread_state(tid))["values"]["outputs"]
    assert branch in outputs


async def test_every_activation_is_the_scripted_harness(demo: tuple[Demo, dict[str, str]]) -> None:
    d, _ = demo
    harness = d.build.harness
    assert isinstance(harness, DemoHarness) and harness.name == NAME == "scripted"
    for inst in d.engine.runtimes.values():
        assert inst.router.connections == [SCRIPTED]
        assert inst.router.harness_factory(SCRIPTED, inst.secrets) is harness
    before = harness.calls
    rt = d.engine.runtime("samsungdemo", ORG_WORKSPACE)
    assert rt is not None
    tid = rt.manager.create_thread("chat")
    rid = await rt.manager.submit(tid, "10월 손익 정리해줘")
    assert (await rt.manager.wait(rid, 20))["status"] == "success"
    assert harness.calls >= before + 2  # chief, then the finance agent it handed to
    entries = rt.ledger.entries(thread_id=tid)
    assert {e["harness"] for e in entries} == {NAME}
    assert {e["agent"] for e in entries} >= {"chief", "finance"}
    assert sum(e["cost_usd"] for e in entries) == 0


def test_chat_intents_suggestions_and_the_fallback() -> None:
    r = script("[user] 보온 텀블러 공급처 비교해줘\n\n---\nYou are chief in x's agent company.")
    assert r.intent == "sourcing" and r.handoff is not None and r.handoff[0] == "researcher"
    assert script("[user] 오늘 날씨 어때?\n\n---\nYou are chief in x").text == FALLBACK["ko"]
    assert script("[user] what's the weather\n\n---\nYou are chief in x").text == FALLBACK["en"]
    assert script("[user] 今天天气怎么样\n\n---\nYou are chief in x").text == FALLBACK["zh-CN"]
    assert "财务" in script("[user] 帮我整理利润\n\n---\nYou are chief in x").text
    step = script(
        "[workflow job for finance] #demo:finance.read 읽어줘\n\n---\nYou are finance in x"
    )
    assert step.intent == "step:finance.read" and "은행" in step.text
    found = [match_intent(s) for s in SUGGESTIONS]
    assert {f.scenario for f in found if f is not None} == set(SCENARIOS)


async def test_restart_stops_the_open_runs_and_starts_again(
    demo: tuple[Demo, dict[str, str]],
) -> None:
    d, pw = demo
    async with d.client() as c:
        h = await d.login(c, "samsungDemo", pw["samsungDemo"])  # starts the scenarios
        wf = wf_of(d)
        first = {r["thread_id"] for r in wf.open_runs()}
        assert len(first) == 3
        r = await c.post("/api/o/samsungdemo/w/hq/demo/restart", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["workflows"] == list(SCENARIOS)
        now: set[str] = set()
        for _ in range(200):
            now = {x["thread_id"] for x in wf.open_runs()}
            if not (now & first):
                break
            await asyncio.sleep(0.02)
        assert len(now) == 3 and not (now & first)


# ---------------------------------------------------------------------- the web


LOCKED = {
    # the lock table — every route key, plus the own-account actions without one
    "users.create": ("POST", "/api/users", {"username": "x", "password": "0123456789"}),
    "users.update": ("PATCH", "/api/users/u-1", {"disabled": True}),
    "access.update": ("PUT", "/api/access", {"allowed_networks": []}),
    "company.update": ("PUT", "/api/company", {"kind": "corporation", "name": "x"}),
    "snapshot.update": ("PUT", "/api/snapshot", {}),
    "snapshot.run": ("POST", "/api/snapshot/run", {}),
    "people.update": ("PATCH", "/api/o/samsungdemo/people/u-1", {"title": "x"}),
    "connections.create": ("POST", "/api/o/samsungdemo/connections", {"id": "x"}),
    "connections.update": ("PATCH", "/api/o/samsungdemo/connections/demo-scripted", {}),
    "connections.delete": ("DELETE", "/api/o/samsungdemo/connections/demo-scripted", None),
    "workflows.update": ("PATCH", "/api/o/samsungdemo/workflows/finance-monthly", {"enabled": False}),
    "approval_policy.update": ("PUT", "/api/o/samsungdemo/approval-policy", {"tiers": {"payment": "team"}}),
    "ws_access.update": ("PUT", "/api/o/samsungdemo/w/hq/access", {"allowed_networks": []}),
    "uploads.create": ("POST", "/api/o/samsungdemo/w/hq/uploads", None),
    "calendar.labels.create": ("POST", "/api/calendar/labels", {"type": "tag", "name": "x"}),
    "calendar.labels.update": ("PATCH", "/api/calendar/labels/l-1", {"name": "x"}),
    "calendar.agent_access.update": ("PUT", "/api/calendar/agent-access", {"level": "none"}),
    "calendar.delete": ("DELETE", "/api/calendar/items/i-1", None),
    "calendar.todos.delete": ("DELETE", "/api/calendar/todos/t-1", None),
}  # fmt: skip
SELF_LOCKED = [
    ("PATCH", "/api/me", {"password": "0123456789xx"}),
    ("POST", "/api/auth/totp/begin", {}),
    ("POST", "/api/auth/totp/confirm", {"code": "123456"}),
    ("POST", "/api/auth/passkey/register/begin", {}),
    ("POST", "/api/auth/passkey/register/finish", {}),
    ("DELETE", "/api/me/passkeys/p-1", None),
    ("POST", "/api/calendar/reorder", {"type": "labels", "ids": []}),
]


def test_the_lock_table_is_covered() -> None:
    assert set(LOCKED) == set(DEMO_READ_ONLY)


async def test_c59_settings_are_locked_but_the_scenario_stays_live(
    demo: tuple[Demo, dict[str, str]],
) -> None:
    d, pw = demo
    async with d.client() as c:
        h = await d.login(c, "samsungDemo", pw["samsungDemo"])
        me = (await c.get("/api/me")).json()
        assert me["demo"] is True and me["demo_info"]["id"] == "samsungDemo"
        assert set(me["demo_info"]["locked"]) >= set(DEMO_READ_ONLY)
        assert me["demo_info"]["contact_url"] == f"{MARKETING}/?contact=demo"
        assert me["demo_info"]["suggestions"] == list(SUGGESTIONS)
        assert me["user"]["role"] == "owner"
        assert [s["org"] for s in me["scopes"]] == ["samsungdemo"]
        for key, (method, path, payload) in LOCKED.items():
            r = await c.request(method, path, json=payload, headers=h)
            assert r.status_code == 403, (key, r.text)
            assert r.json()["code"] == "demo_read_only", key
        for method, path, payload in SELF_LOCKED:
            r = await c.request(method, path, json=payload, headers=h)
            assert (r.status_code, r.json()["code"]) == (403, "demo_read_only"), path
        # open: the screen language, a calendar entry, approvals, 지금 실행, requests
        r = await c.patch("/api/me", json={"locale": "zh-CN"}, headers=h)
        assert r.status_code == 200 and r.json()["locale"] == "zh-CN"
        r = await c.post("/api/calendar/items", headers=h, json={
            "kind": "work", "org": "samsungdemo", "title": "샘플 확인",
            "start": dt.date.today().isoformat()})  # fmt: skip
        assert r.status_code == 201, r.text
        wf = wf_of(d)
        tid = next(r["thread_id"] for r in wf.open_runs("finance-monthly"))
        await wait_for(wf, tid, "interrupted")
        mine = [a for a in (await c.get("/api/o/samsungdemo/w/hq/approvals")).json()
                if a["thread_id"] == tid]  # fmt: skip
        assert mine and mine[0]["can_approve"] and mine[0]["tier"] == "team"
        r = await c.post(f"/api/o/samsungdemo/w/hq/workflow-threads/{tid}/resume",
                         json={"value": "approved"}, headers=h)  # fmt: skip
        assert r.status_code == 201, r.text
        assert card_of(await wait_for(wf, tid, "interrupted"))["category"] == "payment"
    assert load_connections(d.sol.connections_path) == []  # nothing was written


async def test_a_request_runs_its_scenario(demo: tuple[Demo, dict[str, str]]) -> None:
    d, pw = demo
    wf = wf_of(d)
    async with d.client() as c:
        h = await d.login(c, "samsungDemo", pw["samsungDemo"])
        for run in wf.open_runs():
            wf.stop_run(run["thread_id"])
        for _ in range(200):
            if not wf.open_runs():
                break
            await asyncio.sleep(0.02)
        made = (await c.post("/api/o/samsungdemo/w/hq/threads", json={"title": "q"},
                             headers=h)).json()  # fmt: skip
        r = await c.post(f"/api/o/samsungdemo/w/hq/threads/{made['thread_id']}/runs",
                         json={"input": SUGGESTIONS[2]}, headers=h)  # fmt: skip
        assert r.status_code == 201
        assert wf.open_runs("product-sourcing")
        r = await c.post(f"/api/o/samsungdemo/w/hq/threads/{made['thread_id']}/runs",
                         json={"input": "우리 회사 비밀 매출은 37억이야"}, headers=h)  # fmt: skip
        assert r.status_code == 201
    events = d.store.events("samsungDemo")
    prompts = [e["detail"] for e in events if e["kind"] == "prompt"]
    assert prompts[0] == {"suggestion": 3, "matched": True, "length": len(SUGGESTIONS[2])}
    assert prompts[1]["suggestion"] is None and prompts[1]["matched"] is True
    assert "37억" not in str(events)  # the text a visitor types is never kept
    started = [e["detail"] for e in events if e["kind"] == "scenario_start"]
    assert {"workflow": "product-sourcing", "how": "prompt"} in started


async def test_c61_usage_is_recorded_without_the_text(demo: tuple[Demo, dict[str, str]]) -> None:
    d, pw = demo
    async with d.client() as c:
        h = await d.login(c, "samsungDemo", pw["samsungDemo"])
        ok = await c.post("/api/demo/events", headers=h, json={
            "kind": "page_view", "path": "/o/samsungdemo/w/hq/office?x=1", "ms": 5200})  # fmt: skip
        assert ok.status_code == 200
        await c.post("/api/demo/events", json={"kind": "blocked_click", "name": "connections"},
                     headers=h)  # fmt: skip
        bad = await c.post("/api/demo/events", json={"kind": "nope"}, headers=h)
        assert bad.status_code == 400
        wf = wf_of(d)
        tid = next(r["thread_id"] for r in wf.open_runs("finance-monthly"))
        await wait_for(wf, tid, "interrupted")
        await c.post(f"/api/o/samsungdemo/w/hq/workflow-threads/{tid}/resume",
                     json={"value": "approved"}, headers=h)  # fmt: skip
        card = card_of(await wait_for(wf, tid, "interrupted"))
        await c.post(f"/api/o/samsungdemo/w/hq/workflow-threads/{tid}/resume",
                     json={"value": "declined"}, headers=h)  # fmt: skip
        await wait_for(wf, tid, "success")
        assert card["category"] == "payment"
        await c.post("/api/o/samsungdemo/connections", json={"id": "x"}, headers=h)
        await c.post("/api/auth/logout", headers=h)
    acct = d.store.get("samsungDemo")
    assert acct is not None
    ev = d.store.events("samsungDemo")
    kinds = [e["kind"] for e in ev]
    for k in ("login", "page_view", "scenario_start", "scenario_step", "scenario_done",
              "approval_click", "blocked_click", "logout"):  # fmt: skip
        assert k in kinds, k
    assert next(e for e in ev if e["kind"] == "login")["detail"]["device"] == "phone"
    view = next(e for e in ev if e["kind"] == "page_view")["detail"]
    assert view == {"path": "/o/:org/w/:ws/office", "ms": 5200}
    clicks = [e["detail"] for e in ev if e["kind"] == "approval_click"]
    assert [(c["value"], c["tier"]) for c in clicks] == [
        ("approved", "team"),
        ("declined", "owner"),
    ]
    blocked = {e["detail"]["name"] for e in ev if e["kind"] == "blocked_click"}
    assert blocked == {"connections", "connections.create"}
    u = d.store.summary(acct)
    assert u["inquiry_id"] == "INQ-samsungDemo" and u["logins"] == 1
    assert "finance-monthly" in u["scenarios_done"]
    assert u["approvals_approved"] == 1 and u["approvals_declined"] == 1
    assert u["devices"] == {"phone": 1}
    assert "INQ-samsungDemo" in summaries_csv([u])


async def test_visitors_never_see_each_other(demo: tuple[Demo, dict[str, str]]) -> None:
    d, pw = demo
    async with d.client() as c:
        await d.login(c, "lgDemo", pw["lgDemo"])
        for path in ("/api/o/samsungdemo/org-chart", "/api/o/samsungdemo/w/hq/approvals",
                     "/api/o/samsungdemo/w/hq/artifacts"):  # fmt: skip
            assert (await c.get(path)).status_code == 404, path
        users = {u["username"] for u in (await c.get("/api/users")).json()}
        assert users == {"lgdemo", "lgdemo.finance", "lgdemo.marketing"}
        lg = d.store.get("lgDemo")
        assert lg is not None
        assert all(a["user_id"] == lg.user_id for a in (await c.get("/api/audit")).json())
        digest = (await c.get("/api/me/digest")).json()
        assert digest["finished"] and {r["org"] for r in digest["finished"]} == {"lgdemo"}
        today = dt.date.today()
        span = {"from": (today - dt.timedelta(days=30)).isoformat(),
                "to": (today + dt.timedelta(days=60)).isoformat()}  # fmt: skip
        items = (await c.get("/api/calendar/items", params=span)).json()["items"]
        assert items and all(i.get("org") in (None, "lgdemo") for i in items)


async def test_expired_and_non_demo_logins(demo: tuple[Demo, dict[str, str]]) -> None:
    d, pw = demo
    d.engine.accounts.create_user("operator", "0123456789ab", Role.OWNER)
    async with d.client() as c:
        for path in ("/api/auth/login?demo=1", "/api/auth/login"):
            r = await c.post(path, json={"username": "operator", "password": "0123456789ab"})
            assert r.status_code == 401 and r.json()["code"] == "login_failed", path
        await d.login(c, "LGDEMO", pw["lgDemo"])  # the id is case-insensitive
        assert (await c.get("/api/me")).status_code == 200
        d.store.extend("lgDemo", time.time() - 1)
        r = await c.get("/api/me")
        assert r.status_code == 401 and r.json()["code"] == "demo_expired"
        again = f"company_no=110111-1234567&username=lgDemo&password={pw['lgDemo']}"
        r = await c.post("/api/auth/demo-login", content=again,
                         headers={"content-type": "application/x-www-form-urlencoded",
                                  "origin": MARKETING})  # fmt: skip
        assert r.headers["location"] == f"{MARKETING}/demo?error=1"
    acct = d.store.get("lgDemo")
    assert acct is not None and d.store.summary(acct)["refused"] == 1


async def test_a_demo_account_never_signs_in_through_the_json_login(
    demo: tuple[Demo, dict[str, str]],
) -> None:
    """Only the marketing demo login (number + id + password) lets a demo account in; the
    JSON login answers a right password exactly like a wrong one (2026-11-12)."""
    d, pw = demo
    async with d.client() as c:
        answers = []
        for path in ("/api/auth/login?demo=1", "/api/auth/login"):
            for password in (pw["samsungDemo"], "wrong-password"):
                body = {"username": "samsungDemo", "password": password,
                        "company_no": "123-45-67890"}  # fmt: skip
                r = await c.post(path, json=body)
                answers.append((r.status_code, r.json()["code"]))
                assert (await c.get("/api/me")).status_code == 401
        assert set(answers) == {(401, "login_failed")}
        fails = d.engine.accounts._q(
            "SELECT COUNT(*) FROM login_failures WHERE key = 'user:samsungdemo'"
        )[0][0]
        assert fails == 4  # each counts — a right password does not wipe the count
    acct = d.store.get("samsungDemo")
    assert acct is not None and d.store.summary(acct)["logins"] == 0


async def test_health_tells_the_login_screen_where_the_demo_login_is(
    demo: tuple[Demo, dict[str, str]], tmp_path: Path
) -> None:
    d, _ = demo
    async with d.client() as c:
        r = (await c.get("/api/health")).json()
    assert r["demo"] is True and r["demo_login_url"] == f"{MARKETING}/demo"
    from engine_fixtures import Customer

    cust = Customer(tmp_path / "customer")
    async with plain_client(create_app(AppConfig.for_engine(cust.engine, "tok"))) as c:
        r = (await c.get("/api/health")).json()
    assert r["demo"] is False and r["demo_login_url"] is None


async def test_the_marketing_form_post_signs_in(demo: tuple[Demo, dict[str, str]]) -> None:
    d, pw = demo
    form = {"content-type": "application/x-www-form-urlencoded", "origin": MARKETING}
    login = f"username=samsungDemo&password={pw['samsungDemo']}"
    good = f"company_no=123-45-67890&{login}"
    failed = f"{MARKETING}/demo?error=1"
    async with d.client() as c:
        r = await c.post("/api/auth/demo-login", content=good,
                         headers={**form, "origin": "https://evil.example"})  # fmt: skip
        assert r.status_code == 303 and r.headers["location"] == failed
        assert (await c.get("/api/me")).status_code == 401
        r = await c.post("/api/auth/demo-login",
                         content="company_no=1234567890&username=samsungDemo&password=x",
                         headers=form)  # fmt: skip
        assert r.status_code == 303 and r.headers["location"] == failed
        # the right id and password with another company's number, or none, read the same
        for number in ("company_no=110111-1234567&", "company_no=&", ""):
            r = await c.post("/api/auth/demo-login", content=f"{number}{login}", headers=form)
            assert r.status_code == 303 and r.headers["location"] == failed, number
            assert (await c.get("/api/me")).status_code == 401, number
        # each counts as a failed login (the password's success does not wipe the count)
        fails = d.engine.accounts._q(
            "SELECT COUNT(*) FROM login_failures WHERE key = 'user:samsungdemo'"
        )[0][0]
        assert fails == 4
        r = await c.post("/api/auth/demo-login", content=good, headers=form)
        assert r.status_code == 303 and r.headers["location"] == "/dashboard"
        assert (await c.get("/api/me")).json()["demo"] is True
    async with d.client() as c:  # the number as typed: dashes and spaces do not count
        r = await c.post("/api/auth/demo-login", content=f"company_no=123+45+67890&{login}",
                         headers=form)  # fmt: skip
        assert r.headers["location"] == "/dashboard"
    acct = d.store.get("samsungDemo")
    assert acct is not None and acct.company_no == "1234567890"
    assert d.store.summary(acct)["logins"] == 2  # a refused number is not a login
    d.store.extend("samsungDemo", time.time() - 1)
    async with d.client() as c:
        r = await c.post("/api/auth/demo-login", content=good, headers=form)
        assert r.headers["location"] == failed  # the same for expired


async def test_a_customer_server_has_no_demo(tmp_path: Path) -> None:
    from engine_fixtures import Customer

    cust = Customer(tmp_path)
    app = create_app(AppConfig.for_engine(cust.engine, "tok"))
    async with plain_client(app) as c:
        r = await c.post("/api/auth/demo-login", content="username=a&password=b")
        assert r.status_code == 404


# ---------------------------------------------------------------------- lifecycle


async def test_reset_button_makes_the_copy_again(demo: tuple[Demo, dict[str, str]]) -> None:
    d, pw = demo
    async with d.client() as c:
        h = await d.login(c, "samsungDemo", pw["samsungDemo"])
        old = d.engine.runtime("samsungdemo", ORG_WORKSPACE)
        assert old is not None and old.workflows is not None and old.workflows.open_runs()
        r = await c.post("/api/demo/reset", headers=h)
        assert r.status_code == 200, r.text
        new = d.engine.runtime("samsungdemo", ORG_WORKSPACE)
        assert new is not None and new is not old and new.workflows is not None
        assert not new.workflows.open_runs()  # back to the template, history only
        assert d.config.runtimes[("samsungdemo", "hq")].manager is new.manager
        assert (await c.get("/api/me")).status_code == 200  # still signed in
    kinds = [e["kind"] for e in d.store.events("samsungDemo")]
    assert "reset" in kinds and "login" in kinds  # usage survives the reset
    acct = d.store.get("samsungDemo")
    assert acct is not None and acct.ready and acct.generation == 2


async def test_the_supervisor_wakes_resets_and_retires(tmp_path: Path) -> None:
    sol = make_solution(tmp_path)
    build = demo_builder(FAST)
    await issue(sol, "samsungDemo", build)
    engine = build_engine(sol.root, build=build)
    await start_engine(engine)
    accounts = engine.accounts
    store = DemoStore(accounts.path)
    cfg = AppConfig.for_engine(engine, "tok", demo=store)
    sup = DemoSupervisor(engine, store, FAST, build, cfg)
    try:
        assert ("samsungdemo", "hq") in cfg.runtimes
        # nobody here → the runtime sleeps; a login wakes it
        assert (await sup.reconcile())["stopped"] == ["samsungDemo"]
        assert ("samsungdemo", "hq") not in cfg.runtimes
        acct = store.get("samsungDemo")
        assert acct is not None
        await sup.ensure(acct)
        assert ("samsungdemo", "hq") in cfg.runtimes
        # issued while the server runs, visitor here → it starts without a restart
        kia, _ = await issue(sol, "kiaDemo", build)
        store.open_session("kiaDemo", "s-kia")
        store.open_session("samsungDemo", "s-sam")
        assert (await sup.reconcile())["started"] == ["kiaDemo"]
        # a reset asked from the CLI → applied by the server
        rt = engine.runtime("samsungdemo", "hq")
        assert rt is not None and rt.workflows is not None
        await ensure_running(rt.workflows)
        store.request_reset("samsungDemo")
        assert (await sup.reconcile())["reset"] == ["samsungDemo"]
        fresh = engine.runtime("samsungdemo", "hq")
        assert fresh is not None and fresh is not rt and fresh.workflows is not None
        assert not fresh.workflows.open_runs()
        # expired → stopped, the copy removed `delete_after_days` later, usage kept
        store.extend("kiaDemo", time.time() - 1)
        assert (await sup.reconcile())["stopped"] == ["kiaDemo"]
        assert (sol.orgs_dir / "kiademo").exists()
        later = time.time() + 8 * 86400
        store.open_session("samsungDemo", "s-sam2", now=later)
        assert "kiaDemo" in (await sup.reconcile(now=later))["removed"]
        assert not (sol.orgs_dir / "kiademo").exists()
        store.record("kiaDemo", "login")
        assert store.events("kiaDemo")
        # extended → back, the same login
        store.extend("kiaDemo", parse_expiry("7d"))
        got = store.get("kiaDemo")
        assert got is not None and got.active() and kia.user_id == got.user_id
    finally:
        await stop_engine(engine)
    # with no server running the CLI path resets in place
    store.request_reset("samsungDemo")
    acct = store.get("samsungDemo")
    assert acct is not None and not acct.ready
    await reset_account(
        sol, solosquad_home(), store, AccountStore(accounts.path), acct, build=build
    )
    again = store.get("samsungDemo")
    assert again is not None and again.ready


async def test_the_nightly_reset(tmp_path: Path) -> None:
    sol = make_solution(tmp_path)
    build = demo_builder(FAST)
    await issue(sol, "samsungDemo", build)
    engine = build_engine(sol.root, build=build)
    store = DemoStore(engine.accounts.path)
    sup = DemoSupervisor(engine, store, FAST, build)
    day = dt.datetime(2026, 11, 12, 3, 0).timestamp()
    sup._nightly(day)  # started before 04:00: armed, no reset yet
    acct = store.get("samsungDemo")
    assert acct is not None and acct.ready
    sup._nightly(day + 3600 + 60)  # 04:01
    acct = store.get("samsungDemo")
    assert acct is not None and not acct.ready
    resets = [e["detail"] for e in store.events("samsungDemo") if e["kind"] == "reset"]
    assert resets == [{"by": "nightly"}]
    sup._nightly(day + 7200)  # once a day
    assert len([e for e in store.events("samsungDemo") if e["kind"] == "reset"]) == 1


async def test_revoke_removes_the_copy_and_keeps_usage(tmp_path: Path) -> None:
    sol = make_solution(tmp_path)
    build = demo_builder(FAST)
    acct, _ = await issue(sol, "samsungDemo", build)
    accounts, store = open_stores(sol)
    store.record("samsungDemo", "login")
    store.revoke("samsungDemo")
    accounts.set_disabled(acct.user_id, True)
    wipe_org(sol, solosquad_home(), acct, accounts)
    assert not (sol.orgs_dir / "samsungdemo").exists()
    assert {u.username for u in accounts.users()} == {"samsungdemo"}
    assert store.events("samsungDemo")


def test_the_pace_is_configurable() -> None:
    demo_builder(DemoConfig(step_seconds=6))
    assert Pace.tool_seconds == 3
    demo_builder(FAST)
    assert Pace.tool_seconds == 0


def test_the_cli_the_marketing_admin_calls(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`ssh demo 'solosquad demo issue --id … --inquiry … --company-no … --days 14 --locale …'` ·
    list · extend · revoke · usage — the shape the marketing site's admin script uses."""
    from typer.testing import CliRunner

    from solosquad import cli
    from solosquad.cli import app

    monkeypatch.setattr(cli.console, "width", 200)  # the list table on one line
    sol = make_solution(tmp_path)
    run = CliRunner()
    s = ["-s", str(sol.root)]
    r = run.invoke(app, ["demo", "issue", "--id", "samsungDemo", "--inquiry", "inq-7", *s])
    assert r.exit_code == 1 and "--company-no" in r.output  # the number is required
    r = run.invoke(app, ["demo", "issue", "--id", "samsungDemo", "--inquiry", "inq-7",
                         "--company-no", "12", *s])  # fmt: skip
    assert r.exit_code == 1 and "company number" in r.output
    r = run.invoke(app, ["demo", "issue", "--id", "samsungDemo", "--inquiry", "inq-7",
                         "--company-no", "123-45-67890", "--days", "14", "--locale", "zh-CN",
                         *s])  # fmt: skip
    assert r.exit_code == 0, r.output
    lines = dict(line.split("=", 1) for line in r.output.splitlines() if "=" in line)
    assert lines["demo_id"] == "samsungDemo" and len(lines["password"]) == 16
    assert lines["company_no"] == "1234567890"
    accounts, store = open_stores(sol)
    acct = store.get("samsungDemo")
    assert acct is not None and acct.inquiry_id == "inq-7" and acct.locale == "zh-CN"
    assert acct.company_no == "1234567890"
    assert 13.9 < (acct.expires - time.time()) / 86400 <= 14
    assert accounts.user(acct.user_id).locale == "zh-CN"
    r = run.invoke(app, ["demo", "issue", "--id", "samsungdemo", "--inquiry", "x",
                         "--company-no", "1234567890", *s])  # fmt: skip
    assert r.exit_code == 1  # taken, whatever the case
    r = run.invoke(app, ["demo", "list", *s])
    assert r.exit_code == 0 and "1234567890" in r.output and "company no" in r.output
    r = run.invoke(app, ["demo", "extend", "--id", "samsungDemo", "--days", "30", *s])
    assert r.exit_code == 0, r.output
    got = store.get("samsungDemo")
    assert got is not None and got.expires > acct.expires
    r = run.invoke(app, ["demo", "usage", "--id", "samsungDemo", "--format", "csv", *s])
    assert r.exit_code == 0 and "inq-7" in r.output
    r = run.invoke(app, ["demo", "revoke", "--id", "samsungDemo", *s])
    assert r.exit_code == 0, r.output
    gone = store.get("samsungDemo")
    assert gone is not None and gone.status() == "revoked"
    assert not (sol.orgs_dir / "samsungdemo").exists()


def test_a_scenario_step_goes_through_chief_to_its_agent() -> None:
    job = (
        "[user] [workflow job for researcher] #demo:sourcing.quotes 모아줘\n\n---\nYou are {} in x"
    )
    first = script(job.format("chief"))
    assert first.handoff == ("researcher", "#demo:sourcing.quotes")
    after = job.replace("\n\n---", "\n\n[chief] 넘길게요\n(called transfer_to_researcher)\n\n---")
    assert script(after.format("researcher")).intent == "step:sourcing.quotes"
