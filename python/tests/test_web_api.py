"""v2.1.0 web core — accounts, second factor, CSRF, roles and the office access policy.

PRD v2.1.0: C12 (access default · IP allow-list) · C14/C15 (owner vs staff) · I18 to I25.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from company_fixtures import Company

from solosquad.check import validate_solution
from solosquad.company import build_company
from solosquad.layout import Solution
from solosquad.runtime import RunManager
from solosquad.runtime.store import RunStore
from solosquad.web_api import totp
from solosquad.web_api.accounts import AccountStore, Role
from solosquad.web_api.app import CSRF_HEADER, SESSION_COOKIE, WebConfig, create_app

PASSWORD = "correct horse battery"
TOKEN = "local-cli-token"


class Office:
    def __init__(self, tmp: Path) -> None:
        self.company = Company(tmp)
        ctx = self.company.ctx
        self.manager = RunManager(
            build_company(self.company.rt), RunStore(ctx.data_dir / "runs.sqlite")
        )
        self.accounts = AccountStore(ctx.data_dir.parent / "accounts.sqlite")
        self.workspace = Solution(ctx.solution_root).org("tesla").workspace("hq")
        self.app = create_app(
            WebConfig(self.manager, self.company.ledger, TOKEN, self.accounts, self.workspace)
        )

    def client(self, ip: str = "203.0.113.5", **headers: str) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app, client=(ip, 50000)),
            base_url="https://office.example",
            headers=headers,
        )


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Office]:
    o = Office(tmp_path)
    await o.manager.start()
    yield o
    await o.manager.stop()


def _secret(uri: str) -> str:
    return parse_qs(urlsplit(uri).query)["secret"][0]


def _next_code(secret: str) -> str:
    # the step after the one used to confirm, so the replay guard accepts it
    return totp.code_at(secret, totp.current_step() + 1)


async def _owner(o: Office, c: httpx.AsyncClient, name: str = "boss") -> tuple[str, str]:
    """Create an owner with an enrolled factor, log in → (csrf, totp secret)."""
    user = o.accounts.create_user(name, PASSWORD, Role.OWNER)
    secret = _secret(o.accounts.begin_totp(user.id))
    assert o.accounts.confirm_totp(user.id, totp.code_at(secret, totp.current_step()))
    r = await c.post(
        "/api/auth/login", json={"username": name, "password": PASSWORD, "otp": _next_code(secret)}
    )
    assert r.status_code == 200, r.text
    return str(r.json()["csrf"]), secret


def test_totp_matches_rfc6238_vectors() -> None:
    # RFC 6238 appendix B, SHA-1 seed "12345678901234567890" — last 6 of the 8-digit codes
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp.code_at(secret, 59 // 30) == "287082"
    assert totp.code_at(secret, 1111111109 // 30) == "081804"
    assert totp.code_at(secret, 2000000000 // 30) == "279037"
    step = totp.verify(secret, "081804", now=1111111109)
    assert step is not None
    assert totp.verify(secret, "081804", now=1111111109, last_step=step) is None  # no replay


async def test_first_login_must_enrol_the_second_factor(office: Office) -> None:
    office.accounts.create_user("boss", PASSWORD, Role.OWNER)
    async with office.client() as c:
        r = await c.post("/api/auth/login", json={"username": "boss", "password": PASSWORD})
        assert r.status_code == 200 and r.json()["stage"] == "enroll"
        csrf = {CSRF_HEADER: r.json()["csrf"]}
        assert (await c.get("/api/threads")).status_code == 403  # only enrolment until done
        uri = (await c.post("/api/auth/totp/begin", headers=csrf)).json()["uri"]
        assert uri.startswith("otpauth://totp/SoloSquad:boss?")
        code = totp.code_at(_secret(uri), totp.current_step())
        assert (
            await c.post("/api/auth/totp/confirm", json={"code": "000000"}, headers=csrf)
        ).status_code == 400
        assert (
            await c.post("/api/auth/totp/confirm", json={"code": code}, headers=csrf)
        ).status_code == 200
        assert (await c.get("/api/threads")).status_code == 200
        # from now on the code is required at login
        await c.post("/api/auth/logout", headers=csrf)
        r = await c.post("/api/auth/login", json={"username": "boss", "password": PASSWORD})
        assert r.status_code == 401 and "one-time code" in r.json()["error"]


async def test_cookie_flags_and_security_headers(office: Office) -> None:
    async with office.client() as c:
        await _owner(office, c)
        r = await c.get("/api/me")
    cookie = r.request.headers.get("cookie", "")
    assert SESSION_COOKIE in cookie
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["strict-transport-security"].startswith("max-age=")
    async with office.client() as c:
        office.accounts.create_user("viewer", PASSWORD, Role.STAFF)
        login = await c.post("/api/auth/login", json={"username": "viewer", "password": PASSWORD})
    set_cookie = login.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "secure" in set_cookie and "samesite=lax" in set_cookie


async def test_writes_need_the_csrf_token(office: Office) -> None:
    async with office.client() as c:
        csrf, _ = await _owner(office, c)
        assert (await c.post("/api/threads", json={"title": "x"})).status_code == 403
        r = await c.post("/api/threads", json={"title": "x"}, headers={CSRF_HEADER: csrf})
        assert r.status_code == 201


async def test_roles_owner_manages_staff_works(office: Office) -> None:
    async with office.client() as boss:
        csrf, _ = await _owner(office, boss)
        h = {CSRF_HEADER: csrf}
        r = await boss.post(
            "/api/users", json={"username": "kim", "password": PASSWORD, "role": "staff"}, headers=h
        )
        assert r.status_code == 201 and r.json()["role"] == "staff"
        staff_id = r.json()["id"]
        assert [u["username"] for u in (await boss.get("/api/users")).json()] == ["boss", "kim"]

    async with office.client("203.0.113.9") as kim:
        r = await kim.post("/api/auth/login", json={"username": "kim", "password": PASSWORD})
        assert r.json()["stage"] == "enroll"  # two_factor is on by default
        h = {CSRF_HEADER: r.json()["csrf"]}
        uri = (await kim.post("/api/auth/totp/begin", headers=h)).json()["uri"]
        await kim.post(
            "/api/auth/totp/confirm",
            json={"code": totp.code_at(_secret(uri), totp.current_step())},
            headers=h,
        )
        assert (await kim.get("/api/threads")).status_code == 200
        tid = (await kim.post("/api/threads", json={"title": "t"}, headers=h)).json()["thread_id"]
        for method, path, body in (
            ("GET", "/api/users", None),
            ("POST", "/api/users", {"username": "x", "password": PASSWORD}),
            ("PATCH", f"/api/users/{staff_id}", {"role": "owner"}),
            ("PUT", "/api/access", {"allowed_networks": []}),
            ("GET", "/api/audit", None),
            ("POST", f"/api/threads/{tid}/resume", {"value": "approved"}),
        ):
            r = await kim.request(method, path, json=body, headers=h)
            assert r.status_code == 403, (method, path, r.text)


async def test_last_owner_is_protected_and_disable_ends_sessions(office: Office) -> None:
    async with office.client() as boss:
        csrf, _ = await _owner(office, boss)
        h = {CSRF_HEADER: csrf}
        me = (await boss.get("/api/me")).json()["user"]["id"]
        assert (
            await boss.patch(f"/api/users/{me}", json={"role": "staff"}, headers=h)
        ).status_code == 400
        staff = office.accounts.create_user("lee", PASSWORD, Role.STAFF)
    async with office.client() as lee:
        await lee.post("/api/auth/login", json={"username": "lee", "password": PASSWORD})
        assert (await lee.get("/api/me")).status_code == 200
        office.accounts.set_disabled(staff.id, True)
        assert (await lee.get("/api/me")).status_code == 401


async def test_access_policy_allow_list(office: Office) -> None:
    async with office.client("203.0.113.5") as boss:
        csrf, _ = await _owner(office, boss)
        h = {CSRF_HEADER: csrf}
        r = await boss.put("/api/access", json={"allowed_networks": ["203.0.113.0/24"]}, headers=h)
        assert r.status_code == 200 and r.json()["allowed_networks"] == ["203.0.113.0/24"]
        assert (await boss.get("/api/threads")).status_code == 200
        assert (
            await boss.put("/api/access", json={"allowed_networks": ["nope"]}, headers=h)
        ).status_code == 400
    # saved to the office's workspace.yaml
    assert office.workspace.config().access.allowed_networks == ["203.0.113.0/24"]
    # outside the list: refused before anything, login included
    async with office.client("198.51.100.7") as outsider:
        assert (await outsider.get("/api/health")).status_code == 403
        r = await outsider.post("/api/auth/login", json={"username": "boss", "password": PASSWORD})
        assert r.status_code == 403
    # through the local reverse proxy, the forwarded address is what counts
    async with office.client("127.0.0.1", **{"x-forwarded-for": "198.51.100.7"}) as proxied:
        assert (await proxied.get("/api/health")).status_code == 403
    async with office.client(
        "127.0.0.1", **{"x-forwarded-for": "10.0.0.1, 203.0.113.44"}
    ) as proxied:
        assert (await proxied.get("/api/health")).status_code == 200
    # a direct loopback peer is the machine itself — not subject to the list
    async with office.client("127.0.0.1") as local:
        assert (await local.get("/api/health")).status_code == 200
    log = office.accounts.audit_log()
    entry = next(e for e in log if e["action"] == "access.update")
    change = json.loads(entry["detail"])  # C14 — the old list and the new one
    assert change["before"]["allowed_networks"] == []
    assert "203.0.113.0/24" in change["after"]["allowed_networks"]
    assert entry["user_id"] and entry["ts"]


async def test_saving_a_list_that_locks_you_out_needs_confirmation(office: Office) -> None:
    async with office.client("198.51.100.7") as boss:
        csrf, _ = await _owner(office, boss)
        h = {CSRF_HEADER: csrf}
        body: dict[str, Any] = {"allowed_networks": ["203.0.113.0/24"]}
        r = await boss.put("/api/access", json=body, headers=h)
        assert r.status_code == 409 and "198.51.100.7" in r.json()["error"]
        assert office.workspace.config().access.allowed_networks == []
        r = await boss.put("/api/access", json={**body, "confirm_lockout": True}, headers=h)
        assert r.status_code == 200
        assert (await boss.get("/api/me")).status_code == 403


async def test_cli_token_only_from_the_machine(office: Office) -> None:
    bearer = {"authorization": f"Bearer {TOKEN}"}
    async with office.client("127.0.0.1", **bearer) as local:
        assert (await local.get("/api/version")).status_code == 200
        assert (await local.post("/api/threads", json={"title": "cli"})).status_code == 201
    async with office.client("203.0.113.5", **bearer) as remote:
        assert (await remote.get("/api/version")).status_code == 401
    async with office.client(
        "127.0.0.1", **{**bearer, "x-forwarded-for": "203.0.113.5"}
    ) as proxied:
        assert (await proxied.get("/api/version")).status_code == 401


async def test_repeated_failures_are_throttled(office: Office) -> None:
    office.accounts.create_user("boss", PASSWORD, Role.OWNER)
    async with office.client() as c:
        for _ in range(10):
            r = await c.post(
                "/api/auth/login", json={"username": "boss", "password": "wrong password"}
            )
            assert r.status_code == 401
        r = await c.post("/api/auth/login", json={"username": "boss", "password": PASSWORD})
        assert r.status_code == 401 and "too many" in r.json()["error"]


def test_validate_flags_an_office_open_without_login(tmp_path: Path, repo_root: Path) -> None:
    c = Company(tmp_path)
    ws = Solution(c.ctx.solution_root).org("tesla").workspace("hq")
    cfg = ws.config()
    ws.save_config(
        cfg.model_copy(update={"access": cfg.access.model_copy(update={"require_login": False})})
    )
    codes = {
        i.code for r in validate_solution(c.ctx.solution_root, repo_root).values() for i in r.issues
    }
    assert "ACCESS_OPEN" in codes
    ws.save_config(
        cfg.model_copy(
            update={"access": cfg.access.model_copy(update={"allowed_networks": ["bad/99"]})}
        )
    )
    codes = {
        i.code for r in validate_solution(c.ctx.solution_root, repo_root).values() for i in r.issues
    }
    assert "ACCESS_NETWORK_INVALID" in codes
