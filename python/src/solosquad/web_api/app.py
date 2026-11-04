"""The office's HTTP surface — one Starlette app for the CLI and the customer web.

Every request goes through the same gate, in order:

1. **access policy** (I24) — the office's `allowed_networks`; local requests pass.
2. **who** — a bearer token (the CLI's, only from a local peer) or a session cookie.
3. **CSRF** (I21) — a state-changing request on a cookie session needs `X-CSRF-Token`.
4. **stage** — a session that still has to enrol its second factor reaches only auth routes.
5. **role** (I25) — `ROUTE_ROLES` below is the whole permission table.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from solosquad import __version__
from solosquad.context.ledger import Ledger, month_start
from solosquad.context.resolve import Resolver
from solosquad.layout import Workspace
from solosquad.messages import Message as ChatMessage
from solosquad.routing.connections import (
    Connection,
    ConnectionKind,
    load_connections,
    save_connections,
)
from solosquad.routing.eligibility import Entity, judge
from solosquad.routing.router import Router
from solosquad.routing.vault import SecretStore
from solosquad.runtime import RunManager, RunStatus
from solosquad.web_api.access import Origin, allowed, origin, parse_networks
from solosquad.web_api.accounts import (
    SESSION_TTL_S,
    AccountStore,
    AuthError,
    Role,
    Session,
    SessionStage,
)
from solosquad.web_api.events import EventHub

SESSION_COOKIE = "ss_session"
CSRF_HEADER = "x-csrf-token"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}

OWNER = frozenset({Role.OWNER})
EVERYONE = frozenset({Role.OWNER, Role.STAFF})

# The permission table (I25). Owner-only: accounts, roles, access policy, audit, and
# approvals — whether staff may approve is still open (PRD v2.1.0 I25 [보강 필요]), so
# the safer side is the default until the first customer says otherwise.
ROUTE_ROLES: dict[str, frozenset[Role]] = {
    "threads.list": EVERYONE,
    "threads.create": EVERYONE,
    "threads.state": EVERYONE,
    "threads.run": EVERYONE,
    "threads.resume": OWNER,
    "runs.list": EVERYONE,
    "runs.get": EVERYONE,
    "ledger": EVERYONE,
    "events": EVERYONE,
    "users.list": OWNER,
    "users.create": OWNER,
    "users.update": OWNER,
    "access.get": EVERYONE,
    "access.update": OWNER,
    "audit": OWNER,
    "teams": EVERYONE,
    "agents": EVERYONE,
    "connections.list": EVERYONE,
    "connections.create": OWNER,
    "connections.update": OWNER,
    "connections.delete": OWNER,
    "budget": EVERYONE,
}


def _json_default(obj: Any) -> Any:
    if isinstance(obj, ChatMessage):
        return obj.to_dict()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)


def dumps(obj: Any) -> bytes:
    return json.dumps(obj, default=_json_default, ensure_ascii=False).encode()


class Json(JSONResponse):
    def render(self, content: Any) -> bytes:
        return dumps(content)


@dataclass(frozen=True)
class Principal:
    role: Role
    session: Session | None
    """None for the local CLI token, which acts with owner rights on its own machine."""

    @property
    def user_id(self) -> str | None:
        return self.session.user.id if self.session else None


@dataclass
class WebConfig:
    manager: RunManager
    ledger: Ledger
    token: str
    accounts: AccountStore | None = None
    workspace: Workspace | None = None
    static_dir: Path | None = None
    secure_cookies: bool = True
    closing: asyncio.Event | None = None
    resolver: Resolver | None = None
    router: Router | None = None
    secrets: SecretStore | None = None
    connections_path: Path | None = None
    """Where the web adds connections — the owner's `core/connections.yaml`."""
    reload_connections: Callable[[], list[Connection]] | None = None
    """Re-reads every connection file after a change, so routing sees it at once."""
    """Set on shutdown so open event streams end instead of holding the server."""


