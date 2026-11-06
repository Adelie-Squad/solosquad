"""The engine server's HTTP surface — one Starlette app for the CLI and the customer web.

Decision 57 · PRD v2.1.0 I40 · I22 rev7: the scope is in the address.

    /api/...                    the customer: health · auth · me · users · login audit ·
                                profile · snapshot · server settings (access default · locale)
    /api/o/{org}/...            an org: org chart · people · approval policy · teams · agent
                                and workflow definitions · screens · connections · org audit
    /api/o/{org}/w/{ws}/...     a workspace: threads · runs · events · ledger · budget ·
                                approvals · workflow runs · uploads · artifacts · its own
                                access limits · the agents at work · schedules · agent work

Every request goes through the same gate, in order:

1. **customer access default** (I24 · I41) — `core/server.yaml` `access`; local requests pass.
2. **who** — a bearer token (the CLI's, only from a local peer) or a session cookie.
3. **CSRF** (I21) — a state-changing request on a cookie session needs `X-CSRF-Token`.
4. **stage** — a session that still has to enrol its second factor reaches only auth routes.
5. **scope** (K48) — for `/o/{org}` and `/o/{org}/w/{ws}`, in **one place** (`ScopeGate`),
   never route by route: the assignment (I39) → the workspace's own extra limits. A scope
   that is not the person's and a scope that does not exist answer the same 404; a network
   the workspace does not accept answers 403 with guidance (C4).
6. **role** (I25) — `ROUTE_ROLES` below is the whole permission table. The role is the
   person's role *in the requested scope*; the customer's owner is owner everywhere.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import urlsplit

import webauthn
from apscheduler.triggers.cron import CronTrigger
from pydantic import BaseModel
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import BaseRoute, Mount, Route, Router
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from solosquad import __version__
from solosquad.approvals import (
    RECOMMENDED,
    UNCLASSIFIED,
    ApprovalPolicy,
    Tier,
    can_approve,
    load_policy,
    save_policy,
)
from solosquad.artifacts import ArtifactStore
from solosquad.context.ledger import Ledger, month_start
from solosquad.context.resolve import Resolver
from solosquad.layout import LayoutError, ServerConfig, Solution, Workspace
from solosquad.messages import Message as ChatMessage
from solosquad.profile import load_profile, save_profile, update_profile
from solosquad.routing.connections import (
    Connection,
    ConnectionKind,
    load_connections,
    save_connections,
)
from solosquad.routing.eligibility import Entity, Verdict, judge, providers_reached
from solosquad.routing.router import Router as LlmRouter
from solosquad.routing.vault import SecretStore
from solosquad.runtime import RunManager, RunStatus
from solosquad.runtime.manager import OPS_THREAD, load_crons
from solosquad.screens import load_screen
from solosquad.snapshots import S3_SECRET_REF, build_target
from solosquad.web_api import schemas as S
from solosquad.web_api.access import Origin, allowed, origin, parse_networks
from solosquad.web_api.accounts import (
    SESSION_TTL_S,
    AccountStore,
    Assignment,
    AuthError,
    Role,
    Session,
    SessionStage,
    User,
)
from solosquad.web_api.errors import ApiError, CodedError, for_status
from solosquad.web_api.errors import ErrorCode as E
from solosquad.web_api.events import EventHub
from solosquad.web_api.org_store import OrgStore
from solosquad.workflows.engine import UPLOAD_LIMIT, UPLOAD_TYPES, WorkflowEngine

if TYPE_CHECKING:
    from solosquad.engine_server import EngineServer
    from solosquad.instance import Instance

SESSION_COOKIE = "ss_session"
CSRF_HEADER = "x-csrf-token"
ENTITY_REQUIRED = "enter the entity that holds this account (entity: {name, country})"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
NOT_FOUND = "Not Found"
"""The one answer for a scope that is not yours and for one that does not exist (C3 · C30) —
Starlette's own text, so an unknown route inside your scope reads the same."""
NOT_FOUND_BODY = {"error": NOT_FOUND, "code": E.NOT_FOUND.value, "params": {}}
"""…and the whole body: same sentence, same code, nothing in `params` to tell them apart."""
THEME_SCRIPT_HASH = "sha256-Tw8gxlCxr/CHgowPx8fOQaU9j9JOSiBiOuJpPMlkEuk="
"""The one inline script the web has: `web/index.html` picks light or dark before the
first paint (DESIGN.md `## 테마`, no flash). CSP allows exactly that script by hash —
no 'unsafe-inline'. A test recomputes it from index.html."""

CSP = (
    "default-src 'self'; "
    f"script-src 'self' '{THEME_SCRIPT_HASH}' 'wasm-unsafe-eval'; "
    "img-src 'self' blob: data:; "
    "connect-src 'self' blob:; "
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
)
"""Same-origin everything, plus exactly what the office scene's GLBs need (asset contract §8):
`'wasm-unsafe-eval'` lets the meshopt decoder compile its WebAssembly (it does not allow `eval`);
`blob:` lets GLTFLoader read the WebP textures embedded in a GLB, which it hands to the image
loader as blob URLs (an `<img>` or a `fetch`, depending on the browser); `data:` in img-src only
is for GLTFLoader's WebP support probe, a 1-pixel `data:image/webp` image — without it the probe
fails and the loader refuses the file ("WebP required by asset but unsupported")."""

OWNER = frozenset({Role.OWNER})
EVERYONE = frozenset({Role.OWNER, Role.STAFF})

Level = Literal["customer", "org", "workspace"]
Key = tuple[str, str]
Row = dict[str, Any]

# The permission table (I25). For customer routes the role is the customer-level one
# (owner = the customer's owner); for org and workspace routes it is the role in that
# scope. Owner-only: accounts, access policy, audit, server settings, org policy.
ROUTE_ROLES: dict[str, frozenset[Role]] = {
    # customer
    "users.list": OWNER,
    "users.create": OWNER,
    "users.update": OWNER,
    "access.get": EVERYONE,
    "access.update": OWNER,
    "audit": OWNER,
    "settings.get": EVERYONE,
    "settings.update": OWNER,
    "profile.get": EVERYONE,
    "profile.update": OWNER,
    "snapshot.get": EVERYONE,
    "snapshot.update": OWNER,
    "snapshot.run": OWNER,
    # org
    "org_chart": EVERYONE,
    "people.list": EVERYONE,
    "people.update": OWNER,
    "org_audit": OWNER,
    "teams": EVERYONE,
    "agents": EVERYONE,
    "connections.list": EVERYONE,
    "connections.create": OWNER,
    "connections.update": OWNER,
    "connections.delete": OWNER,
    "workflows.list": EVERYONE,
    "workflows.update": OWNER,
    "approval_policy.get": EVERYONE,
    "approval_policy.update": OWNER,
    "screens": EVERYONE,
    # workspace
    "threads.list": EVERYONE,
    "threads.create": EVERYONE,
    "threads.state": EVERYONE,
    "threads.run": EVERYONE,
    "threads.resume": EVERYONE,  # then the card decides (decision 51)
    "runs.list": EVERYONE,
    "runs.get": EVERYONE,
    "ledger": EVERYONE,
    "events": EVERYONE,
    "budget": EVERYONE,
    "workflows.run": EVERYONE,
    "workflows.approve": EVERYONE,  # then the card decides (decision 51)
    "approvals.list": EVERYONE,
    "uploads.list": EVERYONE,
    "uploads.create": EVERYONE,
    "artifacts.list": EVERYONE,
    "artifacts.review": EVERYONE,
    "ws_access.get": EVERYONE,
    "ws_access.update": OWNER,
    "working": EVERYONE,
    "schedules.list": EVERYONE,  # switching a schedule = `workflows.update` (owner)
    "work.list": EVERYONE,
}


def _json_default(obj: Any) -> Any:
    if isinstance(obj, ChatMessage):
        return obj.to_dict()
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json")
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)


def dumps(obj: Any) -> bytes:
    return json.dumps(obj, default=_json_default, ensure_ascii=False).encode()


class Json(JSONResponse):
    def render(self, content: Any) -> bytes:
        return dumps(content)


def respond(tp: Any, data: Any, status_code: int = 200) -> Json:
    """Send `data` through its contract model (I6) — the shape the web's types are made from."""
    return Json(S.conform(tp, json.loads(dumps(data))), status_code=status_code)


class SpaFiles(StaticFiles):
    """The built web; a client-side route (`/o/moa/w/hq/chat/th-1`, no file extension) gets
    `index.html` so a reload or a shared link opens the right screen."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as e:
            last = path.rsplit("/", 1)[-1]
            if e.status_code != 404 or "." in last or path.startswith("api"):
                raise
            return await super().get_response("index.html", scope)


@dataclass(frozen=True)
class Principal:
    role: Role
    """The customer-level role."""
    session: Session | None
    """None for the local CLI token, which acts with owner rights on its own machine."""

    @property
    def user_id(self) -> str | None:
        return self.session.user.id if self.session else None

    @property
    def name(self) -> str:
        return self.session.user.username if self.session else "local-cli"


@dataclass
class RuntimeView:
    """What the web needs of one workspace runtime (`Instance`)."""

    workspace: Workspace
    manager: RunManager
    ledger: Ledger
    router: LlmRouter | None = None
    secrets: SecretStore | None = None
    """The workspace's secret store — connection keys."""
    resolver: Resolver | None = None
    """With this workspace's overrides."""
    reload_connections: Callable[[], list[Connection]] | None = None
    """Re-reads the core and org connection files, so routing sees a change at once."""
    workflows: WorkflowEngine | None = None
    artifacts: ArtifactStore | None = None

    @property
    def key(self) -> Key:
        return (self.workspace.org.name, self.workspace.name)

    @classmethod
    def of(cls, inst: Instance) -> RuntimeView:
        from solosquad.instance import connections_for

        ctx = inst.ctx
        return cls(
            ctx.solution.org(ctx.org).workspace(ctx.workspace),
            inst.manager,
            inst.ledger,
            router=inst.router,
            secrets=inst.secrets,
            resolver=Resolver(ctx),
            reload_connections=lambda: connections_for(ctx),
            workflows=inst.workflows,
            artifacts=inst.artifacts,
        )


