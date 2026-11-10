"""The API's error codes and the security sweeps (PRD v2.1.0 §6 · §7 C2 · C12 · C13 · C15).

Every sweep walks the app's own tables — `route_table(app)` for the routes, `ROUTE_ROLES`
for the roles — so a route or a role key added later is covered without anyone
remembering to add it here; a route nobody classified fails the classification test.

- C2 · C12 — without a session every API route but the explicit public ones answers 401,
  from the machine itself and from an outside address, and says nothing else.
- C13 — a forwarded address is believed only from the local proxy (`test_web_api.py`
  `test_access_policy_allow_list` has the outside-peer forgery; here the whole table).
- C15 — every owner-only key of `ROUTE_ROLES` refuses staff (403 `role_forbidden`), the
  budget change included; every key open to everyone lets staff through the role check.
"""

from __future__ import annotations

import ast
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from test_ops_api import Office

from solosquad.web_api import errors
from solosquad.web_api.accounts import Role
from solosquad.web_api.app import NOT_FOUND_BODY, OWNER, ROUTE_ROLES, route_table
from solosquad.web_api.errors import ErrorCode

WEB_API = Path(errors.__file__).parent

PUBLIC = {
    ("GET", "/api/health"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/passkey/login/begin"),
    ("POST", "/api/auth/passkey/login/finish"),
}
"""Answer without a session — the gate's network check still applies to them."""

SELF = {
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/totp/begin"),
    ("POST", "/api/auth/totp/confirm"),
    ("POST", "/api/auth/passkey/register/begin"),
    ("POST", "/api/auth/passkey/register/finish"),
    ("GET", "/api/me"),
    ("PATCH", "/api/me"),
    ("GET", "/api/me/passkeys"),
    ("DELETE", "/api/me/passkeys/{pid}"),
    ("GET", "/api/version"),
}
"""A person's own session and factors — any signed-in person, no role key."""

CUST, ORG, WS = "/api", "/api/o/{org}", "/api/o/{org}/w/{ws}"
KEYS: dict[str, tuple[str, str, dict[str, Any] | None]] = {
    # customer
    "users.list": ("GET", f"{CUST}/users", None),
    "users.create": ("POST", f"{CUST}/users", {"username": "x", "password": "long enough pw"}),
    "users.update": ("PATCH", f"{CUST}/users/{{uid}}", {"role": "owner"}),
    "access.get": ("GET", f"{CUST}/access", None),
    "access.update": ("PUT", f"{CUST}/access", {"allowed_networks": []}),
    "audit": ("GET", f"{CUST}/audit", None),
    "settings.get": ("GET", f"{CUST}/settings", None),
    "settings.update": ("PUT", f"{CUST}/settings", {"locale": "en"}),
    "profile.get": ("GET", f"{CUST}/profile", None),
    "profile.update": ("PUT", f"{CUST}/profile", {}),
    "snapshot.get": ("GET", f"{CUST}/snapshot", None),
    "snapshot.update": ("PUT", f"{CUST}/snapshot", {"type": None}),
    "snapshot.run": ("POST", f"{CUST}/snapshot/run", None),
    "calendar.list": ("GET", f"{CUST}/calendar/items", None),
    "calendar.create": ("POST", f"{CUST}/calendar/items", {"kind": "work", "org": "tesla"}),
    "calendar.get": ("GET", f"{CUST}/calendar/items/{{iid}}", None),
    "calendar.update": ("PATCH", f"{CUST}/calendar/items/{{iid}}", {"title": "t"}),
    "calendar.delete": ("DELETE", f"{CUST}/calendar/items/{{iid}}", None),
    "calendar.todos.create": ("POST", f"{CUST}/calendar/items/{{iid}}/todos", {"title": "t"}),
    "calendar.todos.update": ("PATCH", f"{CUST}/calendar/todos/{{tid}}", {"done": True}),
    "calendar.todos.delete": ("DELETE", f"{CUST}/calendar/todos/{{tid}}", None),
    "calendar.labels.list": ("GET", f"{CUST}/calendar/labels", None),
    "calendar.labels.create": ("POST", f"{CUST}/calendar/labels", {"type": "tag"}),
    "calendar.labels.update": ("PATCH", f"{CUST}/calendar/labels/{{lid}}", {"name": "n"}),
    "calendar.reorder": ("POST", f"{CUST}/calendar/reorder", {"type": "items", "ids": []}),
    "calendar.agent_access.get": ("GET", f"{CUST}/calendar/agent-access", None),
    "calendar.agent_access.update": ("PUT", f"{CUST}/calendar/agent-access", {"level": "off"}),
    "calendar.agent_view": ("GET", f"{CUST}/calendar/agent-view", None),
    "calendar.events": ("GET", f"{CUST}/calendar/events", None),
    "digest.get": ("GET", f"{CUST}/me/digest", None),
    "digest.ack": ("POST", f"{CUST}/me/digest/ack", {}),
    # org
    "org_chart": ("GET", f"{ORG}/org-chart", None),
    "people.list": ("GET", f"{ORG}/people", None),
    "people.update": ("PATCH", f"{ORG}/people/{{uid}}", {"title": "boss"}),
    "org_audit": ("GET", f"{ORG}/audit", None),
    "teams": ("GET", f"{ORG}/teams", None),
    "agents": ("GET", f"{ORG}/agents", None),
    "connections.list": ("GET", f"{ORG}/connections", None),
    "connections.create": ("POST", f"{ORG}/connections", {"id": "mine", "kind": "local_llm"}),
    "connections.update": ("PATCH", f"{ORG}/connections/{{cid}}", {"monthly_budget_usd": 9999}),
    "connections.delete": ("DELETE", f"{ORG}/connections/{{cid}}", None),
    "workflows.list": ("GET", f"{ORG}/workflows", None),
    "workflows.update": ("PATCH", f"{ORG}/workflows/{{name}}", {"enabled": False}),
    "approval_policy.get": ("GET", f"{ORG}/approval-policy", None),
    "approval_policy.update": ("PUT", f"{ORG}/approval-policy", {"tiers": {"review": "team"}}),
    "screens": ("GET", f"{ORG}/screens/{{name}}", None),
    # workspace
    "threads.list": ("GET", f"{WS}/threads", None),
    "threads.create": ("POST", f"{WS}/threads", {"title": "t"}),
    "threads.state": ("GET", f"{WS}/threads/{{tid}}/state", None),
    "threads.run": ("POST", f"{WS}/threads/{{tid}}/runs", {"input": "hi"}),
    "threads.resume": ("POST", f"{WS}/threads/{{tid}}/resume", {"value": "approved"}),
    "runs.list": ("GET", f"{WS}/runs", None),
    "runs.get": ("GET", f"{WS}/runs/{{rid}}", None),
    "ledger": ("GET", f"{WS}/ledger", None),
    "events": ("GET", f"{WS}/events", None),
    "budget": ("GET", f"{WS}/budget", None),
    "workflows.run": ("POST", f"{WS}/workflows/{{name}}/run", {"inputs": {}}),
    "workflows.approve": ("POST", f"{WS}/workflow-threads/{{tid}}/resume", {"value": "ok"}),
    "approvals.list": ("GET", f"{WS}/approvals", None),
    "uploads.list": ("GET", f"{WS}/uploads", None),
    "uploads.create": ("POST", f"{WS}/uploads", None),
    "artifacts.list": ("GET", f"{WS}/artifacts", None),
    "artifacts.review": ("POST", f"{WS}/artifacts/{{aid}}/review", None),
    "ws_access.get": ("GET", f"{WS}/access", None),
    "ws_access.update": ("PUT", f"{WS}/access", {"allowed_networks": []}),
    "working": ("GET", f"{WS}/agents", None),
    "schedules.list": ("GET", f"{WS}/schedules", None),
    "work.list": ("GET", f"{WS}/work", None),
}
"""Each role key → one route that checks it (`need(request, key)`). Other routes check the
same key too (`workflows.list` guards the run lists), see `ALSO`."""

ALSO: dict[tuple[str, str], str] = {
    ("GET", f"{WS}/workflows"): "workflows.list",
    ("GET", f"{WS}/workflow-runs"): "workflows.list",
    ("GET", f"{WS}/workflow-runs/{{rid}}"): "workflows.list",
    ("GET", f"{WS}/workflow-threads/{{tid}}/state"): "workflows.list",
    ("GET", f"{WS}/artifacts/{{aid}}"): "artifacts.list",
}


def _routes(app: Any) -> set[tuple[str, str]]:
    return {(m, info.path) for info in route_table(app) for m in info.methods}


def _fill(template: str, **ids: str) -> str:
    path = template.replace("{org}", "tesla").replace("{ws}", "hq")
    for name, value in ids.items():
        path = path.replace("{" + name + "}", value)
    return re.sub(r"\{[^}]+\}", "x-1", path)


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Office]:
    o = Office(tmp_path)
    await o.manager.start()
    yield o
    await o.manager.stop()