class SecurityHeaders:
    """Pure ASGI (no BaseHTTPMiddleware) so streaming responses are untouched."""

    def __init__(self, app: ASGIApp, hsts: bool) -> None:
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers += [
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"same-origin"),
                    (b"x-frame-options", b"DENY"),
                    (
                        b"content-security-policy",
                        b"default-src 'self'; frame-ancestors 'none'; base-uri 'self';"
                        b" object-src 'none'",
                    ),
                ]
                if self.hsts:
                    headers.append((b"strict-transport-security", b"max-age=31536000"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, wrapped)


def create_app(cfg: WebConfig) -> Starlette:
    m = cfg.manager
    hub = EventHub(m)

    def where(request: Request) -> Origin:
        peer = request.client.host if request.client else None
        return origin(peer, request.headers.get("x-forwarded-for"))

    def policy_check(request: Request) -> Origin:
        w = where(request)
        if cfg.workspace is not None and not allowed(cfg.workspace.config().access, w):
            raise HTTPException(403, "this office does not accept connections from here")
        return w

    def accounts() -> AccountStore:
        if cfg.accounts is None:
            raise HTTPException(404, "accounts are not enabled on this office")
        return cfg.accounts

    def principal(request: Request, *, allow_enroll: bool = False) -> Principal:
        w = policy_check(request)
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            if w.local and hmac.compare_digest(auth[7:], cfg.token):
                return Principal(Role.OWNER, None)
            raise HTTPException(401, "unauthorized")
        session = (
            cfg.accounts.session(request.cookies.get(SESSION_COOKIE)) if cfg.accounts else None
        )
        if session is None:
            raise HTTPException(401, "unauthorized")
        if request.method in UNSAFE and not hmac.compare_digest(
            request.headers.get(CSRF_HEADER, ""), session.csrf
        ):
            raise HTTPException(403, "missing or wrong CSRF token")
        if session.stage is SessionStage.ENROLL and not allow_enroll:
            raise HTTPException(403, "set up the one-time code first")
        return Principal(session.user.role, session)

    def need(request: Request, route: str) -> Principal:
        who = principal(request)
        if who.role not in ROUTE_ROLES[route]:
            raise HTTPException(403, "not allowed for your role")
        return who

    async def body(request: Request) -> dict[str, Any]:
        raw = await request.body()
        if not raw:
            return {}
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        return data

    def me_payload(session: Session) -> dict[str, Any]:
        return {"user": session.user.public(), "stage": session.stage.value, "csrf": session.csrf}

    # ------------------------------------------------------------------ health · auth

    async def health(request: Request) -> Response:
        policy_check(request)
        return Json({"ok": True})

    async def version(request: Request) -> Response:
        principal(request)
        return Json({"version": __version__})

    async def login(request: Request) -> Response:
        w = policy_check(request)
        data = await body(request)
        require = cfg.workspace.config().access.two_factor if cfg.workspace else True
        try:
            token, session = accounts().login(
                str(data.get("username") or ""),
                str(data.get("password") or ""),
                str(data["otp"]) if data.get("otp") else None,
                require_second_factor=require,
                ip=w.address,
                ua=request.headers.get("user-agent", ""),
            )
        except AuthError as e:
            raise HTTPException(401, str(e)) from e
        accounts().audit(session.user.id, "login", w.address)
        resp = Json(me_payload(session))
        resp.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=SESSION_TTL_S,
            httponly=True,
            secure=cfg.secure_cookies,
            samesite="lax",
            path="/",
        )
        return resp

    async def logout(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            accounts().logout(token)
            accounts().audit(who.user_id, "logout")
        resp = Json({"ok": True})
        resp.delete_cookie(SESSION_COOKIE, path="/")
        return resp

    async def me(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            return Json({"user": None, "stage": "full", "csrf": None, "local": True})
        if request.method == "PATCH":
            data = await body(request)
            if "locale" in data:
                accounts().set_locale(who.session.user.id, str(data["locale"]))
            if "password" in data:
                accounts().set_password(who.session.user.id, str(data["password"]))
                accounts().audit(who.user_id, "password.change")
            session = accounts().session(request.cookies.get(SESSION_COOKIE))
            if session is None:  # a password change ends every session, this one too
                return Json({"ok": True, "relogin": True})
            return Json(me_payload(session))
        return Json(me_payload(who.session))

    async def totp_begin(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            raise HTTPException(400, "log in with an account to set up a one-time code")
        return Json({"uri": accounts().begin_totp(who.session.user.id)})

    async def totp_confirm(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            raise HTTPException(400, "log in with an account to set up a one-time code")
        code = str((await body(request)).get("code") or "")
        if not accounts().confirm_totp(who.session.user.id, code):
            raise HTTPException(400, "wrong one-time code")
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            accounts().promote_session(token)
        accounts().audit(who.user_id, "totp.enrol")
        return Json({"ok": True})

    # ------------------------------------------------------------------ users

    async def users(request: Request) -> Response:
        if request.method == "POST":
            who = need(request, "users.create")
            data = await body(request)
            user = accounts().create_user(
                str(data.get("username") or ""),
                str(data.get("password") or ""),
                Role(str(data.get("role") or Role.STAFF.value)),
                display=str(data.get("display") or ""),
                locale=str(data.get("locale") or "ko"),
            )
            accounts().audit(who.user_id, "user.create", f"{user.username} as {user.role.value}")
            return Json(user.public(), status_code=201)
        need(request, "users.list")
        return Json([u.public() for u in accounts().users()])

    async def user_update(request: Request) -> Response:
        who = need(request, "users.update")
        uid = request.path_params["uid"]
        data = await body(request)
        store = accounts()
        store.user(uid)
        if "role" in data:
            store.set_role(uid, Role(str(data["role"])))
            store.audit(who.user_id, "user.role", f"{uid} → {data['role']}")
        if "disabled" in data:
            store.set_disabled(uid, bool(data["disabled"]))
            store.audit(who.user_id, "user.disable" if data["disabled"] else "user.enable", uid)
        if data.get("password"):
            store.set_password(uid, str(data["password"]))
            store.audit(who.user_id, "user.password.reset", uid)
        if data.get("reset_totp"):
            store.reset_totp(uid)
            store.audit(who.user_id, "user.totp.reset", uid)
        return Json(store.user(uid).public())

    # ------------------------------------------------------------------ access policy

    async def access(request: Request) -> Response:
        if cfg.workspace is None:
            raise HTTPException(404, "no workspace configuration")
        ws_cfg = cfg.workspace.config()
        if request.method == "PUT":
            who = need(request, "access.update")
            data = await body(request)
            nets = [str(x) for x in data.get("allowed_networks", ws_cfg.access.allowed_networks)]
            parse_networks(nets)  # ValueError → 400 on a malformed entry
            proposed = ws_cfg.access.model_copy(
                update={
                    "allowed_networks": nets,
                    "two_factor": bool(data.get("two_factor", ws_cfg.access.two_factor)),
                }
            )
            here = where(request)
            if not allowed(proposed, here) and not data.get("confirm_lockout"):
                # K28 — refuse a list that would lock out the person saving it
                raise HTTPException(
                    409,
                    f"your address {here.address} is not in the new list — you would lose"
                    " access. Send confirm_lockout: true to save anyway.",
                )
            cfg.workspace.save_config(ws_cfg.model_copy(update={"access": proposed}))
            accounts().audit(
                who.user_id,
                "access.update",
                json.dumps(proposed.model_dump(mode="json"), ensure_ascii=False),
            )
            return Json(proposed.model_dump(mode="json"))
        need(request, "access.get")
        return Json(ws_cfg.access.model_dump(mode="json"))

    async def audit(request: Request) -> Response:
        need(request, "audit")
        return Json(accounts().audit_log(int(request.query_params.get("limit", "200"))))

    # ------------------------------------------------------------------ operations

    async def threads(request: Request) -> Response:
        if request.method == "POST":
            need(request, "threads.create")
            data = await body(request)
            tid = m.create_thread(str(data.get("title") or "task"), data.get("metadata"))
            return Json({"thread_id": tid}, status_code=201)
        need(request, "threads.list")
        return Json(m.store.threads(int(request.query_params.get("limit", "50"))))

    async def thread_state(request: Request) -> Response:
        need(request, "threads.state")
        tid = request.path_params["tid"]
        if m.store.thread(tid) is None:
            raise KeyError(f"no thread {tid}")
        return Json(await m.thread_state(tid))

    async def thread_run(request: Request) -> Response:
        need(request, "threads.run")
        text = (await body(request)).get("input")
        tid = request.path_params["tid"]
        rid = await m.submit(tid, text if isinstance(text, str) else None)
        return Json({"run_id": rid}, status_code=201)

    async def thread_resume(request: Request) -> Response:
        who = need(request, "threads.resume")
        tid = request.path_params["tid"]
        if m.store.thread(tid) is None:
            raise KeyError(f"no thread {tid}")
        value = (await body(request)).get("value")
        approver = who.session.user.username if who.session else "local-cli"
        rid = await m.resume(tid, value, source=f"user:{approver}")
        if cfg.accounts is not None:
            cfg.accounts.audit(who.user_id, "approval", f"{tid} → {value!r}")
        return Json({"run_id": rid}, status_code=201)

    async def runs(request: Request) -> Response:
        need(request, "runs.list")
        q = request.query_params
        since = float(q["since"]) if q.get("since") else None
        return Json(
            m.store.runs(
                thread_id=q.get("thread_id"),
                status=q.get("status"),
                since=since,
                limit=int(q.get("limit", "50")),
            )
        )

    async def run(request: Request) -> Response:
        need(request, "runs.get")
        rid = request.path_params["rid"]
        found = m.store.run(rid)
        if found is None:
            raise KeyError(f"no run {rid}")
        return Json(found)

    async def ledger(request: Request) -> Response:
        need(request, "ledger")
        return Json(cfg.ledger.totals(request.query_params.get("by", "agent")))

    async def events(request: Request) -> Response:
        need(request, "events")
        raw = request.headers.get("last-event-id") or request.query_params.get("last_event_id")
        last_id = int(raw) if raw and raw.isdigit() else 0
        await hub.ensure_started()

        async def stream() -> AsyncIterator[bytes]:
            items = hub.subscribe(last_id).__aiter__()
            closing = cfg.closing or asyncio.Event()
            stop = asyncio.ensure_future(closing.wait())
            nxt = asyncio.ensure_future(items.__anext__())
            await asyncio.sleep(0)
            yield b"retry: 3000\n: connected\n\n"
            try:
                while True:
                    done, _ = await asyncio.wait({nxt, stop}, return_when=asyncio.FIRST_COMPLETED)
                    if stop in done:
                        return
                    seq, event = nxt.result()
                    yield f"id: {seq}\n".encode() + b"data: " + dumps(event) + b"\n\n"
                    nxt = asyncio.ensure_future(items.__anext__())
            finally:
                stop.cancel()
                nxt.cancel()
                with contextlib.suppress(Exception):
                    await items.aclose()  # type: ignore[attr-defined]

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ------------------------------------------------------------------ organisation

    def resolver() -> Resolver:
        if cfg.resolver is None:
            raise HTTPException(404, "organisation view is not enabled on this office")
        return cfg.resolver

    async def teams(request: Request) -> Response:
        need(request, "teams")
        return Json(
            [
                {"name": name, "main": comp.main, "members": comp.members}
                for name, comp in resolver().teams().items()
            ]
        )

    async def agents(request: Request) -> Response:
        need(request, "agents")
        r = resolver()
        working: dict[str, list[dict[str, Any]]] = {}
        for run in m.store.runs(status=RunStatus.RUNNING, limit=200):
            state = await m.thread_state(run["thread_id"])
            active = (state.get("values") or {}).get("active_agent") or "chief"
            thread = m.store.thread(run["thread_id"]) or {}
            working.setdefault(str(active), []).append(
                {"thread_id": run["thread_id"], "run_id": run["id"], "title": thread.get("title")}
            )
        out = []
        for name, res in sorted(r.available("agents").items()):
            appearance = res.spec.extra.get("appearance")
            out.append(
                {
                    "name": name,
                    "description": res.spec.description,
                    "team": r.team_of(name),
                    "layer": res.layer,
                    "appearance": appearance if isinstance(appearance, dict) else None,
                    "working_on": working.get(name, []),
                }
            )
        return Json(out)

    # ------------------------------------------------------------------ connections · budget

    def server_country() -> str | None:
        return cfg.workspace.config().server_country if cfg.workspace else None

    def all_connections() -> list[Connection]:
        if cfg.reload_connections is not None:
            return cfg.reload_connections()
        return list(cfg.router.connections) if cfg.router else []

    def refresh_router() -> None:
        if cfg.router is not None and cfg.reload_connections is not None:
            cfg.router.connections[:] = cfg.reload_connections()

    def conn_public(c: Connection) -> dict[str, Any]:
        secret = cfg.secrets.get(c.secret_ref) if cfg.secrets and c.secret_ref else None
        verdict = judge(c.provider, c.harness, c.models, c.entity, server_country())
        return {
            "id": c.id,
            "kind": c.kind.value,
            "provider": c.provider,
            "harness": c.harness,
            "models": c.models,
            "active": c.active,
            "slots": c.slots,
            "monthly_budget_usd": c.monthly_budget_usd,
            "network": c.network,
            "entity": c.entity.model_dump() if c.entity else None,
            "secret_last4": secret[-4:] if secret and len(secret) >= 8 else None,
            "eligible": verdict.ok,
            "eligibility_reason": verdict.reason or None,
            "eligibility_source": verdict.source or None,
        }

    def own_file() -> Path:
        if cfg.connections_path is None:
            raise HTTPException(404, "connections are not editable on this office")
        return cfg.connections_path

    async def connections(request: Request) -> Response:
        if request.method == "POST":
            who = need(request, "connections.create")
            data = await body(request)
            entity = Entity.model_validate(data["entity"]) if data.get("entity") else None
            cid = str(data.get("id") or "").strip()
            if not cid:
                raise ValueError("id is required")
            path = own_file()
            existing = load_connections(path)
            if any(c.id == cid for c in all_connections()):
                raise ValueError(f"connection {cid!r} exists")
            conn = Connection(
                id=cid,
                kind=ConnectionKind(str(data.get("kind") or "api_key")),
                provider=str(data.get("provider") or "anthropic"),
                harness=str(data.get("harness") or "lite"),
                models=[str(x) for x in data.get("models") or []],
                base_url=data.get("base_url"),
                secret_env=data.get("secret_env"),
                monthly_budget_usd=data.get("monthly_budget_usd"),
                entity=entity,
            )
            verdict = judge(conn.provider, conn.harness, conn.models, entity, server_country())
            if not verdict.ok:
                raise HTTPException(422, f"{verdict.reason} — see {verdict.source}")
            if data.get("secret"):
                if cfg.secrets is None:
                    raise HTTPException(404, "no secret store on this office")
                conn = conn.model_copy(update={"secret_ref": f"conn:{cid}"})
                cfg.secrets.set(f"conn:{cid}", str(data["secret"]))
            save_connections(path, [*existing, conn])
            refresh_router()
            accounts().audit(who.user_id, "connection.create", cid)
            return Json(conn_public(conn), status_code=201)
        need(request, "connections.list")
        return Json([conn_public(c) for c in all_connections()])

    async def connection_update(request: Request) -> Response:
        cid = request.path_params["cid"]
        path = own_file()
        existing = load_connections(path)
        found = next((c for c in existing if c.id == cid), None)
        if found is None:
            raise KeyError(f"no editable connection {cid}")
        if request.method == "DELETE":
            who = need(request, "connections.delete")
            save_connections(path, [c for c in existing if c.id != cid])
            if cfg.secrets is not None and found.secret_ref:
                cfg.secrets.delete(found.secret_ref)
            refresh_router()
            accounts().audit(who.user_id, "connection.delete", cid)
            return Json({"ok": True})
        who = need(request, "connections.update")
        data = await body(request)
        update: dict[str, Any] = {}
        if "active" in data:
            update["active"] = bool(data["active"])
        if "monthly_budget_usd" in data:
            update["monthly_budget_usd"] = data["monthly_budget_usd"]
        if "entity" in data:
            update["entity"] = Entity.model_validate(data["entity"]) if data["entity"] else None
        changed = found.model_copy(update=update)
        verdict = judge(
            changed.provider, changed.harness, changed.models, changed.entity, server_country()
        )
        if changed.active and not verdict.ok:
            raise HTTPException(422, f"{verdict.reason} — see {verdict.source}")
        save_connections(path, [changed if c.id == cid else c for c in existing])
        refresh_router()
        accounts().audit(who.user_id, "connection.update", f"{cid} {sorted(update)}")
        return Json(conn_public(changed))

    async def budget(request: Request) -> Response:
        need(request, "budget")
        since = month_start()
        by_conn = cfg.ledger.totals("connection_id", since=since)
        total = sum(v["cost_usd"] for v in by_conn.values())
        policy = cfg.router.chief_policy.budget if cfg.router else None
        warn_at = policy.warn_at if policy else 0.8
        org_cap = policy.monthly_usd if policy else None
        rows = []
        for c in all_connections():
            spent = by_conn.get(c.id, {}).get("cost_usd", 0.0)
            cap = c.monthly_budget_usd
            rows.append(
                {
                    "id": c.id,
                    "spent_usd": round(spent, 4),
                    "budget_usd": cap,
                    "remaining_usd": round(cap - spent, 4) if cap is not None else None,
                    "warning": cap is not None and spent >= cap * warn_at,
                    "exhausted": cap is not None and spent >= cap,
                }
            )
        return Json(
            {
                "month_start": since,
                "warn_at": warn_at,
                "org": {
                    "spent_usd": round(total, 4),
                    "budget_usd": org_cap,
                    "remaining_usd": round(org_cap - total, 4) if org_cap is not None else None,
                    "warning": org_cap is not None and total >= org_cap * warn_at,
                    "exhausted": org_cap is not None and total >= org_cap,
                },
                "connections": rows,
            }
        )

    # ------------------------------------------------------------------ errors · routes

    async def not_found(_request: Request, exc: Exception) -> Response:
        return Json({"error": str(exc).strip("'\"")}, status_code=404)

    async def bad_request(_request: Request, exc: Exception) -> Response:
        return Json({"error": str(exc)}, status_code=400)

    async def http_error(_request: Request, exc: Exception) -> Response:
        assert isinstance(exc, HTTPException)
        return Json({"error": exc.detail}, status_code=exc.status_code)

    Endpoint = Callable[[Request], Awaitable[Response]]
    api: list[tuple[str, Endpoint, list[str]]] = [
        ("/health", health, ["GET"]),
        ("/version", version, ["GET"]),
        ("/auth/login", login, ["POST"]),
        ("/auth/logout", logout, ["POST"]),
        ("/auth/totp/begin", totp_begin, ["POST"]),
        ("/auth/totp/confirm", totp_confirm, ["POST"]),
        ("/me", me, ["GET", "PATCH"]),
        ("/users", users, ["GET", "POST"]),
        ("/users/{uid}", user_update, ["PATCH"]),
        ("/access", access, ["GET", "PUT"]),
        ("/audit", audit, ["GET"]),
        ("/threads", threads, ["GET", "POST"]),
        ("/threads/{tid}/state", thread_state, ["GET"]),
        ("/threads/{tid}/runs", thread_run, ["POST"]),
        ("/threads/{tid}/resume", thread_resume, ["POST"]),
        ("/runs", runs, ["GET"]),
        ("/runs/{rid}", run, ["GET"]),
        ("/ledger", ledger, ["GET"]),
        ("/events", events, ["GET"]),
        ("/teams", teams, ["GET"]),
        ("/agents", agents, ["GET"]),
        ("/connections", connections, ["GET", "POST"]),
        ("/connections/{cid}", connection_update, ["PATCH", "DELETE"]),
        ("/budget", budget, ["GET"]),
    ]
    routes: list[Route | Mount] = [
        Mount("/api", routes=[Route(path, fn, methods=methods) for path, fn, methods in api])
    ]
    if cfg.static_dir is not None and cfg.static_dir.is_dir():
        routes.append(Mount("/", app=StaticFiles(directory=cfg.static_dir, html=True)))

    return Starlette(
        routes=routes,
        middleware=[Middleware(SecurityHeaders, hsts=cfg.secure_cookies)],
        exception_handlers={
            KeyError: not_found,
            ValueError: bad_request,
            TypeError: bad_request,
            HTTPException: http_error,
        },
    )