@dataclass
class AppConfig:
    solution: Solution
    token: str
    accounts: AccountStore
    runtimes: dict[Key, RuntimeView]
    orgs: dict[str, OrgStore] = field(default_factory=dict)
    failed: dict[Key, str] = field(default_factory=dict)
    """Placed here but not running — the scope answers 503 to the people it belongs to."""
    secrets: SecretStore | None = None
    """The customer's own secret store — the snapshot keys."""
    run_snapshot: Callable[[], dict[str, Any]] | None = None
    """Back up every database at one moment and ship it now (`maintenance.run_snapshot`)."""
    static_dir: Path | None = None
    secure_cookies: bool = True
    closing: asyncio.Event | None = None
    """Set on shutdown so open event streams end instead of holding the server."""

    @property
    def placed(self) -> set[Key]:
        return set(self.runtimes) | set(self.failed)

    @classmethod
    def for_engine(
        cls,
        engine: EngineServer,
        token: str,
        *,
        static_dir: Path | None = None,
        secure_cookies: bool = True,
        closing: asyncio.Event | None = None,
    ) -> AppConfig:
        from solosquad.maintenance import run_snapshot

        return cls(
            engine.solution,
            token,
            engine.accounts,
            {key: RuntimeView.of(inst) for key, inst in engine.runtimes.items()},
            orgs=engine.orgs,
            failed=engine.failed,
            secrets=engine.secrets,
            run_snapshot=lambda: run_snapshot(engine),
            static_dir=static_dir,
            secure_cookies=secure_cookies,
            closing=closing,
        )