# ---------------------------------------------------------------------- error codes


def _raises(tree: ast.AST) -> list[tuple[int, str, ast.Call]]:
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
            func = node.exc.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
            out.append((node.lineno, name, node.exc))
    return out


def test_every_error_the_web_api_raises_carries_a_code() -> None:
    """No bare `HTTPException` / `ValueError` / `TypeError` in the web API — each goes out
    through `ApiError` (or `CodedError` / `AuthError` in a store the CLI shares) with an
    `ErrorCode` member. A `KeyError` always answers `not_found`, so it stays allowed."""
    found = 0
    for path in sorted(WEB_API.glob("*.py")):
        for line, name, call in _raises(ast.parse(path.read_text(encoding="utf-8"))):
            where = f"{path.name}:{line}"
            assert name not in ("HTTPException", "ValueError", "TypeError"), where
            if name in ("ApiError", "CodedError", "AuthError"):
                found += 1
                arg = call.args[1] if name == "ApiError" else call.args[0]
                coded = (
                    isinstance(arg, ast.Attribute)
                    and isinstance(arg.value, ast.Name)
                    and arg.value.id in ("E", "ErrorCode")
                ) or ast.unparse(arg) == "e.code"
                assert coded, f"{where}: {ast.unparse(arg)} is not an ErrorCode member"
    assert found > 60  # the walk really saw the raises


