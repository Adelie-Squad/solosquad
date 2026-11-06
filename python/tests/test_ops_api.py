"""v2.1.0 ops API — organisation, approvals, connections with eligibility, budget, replay.

PRD v2.1.0: W9 (I11) · W12 (I10) · W13 (I14) · W4 + decision 45 (I23 · I32) · I9 · C18 · C19.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from company_fixtures import Company, agent_of, reply
from test_web_api import PASSWORD, _next_code, _secret

from solosquad.company import build_company
from solosquad.context.ledger import LedgerEntry
from solosquad.harness.base import SpawnRequest
from solosquad.harness.events import End, Start, TextDelta, ToolResult
from solosquad.harness.guard_hook import MARKER
from solosquad.layout import Solution
from solosquad.routing.connections import load_connections
from solosquad.routing.eligibility import Entity, judge
from solosquad.runtime import RunManager, RunStatus
from solosquad.runtime.store import RunStore
from solosquad.web_api import totp
from solosquad.web_api.accounts import AccountStore, Role
from solosquad.web_api.app import CSRF_HEADER, WebConfig, create_app
from solosquad.web_api.events import EventHub

KR = {"name": "Moa Korea Co.", "country": "KR"}
CN_CONTROLLED = {"name": "Moa Qingdao 3PL", "country": "CN"}


class Office:
    def __init__(self, tmp: Path) -> None:
        self.company = c = Company(tmp)
        self.manager = RunManager(build_company(c.rt), RunStore(c.ctx.data_dir / "runs.sqlite"))
        self.accounts = AccountStore(c.ctx.data_dir.parent / "accounts.sqlite")
        self.workspace = Solution(c.ctx.solution_root).org("tesla").workspace("hq")
        self.conn_file = c.ctx.solution.connections_path
        self.app = create_app(
            WebConfig(
                self.manager,
                c.ledger,
                "tok",
                self.accounts,
                self.workspace,
                resolver=c.rt.resolver,
                router=c.router,
                secrets=c.secrets,
                connections_path=self.conn_file,
                reload_connections=lambda: load_connections(self.conn_file),
            )
        )

    def client(self, ip: str = "203.0.113.5") -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app, client=(ip, 50000)),
            base_url="https://office.example",
        )

    async def login(self, c: httpx.AsyncClient, name: str, role: Role) -> dict[str, str]:
        user = self.accounts.create_user(name, PASSWORD, role)
        secret = _secret(self.accounts.begin_totp(user.id))
        assert self.accounts.confirm_totp(user.id, totp.code_at(secret, totp.current_step()))
        r = await c.post(
            "/api/auth/login",
            json={"username": name, "password": PASSWORD, "otp": _next_code(secret)},
        )
        assert r.status_code == 200, r.text
        return {CSRF_HEADER: r.json()["csrf"]}

    async def login_existing(self, c: httpx.AsyncClient, name: str) -> dict[str, str]:
        """A second session for an existing user — re-enrols the factor (one code per step)."""
        user = next(u for u in self.accounts.users() if u.username == name)
        self.accounts.reset_totp(user.id)
        secret = _secret(self.accounts.begin_totp(user.id))
        assert self.accounts.confirm_totp(user.id, totp.code_at(secret, totp.current_step()))
        r = await c.post(
            "/api/auth/login",
            json={"username": name, "password": PASSWORD, "otp": _next_code(secret)},
        )
        assert r.status_code == 200, r.text
        return {CSRF_HEADER: r.json()["csrf"]}


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Office]:
    o = Office(tmp_path)
    await o.manager.start()
    yield o
    await o.manager.stop()


async def _until(pred: Any, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if await pred():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("condition not reached")


# ---------------------------------------------------------------------- eligibility rules


def test_eligibility_rules() -> None:
    kr = Entity.model_validate(KR)
    cn = Entity.model_validate(CN_CONTROLLED)
    kr_owned_by_cn = Entity(name="Moa Seoul", country="KR", controlled_by="CN")
    assert judge("anthropic", "lite", ["claude-sonnet"], kr, "KR").ok
    assert not judge("anthropic", "lite", [], cn, "KR").ok
    assert not judge("anthropic", "lite", [], kr_owned_by_cn, "KR").ok  # control, not location
    assert not judge("openai", "codex", ["gpt-5"], kr, "HK").ok  # server region
    # an OpenRouter key reaching Anthropic's model is judged as Anthropic
    assert not judge("openrouter", "lite", ["anthropic/claude-sonnet"], cn, "KR").ok
    # Chinese models are not restricted by these rules
    v = judge("openrouter", "lite", ["qwen/qwen3"], cn, "HK")
    assert v.ok
    # unknown entity or server: allowed (validate/doctor surface it)
    assert judge("anthropic", "claude-code", [], None, None).ok
    blocked = judge("anthropic", "claude-code", [], cn, None)
    assert "anthropic.com" in blocked.source and "CN" in blocked.reason


def test_router_skips_an_ineligible_connection(tmp_path: Path) -> None:
    c = Company(tmp_path)
    c.connections[0].entity = Entity.model_validate(CN_CONTROLLED)
    c.connections[0].provider = "anthropic"
    names = [conn.id for conn, _ in c.router.candidates("chief")]
    assert "max" not in names and "router" in names


# ---------------------------------------------------------------------- organisation


async def test_teams_and_who_is_working(office: Office) -> None:
    c = office.company
    for conn in c.connections:
        c._factory(conn, c.secrets).delay_s = 0.2  # type: ignore[attr-defined]
    async with office.client() as web:
        h = await office.login(web, "boss", Role.OWNER)
        teams = {t["name"]: t for t in (await web.get("/api/teams")).json()}
        assert teams["product"] == {"name": "product", "main": None, "members": ["pm", "engineer"]}
        agents = {a["name"]: a for a in (await web.get("/api/agents")).json()}
        assert set(agents) == {"chief", "pm", "engineer"}
        assert agents["engineer"]["team"] == "product" and agents["chief"]["layer"] == "package"
        tid = (await web.post("/api/threads", json={"title": "launch"}, headers=h)).json()[
            "thread_id"
        ]
        await web.post(f"/api/threads/{tid}/runs", json={"input": "hello"}, headers=h)

        async def chief_busy() -> bool:
            now = {a["name"]: a for a in (await web.get("/api/agents")).json()}
            return bool(now["chief"]["working_on"])

        await _until(chief_busy)
        busy = {a["name"]: a for a in (await web.get("/api/agents")).json()}["chief"]["working_on"]
        assert busy[0]["thread_id"] == tid and busy[0]["title"] == "launch"


# ---------------------------------------------------------------------- approvals · since


async def test_approval_card_and_approver(office: Office) -> None:
    def script(req: SpawnRequest) -> list[Any]:
        if agent_of(req) == "chief" and "(approved by owner" not in req.prompt:
            return [
                Start(),
                TextDelta("cleaning"),
                ToolResult("t", f"{MARKER}:abc123:recursive delete"),
                End("end_turn"),
            ]
        return reply("done")

    office.company.scripts["max"] = script
    async with office.client() as web:
        h = await office.login(web, "boss", Role.OWNER)
        started = time.time()
        tid = (await web.post("/api/threads", json={"title": "tidy"}, headers=h)).json()[
            "thread_id"
        ]
        rid = (
            await web.post(f"/api/threads/{tid}/runs", json={"input": "tidy up"}, headers=h)
        ).json()["run_id"]

        async def waiting() -> bool:
            return (await web.get(f"/api/runs/{rid}")).json()["status"] == RunStatus.INTERRUPTED

        await _until(waiting)
        card = (await web.get(f"/api/runs/{rid}")).json()["interrupts"][0]["value"]
        assert {k: card[k] for k in ("kind", "options", "risk")} == {
            "kind": "approval", "options": ["approved", "declined"], "risk": "high"
        }  # fmt: skip
        assert card["title"] and card["summary"] == "recursive delete"
        resume = (
            await web.post(f"/api/threads/{tid}/resume", json={"value": "approved"}, headers=h)
        ).json()
        run = (await web.get(f"/api/runs/{resume['run_id']}")).json()
        assert run["source"] == "user:boss"
        assert any(e["action"] == "approval" for e in office.accounts.audit_log())
        recent = (await web.get("/api/runs", params={"since": str(started)})).json()
        assert {r["id"] for r in recent} >= {rid, resume["run_id"]}
        future = (await web.get("/api/runs", params={"since": str(time.time() + 60)})).json()
        assert future == []


# ---------------------------------------------------------------------- connections · budget


async def test_connections_record_the_entity_and_refuse_ineligible(office: Office) -> None:
    async with office.client() as web:
        h = await office.login(web, "boss", Role.OWNER)
        bad = {
            "id": "claude-cn",
            "provider": "anthropic",
            "harness": "lite",
            "models": ["claude-sonnet"],
            "entity": CN_CONTROLLED,
        }
        # C18 — an API key that reaches a provider is not saved without its holder
        nameless = {k: v for k, v in bad.items() if k != "entity"}
        r = await web.post("/api/connections", json=nameless, headers=h)
        assert r.status_code == 400 and "entity that holds" in r.json()["error"]
        assert not office.conn_file.exists() or "claude-cn" not in office.conn_file.read_text()
        r = await web.post("/api/connections", json=bad, headers=h)
        assert r.status_code == 422 and "anthropic.com" in r.json()["error"]
        good = {
            **bad,
            "id": "claude-kr",
            "entity": KR,
            "secret": "sk-ant-1234567890abcd",
            "secret_env": "ANTHROPIC_API_KEY",
        }
        r = await web.post("/api/connections", json=good, headers=h)
        assert r.status_code == 201, r.text
        assert r.json()["secret_last4"] == "abcd" and r.json()["eligible"] is True
        assert "sk-ant" not in office.conn_file.read_text()
        assert [c.id for c in office.company.router.connections] == ["claude-kr"]  # routing sees it
        r = await web.patch("/api/connections/claude-kr", json={"entity": None}, headers=h)
        assert r.status_code == 400  # nor can the holder be erased afterwards
        # the server moves to Hong Kong: the same connection is now ineligible, and says why
        office.workspace.org.solution.update_server_country("HK")
        listed = {c["id"]: c for c in (await web.get("/api/connections")).json()}
        assert (
            listed["claude-kr"]["eligible"] is False
            and "HK" in listed["claude-kr"]["eligibility_reason"]
        )
        office.workspace.org.solution.update_server_country(None)
        r = await web.patch("/api/connections/claude-kr", json={"active": False}, headers=h)
        assert r.status_code == 200 and r.json()["active"] is False
        assert (await web.delete("/api/connections/claude-kr", headers=h)).status_code == 200
        assert office.company.secrets.get("conn:claude-kr") is None
    async with office.client("203.0.113.9") as staff:
        hs = await office.login(staff, "kim", Role.STAFF)
        assert (await staff.get("/api/connections")).status_code == 200
        r = await staff.post("/api/connections", json={**good, "id": "x"}, headers=hs)
        assert r.status_code == 403


async def test_budget_reports_month_spend_and_warnings(office: Office) -> None:
    async with office.client() as web:
        h = await office.login(web, "boss", Role.OWNER)
        body = {
            "id": "kimi",
            "provider": "moonshot",
            "harness": "lite",
            "models": ["kimi-k2"],
            "monthly_budget_usd": 10.0,
        }
        assert (await web.post("/api/connections", json=body, headers=h)).status_code == 201
        office.company.ledger.record(
            LedgerEntry(thread_id="t", org="tesla", workspace="hq", agent="chief", connection_id="kimi",
                        harness="lite", model="kimi-k2", input_tokens=10, output_tokens=5, cost_usd=8.5)
        )  # fmt: skip
        data = (await web.get("/api/budget")).json()
        row = next(r for r in data["connections"] if r["id"] == "kimi")
        assert row["spent_usd"] == 8.5 and row["remaining_usd"] == 1.5
        assert row["warning"] is True and row["exhausted"] is False
        assert data["org"]["spent_usd"] >= 8.5 and data["warn_at"] == 0.8


# ---------------------------------------------------------------------- event replay


async def test_event_hub_replays_what_a_reconnecting_client_missed(office: Office) -> None:
    hub = EventHub(office.manager, size=3)
    await hub.ensure_started()
    for i in range(5):
        office.manager._publish({"event": "tick", "n": i})
    await asyncio.sleep(0.05)
    assert [item[0] for item in hub.buffer] == [3, 4, 5]  # only the last 3 are kept

    async def take(last_id: int, n: int) -> list[int]:
        got: list[int] = []
        async for seq, _event in hub.subscribe(last_id):
            got.append(seq)
            if len(got) == n:
                break
        return got

    assert await take(3, 2) == [4, 5]  # missed 4 and 5
    reader = asyncio.create_task(take(5, 1))
    await asyncio.sleep(0.02)
    office.manager._publish({"event": "tick", "n": 5})
    assert await asyncio.wait_for(reader, 2) == [6]  # then live, no duplicates
    await hub.stop()
