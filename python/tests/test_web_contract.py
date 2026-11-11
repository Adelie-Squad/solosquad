"""v2.1.0 slice 4 — the web's contract, declarative screens, language, same-origin serving.

PRD v2.1.0: I6 (pydantic → JSON Schema → TS, no hand-written types) · I30 (screens) ·
I31 (ko · en · zh-CN, per person + org default) · W5 / I2 (engine serves the web).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from company_fixtures import Company, reply
from test_ops_api import Office
from test_web_api import PASSWORD
from test_workflows import LEDGER_CSV

from solosquad.check import validate_solution
from solosquad.cli import _web_dist
from solosquad.runtime import RunStatus
from solosquad.screens import DEFAULTS, WIDGETS, load_screen
from solosquad.web_api import schemas as S
from solosquad.web_api.accounts import Role
from solosquad.web_api.app import CSRF_HEADER, dumps
from solosquad.workflows.tools import finance_pnl

# ---------------------------------------------------------------------- the contract (I6)


def test_committed_schema_matches_the_models(repo_root: Path) -> None:
    committed = repo_root / "web" / "src" / "api" / "schema.json"
    assert committed.is_file(), "run: uv run solosquad web schema -o ../web/src/api/schema.json"
    assert committed.read_text(encoding="utf-8") == S.schema_text(), (
        "web/src/api/schema.json is stale — regenerate it (`solosquad web schema -o …`)"
        " and the TS types (`npm --prefix web run gen:types`)"
    )


def test_every_exported_model_is_a_named_type() -> None:
    schema = S.json_schema()
    assert set(schema["properties"]) == {m.__name__ for m in S.EXPORTED}
    assert set(schema["properties"]) <= set(schema["$defs"])


def test_closed_models_refuse_an_unknown_field() -> None:
    with pytest.raises(ValueError):
        S.conform(S.Version, {"version": "2", "extra": 1})
    card = S.conform(S.ApprovalCard, {"title": "t", "signature": "abc"})
    assert card["signature"] == "abc" and card["category"] == "unclassified"  # cards stay open


def test_pnl_tool_output_fits_the_contract(tmp_path: Path) -> None:
    path = tmp_path / "ledger.csv"
    path.write_text(LEDGER_CSV, encoding="utf-8")
    data = S.PnlData.model_validate(finance_pnl(str(path)))
    assert data.by_month and data.needs_review and data.needs_review[0].row > 1


async def test_engine_events_fit_the_contract(tmp_path: Path) -> None:
    o = Office(tmp_path)
    o.company.scripts["max"] = lambda req: reply("hello")
    await o.manager.start()
    seen: list[dict[str, Any]] = []

    async def collect() -> None:
        async for event in o.manager.subscribe():
            seen.append(event)
            if event["event"] in ("run.completed", "run.failed"):
                return

    reader = asyncio.create_task(collect())
    await asyncio.sleep(0)
    try:
        tid = o.manager.create_thread("t")
        rid = await o.manager.submit(tid, "hi")
        assert (await o.manager.wait(rid, 5))["status"] == RunStatus.SUCCESS
        await asyncio.wait_for(reader, 5)
    finally:
        await o.manager.stop()
    kinds = {e["event"] for e in seen}
    assert {"run.created", "run.started", "run.completed"} <= kinds
    for event in seen:
        S.EngineEvent.model_validate(event)
    state = await o.manager.thread_state(tid)
    typed = S.conform(S.ThreadState, json.loads(dumps(state)))
    assert any(p["kind"] == "text" for m in typed["values"]["messages"] for p in m["parts"])


# ---------------------------------------------------------------------- screens (I30)


async def _boss_and_staff(o: Office, boss: httpx.AsyncClient, kim: httpx.AsyncClient) -> Any:
    return await o.login(boss, "boss", Role.OWNER), await o.login(kim, "kim", Role.STAFF)


async def test_screens_default_org_file_and_errors(tmp_path: Path) -> None:
    o = Office(tmp_path)
    folder = o.company.ctx.org_root / "screens"
    async with o.client() as boss, o.client("203.0.113.9") as kim:
        await _boss_and_staff(o, boss, kim)
        r = (await kim.get("/api/screens/home")).json()
        assert r["source"] == "default" and r["screen"]["format_version"] == 1
        assert r["name"] == "dashboard" and r["screen"]["widgets"][0]["widget"] == "stats"
        folder.mkdir(parents=True)
        (folder / "home.yaml").write_text(
            "format_version: 1\ntitle: 모아 첫 화면\nwidgets:\n"
            "  - {widget: artifact-latest, kind: finance.pnl}\n  - {widget: weather}\n",
            encoding="utf-8",
        )
        r = (await kim.get("/api/screens/home")).json()
        assert r["source"] == "org" and r["screen"]["title"] == "모아 첫 화면"
        assert r["screen"]["widgets"] == [
            {"widget": "artifact-latest", "version": 1, "kind": "finance.pnl"},
            {"widget": "weather", "version": 1},  # unknown → the web draws a placeholder
        ]
        (folder / "home.yaml").write_text("format_version: 2\nwidgets: [{widget: x}]\n")
        r = (await kim.get("/api/screens/home")).json()
        assert r["screen"]["format_version"] == 2  # passed on; the web shows a placeholder
        (folder / "home.yaml").write_text("widgets: nope\n")
        r = (await kim.get("/api/screens/home")).json()
        assert r["screen"] is None and r["error"]
        assert (await kim.get("/api/screens/artifacts")).json()["source"] == "default"
        assert (await kim.get("/api/screens/nothing")).status_code == 404
        assert (await kim.get("/api/screens/..%2Fx")).status_code in (400, 404)


def test_every_default_screen_uses_known_widgets() -> None:
    for name, screen in DEFAULTS.items():
        assert screen.format_version == 1, name
        assert all(w.widget in WIDGETS for w in screen.widgets), name
    assert load_screen(None, "home").source == "default"


def test_validate_checks_screen_files(tmp_path: Path, repo_root: Path) -> None:
    c = Company(tmp_path)
    folder = c.ctx.org_root / "screens"
    folder.mkdir(parents=True)
    (folder / "home.yaml").write_text(
        "format_version: 1\nwidgets: [{widget: weather}, {widget: artifact-latest}]\n"
    )
    (folder / "old.yaml").write_text("format_version: 9\nwidgets: []\n")
    (folder / "broken.yaml").write_text("widgets: 3\n")
    codes = {
        i.code for r in validate_solution(c.ctx.solution_root, repo_root).values() for i in r.issues
    }
    assert {
        "SCREEN_WIDGET_UNKNOWN",
        "SCREEN_WIDGET_PROPS",
        "SCREEN_FORMAT_UNSUPPORTED",
        "SCREEN_INVALID",
    } <= codes


# ---------------------------------------------------------------------- language (I31)


async def test_locale_is_each_persons_own_with_ko_as_the_fixed_default(tmp_path: Path) -> None:
    """2026-11-11: no customer default language. Each person's screen language lives on
    their account (core.db `users.locale`), ko until they choose."""
    o = Office(tmp_path)
    async with o.client() as boss, o.client("203.0.113.9") as kim:
        hb, hk = await _boss_and_staff(o, boss, kim)
        # the company default is gone — no endpoint, no field
        assert (await kim.get("/api/settings")).status_code == 404
        assert (await boss.put("/api/settings", json={"locale": "en"}, headers=hb)).status_code in (
            404,
            405,
        )
        me = (await kim.get("/api/me")).json()
        assert "org_locale" not in me
        assert (me["locale"], me["user"]["locale"]) == ("ko", "ko")  # the fixed default
        me = (await kim.patch("/api/me", json={"locale": "zh-CN"}, headers=hk)).json()
        assert (me["locale"], me["user"]["locale"]) == ("zh-CN", "zh-CN")
        # one person's choice is theirs alone
        assert (await boss.get("/api/me")).json()["locale"] == "ko"
        # there is nothing to "follow" any more: null, "" and unknown languages are refused
        for bad in (None, "", "fr"):
            r = await kim.patch("/api/me", json={"locale": bad}, headers=hk)
            assert (r.status_code, r.json()["code"]) == (400, "locale_invalid"), bad
        assert (await kim.get("/api/me")).json()["locale"] == "zh-CN"
        new = await boss.post(
            "/api/users", json={"username": "lee", "password": PASSWORD}, headers=hb
        )
        assert new.json()["locale"] == "ko"  # a new person starts in Korean
        given = await boss.post(
            "/api/users",
            json={"username": "park", "password": PASSWORD, "locale": "en"},
            headers=hb,
        )
        assert given.json()["locale"] == "en"
        bad = await boss.post(
            "/api/users",
            json={"username": "choi", "password": PASSWORD, "locale": "fr"},
            headers=hb,
        )
        assert (bad.status_code, bad.json()["code"]) == (400, "locale_invalid")
        listed = {u["username"]: u["locale"] for u in (await boss.get("/api/users")).json()}
        assert listed["kim"] == "zh-CN" and listed["lee"] == "ko"


# ---------------------------------------------------------------------- serving (W5 · I2)


def _spa(tmp: Path) -> Path:
    dist = tmp / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>SoloSquad</title><div id=root>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    return dist


async def _get(app: Any, path: str) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 5)),
        base_url="https://office.example",
    ) as c:
        return await c.get(path)


async def test_the_engine_serves_the_web_and_the_api_same_origin(tmp_path: Path) -> None:
    o = Office(tmp_path)
    o.web.rebuild(static_dir=_spa(tmp_path))
    app = o.web.app
    root = await _get(app, "/")
    assert root.status_code == 200 and "SoloSquad" in root.text
    assert "default-src 'self'" in root.headers["content-security-policy"]
    deep = await _get(app, "/o/tesla/w/hq/chat/th-123")  # a client-side route → index.html
    assert deep.status_code == 200 and "SoloSquad" in deep.text
    assert (await _get(app, "/assets/app.js")).text == "console.log(1)"
    assert (await _get(app, "/assets/missing.js")).status_code == 404  # files are not faked
    health = await _get(app, "/api/health")
    assert health.json() == {
        "ok": True,
        "passkeys": False,
        "demo": False,
        "demo_login_url": None,
    }  # no public_url here
    api_miss = await _get(app, "/api/no-such-route")
    assert api_miss.status_code == 404 and "SoloSquad" not in api_miss.text
    # C62 (decision 62): a company server takes no requests or login routes — those are the
    # marketing site's (marketing/)
    for path in ("/api/inquiry", "/api/login/route"):
        assert (await _get(app, path)).status_code == 404
    assert (await _get(app, "/api/me")).status_code == 401


async def test_the_built_web_when_present(tmp_path: Path) -> None:
    dist = _web_dist()
    if dist is None or not (dist / "index.html").is_file():
        pytest.skip("web/dist not built (npm --prefix web run build)")
    o = Office(tmp_path)
    o.web.rebuild(static_dir=dist)
    app = o.web.app
    root = await _get(app, "/")
    assert root.status_code == 200 and '<div id="root">' in root.text
    assert (await _get(app, "/approvals")).text == root.text
    assert (await _get(app, "/manifest.webmanifest")).status_code == 200
    assert (await _get(app, "/api/health")).json()["ok"] is True


def test_csrf_header_name_is_what_the_web_sends(repo_root: Path) -> None:
    client = (repo_root / "web" / "src" / "api" / "client.ts").read_text(encoding="utf-8")
    assert CSRF_HEADER.lower() in client.lower()