def test_error_codes_are_stable_names() -> None:
    values = [c.value for c in ErrorCode]
    assert len(values) == len(set(values))
    assert all(re.fullmatch(r"[a-z][a-z0-9]*(_[a-z0-9]+)*", v) for v in values)
    assert errors.for_status(404) is ErrorCode.NOT_FOUND
    assert errors.for_status(500) is ErrorCode.SERVER_ERROR


async def test_representative_errors_answer_with_their_code(office: Office) -> None:
    async with office.client() as boss:
        h = await office.login(boss, "boss", Role.OWNER)
        expect: list[tuple[str, str, Any, int, str]] = [
            ("GET", "/api/no-such-route", None, 404, "not_found"),
            ("DELETE", "/api/health", None, 405, "method_not_allowed"),
            ("GET", "/api/o/tesla/w/hq/workflows", None, 404, "feature_disabled"),
            ("POST", "/api/o/tesla/connections", {}, 400, "connection_id_required"),
            (
                "PUT",
                "/api/o/tesla/approval-policy",
                {"tiers": {"unclassified": "team"}},
                400,
                "unclassified_owner_only",
            ),
            (
                "PUT",
                "/api/o/tesla/approval-policy",
                {"tiers": {"review": "nobody"}},
                400,
                "approval_policy_invalid",
            ),
            ("POST", "/api/snapshot/run", None, 404, "snapshot_unavailable"),
            ("PATCH", "/api/me", {"locale": "fr"}, 400, "locale_invalid"),
            ("POST", "/api/auth/totp/confirm", {"code": "000000"}, 400, "otp_invalid"),
        ]
        for method, path, body, status, code in expect:
            r = await boss.request(method, path, json=body, headers=h)
            assert (r.status_code, r.json()["code"]) == (status, code), (method, path, r.text)
            assert set(r.json()) == {"error", "code", "params"}
        # an unknown path inside your own scope reads exactly like a scope you do not have
        inside = await boss.get("/api/o/tesla/no-such-route")
        outside = await boss.get("/api/o/no-such-org/org-chart")
        assert inside.json() == outside.json() == NOT_FOUND_BODY
        bad_json = await boss.post(
            "/api/o/tesla/w/hq/threads",
            content=b"{not json",
            headers={**h, "content-type": "application/json"},
        )
        assert bad_json.status_code == 400 and bad_json.json()["code"] == "invalid_request"
        r = await boss.post("/api/o/tesla/connections", json={"id": "x", "kind": "local_llm",
                            "provider": "ollama", "harness": "lite"}, headers=h)  # fmt: skip
        assert r.status_code == 201, r.text
        r = await boss.post("/api/o/tesla/connections", json={"id": "x"}, headers=h)
        assert r.json()["code"] == "connection_exists" and r.json()["params"] == {"id": "x"}


# ---------------------------------------------------------------------- C2 · C12


def test_every_route_is_classified(office: Office) -> None:
    """A new route must be public, a person's own, or behind a role key — and the lists
    here must not name routes that are gone."""
    routes = _routes(office.app)
    keyed = {(m, p) for m, p, _b in KEYS.values()} | set(ALSO)
    assert set(KEYS) == set(ROUTE_ROLES), "a role key without a route here (or the reverse)"
    assert PUBLIC | SELF | keyed == routes, sorted(routes ^ (PUBLIC | SELF | keyed))
    assert not (PUBLIC & SELF) and not (PUBLIC & keyed) and not (SELF & keyed)