@dataclass(frozen=True)
class InScope:
    """What the scope gate found out about a request — handlers read it, never re-check."""

    who: Principal
    org: str
    workspace: str | None
    role: Role
    runtime: RuntimeView | None = None


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
                    (b"content-security-policy", CSP.encode()),
                ]
                if self.hsts:
                    headers.append((b"strict-transport-security", b"max-age=31536000"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, wrapped)


class ScopeGate:
    """The one place a scope is checked (K48). Wraps the router of a scope level; the
    check runs before any route of that level is even matched, so no route can be
    reached around it and an unknown path inside a foreign scope is the same 404."""

    def __init__(self, app: Router, check: Callable[[Request], None], level: Level) -> None:
        self.app = app
        self.check = check
        self.level = level

    @property
    def routes(self) -> list[BaseRoute]:
        return self.app.routes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            self.check(Request(scope, receive))
        await self.app(scope, receive, send)


@dataclass(frozen=True)
class RouteInfo:
    level: Level
    path: str
    """The full template, e.g. `/api/o/{org}/w/{ws}/threads/{tid}/state`."""
    methods: frozenset[str]


def route_table(app: Starlette) -> list[RouteInfo]:
    """Every API route with its scope level — the scope test walks this, so a route added
    later is covered without anyone remembering to add it (C3 · C30)."""
    out: list[RouteInfo] = []

    def walk(routes: list[BaseRoute], prefix: str, level: Level) -> None:
        for r in routes:
            if isinstance(r, Mount):
                base = getattr(r, "app", None)
                inner = base.level if isinstance(base, ScopeGate) else level
                if r.path == "" or (prefix == "" and r.path != "/api"):
                    continue
                walk(list(r.routes), prefix + r.path, inner)
            elif isinstance(r, Route):
                methods = frozenset((r.methods or set()) - {"HEAD"})
                out.append(RouteInfo(level, prefix + r.path, methods))

    walk(list(app.routes), "", "customer")
    return out


def _access_public(policy: Any) -> dict[str, Any]:
    return {
        "require_login": policy.require_login,
        "two_factor": policy.two_factor,
        "allowed_networks": list(policy.allowed_networks),
    }


def _artifact_public(art: Any) -> dict[str, Any]:
    """An artifact whose kind has a contract (`finance.pnl`, `brief`) is checked against it."""
    out: dict[str, Any] = art.public()
    model = S.ARTIFACT_DATA.get(art.kind)
    if model is not None:
        out["data"] = S.conform(model, json.loads(dumps(out["data"])))
    return out


def create_app(cfg: AppConfig) -> Starlette:
    hubs: dict[Key, EventHub] = {}
    last_seen: dict[str, Key] = {}

    # ------------------------------------------------------------------ the gate

    def server_cfg() -> ServerConfig:
        """core/server.yaml as it is now (I41) — the web may have just changed it."""
        return cfg.solution.server_config(strict=False)

    def where(request: Request) -> Origin:
        peer = request.client.host if request.client else None
        return origin(peer, request.headers.get("x-forwarded-for"))

    def policy_check(request: Request) -> Origin:
        w = where(request)
        if not allowed(server_cfg().access, w):
            raise ApiError(
                403, E.NETWORK_BLOCKED, "this server does not accept connections from here"
            )
        return w

    def accounts() -> AccountStore:
        return cfg.accounts

    def principal(request: Request, *, allow_enroll: bool = False) -> Principal:
        w = policy_check(request)
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            if w.local and hmac.compare_digest(auth[7:], cfg.token):
                return Principal(Role.OWNER, None)
            raise ApiError(401, E.UNAUTHORIZED, "unauthorized")
        session = cfg.accounts.session(request.cookies.get(SESSION_COOKIE))
        if session is None:
            raise ApiError(401, E.UNAUTHORIZED, "unauthorized")
        if request.method in UNSAFE and not hmac.compare_digest(
            request.headers.get(CSRF_HEADER, ""), session.csrf
        ):
            raise ApiError(403, E.CSRF_INVALID, "missing or wrong CSRF token")
        if session.stage is SessionStage.ENROLL and not allow_enroll:
            raise ApiError(403, E.ENROL_REQUIRED, "set up the one-time code first")
        return Principal(session.user.role, session)

    def role_for(who: Principal, org: str, workspace: str | None) -> Role | None:
        if who.session is None:
            return Role.OWNER
        return cfg.accounts.role_in(who.session.user, org, workspace)

    def served_orgs() -> set[str]:
        return {o for o, _w in cfg.placed}

    def check_org(request: Request) -> None:
        org = str(request.path_params.get("org", ""))
        who = principal(request)
        role = role_for(who, org, None) if org in served_orgs() else None
        if role is None:  # not assigned, not placed here, not there at all — the same 404
            raise ApiError(404, E.NOT_FOUND, NOT_FOUND)
        request.state.in_scope = InScope(who, org, None, role)

    def check_workspace(request: Request) -> None:
        outer: InScope = request.state.in_scope
        key = (outer.org, str(request.path_params.get("ws", "")))
        role = role_for(outer.who, *key) if key in cfg.placed else None
        if role is None:
            raise ApiError(404, E.NOT_FOUND, NOT_FOUND)
        rt = cfg.runtimes.get(key)
        if rt is None:
            raise ApiError(
                503, E.WORKSPACE_NOT_STARTED, "this workspace did not start — see the server log"
            )
        if not allowed(rt.workspace.config().access, where(request)):
            raise ApiError(  # C4 — the session is fine, this workspace is not open here
                403,
                E.WORKSPACE_NETWORK_BLOCKED,
                "this workspace accepts connections only from its own networks — connect"
                " from there (office network or VPN), or ask the owner",
            )
        request.state.in_scope = InScope(outer.who, key[0], key[1], role, rt)
        uid = outer.who.user_id
        if uid is not None and last_seen.get(uid) != key:
            last_seen[uid] = key
            cfg.accounts.set_last_scope(uid, *key)

    def in_scope(request: Request) -> InScope:
        found: InScope = request.state.in_scope
        return found

    def need(request: Request, route: str) -> Principal:
        sc: InScope | None = getattr(request.state, "in_scope", None)
        who = sc.who if sc is not None else principal(request)
        role = sc.role if sc is not None else who.role
        if role not in ROUTE_ROLES[route]:
            raise ApiError(403, E.ROLE_FORBIDDEN, "not allowed for your role")
        return who

    def runtime(request: Request) -> RuntimeView:
        rt = in_scope(request).runtime
        assert rt is not None  # the workspace gate set it
        return rt

    async def body(request: Request) -> dict[str, Any]:
        raw = await request.body()
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except ValueError as e:
            raise ApiError(400, E.INVALID_REQUEST, f"the body is not JSON: {e}") from e
        if not isinstance(data, dict):
            raise ApiError(400, E.INVALID_REQUEST, "expected a JSON object")
        return data

    def locale_error(nullable: bool) -> ApiError:
        tail = " or null" if nullable else ""
        return ApiError(400, E.LOCALE_INVALID, f"locale must be one of {list(S.LOCALES)}{tail}")

    # ------------------------------------------------------------------ audit · scopes

    def org_audit(sc: InScope, action: str, detail: str = "") -> None:
        store = cfg.orgs.get(sc.org)
        if store is not None:
            store.audit(sc.who.user_id, action, detail, workspace=sc.workspace)

    def org_display(org: str) -> str:
        try:
            return cfg.solution.org(org).config().display_name or org
        except LayoutError:
            return org

    def ws_display(org: str, ws: str) -> str:
        try:
            return cfg.solution.org(org).workspace(ws).config().display_name or ws
        except (LayoutError, ValueError):  # a broken workspace.yaml still lists by its id
            return ws

    def scopes_for(who: Principal) -> list[dict[str, Any]]:
        out = []
        for org in sorted(served_orgs()):
            org_role = role_for(who, org, None)
            if org_role is None:
                continue
            wss = []
            for o, w in sorted(cfg.placed):
                ws_role = role_for(who, o, w) if o == org else None
                if ws_role is not None:
                    wss.append(
                        {
                            "name": w,
                            "display": ws_display(o, w),
                            "role": ws_role.value,
                            "running": (o, w) in cfg.runtimes,
                        }
                    )
            whole = (
                who.session is None
                or who.role is Role.OWNER
                or any(
                    a.org == org and a.workspace is None
                    for a in cfg.accounts.assignments(who.session.user.id)
                )
            )
            out.append(
                {
                    "org": org,
                    "display": org_display(org),
                    "role": org_role.value,
                    "whole_org": whole,
                    "workspaces": wss,
                }
            )
        return out

    def last_scope_for(who: Principal, scopes: list[dict[str, Any]]) -> dict[str, str] | None:
        mine = {(s["org"], w["name"]) for s in scopes for w in s["workspaces"]}
        stored = cfg.accounts.last_scope(who.session.user.id) if who.session else None
        if stored is not None and stored in mine:
            return {"org": stored[0], "workspace": stored[1]}
        for s in scopes:
            for w in s["workspaces"]:
                return {"org": s["org"], "workspace": w["name"]}
        return None

    def customer_locale() -> str:
        loc = server_cfg().web.locale
        return loc if loc in S.LOCALES else S.DEFAULT_LOCALE

    def user_public(user: User) -> dict[str, Any]:
        return {
            **user.public(),
            "assignments": [a.public() for a in cfg.accounts.assignments(user.id)],
        }

    def me_payload(session: Session) -> dict[str, Any]:
        own = session.user.locale
        who = Principal(session.user.role, session)
        scopes = scopes_for(who)
        return {
            "user": user_public(session.user),
            "stage": session.stage.value,
            "csrf": session.csrf,
            "locale": own if own in S.LOCALES else customer_locale(),
            "org_locale": customer_locale(),
            "scopes": scopes,
            "last_scope": last_scope_for(who, scopes),
        }

    # ------------------------------------------------------------------ health · auth

    async def health(request: Request) -> Response:
        policy_check(request)
        return respond(S.Health, {"ok": True, "passkeys": passkeys_available()})

    async def version(request: Request) -> Response:
        principal(request)
        return respond(S.Version, {"version": __version__})

    def set_session(resp: Response, token: str) -> None:
        resp.set_cookie(
            SESSION_COOKIE, token, max_age=SESSION_TTL_S, httponly=True,
            secure=cfg.secure_cookies, samesite="lax", path="/",
        )  # fmt: skip

    async def login(request: Request) -> Response:
        w = policy_check(request)
        data = await body(request)
        try:
            token, session = accounts().login(
                str(data.get("username") or ""),
                str(data.get("password") or ""),
                str(data["otp"]) if data.get("otp") else None,
                require_second_factor=server_cfg().access.two_factor,
                ip=w.address,
                ua=request.headers.get("user-agent", ""),
            )
        except AuthError as e:
            raise ApiError(401, e.code, str(e)) from e
        accounts().audit(session.user.id, "login", w.address)
        resp = respond(S.Me, me_payload(session))
        set_session(resp, token)
        return resp

    async def logout(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            accounts().logout(token)
            accounts().audit(who.user_id, "logout")
        resp = respond(S.Ok, {"ok": True})
        resp.delete_cookie(SESSION_COOKIE, path="/")
        return resp

    async def me(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            local = {"user": None, "stage": "full", "csrf": None, "local": True}
            scopes = scopes_for(who)
            return respond(
                S.Me,
                {**local, "locale": customer_locale(), "org_locale": customer_locale(),
                 "scopes": scopes, "last_scope": last_scope_for(who, scopes)},
            )  # fmt: skip
        if request.method == "PATCH":
            data = await body(request)
            uid = who.session.user.id
            if "locale" in data:
                # null or "" = follow the customer default (I31)
                loc = str(data["locale"] or "")
                if loc and loc not in S.LOCALES:
                    raise locale_error(nullable=True)
                accounts().set_locale(uid, loc)
            if isinstance(data.get("last_scope"), dict):
                want = (
                    str(data["last_scope"].get("org")),
                    str(data["last_scope"].get("workspace")),
                )
                if want not in cfg.placed or role_for(who, *want) is None:
                    raise ApiError(404, E.NOT_FOUND, NOT_FOUND)
                accounts().set_last_scope(uid, *want)
                last_seen[uid] = want
            if "password" in data:
                accounts().set_password(uid, str(data["password"]))
                accounts().audit(who.user_id, "password.change")
            session = accounts().session(request.cookies.get(SESSION_COOKIE))
            if session is None:  # a password change ends every session, this one too
                gone = {"user": None, "stage": "full", "csrf": None, "relogin": True}
                return respond(
                    S.Me, {**gone, "locale": customer_locale(), "org_locale": customer_locale()}
                )
            return respond(S.Me, me_payload(session))
        return respond(S.Me, me_payload(who.session))

    async def totp_begin(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            raise ApiError(
                400, E.ACCOUNT_REQUIRED, "log in with an account to set up a one-time code"
            )
        user = who.session.user
        store, key = accounts(), f"totp:{user.id}"
        if user.has_totp:
            # replacing a factor in use needs that factor: a taken-over session alone must
            # not be able to swap the second factor for someone else's
            if store.throttled(key):
                raise ApiError(429, E.LOGIN_THROTTLED, "too many attempts — try again later")
            current = str((await body(request)).get("current_code") or "")
            if not current:
                raise ApiError(
                    400, E.OTP_CURRENT_REQUIRED, "enter the code from the one-time code app in use"
                )
            if not store.check_current_totp(user.id, current):
                store.record_failure(key)
                raise ApiError(400, E.OTP_INVALID, "wrong one-time code")
            store.audit(who.user_id, "totp.replace.begin")
        return respond(S.TotpBegin, {"uri": store.begin_totp(user.id)})

    async def totp_confirm(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            raise ApiError(
                400, E.ACCOUNT_REQUIRED, "log in with an account to set up a one-time code"
            )
        key = f"totp:{who.session.user.id}"
        if accounts().throttled(key):  # guessing the six digits is limited like a login
            raise ApiError(429, E.LOGIN_THROTTLED, "too many attempts — try again later")
        code = str((await body(request)).get("code") or "")
        if not accounts().confirm_totp(who.session.user.id, code):
            accounts().record_failure(key)
            raise ApiError(400, E.OTP_INVALID, "wrong one-time code")
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            accounts().promote_session(token)
        accounts().audit(who.user_id, "totp.enrol")
        return respond(S.Ok, {"ok": True})

    # ------------------------------------------------------------- passkeys (W3)

    def passkeys_available() -> bool:
        try:
            relying_party()
        except HTTPException:
            return False
        return True

    def relying_party() -> tuple[str, str]:
        url = server_cfg().public_url
        parts = urlsplit(url or "")
        if parts.scheme not in ("https", "http") or not parts.hostname:
            raise ApiError(
                409,
                E.PASSKEYS_UNAVAILABLE,
                "passkeys need the server's public_url (https://…) in core/server.yaml",
            )
        return parts.hostname, f"{parts.scheme}://{parts.netloc}"

    async def passkey_register_begin(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            raise ApiError(400, E.ACCOUNT_REQUIRED, "log in with an account to add a passkey")
        rp_id, _origin = relying_party()
        user = who.session.user
        options = webauthn.generate_registration_options(
            rp_id=rp_id,
            rp_name="SoloSquad",
            user_name=user.username,
            user_id=user.id.encode(),
            user_display_name=user.display,
            exclude_credentials=[
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(pk["id"]))
                for pk in accounts().passkeys(user.id)
            ],
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
        )
        cid = accounts().new_challenge("register", options.challenge, user.id)
        opts = json.loads(webauthn.options_to_json(options))
        return respond(S.PasskeyOptions, {"challenge_id": cid, "options": opts})

    async def passkey_register_finish(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            raise ApiError(400, E.ACCOUNT_REQUIRED, "log in with an account to add a passkey")
        rp_id, origin = relying_party()
        data = await body(request)
        taken = accounts().take_challenge(str(data.get("challenge_id") or ""), "register")
        if taken is None or taken[1] != who.session.user.id:
            raise ApiError(400, E.PASSKEY_EXPIRED, "the passkey request expired — start again")
        cred = data.get("credential")
        if not isinstance(cred, dict):
            raise ApiError(
                400,
                E.PASSKEY_REJECTED,
                "send the credential from navigator.credentials.create()",
            )
        try:
            verified = webauthn.verify_registration_response(
                credential=cred,
                expected_challenge=taken[0],
                expected_origin=origin,
                expected_rp_id=rp_id,
                require_user_verification=True,
            )
        except Exception as e:  # the library raises its own errors for every bad response
            raise ApiError(400, E.PASSKEY_REJECTED, f"passkey was not accepted: {e}") from e
        transports = (cred.get("response") or {}).get("transports") or []
        accounts().add_passkey(
            who.session.user.id,
            bytes_to_base64url(verified.credential_id),
            verified.credential_public_key,
            verified.sign_count,
            [str(t) for t in transports],
            str(data.get("name") or "passkey"),
        )
        token = request.cookies.get(SESSION_COOKIE)
        if who.session.stage is SessionStage.ENROLL and token:
            accounts().promote_session(token)  # a passkey is a strong factor in itself
        accounts().audit(who.user_id, "passkey.add", str(data.get("name") or ""))
        mine = accounts().passkeys(who.session.user.id)
        return respond(S.PasskeyAdded, {"ok": True, "passkeys": mine})

    async def passkey_login_begin(request: Request) -> Response:
        policy_check(request)
        rp_id, _origin = relying_party()
        username = str((await body(request)).get("username") or "").strip().lower()
        uid = None
        allow: list[PublicKeyCredentialDescriptor] = []
        if username:
            match = [u for u in accounts().users() if u.username == username and not u.disabled]
            if match:
                uid = match[0].id
                allow = [
                    PublicKeyCredentialDescriptor(id=base64url_to_bytes(pk["id"]))
                    for pk in accounts().passkeys(uid)
                ]
        options = webauthn.generate_authentication_options(
            rp_id=rp_id,
            allow_credentials=allow,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        cid = accounts().new_challenge("login", options.challenge, uid)
        opts = json.loads(webauthn.options_to_json(options))
        return respond(S.PasskeyOptions, {"challenge_id": cid, "options": opts})

    async def passkey_login_finish(request: Request) -> Response:
        w = policy_check(request)
        rp_id, origin = relying_party()
        store = accounts()
        if store.throttled(f"ip:{w.address}"):
            raise ApiError(401, E.LOGIN_THROTTLED, "too many attempts — try again later")
        data = await body(request)
        cred = data.get("credential") or {}
        taken = store.take_challenge(str(data.get("challenge_id") or ""), "login")
        found = store.passkey(str(cred.get("id") or "")) if isinstance(cred, dict) else None
        unknown = ApiError(401, E.PASSKEY_NOT_RECOGNISED, "passkey not recognised")
        if taken is None or found is None or (taken[1] is not None and taken[1] != found[0]):
            store.record_failure(f"ip:{w.address}")
            raise unknown
        uid, public_key, sign_count = found
        try:
            verified = webauthn.verify_authentication_response(
                credential=cred,
                expected_challenge=taken[0],
                expected_rp_id=rp_id,
                expected_origin=origin,
                credential_public_key=public_key,
                credential_current_sign_count=sign_count,
                require_user_verification=True,
            )
        except Exception as e:
            store.record_failure(f"ip:{w.address}")
            raise unknown from e
        if store.user(uid).disabled:
            raise unknown
        store.touch_passkey(str(cred["id"]), verified.new_sign_count)
        token, session = store.open_session(
            uid, SessionStage.FULL, ip=w.address, ua=request.headers.get("user-agent", "")
        )
        store.audit(uid, "login.passkey", w.address)
        resp = respond(S.Me, me_payload(session))
        set_session(resp, token)
        return resp

    async def my_passkeys(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            return respond(list[S.Passkey], [])
        return respond(list[S.Passkey], accounts().passkeys(who.session.user.id))

    async def my_passkey_delete(request: Request) -> Response:
        who = principal(request)
        if who.session is None or not accounts().delete_passkey(
            who.session.user.id, request.path_params["pid"]
        ):
            raise ApiError(404, E.NOT_FOUND, "no such passkey")
        accounts().audit(who.user_id, "passkey.remove", request.path_params["pid"])
        return respond(S.Ok, {"ok": True})

    # ------------------------------------------------------------------ users · assignments

    def parse_assignments(raw: Any) -> list[Assignment]:
        if not isinstance(raw, list):
            raise ApiError(
                400, E.ASSIGNMENT_INVALID, "assignments must be a list of {org, workspace?, role}"
            )
        out = []
        for item in raw:
            if not isinstance(item, dict) or not item.get("org"):
                raise ApiError(400, E.ASSIGNMENT_INVALID, "each assignment needs an org")
            org, ws = str(item["org"]), item.get("workspace")
            try:
                found = cfg.solution.org(org)
                if ws:
                    found.workspace(str(ws))
            except LayoutError as e:
                where = f"{org}/{ws or '*'}"
                raise ApiError(400, E.ASSIGNMENT_UNKNOWN_SCOPE, str(e), scope=where) from e
            out.append(
                Assignment(org, str(ws) if ws else None, Role(str(item.get("role") or "staff")))
            )
        return out

    async def users(request: Request) -> Response:
        if request.method == "POST":
            who = need(request, "users.create")
            data = await body(request)
            assigned = parse_assignments(data.get("assignments") or [])
            user = accounts().create_user(
                str(data.get("username") or ""),
                str(data.get("password") or ""),
                Role(str(data.get("role") or Role.STAFF.value)),
                display=str(data.get("display") or ""),
                locale=str(data.get("locale") or ""),  # "" = follow the customer default
                assignments=assigned,
            )
            accounts().audit(
                who.user_id,
                "user.create",
                f"{user.username} as {user.role.value} · "
                + ", ".join(f"{a.org}/{a.workspace or '*'}:{a.role.value}" for a in assigned),
            )
            return respond(S.PublicUser, user_public(user), 201)
        need(request, "users.list")
        return respond(list[S.PublicUser], [user_public(u) for u in accounts().users()])

    async def user_update(request: Request) -> Response:
        who = need(request, "users.update")
        uid = request.path_params["uid"]
        data = await body(request)
        store = accounts()
        store.user(uid)
        if "teams" in data or "title" in data:
            raise ApiError(
                400,
                E.USER_FIELDS_MOVED,
                "title and teams are per org since rev7 — PATCH /api/o/{org}/people/{uid}",
            )
        if "role" in data:
            store.set_role(uid, Role(str(data["role"])))
            store.audit(who.user_id, "user.role", f"{uid} → {data['role']}")
        if "assignments" in data:
            assigned = parse_assignments(data["assignments"])
            store.set_assignments(uid, assigned)  # the next request already follows it (C30)
            store.audit(
                who.user_id,
                "user.assign",
                f"{uid} → "
                + (", ".join(f"{a.org}/{a.workspace or '*'}:{a.role.value}" for a in assigned)
                   or "nothing"),
            )  # fmt: skip
        if "disabled" in data:
            store.set_disabled(uid, bool(data["disabled"]))
            store.audit(who.user_id, "user.disable" if data["disabled"] else "user.enable", uid)
        if data.get("password"):
            store.set_password(uid, str(data["password"]))
            store.audit(who.user_id, "user.password.reset", uid)
        if data.get("reset_passkeys"):
            store.clear_passkeys(uid)
            store.audit(who.user_id, "user.passkeys.reset", uid)
        if data.get("reset_totp"):
            store.reset_totp(uid)
            store.audit(who.user_id, "user.totp.reset", uid)
        return respond(S.PublicUser, user_public(store.user(uid)))

    # ------------------------------------------------------------------ access policy

    def save_access(
        request: Request, current: Any, data: dict[str, Any], save: Callable[[Any], object]
    ) -> Any:
        nets = [str(x) for x in data.get("allowed_networks", current.allowed_networks)]
        for entry in nets:
            try:
                parse_networks([entry])
            except ValueError as e:
                raise ApiError(400, E.NETWORK_INVALID, str(e), entry=entry) from e
        proposed = current.model_copy(
            update={
                "allowed_networks": nets,
                "two_factor": bool(data.get("two_factor", current.two_factor)),
            }
        )
        here = where(request)
        if not allowed(proposed, here) and not data.get("confirm_lockout"):
            # K28 — refuse a list that would lock out the person saving it
            raise ApiError(
                409,
                E.ACCESS_LOCKOUT,
                f"your address {here.address} is not in the new list — you would lose"
                " access. Send confirm_lockout: true to save anyway.",
                address=here.address,
            )
        save(proposed)
        return proposed

    def access_change(before: Any, after: Any) -> str:
        return json.dumps(  # C14 — who · when (the row) · before · after
            {"before": before.model_dump(mode="json"), "after": after.model_dump(mode="json")},
            ensure_ascii=False,
        )

    async def access(request: Request) -> Response:
        """The customer's default access policy (core/server.yaml)."""
        srv = server_cfg()
        if request.method == "PUT":
            who = need(request, "access.update")
            proposed = save_access(
                request,
                srv.access,
                await body(request),
                lambda p: cfg.solution.update_server_config(access=p),
            )
            accounts().audit(who.user_id, "access.update", access_change(srv.access, proposed))
            return respond(S.AccessPolicy, _access_public(proposed))
        need(request, "access.get")
        return respond(S.AccessPolicy, _access_public(srv.access))

    async def ws_access(request: Request) -> Response:
        """The workspace's own extra limits (workspace.yaml) — on top of the default."""
        sc, ws = in_scope(request), runtime(request).workspace
        ws_cfg = ws.config()
        if request.method == "PUT":
            need(request, "ws_access.update")
            proposed = save_access(
                request,
                ws_cfg.access,
                await body(request),
                lambda p: ws.save_config(ws.config().model_copy(update={"access": p})),
            )
            org_audit(sc, "access.update", access_change(ws_cfg.access, proposed))
            return respond(S.AccessPolicy, _access_public(proposed))
        need(request, "ws_access.get")
        return respond(S.AccessPolicy, _access_public(ws_cfg.access))

    async def audit(request: Request) -> Response:
        need(request, "audit")
        rows = accounts().audit_log(int(request.query_params.get("limit", "200")))
        return respond(list[S.AuditEntry], rows)

    async def settings(request: Request) -> Response:
        if request.method == "PUT":
            who = need(request, "settings.update")
            data = await body(request)
            loc = str(data.get("locale") or "")
            if loc not in S.LOCALES:
                raise locale_error(nullable=False)
            web = server_cfg().web.model_copy(update={"locale": loc})
            cfg.solution.update_server_config(web=web)
            accounts().audit(who.user_id, "settings.update", f"locale={loc}")
            return respond(S.WebSettings, {"locale": loc})
        need(request, "settings.get")
        return respond(S.WebSettings, {"locale": customer_locale()})

    # ------------------------------------------------------------------ profile · snapshot

    def profile_payload() -> dict[str, Any]:
        profile = load_profile(cfg.solution.root)
        return {"profile": profile.model_dump(mode="json"), "checklist": profile.checklist()}

    async def profile(request: Request) -> Response:
        if request.method == "PUT":
            who = need(request, "profile.update")
            root = cfg.solution.root
            before = load_profile(root)
            data = await body(request)
            try:
                updated = update_profile(before, data)
            except ValueError as e:  # the model's own rules, pydantic's included
                raise ApiError(400, E.PROFILE_INVALID, str(e)) from e
            save_profile(root, updated)  # the country goes to core/server.yaml (I41)
            for rt in cfg.runtimes.values():
                if rt.router is not None:
                    rt.router.server_country = updated.server.country
            changed = sorted(
                k for k in ("server", "entities", "languages", "privacy")
                if getattr(updated, k) != getattr(before, k)
            )  # fmt: skip
            accounts().audit(who.user_id, "profile.update", f"sections={changed}")
            return respond(S.ProfileResponse, profile_payload())
        need(request, "profile.get")
        return respond(S.ProfileResponse, profile_payload())

    def snapshot_payload() -> dict[str, Any]:
        target = server_cfg().snapshot
        ref = target.secret_ref
        has = bool(ref and cfg.secrets is not None and cfg.secrets.get(ref))
        out = target.model_dump(mode="json", exclude={"secret_ref"})
        return {**out, "has_secret": has}

    async def snapshot(request: Request) -> Response:
        if request.method == "PUT":
            who = need(request, "snapshot.update")
            data = await body(request)
            kind = data.get("type")
            try:
                target = build_target(
                    str(kind) if kind else None,
                    endpoint=str(data.get("endpoint") or "") or None,
                    region=str(data.get("region") or "us-east-1"),
                    bucket=str(data.get("bucket") or "") or None,
                    prefix=str(data.get("prefix") or "solosquad"),
                    path=str(data.get("path") or "") or None,
                    keep_days=int(data.get("keep_days") or 30),
                )  # the same check as `snapshot set`
            except ValueError as e:
                raise ApiError(400, E.SNAPSHOT_INVALID, str(e)) from e
            access_key, secret = data.get("access_key"), data.get("secret_key")
            if target.type == "s3":
                if cfg.secrets is None:
                    raise ApiError(404, E.SECRET_STORE_MISSING, "no secret store on this server")
                if access_key or secret:
                    if not (access_key and secret):
                        raise ApiError(
                            400, E.SNAPSHOT_KEYS_REQUIRED, "send both access_key and secret_key"
                        )
                    cfg.secrets.set(S3_SECRET_REF, f"{access_key}:{secret}")
                elif not cfg.secrets.get(S3_SECRET_REF):
                    raise ApiError(
                        400,
                        E.SNAPSHOT_KEYS_REQUIRED,
                        "an s3 target needs access_key and secret_key",
                    )
            cfg.solution.update_server_config(snapshot=target)
            keys = " · keys replaced" if access_key else ""
            accounts().audit(who.user_id, "snapshot.update", f"type={target.type}{keys}")
            return respond(S.SnapshotSettings, snapshot_payload())
        need(request, "snapshot.get")
        return respond(S.SnapshotSettings, snapshot_payload())

    async def snapshot_run(request: Request) -> Response:
        who = need(request, "snapshot.run")
        if cfg.run_snapshot is None:
            raise ApiError(404, E.SNAPSHOT_UNAVAILABLE, "snapshots cannot be run from this server")
        try:
            result = await asyncio.to_thread(cfg.run_snapshot)
        except (ValueError, OSError) as e:
            accounts().audit(who.user_id, "snapshot.failed", f"{type(e).__name__}: {e}")
            raise ApiError(502, E.SNAPSHOT_FAILED, f"snapshot failed: {e}") from e
        accounts().audit(who.user_id, "snapshot.run", repr(result))
        return respond(S.SnapshotRunResult, result)

    # ------------------------------------------------------------------ org scope

    def org_root(request: Request) -> Path:
        return cfg.solution.org(in_scope(request).org).root

    def org_runtimes(org: str) -> list[RuntimeView]:
        return [rt for (o, _w), rt in sorted(cfg.runtimes.items()) if o == org]

    def org_resolver(request: Request) -> Resolver:
        """What the org defines (team · package), without any workspace's overrides."""
        for rt in org_runtimes(in_scope(request).org):
            if rt.resolver is not None:
                return Resolver(rt.resolver.ctx, workspace_layer=False)
        raise ApiError(503, E.ORG_NOT_RUNNING, "no workspace of this org is running")

    def org_store(request: Request) -> OrgStore | None:
        return cfg.orgs.get(in_scope(request).org)

    def policy(request: Request) -> ApprovalPolicy:
        return load_policy(org_root(request) / "approvals.yaml")

    def people_of(org: str) -> list[User]:
        return [
            u
            for u in cfg.accounts.users()
            if not u.disabled and cfg.accounts.role_in(u, org, None) is not None
        ]

    def teams_of(sc: InScope) -> list[str]:
        store = cfg.orgs.get(sc.org)
        if sc.who.session is None or store is None:
            return []
        return list(store.member(sc.who.session.user.id)[1])

    async def screen(request: Request) -> Response:
        need(request, "screens")
        return respond(
            S.ScreenResponse, load_screen(org_root(request), request.path_params["name"])
        )

    async def teams(request: Request) -> Response:
        need(request, "teams")
        return respond(
            list[S.Team],
            [
                {"name": name, "members": comp.members}
                for name, comp in org_resolver(request).teams().items()
            ],
        )

    def localized(value: Any) -> dict[str, str]:
        """`{ko: …, en: …, zh-CN: …}` from a SKILL.md field — anything else is dropped."""
        if not isinstance(value, dict):
            return {}
        return {
            k: v.strip()
            for k, v in value.items()
            if k in S.LOCALES and isinstance(v, str) and v.strip()
        }

    def agent_words(res: Any) -> dict[str, Any]:
        extra = res.spec.extra if res else {}
        return {
            "display_name": localized(extra.get("display_name")),
            "summary": localized(extra.get("summary")),
        }

    def agent_rows(r: Resolver, working: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
        out = []
        for name, res in sorted(r.available("agents").items()):
            appearance = res.spec.extra.get("appearance")
            out.append(
                {
                    "name": name,
                    "description": res.spec.description,
                    **agent_words(res),
                    "team": r.team_of(name),
                    "layer": res.layer,
                    "appearance": appearance if isinstance(appearance, dict) else None,
                    "working_on": working.get(name, []),
                }
            )
        return out

    async def org_agents(request: Request) -> Response:
        """The org's agent definitions — who is at work is per workspace (`.../w/{ws}/agents`)."""
        need(request, "agents")
        return respond(list[S.Agent], agent_rows(org_resolver(request), {}))

    async def people(request: Request) -> Response:
        need(request, "people.list")
        sc = in_scope(request)
        store = org_store(request)
        out = []
        for u in people_of(sc.org):
            title, tms = store.member(u.id) if store else ("", ())
            mine = [a for a in cfg.accounts.assignments(u.id) if a.org == sc.org]
            whole = u.role is Role.OWNER or any(a.workspace is None for a in mine)
            out.append(
                {
                    "id": u.id,
                    "username": u.username,
                    "display": u.display,
                    "role": (cfg.accounts.role_in(u, sc.org) or Role.STAFF).value,
                    "title": title,
                    "teams": list(tms),
                    "workspaces": None if whole else sorted(a.workspace or "" for a in mine),
                }
            )
        return respond(list[S.OrgPerson], out)

    async def person_update(request: Request) -> Response:
        need(request, "people.update")
        sc = in_scope(request)
        uid = request.path_params["uid"]
        user = cfg.accounts.user(uid)
        if cfg.accounts.role_in(user, sc.org) is None:
            raise ApiError(404, E.NOT_FOUND, f"no person {uid} in this org")
        store = org_store(request)
        if store is None:
            raise ApiError(
                503, E.ORG_RECORDS_UNAVAILABLE, "this org's records are not open on this server"
            )
        data = await body(request)
        teams_in = data.get("teams")
        if teams_in is not None and not isinstance(teams_in, list):
            raise ApiError(400, E.TEAMS_INVALID, "teams must be a list of team names")
        title, tms = store.set_member(
            uid,
            title=str(data["title"]) if "title" in data else None,
            teams=[str(t) for t in teams_in] if teams_in is not None else None,
        )
        org_audit(sc, "user.profile", f"{uid} teams={list(tms)} title={title!r}")
        mine = [a for a in cfg.accounts.assignments(uid) if a.org == sc.org]
        whole = user.role is Role.OWNER or any(a.workspace is None for a in mine)
        return respond(
            S.OrgPerson,
            {
                "id": user.id,
                "username": user.username,
                "display": user.display,
                "role": (cfg.accounts.role_in(user, sc.org) or Role.STAFF).value,
                "title": title,
                "teams": list(tms),
                "workspaces": None if whole else sorted(a.workspace or "" for a in mine),
            },
        )

    async def org_chart(request: Request) -> Response:
        need(request, "org_chart")
        sc = in_scope(request)
        r = org_resolver(request)
        agents = r.available("agents")
        store = org_store(request)
        people = people_of(sc.org)
        member = {u.id: (store.member(u.id) if store else ("", ())) for u in people}
        role = {u.id: cfg.accounts.role_in(u, sc.org) or Role.STAFF for u in people}

        def agent_card(name: str) -> dict[str, Any]:
            res = agents.get(name)
            appearance = res.spec.extra.get("appearance") if res else None
            return {
                "name": name,
                "description": res.spec.description if res else "",
                **agent_words(res),
                "appearance": appearance if isinstance(appearance, dict) else None,
            }

        def person_card(u: User) -> dict[str, Any]:
            return {"id": u.id, "display": u.display, "title": member[u.id][0],
                    "role": role[u.id].value}  # fmt: skip

        teams = []
        named = set()
        for name, comp in r.teams().items():
            named.add(name)
            teams.append(
                {
                    "name": name,
                    "agents": [agent_card(a) for a in comp.members if a in agents],
                    "people": [person_card(u) for u in people if name in member[u.id][1]],
                }
            )
        owners = [person_card(u) for u in people if role[u.id] is Role.OWNER]
        unassigned = [
            person_card(u)
            for u in people
            if role[u.id] is not Role.OWNER and not (set(member[u.id][1]) & named)
        ]
        return respond(S.OrgChart, {"owners": owners, "teams": teams, "unassigned": unassigned})

    async def org_audit_log(request: Request) -> Response:
        need(request, "org_audit")
        store = org_store(request)
        rows = store.audit_log(int(request.query_params.get("limit", "200"))) if store else []
        return respond(list[S.AuditEntry], rows)

    async def approval_policy(request: Request) -> Response:
        path = org_root(request) / "approvals.yaml"
        if request.method == "PUT":
            need(request, "approval_policy.update")
            tiers = (await body(request)).get("tiers")
            if not isinstance(tiers, dict):
                raise ApiError(
                    400, E.APPROVAL_POLICY_INVALID, "send {tiers: {category: owner|team}}"
                )
            if UNCLASSIFIED in tiers:
                raise ApiError(
                    400, E.UNCLASSIFIED_OWNER_ONLY, "unclassified approvals always go to the owner"
                )
            before = policy(request)
            try:
                chosen = {str(k): Tier(str(v)) for k, v in tiers.items()}
            except ValueError as e:
                raise ApiError(400, E.APPROVAL_POLICY_INVALID, str(e)) from e
            updated = {**before.overrides, **chosen}
            # keep only what differs from the recommendation — the file stays a list of choices
            overrides = {k: v for k, v in updated.items() if RECOMMENDED.get(k) is not v}
            save_policy(path, ApprovalPolicy(overrides))
            after = ApprovalPolicy(overrides)
            changes = [
                {"category": c, "before": before.tier(c).value, "after": after.tier(c).value}
                for c in sorted({str(k) for k in tiers})
                if before.tier(c) is not after.tier(c)
            ]
            deviations = [r["category"] for r in after.table() if r["deviates"]]
            org_audit(  # C25 — who · when (the row) · category · before · after
                in_scope(request),
                "approval_policy.update",
                json.dumps({"changes": changes, "deviates": deviations}, ensure_ascii=False),
            )
            return respond(list[S.ApprovalPolicyRow], ApprovalPolicy(overrides).table())
        need(request, "approval_policy.get")
        return respond(list[S.ApprovalPolicyRow], policy(request).table())

    # ------------------------------------------------------------------ connections

    def server_country() -> str | None:
        return server_cfg().server_country

    def own_file(request: Request) -> Path:
        """Connections added in the web go to the org's own file (core stays the owner's)."""
        return org_root(request) / "connections.yaml"

    def visible(request: Request) -> list[tuple[Connection, str]]:
        merged: dict[str, tuple[Connection, str]] = {
            c.id: (c, "core") for c in load_connections(cfg.solution.connections_path)
        }
        merged.update({c.id: (c, "org") for c in load_connections(own_file(request))})
        return list(merged.values())

    def refresh_routers(org: str) -> None:
        for rt in org_runtimes(org):
            if rt.router is not None and rt.reload_connections is not None:
                rt.router.connections[:] = rt.reload_connections()

    def org_secret(org: str, ref: str) -> str | None:
        for rt in org_runtimes(org):
            if rt.secrets is not None:
                return rt.secrets.get(ref)
        return None

    def conn_public(c: Connection, source: str, org: str) -> dict[str, Any]:
        secret = org_secret(org, c.secret_ref) if c.secret_ref else None
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
            "source": source,
        }

    def entity_required() -> ApiError:
        return ApiError(400, E.ENTITY_REQUIRED, ENTITY_REQUIRED)

    def ineligible(verdict: Verdict) -> ApiError:
        code = (
            E.CONNECTION_INELIGIBLE_SERVER if verdict.by == "server"
            else E.CONNECTION_INELIGIBLE_ENTITY
        )  # fmt: skip
        return ApiError(
            422,
            code,
            f"{verdict.reason} — see {verdict.source}",
            provider=verdict.provider,
            country=verdict.country,
            source=verdict.source,
        )

    async def connections(request: Request) -> Response:
        sc = in_scope(request)
        if request.method == "POST":
            need(request, "connections.create")
            data = await body(request)
            entity = Entity.model_validate(data["entity"]) if data.get("entity") else None
            cid = str(data.get("id") or "").strip()
            if not cid:
                raise ApiError(400, E.CONNECTION_ID_REQUIRED, "id is required")
            path = own_file(request)
            existing = load_connections(path)
            if any(c.id == cid for c, _src in visible(request)):
                raise ApiError(400, E.CONNECTION_EXISTS, f"connection {cid!r} exists", id=cid)
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
            if entity is None and providers_reached(conn.provider, conn.harness, conn.models):
                raise entity_required()  # C18 — eligibility is judged on the holder
            verdict = judge(conn.provider, conn.harness, conn.models, entity, server_country())
            if not verdict.ok:
                raise ineligible(verdict)
            if data.get("secret"):
                stores = [rt.secrets for rt in org_runtimes(sc.org) if rt.secrets is not None]
                if not stores:
                    raise ApiError(
                        404, E.SECRET_STORE_MISSING, "no secret store for this org on this server"
                    )
                conn = conn.model_copy(update={"secret_ref": f"conn:{cid}"})
                for store in stores:  # every workspace of the org routes through it
                    store.set(f"conn:{cid}", str(data["secret"]))
            save_connections(path, [*existing, conn])
            refresh_routers(sc.org)
            org_audit(sc, "connection.create", cid)
            return respond(S.ConnectionOut, conn_public(conn, "org", sc.org), 201)
        need(request, "connections.list")
        return respond(
            list[S.ConnectionOut], [conn_public(c, src, sc.org) for c, src in visible(request)]
        )

    async def connection_update(request: Request) -> Response:
        sc = in_scope(request)
        cid = request.path_params["cid"]
        path = own_file(request)
        existing = load_connections(path)
        found = next((c for c in existing if c.id == cid), None)
        if request.method == "DELETE":
            need(request, "connections.delete")
            if found is None:
                raise KeyError(f"no editable connection {cid}")
            save_connections(path, [c for c in existing if c.id != cid])
            if found.secret_ref:
                for rt in org_runtimes(sc.org):
                    if rt.secrets is not None:
                        rt.secrets.delete(found.secret_ref)
            refresh_routers(sc.org)
            org_audit(sc, "connection.delete", cid)
            return respond(S.Ok, {"ok": True})
        need(request, "connections.update")
        if found is None:
            raise KeyError(f"no editable connection {cid}")
        data = await body(request)
        update: dict[str, Any] = {}
        if "active" in data:
            update["active"] = bool(data["active"])
        if "monthly_budget_usd" in data:
            update["monthly_budget_usd"] = data["monthly_budget_usd"]
        if "entity" in data:
            update["entity"] = Entity.model_validate(data["entity"]) if data["entity"] else None
        changed = found.model_copy(update=update)
        if (
            "entity" in data
            and changed.entity is None
            and providers_reached(changed.provider, changed.harness, changed.models)
        ):
            raise entity_required()
        verdict = judge(
            changed.provider, changed.harness, changed.models, changed.entity, server_country()
        )
        if changed.active and not verdict.ok:
            raise ineligible(verdict)
        save_connections(path, [changed if c.id == cid else c for c in existing])
        refresh_routers(sc.org)
        org_audit(sc, "connection.update", f"{cid} {sorted(update)}")
        return respond(S.ConnectionOut, conn_public(changed, "org", sc.org))

    # ------------------------------------------------------------------ workflows (org)

    def org_engines(org: str) -> list[WorkflowEngine]:
        return [rt.workflows for rt in org_runtimes(org) if rt.workflows is not None]

    def org_summaries(org: str) -> tuple[list[dict[str, Any]], list[str]]:
        engines = org_engines(org)
        if not engines:
            raise ApiError(404, E.FEATURE_DISABLED, "workflows are not enabled for this org")
        first = engines[0]
        return [{**w, "last_run": None} for w in first.summaries()], first.errors

    async def workflows(request: Request) -> Response:
        """The org's workflow definitions and switches; runs are per workspace."""
        need(request, "workflows.list")
        found, errors = org_summaries(in_scope(request).org)
        return respond(S.WorkflowList, {"workflows": found, "errors": errors})

    async def workflow_update(request: Request) -> Response:
        need(request, "workflows.update")
        sc = in_scope(request)
        name = request.path_params["name"]
        data = await body(request)
        if "enabled" not in data:
            raise ApiError(400, E.INVALID_REQUEST, "send {enabled: true|false}")
        engines = org_engines(sc.org)
        if not engines:
            raise ApiError(404, E.FEATURE_DISABLED, "workflows are not enabled for this org")
        for e in engines:  # one switch for the org: every workspace's scheduler follows it
            e.set_enabled(name, bool(data["enabled"]))
        org_audit(sc, "workflow.enable" if data["enabled"] else "workflow.disable", name)
        found = next(w for w in org_summaries(sc.org)[0] if w["name"] == name)
        return respond(S.WorkflowSummary, found)

    # ------------------------------------------------------------------ workspace scope

    def waiting_card(mgr: RunManager, tid: str) -> dict[str, Any] | None:
        # only the thread's newest run can be waiting: once answered, the resume run is
        # newer and the old interrupted run stays in the store as history
        for run in mgr.store.runs(thread_id=tid, limit=1):
            if run["status"] != RunStatus.INTERRUPTED:
                return None
            for item in run.get("interrupts") or []:
                value = item.get("value")
                if isinstance(value, dict):
                    return value
        return None

    def may_approve(request: Request, card: dict[str, Any] | None) -> bool:
        sc = in_scope(request)
        if sc.role is Role.OWNER:  # the role in this org (decision 57 · I25 rev7)
            return True
        return card is not None and can_approve(
            policy(request), card, is_owner=False, teams=teams_of(sc)
        )

    def check_approver(request: Request, mgr: RunManager, tid: str) -> dict[str, Any] | None:
        card = waiting_card(mgr, tid)
        if not may_approve(request, card):
            tier = policy(request).tier((card or {}).get("category")).value
            if tier == "owner":
                raise ApiError(403, E.APPROVAL_NEEDS_OWNER, "this approval needs the owner")
            team = str((card or {}).get("team"))
            raise ApiError(
                403, E.APPROVAL_NEEDS_TEAM, f"this approval needs team {team}", team=team
            )
        return card

    def approval_change(
        request: Request,
        source: str,
        tid: str,
        rid: str,
        value: Any,
        card: dict[str, Any] | None,
        approver: str,
    ) -> str:
        # C6 · C23 — who (the row and `approver`) · when (the row) · what kind and whose team,
        # read from the card that was waiting, so the record stands without the run
        c = card or {}
        return json.dumps(
            {
                "source": source,
                "thread": tid,
                "run": rid,
                "value": value,
                "category": c.get("category"),
                "team": c.get("team"),
                "tier": policy(request).tier(c.get("category")).value,
                "approver": approver,
            },
            ensure_ascii=False,
        )

    async def threads(request: Request) -> Response:
        m = runtime(request).manager
        if request.method == "POST":
            need(request, "threads.create")
            data = await body(request)
            tid = m.create_thread(str(data.get("title") or "task"), data.get("metadata"))
            return respond(S.ThreadCreated, {"thread_id": tid}, 201)
        need(request, "threads.list")
        limit = int(request.query_params.get("limit", "50"))
        return respond(list[S.Thread], m.store.threads(limit))

    async def thread_state(request: Request) -> Response:
        need(request, "threads.state")
        m = runtime(request).manager
        tid = request.path_params["tid"]
        if m.store.thread(tid) is None:
            raise KeyError(f"no thread {tid}")
        return respond(S.ThreadState, await m.thread_state(tid))

    async def thread_run(request: Request) -> Response:
        need(request, "threads.run")
        m = runtime(request).manager
        text = (await body(request)).get("input")
        tid = request.path_params["tid"]
        if m.store.thread(tid) is None:
            raise KeyError(f"no thread {tid}")
        rid = await m.submit(tid, text if isinstance(text, str) else None)
        return respond(S.RunCreated, {"run_id": rid}, 201)

    async def thread_resume(request: Request) -> Response:
        who = need(request, "threads.resume")
        m = runtime(request).manager
        tid = request.path_params["tid"]
        if m.store.thread(tid) is None:
            raise KeyError(f"no thread {tid}")
        card = check_approver(request, m, tid)
        value = (await body(request)).get("value")
        rid = await m.resume(tid, value, source=f"user:{who.name}")
        org_audit(
            in_scope(request),
            "approval",
            approval_change(request, "company", tid, rid, value, card, who.name),
        )
        return respond(S.RunCreated, {"run_id": rid}, 201)

    async def runs(request: Request) -> Response:
        need(request, "runs.list")
        m = runtime(request).manager
        q = request.query_params
        since = float(q["since"]) if q.get("since") else None
        return respond(
            list[S.Run],
            m.store.runs(
                thread_id=q.get("thread_id"),
                status=q.get("status"),
                since=since,
                limit=int(q.get("limit", "50")),
            ),
        )

    async def run(request: Request) -> Response:
        need(request, "runs.get")
        rid = request.path_params["rid"]
        found = runtime(request).manager.store.run(rid)
        if found is None:
            raise KeyError(f"no run {rid}")
        return respond(S.Run, found)

    async def ledger(request: Request) -> Response:
        need(request, "ledger")
        totals = runtime(request).ledger.totals(request.query_params.get("by", "agent"))
        return respond(S.LedgerTotals, totals)

    def hub_for(rt: RuntimeView) -> EventHub:
        hub = hubs.get(rt.key)
        if hub is None:
            others = {"workflow": rt.workflows.manager} if rt.workflows else None
            hub = hubs[rt.key] = EventHub(rt.manager, others=others)
        return hub

    async def events(request: Request) -> Response:
        need(request, "events")
        hub = hub_for(runtime(request))
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

    async def working(request: Request) -> Response:
        """The agents as this workspace sees them (its overrides) and what each works on."""
        need(request, "working")
        rt = runtime(request)
        if rt.resolver is None:
            raise ApiError(404, E.FEATURE_DISABLED, "the agents are not visible on this server")
        m = rt.manager
        busy: dict[str, list[dict[str, Any]]] = {}
        for item in m.store.runs(status=RunStatus.RUNNING, limit=200):
            state = await m.thread_state(item["thread_id"])
            active = (state.get("values") or {}).get("active_agent") or "chief"
            thread = m.store.thread(item["thread_id"]) or {}
            busy.setdefault(str(active), []).append(
                {"thread_id": item["thread_id"], "run_id": item["id"], "title": thread.get("title")}
            )
        return respond(list[S.Agent], agent_rows(rt.resolver, busy))

    async def budget(request: Request) -> Response:
        need(request, "budget")
        rt = runtime(request)
        since = month_start()
        by_conn = rt.ledger.totals("connection_id", since=since)
        total = sum(v["cost_usd"] for v in by_conn.values())
        chief = rt.router.chief_policy.budget if rt.router else None
        warn_at = chief.warn_at if chief else 0.8
        org_cap = chief.monthly_usd if chief else None
        conns = (
            rt.reload_connections()
            if rt.reload_connections
            else (list(rt.router.connections) if rt.router else [])
        )
        rows = []
        for c in conns:
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
        return respond(
            S.Budget,
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
            },
        )

    def engine(request: Request) -> WorkflowEngine:
        found = runtime(request).workflows
        if found is None:
            raise ApiError(404, E.FEATURE_DISABLED, "workflows are not enabled in this workspace")
        return found

    def store(request: Request) -> ArtifactStore:
        found = runtime(request).artifacts
        if found is None:
            raise ApiError(404, E.FEATURE_DISABLED, "artifacts are not enabled in this workspace")
        return found

    async def ws_workflows(request: Request) -> Response:
        """The org's workflows with this workspace's last run of each."""
        need(request, "workflows.list")
        e = engine(request)
        return respond(S.WorkflowList, {"workflows": e.summaries(), "errors": e.errors})

    async def workflow_run(request: Request) -> Response:
        who = need(request, "workflows.run")
        name = request.path_params["name"]
        inputs = (await body(request)).get("inputs") or {}
        if not isinstance(inputs, dict):
            raise ApiError(400, E.WORKFLOW_INPUT_INVALID, "inputs must be an object")
        try:
            tid, rid = await engine(request).run_now(name, inputs, source=f"user:{who.name}")
        except ValueError as e:  # a missing input · an upload id that is not one
            raise ApiError(400, E.WORKFLOW_INPUT_INVALID, str(e)) from e
        org_audit(in_scope(request), "workflow.run", name)
        return respond(S.WorkflowRunCreated, {"thread_id": tid, "run_id": rid}, 201)

    async def workflow_runs(request: Request) -> Response:
        need(request, "workflows.list")
        q = request.query_params
        runs_store = engine(request).manager.store
        limit = int(q.get("limit", "50"))
        name = q.get("workflow")
        found = runs_store.runs(
            thread_id=q.get("thread_id"),
            status=q.get("status"),
            limit=limit if name is None else max(limit, 200),
        )
        if name is not None:  # the run's thread remembers which workflow it belongs to
            found = [
                r
                for r in found
                if (runs_store.thread(r["thread_id"]) or {}).get("metadata", {}).get("workflow")
                == name
            ][:limit]
        return respond(list[S.Run], found)

    async def workflow_run_get(request: Request) -> Response:
        need(request, "workflows.list")
        found = engine(request).manager.store.run(request.path_params["rid"])
        if found is None:
            raise KeyError(f"no workflow run {request.path_params['rid']}")
        return respond(S.Run, found)

    async def workflow_state(request: Request) -> Response:
        need(request, "workflows.list")
        tid = request.path_params["tid"]
        e = engine(request)
        if e.manager.store.thread(tid) is None:
            raise KeyError(f"no workflow thread {tid}")
        return respond(S.WorkflowThreadState, await e.manager.thread_state(tid))

    async def workflow_resume(request: Request) -> Response:
        who = need(request, "workflows.approve")
        tid = request.path_params["tid"]
        e = engine(request)
        if e.manager.store.thread(tid) is None:
            raise KeyError(f"no workflow thread {tid}")
        card = check_approver(request, e.manager, tid)
        value = (await body(request)).get("value")
        rid = await e.manager.resume(tid, value, source=f"user:{who.name}")
        org_audit(
            in_scope(request),
            "approval",
            approval_change(request, "workflow", tid, rid, value, card, who.name),
        )
        return respond(S.RunCreated, {"run_id": rid}, 201)

    async def uploads(request: Request) -> Response:
        if request.method == "POST":
            need(request, "uploads.create")
            filename = request.query_params.get("filename") or ""
            declared = int(request.headers.get("content-length") or "0")
            limit_mb = UPLOAD_LIMIT // (1024 * 1024)
            too_large = ApiError(
                413, E.UPLOAD_TOO_LARGE, f"file is larger than {limit_mb} MB", limit_mb=limit_mb
            )
            if declared > UPLOAD_LIMIT:
                raise too_large
            if Path(filename).suffix.lower() not in UPLOAD_TYPES:
                kinds = ", ".join(UPLOAD_TYPES)
                raise ApiError(
                    400, E.UPLOAD_TYPE, f"only {kinds} files can be uploaded", types=kinds
                )
            data = await request.body()
            if len(data) > UPLOAD_LIMIT:
                raise too_large
            if not data:
                raise ApiError(400, E.UPLOAD_EMPTY, "empty file")
            meta = engine(request).save_upload(filename, data)
            org_audit(in_scope(request), "upload", f"{meta['filename']} ({meta['size']} B)")
            return respond(S.Upload, meta, 201)
        need(request, "uploads.list")
        return respond(list[S.Upload], engine(request).uploads_list())

    async def artifacts(request: Request) -> Response:
        need(request, "artifacts.list")
        q = request.query_params
        review = q.get("needs_review")
        found = store(request).find(
            kind=q.get("kind"),
            thread_id=q.get("thread_id"),
            workflow=q.get("workflow"),
            needs_review=None if review is None else review.lower() in ("1", "true", "yes"),
            since=float(q["since"]) if q.get("since") else None,
            limit=int(q.get("limit", "50")),
        )
        return respond(list[S.Artifact], [_artifact_public(a) for a in found])

    async def artifact_get(request: Request) -> Response:
        need(request, "artifacts.list")
        return respond(S.Artifact, _artifact_public(store(request).get(request.path_params["aid"])))

    async def artifact_review(request: Request) -> Response:
        who = need(request, "artifacts.review")
        art = store(request).mark_reviewed(request.path_params["aid"], who.name)
        org_audit(in_scope(request), "artifact.review", art.id)
        return respond(S.Artifact, _artifact_public(art))

    # ------------------------------------------------------------------ schedules · work

    def next_fire(schedule: str, tz: str) -> float | None:
        trigger = CronTrigger.from_crontab(schedule, timezone=tz)
        nxt = trigger.get_next_fire_time(None, datetime.now(trigger.timezone))
        return nxt.timestamp() if nxt is not None else None

    async def schedules(request: Request) -> Response:
        """The workspace's scheduled runs — workflow schedules and the org's crons (standing
        goals and routines) — with when each fires next and how it went last time. Read-only;
        a workflow's schedule is switched with the workflow (`PATCH …/workflows/{name}`)."""
        need(request, "schedules.list")
        rt = runtime(request)
        tz = rt.manager.timezone
        rows: list[dict[str, Any]] = []
        errors: list[str] = []

        def when(schedule: str, enabled: bool, label: str) -> float | None:
            try:
                nxt = next_fire(schedule, tz)
            except ValueError as e:
                errors.append(f"{label}: {schedule!r}: {e}")
                return None
            return nxt if enabled else None

        e = rt.workflows
        if e is not None:
            for wf in e.summaries():
                if e.scheduled(wf["name"]) is None:
                    continue  # no schedule, or one that would wait for an upload
                on = bool(wf["enabled"])
                rows.append(
                    {
                        "id": f"wf:{wf['name']}",
                        "kind": "workflow",
                        "name": wf["name"],
                        "title": wf["title"],
                        "schedule": wf["schedule"],
                        "enabled": on,
                        "next_run": when(wf["schedule"], on, wf["name"]),
                        "last_run": wf["last_run"],
                        "workflow": wf["name"],
                    }
                )
        recent = rt.manager.store.runs(limit=500)
        for c in load_crons(org_root(request) / "crons"):
            last = next((r for r in recent if r["source"] == f"cron:{c.name}"), None)
            rows.append(
                {
                    "id": f"cron:{c.name}",
                    "kind": "goal" if c.thread else "routine",
                    "name": c.name,
                    "title": c.name,
                    "schedule": c.schedule,
                    "enabled": c.enabled,
                    "next_run": when(c.schedule, c.enabled, c.name),
                    "last_run": {k: last[k] for k in ("id", "status", "created")} if last else None,
                    "workflow": None,
                }
            )
        rows.sort(key=lambda r: (r["next_run"] is None, r["next_run"] or 0, r["title"]))
        return respond(S.ScheduleList, {"timezone": tz, "schedules": rows, "errors": errors})

    async def work(request: Request) -> Response:
        """Agent work for Task: each conversation and workflow run once (by its newest run),
        who worked on it and what it made. Read-only — joins the run stores, the cost ledger
        and the artifacts, so the web does not fetch every thread's state."""
        need(request, "work.list")
        rt = runtime(request)
        q = request.query_params
        since = float(q["since"]) if q.get("since") else None
        limit = max(1, min(int(q.get("limit", "50")), 200))
        arts = rt.artifacts

        def agents_of(tid: str) -> list[str]:
            seen: list[str] = []
            for entry in reversed(rt.ledger.entries(thread_id=tid, limit=200)):
                agent = entry.get("agent")
                if agent and agent not in seen:
                    seen.append(str(agent))
            return seen

        def made(tid: str) -> list[dict[str, Any]]:
            if arts is None:
                return []
            return [
                {"id": a.id, "kind": a.kind, "title": a.title, "needs_review": a.needs_review}
                for a in arts.find(thread_id=tid, limit=20)
            ]

        def newest(mgr: RunManager) -> dict[str, dict[str, Any]]:
            out: dict[str, dict[str, Any]] = {}
            for r in mgr.store.runs(since=since, limit=limit * 4):
                out.setdefault(r["thread_id"], r)
            return out

        def entry(source: str, r: dict[str, Any], meta: dict[str, Any], title: Any) -> Row:
            cron = meta.get("cron")
            if cron is None and str(r.get("source") or "").startswith("cron:"):
                cron = str(r["source"])[5:]
            return {
                "source": source,
                "thread_id": r["thread_id"],
                "run_id": r["id"],
                "title": title,
                "workflow": meta.get("workflow"),
                "cron": cron,
                "status": r["status"],
                "created": r["created"],
                "ended": r.get("ended"),
                "agents": [],
                "step": None,
                "steps": None,
                "current_step": None,
                "artifacts": made(r["thread_id"]),
            }

        items: list[dict[str, Any]] = []
        for tid, r in newest(rt.manager).items():
            th = rt.manager.store.thread(tid) or {}
            meta = th.get("metadata") or {}
            if meta.get("workflow_thread") or tid == OPS_THREAD:
                continue  # a workflow's agent step is part of that run; engine notices are not work
            item = entry("chat", r, meta, th.get("title"))
            item["agents"] = agents_of(tid)
            items.append(item)
        e = rt.workflows
        if e is not None:
            open_states = {RunStatus.PENDING, RunStatus.RUNNING, RunStatus.INTERRUPTED}
            for tid, r in newest(e.manager).items():
                th = e.manager.store.thread(tid) or {}
                meta = th.get("metadata") or {}
                item = entry("workflow", r, meta, th.get("title"))
                item["agents"] = agents_of(f"{tid}-agent")
                wf = e.defs.get(str(meta.get("workflow")))
                if wf is not None and r["status"] in open_states:
                    values = (await e.manager.thread_state(tid)).get("values") or {}
                    step = int(values.get("step") or 0)
                    item["step"], item["steps"] = step, len(wf.steps)
                    if step < len(wf.steps):
                        item["current_step"] = wf.public()["steps"][step]["title"]
                items.append(item)
        items.sort(key=lambda i: -float(i["created"]))
        return respond(S.WorkList, {"items": items[:limit]})

    async def approvals(request: Request) -> Response:
        need(request, "approvals.list")
        rt = runtime(request)
        sources = [("company", rt.manager)]
        if rt.workflows is not None:
            sources.append(("workflow", rt.workflows.manager))
        tiers = policy(request)
        out = []
        for source, mgr in sources:
            for item in mgr.store.runs(status=RunStatus.INTERRUPTED, limit=200):
                card = waiting_card(mgr, item["thread_id"])
                newest = mgr.store.runs(thread_id=item["thread_id"], limit=1)
                if card is None or newest[0]["id"] != item["id"]:
                    continue
                out.append(
                    {
                        "source": source,
                        "thread_id": item["thread_id"],
                        "run_id": item["id"],
                        "created": item["created"],
                        "card": card,
                        "tier": tiers.tier(card.get("category")).value,
                        "can_approve": may_approve(request, card),
                    }
                )
        return respond(list[S.ApprovalItem], sorted(out, key=lambda a: -float(a["created"])))

    # ------------------------------------------------------------------ errors · routes

    def error(status: int, message: str, code: E, params: dict[str, Any] | None = None) -> Json:
        body = {"error": message, "code": code.value, "params": params or {}}
        return respond(S.ErrorBody, body, status)

    async def not_found(_request: Request, exc: Exception) -> Response:
        return error(404, str(exc).strip("'\""), E.NOT_FOUND)

    async def bad_request(_request: Request, exc: Exception) -> Response:
        if isinstance(exc, CodedError):
            return error(400, str(exc), exc.code, exc.params)
        return error(400, str(exc), E.INVALID_REQUEST)

    async def http_error(_request: Request, exc: Exception) -> Response:
        assert isinstance(exc, HTTPException)
        if isinstance(exc, ApiError):
            return error(exc.status_code, exc.detail, exc.code, exc.params)
        # Starlette's own (an unknown route, a method the route does not take)
        return error(exc.status_code, exc.detail, for_status(exc.status_code))

    Endpoint = Callable[[Request], Awaitable[Response]]
    Table = list[tuple[str, Endpoint, list[str]]]
    customer: Table = [
        ("/health", health, ["GET"]),
        ("/version", version, ["GET"]),
        ("/auth/login", login, ["POST"]),
        ("/auth/logout", logout, ["POST"]),
        ("/auth/totp/begin", totp_begin, ["POST"]),
        ("/auth/totp/confirm", totp_confirm, ["POST"]),
        ("/auth/passkey/register/begin", passkey_register_begin, ["POST"]),
        ("/auth/passkey/register/finish", passkey_register_finish, ["POST"]),
        ("/auth/passkey/login/begin", passkey_login_begin, ["POST"]),
        ("/auth/passkey/login/finish", passkey_login_finish, ["POST"]),
        ("/me/passkeys", my_passkeys, ["GET"]),
        ("/me/passkeys/{pid}", my_passkey_delete, ["DELETE"]),
        ("/me", me, ["GET", "PATCH"]),
        ("/users", users, ["GET", "POST"]),
        ("/users/{uid}", user_update, ["PATCH"]),
        ("/access", access, ["GET", "PUT"]),
        ("/audit", audit, ["GET"]),
        ("/settings", settings, ["GET", "PUT"]),
        ("/profile", profile, ["GET", "PUT"]),
        ("/snapshot", snapshot, ["GET", "PUT"]),
        ("/snapshot/run", snapshot_run, ["POST"]),
    ]
    org: Table = [
        ("/org-chart", org_chart, ["GET"]),
        ("/people", people, ["GET"]),
        ("/people/{uid}", person_update, ["PATCH"]),
        ("/audit", org_audit_log, ["GET"]),
        ("/approval-policy", approval_policy, ["GET", "PUT"]),
        ("/teams", teams, ["GET"]),
        ("/agents", org_agents, ["GET"]),
        ("/workflows", workflows, ["GET"]),
        ("/workflows/{name}", workflow_update, ["PATCH"]),
        ("/screens/{name}", screen, ["GET"]),
        ("/connections", connections, ["GET", "POST"]),
        ("/connections/{cid}", connection_update, ["PATCH", "DELETE"]),
    ]
    workspace: Table = [
        ("/threads", threads, ["GET", "POST"]),
        ("/threads/{tid}/state", thread_state, ["GET"]),
        ("/threads/{tid}/runs", thread_run, ["POST"]),
        ("/threads/{tid}/resume", thread_resume, ["POST"]),
        ("/runs", runs, ["GET"]),
        ("/runs/{rid}", run, ["GET"]),
        ("/events", events, ["GET"]),
        ("/ledger", ledger, ["GET"]),
        ("/budget", budget, ["GET"]),
        ("/approvals", approvals, ["GET"]),
        ("/agents", working, ["GET"]),
        ("/access", ws_access, ["GET", "PUT"]),
        ("/workflows", ws_workflows, ["GET"]),
        ("/workflows/{name}/run", workflow_run, ["POST"]),
        ("/workflow-runs", workflow_runs, ["GET"]),
        ("/workflow-runs/{rid}", workflow_run_get, ["GET"]),
        ("/workflow-threads/{tid}/state", workflow_state, ["GET"]),
        ("/workflow-threads/{tid}/resume", workflow_resume, ["POST"]),
        ("/uploads", uploads, ["GET", "POST"]),
        ("/artifacts", artifacts, ["GET"]),
        ("/artifacts/{aid}", artifact_get, ["GET"]),
        ("/artifacts/{aid}/review", artifact_review, ["POST"]),
        ("/schedules", schedules, ["GET"]),
        ("/work", work, ["GET"]),
    ]

    def table(rows: Table) -> list[BaseRoute]:
        return [Route(path, fn, methods=methods) for path, fn, methods in rows]

    ws_gate = ScopeGate(Router(routes=table(workspace)), check_workspace, "workspace")
    org_gate = ScopeGate(
        Router(routes=[*table(org), Mount("/w/{ws}", app=ws_gate)]), check_org, "org"
    )
    routes: list[BaseRoute] = [
        Mount("/api", routes=[*table(customer), Mount("/o/{org}", app=org_gate)])
    ]
    if cfg.static_dir is not None and cfg.static_dir.is_dir():
        routes.append(Mount("/", app=SpaFiles(directory=cfg.static_dir, html=True)))

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
