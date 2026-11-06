"""One customer account, scopes in the address (decision 57 · PRD v2.1.0 I40 · I22 · K48).

C3  — two orgs, the owner and a staff member of Tesla only: the staff member's switcher
      lists Tesla only, and **every** scoped API called with SpaceX's scope is a 404 that
      reads exactly like a scope that does not exist.
C30 — a staff member of one workspace: the org's other workspace is a 404 too, and a
      change of assignment holds from the very next request.
C31 — one server, two orgs, three workspaces through the web: nothing crosses scopes, and
      a failing runtime does not stop the others.
C32 — a rev6 data folder moved to core.db: the same password, one-time code and passkey
      still sign in, with the same role in the same org.

The sweep walks `route_table(app)` — a route added later is covered on its own.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from engine_fixtures import Customer, make_customer
from rev6_fixtures import write_rev6_org_db
from soft_authenticator import SoftAuthenticator, b64u
from web_fixtures import plain_client

from solosquad.engine_server import start_engine, stop_engine
from solosquad.runtime import RunStatus
from solosquad.web_api import totp
from solosquad.web_api.accounts import Assignment, Role
from solosquad.web_api.app import (
    CSRF_HEADER,
    NOT_FOUND_BODY,
    AppConfig,
    create_app,
    route_table,
)
from solosquad.web_api.org_store import org_path

PASSWORD = "correct horse battery"
SCOPED = ("org", "workspace")


class Web:
    def __init__(self, customer: Customer) -> None:
        self.customer = customer
        self.engine = customer.engine
        self.config = AppConfig.for_engine(self.engine, "tok")
        self.app = create_app(self.config)

    def client(self, ip: str = "203.0.113.5") -> httpx.AsyncClient:
        return plain_client(self.app, ip)

    async def login(
        self,
        c: httpx.AsyncClient,
        name: str,
        role: Role = Role.STAFF,
        assignments: list[Assignment] | None = None,
    ) -> dict[str, str]:
        store = self.engine.accounts
        user = store.create_user(name, PASSWORD, role, assignments=assignments)
        secret = parse_qs(urlsplit(store.begin_totp(user.id)).query)["secret"][0]
        assert store.confirm_totp(user.id, totp.code_at(secret, totp.current_step()))
        r = await c.post(
            "/api/auth/login",
            json={"username": name, "password": PASSWORD,
                  "otp": totp.code_at(secret, totp.current_step() + 1)},
        )  # fmt: skip
        assert r.status_code == 200, r.text
        return {CSRF_HEADER: r.json()["csrf"]}


@pytest.fixture
async def web(tmp_path: Path) -> AsyncIterator[Web]:
    w = Web(Customer(tmp_path))
    await start_engine(w.engine)
    yield w
    await stop_engine(w.engine)


def fill(template: str, org: str, ws: str) -> str:
    """A concrete path for a route template — ids that do not exist are fine: the gate
    answers before any handler looks."""
    path = template.replace("{org}", org).replace("{ws}", ws)
    return re.sub(r"\{[^}]+\}", "x-1", path)


def scoped_routes(app: Any) -> list[tuple[str, str, str]]:
    """(level, method, template) for every org and workspace route of the app."""
    rows = [
        (info.level, method, info.path)
        for info in route_table(app)
        if info.level in SCOPED
        for method in sorted(info.methods)
    ]
    assert len(rows) > 30  # the table really was walked
    return rows


async def call(c: httpx.AsyncClient, method: str, path: str, h: dict[str, str]) -> httpx.Response:
    return await c.request(method, path, json={} if method != "GET" else None, headers=h)


def scope_names(me: dict[str, Any]) -> dict[str, list[str]]:
    return {s["org"]: [w["name"] for w in s["workspaces"]] for s in me["scopes"]}


# ---------------------------------------------------------------------- C3


async def test_c3_staff_of_one_org_sees_nothing_of_the_other(web: Web) -> None:
    async with web.client() as boss, web.client("203.0.113.9") as kim:
        hb = await web.login(boss, "elon", Role.OWNER)
        hk = await web.login(kim, "kim", assignments=[Assignment("tesla", None, Role.STAFF)])

        me_boss = (await boss.get("/api/me")).json()
        assert scope_names(me_boss) == {"spacex": ["rocket"], "tesla": ["cars", "charging"]}
        assert {s["org"]: s["role"] for s in me_boss["scopes"]} == {
            "spacex": "owner", "tesla": "owner"
        }  # fmt: skip  # the customer's owner leads every org
        me_kim = (await kim.get("/api/me")).json()
        assert scope_names(me_kim) == {"tesla": ["cars", "charging"]}
        assert me_kim["scopes"][0]["whole_org"] is True and me_kim["scopes"][0]["role"] == "staff"
        assert me_kim["last_scope"] == {"org": "tesla", "workspace": "cars"}  # first one

        # every scoped route, every method, called with SpaceX's scope: all 404, and the
        # answer is the same as for a scope that is not there at all
        for level, method, template in scoped_routes(web.app):
            foreign = await call(kim, method, fill(template, "spacex", "rocket"), hk)
            missing = await call(kim, method, fill(template, "no-such-org", "rocket"), hk)
            assert foreign.status_code == 404, (level, method, template, foreign.text)
            assert foreign.json() == missing.json() == NOT_FOUND_BODY, template
            assert foreign.headers["content-length"] == missing.headers["content-length"]

        # inside Tesla kim works; the owner reaches SpaceX
        assert (await kim.get("/api/o/tesla/w/cars/threads")).status_code == 200
        assert (await kim.get("/api/o/tesla/org-chart")).status_code == 200
        assert (await boss.get("/api/o/spacex/w/rocket/threads")).status_code == 200
        assert (await boss.get("/api/o/spacex/agents")).status_code == 200
        # the customer level stays the customer's: staff cannot manage people there
        assert (await kim.get("/api/users")).status_code == 403
        assert hb


async def test_unauthenticated_requests_never_learn_a_scope_exists(web: Web) -> None:
    async with web.client() as anon:
        for _level, method, template in scoped_routes(web.app):
            real = await call(anon, method, fill(template, "tesla", "cars"), {})
            fake = await call(anon, method, fill(template, "nope", "nope"), {})
            assert real.status_code == fake.status_code == 401, template


# ---------------------------------------------------------------------- C30


async def test_c30_a_workspace_assignment_is_that_workspace_only(web: Web) -> None:
    async with web.client() as boss, web.client("203.0.113.9") as lee:
        hb = await web.login(boss, "elon", Role.OWNER)
        hl = await web.login(lee, "lee", assignments=[Assignment("tesla", "charging", Role.STAFF)])
        me = (await lee.get("/api/me")).json()
        assert scope_names(me) == {"tesla": ["charging"]}
        assert me["scopes"][0]["whole_org"] is False
        assert me["last_scope"] == {"org": "tesla", "workspace": "charging"}

        for level, method, template in scoped_routes(web.app):
            if level == "workspace":  # the same org's other workspace
                r = await call(lee, method, fill(template, "tesla", "cars"), hl)
                assert r.status_code == 404 and r.json() == NOT_FOUND_BODY, template
            r = await call(lee, method, fill(template, "spacex", "rocket"), hl)
            assert r.status_code == 404 and r.json() == NOT_FOUND_BODY, template
        assert (await lee.get("/api/o/tesla/w/charging/threads")).status_code == 200
        assert (await lee.get("/api/o/tesla/teams")).status_code == 200  # the org it works in

        # the owner moves lee to cars: the next request already follows it
        uid = me["user"]["id"]
        r = await boss.patch(
            f"/api/users/{uid}",
            json={"assignments": [{"org": "tesla", "workspace": "cars", "role": "staff"}]},
            headers=hb,
        )
        assert r.status_code == 200, r.text
        assert r.json()["assignments"] == [{"org": "tesla", "workspace": "cars", "role": "staff"}]
        assert (await lee.get("/api/o/tesla/w/charging/threads")).status_code == 404
        assert (await lee.get("/api/o/tesla/w/cars/threads")).status_code == 200
        me = (await lee.get("/api/me")).json()
        assert me["last_scope"] == {"org": "tesla", "workspace": "cars"}
        # and nothing at all: even the org is gone
        await boss.patch(f"/api/users/{uid}", json={"assignments": []}, headers=hb)
        assert (await lee.get("/api/o/tesla/teams")).status_code == 404
        assert (await lee.get("/api/me")).json()["scopes"] == []


async def test_roles_and_approval_rights_follow_the_requested_org(web: Web) -> None:
    async with web.client() as kim:
        hk = await web.login(
            kim,
            "kim",
            assignments=[
                Assignment("tesla", None, Role.OWNER),
                Assignment("spacex", "rocket", Role.STAFF),
            ],
        )
        tiers = {"tiers": {"review": "owner"}}
        assert (
            await kim.put("/api/o/tesla/approval-policy", json=tiers, headers=hk)
        ).status_code == 200
        assert (
            await kim.put("/api/o/spacex/approval-policy", json=tiers, headers=hk)
        ).status_code == 403
        assert (await kim.get("/api/o/tesla/audit")).status_code == 200  # org owner
        assert (await kim.get("/api/o/spacex/audit")).status_code == 403
        assert (await kim.get("/api/audit")).status_code == 403  # not the customer's owner
        me = (await kim.get("/api/me")).json()
        assert {s["org"]: s["role"] for s in me["scopes"]} == {"spacex": "staff", "tesla": "owner"}


async def test_the_last_scope_is_remembered(web: Web) -> None:
    async with web.client() as boss:
        await web.login(boss, "elon", Role.OWNER)
        assert (await boss.get("/api/o/spacex/w/rocket/threads")).status_code == 200
        assert (await boss.get("/api/me")).json()["last_scope"] == {
            "org": "spacex", "workspace": "rocket"
        }  # fmt: skip
        uid = (await boss.get("/api/me")).json()["user"]["id"]
        assert web.engine.accounts.last_scope(uid) == ("spacex", "rocket")  # kept in core.db


async def test_a_workspace_open_only_to_its_network(web: Web) -> None:
    async with web.client() as boss:
        hb = await web.login(boss, "elon", Role.OWNER)
        limit = {"allowed_networks": ["10.0.0.0/8"]}
        r = await boss.put("/api/o/tesla/w/charging/access", json=limit, headers=hb)
        assert r.status_code == 409  # it would lock the owner out of that workspace (K28)
        r = await boss.put(
            "/api/o/tesla/w/charging/access", json={**limit, "confirm_lockout": True}, headers=hb
        )
        assert r.status_code == 200
        blocked = await boss.get("/api/o/tesla/w/charging/threads")
        assert blocked.status_code == 403 and "networks" in blocked.json()["error"]  # C4
        assert blocked.json()["code"] == "workspace_network_blocked"
        assert (await boss.get("/api/o/tesla/w/cars/threads")).status_code == 200
        assert (await boss.get("/api/me")).status_code == 200  # the session itself is fine
    async with web.client("10.1.2.3") as inside:
        await web.login(inside, "kim", assignments=[Assignment("tesla", None, Role.STAFF)])
        assert (await inside.get("/api/o/tesla/w/charging/threads")).status_code == 200


# ---------------------------------------------------------------------- C31


async def test_c31_three_workspaces_on_one_server_stay_apart(web: Web) -> None:
    async with web.client() as boss:
        hb = await web.login(boss, "elon", Role.OWNER)
        runs: dict[str, str] = {}
        for scope, text in (("tesla/cars", "hello"), ("tesla/charging", "hello"),
                            ("spacex/rocket", "boom")):  # fmt: skip
            org, ws = scope.split("/")
            base = f"/api/o/{org}/w/{ws}"
            tid = (await boss.post(f"{base}/threads", json={"title": scope}, headers=hb)).json()[
                "thread_id"
            ]
            r = await boss.post(f"{base}/threads/{tid}/runs", json={"input": text}, headers=hb)
            runs[scope] = r.json()["run_id"]

        async def status(scope: str) -> str:
            org, ws = scope.split("/")
            return str((await boss.get(f"/api/o/{org}/w/{ws}/runs/{runs[scope]}")).json()["status"])

        for _ in range(250):
            if all(s in ("success", "error") for s in [await status(x) for x in runs]):
                break
            await asyncio.sleep(0.02)
        assert await status("spacex/rocket") == RunStatus.ERROR  # injected failure
        assert await status("tesla/cars") == await status("tesla/charging") == RunStatus.SUCCESS
        for scope in runs:
            org, ws = scope.split("/")
            listed = (await boss.get(f"/api/o/{org}/w/{ws}/threads")).json()
            assert [t["title"] for t in listed] == [scope]  # only its own
            others = {s for s in runs if s != scope}
            for other in others:  # another workspace's run id is not found here
                r = await boss.get(f"/api/o/{org}/w/{ws}/runs/{runs[other]}")
                assert r.status_code == 404
        ledger = (await boss.get("/api/o/tesla/w/cars/ledger", params={"by": "workspace"})).json()
        assert set(ledger) == {"cars"}
        # the failing workspace keeps working afterwards
        tid = (await boss.post("/api/o/spacex/w/rocket/threads", json={}, headers=hb)).json()[
            "thread_id"
        ]
        rid = (
            await boss.post(
                f"/api/o/spacex/w/rocket/threads/{tid}/runs", json={"input": "hi"}, headers=hb
            )
        ).json()["run_id"]
        mgr = web.engine.runtimes[("spacex", "rocket")].manager
        assert (await mgr.wait(rid, 5))["status"] == RunStatus.SUCCESS


async def test_c31_a_workspace_that_did_not_start(tmp_path: Path) -> None:
    sol = make_customer(tmp_path)
    (sol.org("tesla").workspace("charging").root / "workspace.yaml").write_text(
        "schema_version: 1\nname: charging\ntimezone: [broken]\n", encoding="utf-8"
    )
    web = Web(Customer(tmp_path, sol))
    await start_engine(web.engine)
    try:
        async with web.client() as boss, web.client("203.0.113.9") as kim:
            await web.login(boss, "elon", Role.OWNER)
            await web.login(kim, "kim", assignments=[Assignment("spacex", None, Role.STAFF)])
            down = await boss.get("/api/o/tesla/w/charging/threads")
            assert down.status_code == 503  # its people learn it did not start
            assert down.json()["code"] == "workspace_not_started"
            assert (await kim.get("/api/o/tesla/w/charging/threads")).status_code == 404
            assert (await boss.get("/api/o/tesla/w/cars/threads")).status_code == 200
            me = (await boss.get("/api/me")).json()
            tesla = next(s for s in me["scopes"] if s["org"] == "tesla")
            assert {w["name"]: w["running"] for w in tesla["workspaces"]} == {
                "cars": True, "charging": False
            }  # fmt: skip
    finally:
        await stop_engine(web.engine)


# ---------------------------------------------------------------------- C32 through the web


async def test_c32_rev6_logins_still_work_after_the_move(tmp_path: Path) -> None:
    sol = make_customer(tmp_path)
    phone = SoftAuthenticator()
    old = write_rev6_org_db(
        org_path(sol, "tesla"), passkey=(b64u(phone.credential_id), phone._cose_key(), 0)
    )
    phone.user_handle = old.staff_id.encode()
    sol.update_server_config(public_url="https://office.example")
    web = Web(Customer(tmp_path, sol))  # the first start moves the accounts
    async with web.client() as boss:
        code = totp.code_at(old.owner_secret, totp.current_step())
        r = await boss.post(
            "/api/auth/login", json={"username": "boss", "password": PASSWORD, "otp": code}
        )
        assert r.status_code == 200, r.text
        assert {s["org"]: s["role"] for s in r.json()["scopes"]} == {
            "spacex": "owner", "tesla": "owner"
        }  # fmt: skip  # the rev6 owner is the customer's owner
    async with web.client("203.0.113.9") as kim:
        begin = (await kim.post("/api/auth/passkey/login/begin", json={})).json()
        cred = phone.get(begin["options"], "https://office.example", rp_id="office.example")
        r = await kim.post(
            "/api/auth/passkey/login/finish",
            json={"challenge_id": begin["challenge_id"], "credential": cred},
        )
        assert r.status_code == 200, r.text
        assert scope_names(r.json()) == {"tesla": ["cars", "charging"]}  # same org, same role
        assert r.json()["scopes"][0]["role"] == "staff"
        people = (await kim.get("/api/o/tesla/people")).json()
        assert {p["username"]: (p["title"], p["teams"]) for p in people}["kim"] == (
            "MD", ["product"]
        )  # fmt: skip
        assert (await kim.get("/api/o/spacex/people")).status_code == 404