@pytest.mark.parametrize(
    "ip, headers",
    [
        ("127.0.0.1", {}),  # the machine itself, without the CLI token
        ("203.0.113.5", {}),  # C12 — any internet address, default access policy
        ("127.0.0.1", {"x-forwarded-for": "203.0.113.5"}),  # through the local proxy
        ("203.0.113.5", {"authorization": "Bearer tok"}),  # the CLI token from outside
    ],
)
async def test_c2_c12_no_api_answers_without_a_session(
    office: Office, ip: str, headers: dict[str, str]
) -> None:
    rows = sorted(_routes(office.app) - PUBLIC)
    assert len(rows) > 60
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=office.app, client=(ip, 50000)),
        base_url="https://office.example",
        headers=headers,
    ) as anon:
        for method, template in rows:
            body = {} if method != "GET" else None
            r = await anon.request(method, _fill(template), json=body)
            assert r.status_code == 401, (method, template, r.text)
            # nothing but the refusal — no data, no hint of what is behind the route
            assert r.json() == {"error": "unauthorized", "code": "unauthorized", "params": {}}
            assert "set-cookie" not in r.headers
        # the public ones answer, but hand out no session either
        assert (await anon.get("/api/health")).status_code == 200
        r = await anon.post("/api/auth/login", json={"username": "nobody", "password": "x"})
        assert r.status_code == 401 and r.json()["code"] == "login_failed"
        assert "set-cookie" not in r.headers


# ---------------------------------------------------------------------- C13


async def test_c13_forged_forwarded_for_is_ignored_on_every_route(office: Office) -> None:
    """A direct peer outside the list that claims an address inside it: refused before the
    session is even looked at, on every route, the public ones included."""
    office.workspace.org.solution.update_server_config(
        access=office.workspace.org.solution.server_config().access.model_copy(
            update={"allowed_networks": ["203.0.113.0/24"]}
        )
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=office.app, client=("198.51.100.7", 50000)),
        base_url="https://office.example",
        headers={"x-forwarded-for": "203.0.113.44"},
    ) as spoofer:
        for method, template in sorted(_routes(office.app)):
            body = {} if method != "GET" else None
            r = await spoofer.request(method, _fill(template), json=body)
            assert r.status_code == 403, (method, template, r.text)
            assert r.json()["code"] == "network_blocked", (method, template)
    # the same claim through the local proxy is believed
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=office.app, client=("127.0.0.1", 50000)),
        base_url="https://office.example",
        headers={"x-forwarded-for": "203.0.113.44"},
    ) as proxied:
        assert (await proxied.get("/api/health")).status_code == 200


# ---------------------------------------------------------------------- C15


async def test_c15_staff_is_refused_every_owner_only_key(office: Office) -> None:
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.login(kim, "kim", Role.STAFF)
        kim_id = next(u.id for u in office.accounts.users() if u.username == "kim")
        # something real to aim at: an editable connection with a budget
        conn = {"id": "local", "kind": "local_llm", "provider": "ollama", "harness": "lite",
                "monthly_budget_usd": 10}  # fmt: skip
        assert (
            await boss.post("/api/o/tesla/connections", json=conn, headers=hb)
        ).status_code == 201
        ids = {"uid": kim_id, "cid": "local", "name": "home"}
        before = office.conn_file.read_text(encoding="utf-8")

        owner_only = sorted(k for k, roles in ROUTE_ROLES.items() if roles == OWNER)
        assert len(owner_only) >= 17
        for key in owner_only:
            method, template, body = KEYS[key]
            r = await kim.request(method, _fill(template, **ids), json=body, headers=hk)
            assert r.status_code == 403, (key, r.text)
            assert r.json()["code"] == "role_forbidden", (key, r.text)
        # the budget stays the owner's: the file did not change, the cap is still 10
        assert office.conn_file.read_text(encoding="utf-8") == before
        listed = (await kim.get("/api/o/tesla/connections")).json()
        assert next(c for c in listed if c["id"] == "local")["monthly_budget_usd"] == 10

        # what staff may do passes the role check (it may still fail for its own reasons)
        for key in sorted(k for k, roles in ROUTE_ROLES.items() if Role.STAFF in roles):
            method, template, body = KEYS[key]
            if key in ("events", "calendar.events"):
                continue  # a stream — it opens; the sweep would wait on it forever
            r = await kim.request(method, _fill(template, **ids), json=body, headers=hk)
            code = r.json().get("code") if r.status_code >= 400 else None
            assert code != "role_forbidden", (key, r.text)
        # and the owner's change of the budget goes through
        r = await boss.patch("/api/o/tesla/connections/local",
                             json={"monthly_budget_usd": 20}, headers=hb)  # fmt: skip
        assert r.status_code == 200 and r.json()["monthly_budget_usd"] == 20
