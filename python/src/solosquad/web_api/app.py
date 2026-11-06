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
from urllib.parse import urlsplit

import webauthn
from pydantic import BaseModel
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
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
from solosquad.layout import ServerConfig, Workspace
from solosquad.messages import Message as ChatMessage
from solosquad.profile import load_profile, save_profile, update_profile
from solosquad.routing.connections import (
    Connection,
    ConnectionKind,
    load_connections,
    save_connections,
)
from solosquad.routing.eligibility import Entity, judge, providers_reached
from solosquad.routing.router import Router
from solosquad.routing.vault import SecretStore
from solosquad.runtime import RunManager, RunStatus
from solosquad.screens import load_screen
from solosquad.snapshots import S3_SECRET_REF, build_target
from solosquad.web_api import schemas as S
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
from solosquad.workflows.engine import UPLOAD_LIMIT, WorkflowEngine

SESSION_COOKIE = "ss_session"
CSRF_HEADER = "x-csrf-token"
ENTITY_REQUIRED = "enter the entity that holds this account (entity: {name, country})"
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
    "threads.resume": EVERYONE,  # then the card decides (decision 51)
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
    "workflows.list": EVERYONE,
    "workflows.run": EVERYONE,
    "workflows.update": OWNER,
    "workflows.approve": EVERYONE,  # then the card decides (decision 51)
    "approvals.list": EVERYONE,
    "approval_policy.get": EVERYONE,
    "approval_policy.update": OWNER,
    "org_chart": EVERYONE,
    "uploads.list": EVERYONE,
    "uploads.create": EVERYONE,
    "artifacts.list": EVERYONE,
    "artifacts.review": EVERYONE,
    "screens": EVERYONE,
    "settings.get": EVERYONE,
    "settings.update": OWNER,
    "profile.get": EVERYONE,
    "profile.update": OWNER,
    "snapshot.get": EVERYONE,
    "snapshot.update": OWNER,
    "snapshot.run": OWNER,
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
    """The built web; a client-side route (`/chat/th-1`, no file extension) gets
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
    workflows: WorkflowEngine | None = None
    artifacts: ArtifactStore | None = None
    approvals_path: Path | None = None
    """`orgs/<org>/approvals.yaml` — the owner's tier overrides (decision 51)."""
    run_snapshot: Callable[[], dict[str, Any]] | None = None
    """Back up and ship now (`maintenance.run_snapshot` with the current workspace.yaml)."""
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


def create_app(cfg: WebConfig) -> Starlette:
    m = cfg.manager
    hub = EventHub(m, others={"workflow": cfg.workflows.manager} if cfg.workflows else None)

    def where(request: Request) -> Origin:
        peer = request.client.host if request.client else None
        return origin(peer, request.headers.get("x-forwarded-for"))

    def server_cfg() -> ServerConfig:
        """core/server.yaml as it is now (I41) — the web may have just changed it."""
        if cfg.workspace is None:
            return ServerConfig()
        return cfg.workspace.org.solution.server_config(strict=False)

    def policy_check(request: Request) -> Origin:
        w = where(request)
        if cfg.workspace is not None and not (
            allowed(server_cfg().access, w) and allowed(cfg.workspace.config().access, w)
        ):
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

    def org_root() -> Path | None:
        if cfg.workspace is not None:
            return cfg.workspace.org.root
        return cfg.workflows.org_root if cfg.workflows else None

    def org_locale() -> str:
        loc = server_cfg().web.locale if cfg.workspace else S.DEFAULT_LOCALE
        return loc if loc in S.LOCALES else S.DEFAULT_LOCALE

    def me_payload(session: Session) -> dict[str, Any]:
        own = session.user.locale
        return {
            "user": session.user.public(),
            "stage": session.stage.value,
            "csrf": session.csrf,
            "locale": own if own in S.LOCALES else org_locale(),
            "org_locale": org_locale(),
        }

    # ------------------------------------------------------------------ health · auth

    async def health(request: Request) -> Response:
        policy_check(request)
        return respond(S.Health, {"ok": True, "passkeys": passkeys_available()})

    async def version(request: Request) -> Response:
        principal(request)
        return respond(S.Version, {"version": __version__})

    async def login(request: Request) -> Response:
        w = policy_check(request)
        data = await body(request)
        require = server_cfg().access.two_factor if cfg.workspace else True
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
        resp = respond(S.Me, me_payload(session))
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
        resp = respond(S.Ok, {"ok": True})
        resp.delete_cookie(SESSION_COOKIE, path="/")
        return resp

    async def me(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            local = {"user": None, "stage": "full", "csrf": None, "local": True}
            return respond(S.Me, {**local, "locale": org_locale(), "org_locale": org_locale()})
        if request.method == "PATCH":
            data = await body(request)
            if "locale" in data:
                # null or "" = follow the org default (I31)
                loc = str(data["locale"] or "")
                if loc and loc not in S.LOCALES:
                    raise ValueError(f"locale must be one of {list(S.LOCALES)} or null")
                accounts().set_locale(who.session.user.id, loc)
            if "password" in data:
                accounts().set_password(who.session.user.id, str(data["password"]))
                accounts().audit(who.user_id, "password.change")
            session = accounts().session(request.cookies.get(SESSION_COOKIE))
            if session is None:  # a password change ends every session, this one too
                gone = {"user": None, "stage": "full", "csrf": None, "relogin": True}
                return respond(S.Me, {**gone, "locale": org_locale(), "org_locale": org_locale()})
            return respond(S.Me, me_payload(session))
        return respond(S.Me, me_payload(who.session))

    async def totp_begin(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            raise HTTPException(400, "log in with an account to set up a one-time code")
        return respond(S.TotpBegin, {"uri": accounts().begin_totp(who.session.user.id)})

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
        return respond(S.Ok, {"ok": True})

    # ------------------------------------------------------------------ approval rights

    def policy() -> ApprovalPolicy:
        return load_policy(cfg.approvals_path) if cfg.approvals_path else ApprovalPolicy({})

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

    def may_approve(who: Principal, card: dict[str, Any] | None) -> bool:
        if who.role is Role.OWNER:
            return True
        teams = list(who.session.user.teams) if who.session else []
        return card is not None and can_approve(policy(), card, is_owner=False, teams=teams)

    def check_approver(who: Principal, mgr: RunManager, tid: str) -> dict[str, Any] | None:
        card = waiting_card(mgr, tid)
        if not may_approve(who, card):
            tier = policy().tier((card or {}).get("category")).value
            whom = "the owner" if tier == "owner" else f"team {(card or {}).get('team')}"
            raise HTTPException(403, f"this approval needs {whom}")
        return card

    # ------------------------------------------------------------- passkeys (W3)

    def passkeys_available() -> bool:
        try:
            relying_party()
        except HTTPException:
            return False
        return cfg.accounts is not None

    def relying_party() -> tuple[str, str]:
        url = server_cfg().public_url if cfg.workspace else None
        parts = urlsplit(url or "")
        if parts.scheme not in ("https", "http") or not parts.hostname:
            raise HTTPException(
                409, "passkeys need the server's public_url (https://…) in core/server.yaml"
            )
        return parts.hostname, f"{parts.scheme}://{parts.netloc}"

    def set_session(resp: Response, token: str) -> None:
        resp.set_cookie(
            SESSION_COOKIE, token, max_age=SESSION_TTL_S, httponly=True,
            secure=cfg.secure_cookies, samesite="lax", path="/",
        )  # fmt: skip

    async def passkey_register_begin(request: Request) -> Response:
        who = principal(request, allow_enroll=True)
        if who.session is None:
            raise HTTPException(400, "log in with an account to add a passkey")
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
            raise HTTPException(400, "log in with an account to add a passkey")
        rp_id, origin = relying_party()
        data = await body(request)
        taken = accounts().take_challenge(str(data.get("challenge_id") or ""), "register")
        if taken is None or taken[1] != who.session.user.id:
            raise HTTPException(400, "the passkey request expired — start again")
        cred = data.get("credential")
        if not isinstance(cred, dict):
            raise ValueError("send the credential from navigator.credentials.create()")
        try:
            verified = webauthn.verify_registration_response(
                credential=cred,
                expected_challenge=taken[0],
                expected_origin=origin,
                expected_rp_id=rp_id,
                require_user_verification=True,
            )
        except Exception as e:  # the library raises its own errors for every bad response
            raise HTTPException(400, f"passkey was not accepted: {e}") from e
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
            raise HTTPException(401, "too many attempts — try again later")
        data = await body(request)
        cred = data.get("credential") or {}
        taken = store.take_challenge(str(data.get("challenge_id") or ""), "login")
        found = store.passkey(str(cred.get("id") or "")) if isinstance(cred, dict) else None
        if taken is None or found is None or (taken[1] is not None and taken[1] != found[0]):
            store.record_failure(f"ip:{w.address}")
            raise HTTPException(401, "passkey not recognised")
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
            raise HTTPException(401, "passkey not recognised") from e
        if store.user(uid).disabled:
            raise HTTPException(401, "passkey not recognised")
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
            raise KeyError("no such passkey")
        accounts().audit(who.user_id, "passkey.remove", request.path_params["pid"])
        return respond(S.Ok, {"ok": True})

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
                locale=str(data.get("locale") or ""),  # "" = follow the org default
            )
            accounts().audit(who.user_id, "user.create", f"{user.username} as {user.role.value}")
            return respond(S.PublicUser, user.public(), 201)
        need(request, "users.list")
        return respond(list[S.PublicUser], [u.public() for u in accounts().users()])

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
        if data.get("reset_passkeys"):
            store.clear_passkeys(uid)
            store.audit(who.user_id, "user.passkeys.reset", uid)
        if data.get("reset_totp"):
            store.reset_totp(uid)
            store.audit(who.user_id, "user.totp.reset", uid)
        if "teams" in data or "title" in data:
            teams = data.get("teams")
            if teams is not None and not isinstance(teams, list):
                raise ValueError("teams must be a list of team names")
            store.set_profile(
                uid,
                title=str(data["title"]) if "title" in data else None,
                teams=[str(t) for t in teams] if teams is not None else None,
            )
            store.audit(
                who.user_id, "user.profile", f"{uid} teams={teams} title={data.get('title')!r}"
            )
        return respond(S.PublicUser, store.user(uid).public())

    # ------------------------------------------------------------------ access policy

    async def access(request: Request) -> Response:
        if cfg.workspace is None:
            raise HTTPException(404, "no workspace configuration")
        srv = server_cfg()
        if request.method == "PUT":
            who = need(request, "access.update")
            data = await body(request)
            nets = [str(x) for x in data.get("allowed_networks", srv.access.allowed_networks)]
            parse_networks(nets)  # ValueError → 400 on a malformed entry
            proposed = srv.access.model_copy(
                update={
                    "allowed_networks": nets,
                    "two_factor": bool(data.get("two_factor", srv.access.two_factor)),
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
            cfg.workspace.org.solution.update_server_config(access=proposed)
            accounts().audit(  # C14 — who · when (the row) · before · after
                who.user_id,
                "access.update",
                json.dumps(
                    {
                        "before": srv.access.model_dump(mode="json"),
                        "after": proposed.model_dump(mode="json"),
                    },
                    ensure_ascii=False,
                ),
            )
            return respond(S.AccessPolicy, _access_public(proposed))
        need(request, "access.get")
        return respond(S.AccessPolicy, _access_public(srv.access))

    async def audit(request: Request) -> Response:
        need(request, "audit")
        rows = accounts().audit_log(int(request.query_params.get("limit", "200")))
        return respond(list[S.AuditEntry], rows)

    async def settings(request: Request) -> Response:
        if cfg.workspace is None:
            raise HTTPException(404, "no workspace configuration")
        if request.method == "PUT":
            who = need(request, "settings.update")
            data = await body(request)
            loc = str(data.get("locale") or "")
            if loc not in S.LOCALES:
                raise ValueError(f"locale must be one of {list(S.LOCALES)}")
            web = server_cfg().web.model_copy(update={"locale": loc})
            cfg.workspace.org.solution.update_server_config(web=web)
            accounts().audit(who.user_id, "settings.update", f"locale={loc}")
            return respond(S.WebSettings, {"locale": loc})
        need(request, "settings.get")
        return respond(S.WebSettings, {"locale": org_locale()})

    # ------------------------------------------------------------------ profile · snapshot

    def solution_root() -> Path:
        if cfg.workspace is None:
            raise HTTPException(404, "no workspace configuration")
        return cfg.workspace.org.solution.root

    def profile_payload() -> dict[str, Any]:
        profile = load_profile(solution_root())
        return {"profile": profile.model_dump(mode="json"), "checklist": profile.checklist()}

    async def profile(request: Request) -> Response:
        if request.method == "PUT":
            who = need(request, "profile.update")
            root = solution_root()
            before = load_profile(root)
            updated = update_profile(before, await body(request))  # ValueError → 400
            save_profile(root, updated)  # the country goes to core/server.yaml (I41)
            if cfg.router is not None:
                cfg.router.server_country = updated.server.country
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
        if cfg.workspace is None:
            raise HTTPException(404, "no workspace configuration")
        if request.method == "PUT":
            who = need(request, "snapshot.update")
            data = await body(request)
            kind = data.get("type")
            target = build_target(
                str(kind) if kind else None,
                endpoint=str(data.get("endpoint") or "") or None,
                region=str(data.get("region") or "us-east-1"),
                bucket=str(data.get("bucket") or "") or None,
                prefix=str(data.get("prefix") or "solosquad"),
                path=str(data.get("path") or "") or None,
                keep_days=int(data.get("keep_days") or 30),
            )  # ValueError → 400, the same check as `snapshot set`
            access, secret = data.get("access_key"), data.get("secret_key")
            if target.type == "s3":
                if cfg.secrets is None:
                    raise HTTPException(404, "no secret store on this office")
                if access or secret:
                    if not (access and secret):
                        raise ValueError("send both access_key and secret_key")
                    cfg.secrets.set(S3_SECRET_REF, f"{access}:{secret}")
                elif not cfg.secrets.get(S3_SECRET_REF):
                    raise ValueError("an s3 target needs access_key and secret_key")
            cfg.workspace.org.solution.update_server_config(snapshot=target)
            keys = " · keys replaced" if access else ""
            accounts().audit(who.user_id, "snapshot.update", f"type={target.type}{keys}")
            return respond(S.SnapshotSettings, snapshot_payload())
        need(request, "snapshot.get")
        return respond(S.SnapshotSettings, snapshot_payload())

    async def snapshot_run(request: Request) -> Response:
        who = need(request, "snapshot.run")
        if cfg.run_snapshot is None:
            raise HTTPException(404, "snapshots cannot be run from this office")
        try:
            result = await asyncio.to_thread(cfg.run_snapshot)
        except (ValueError, OSError) as e:
            accounts().audit(who.user_id, "snapshot.failed", f"{type(e).__name__}: {e}")
            raise HTTPException(502, f"snapshot failed: {e}") from e
        accounts().audit(who.user_id, "snapshot.run", repr(result))
        return respond(S.SnapshotRunResult, result)

    async def screen(request: Request) -> Response:
        need(request, "screens")
        return respond(S.ScreenResponse, load_screen(org_root(), request.path_params["name"]))

    # ------------------------------------------------------------------ operations

    async def threads(request: Request) -> Response:
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
        tid = request.path_params["tid"]
        if m.store.thread(tid) is None:
            raise KeyError(f"no thread {tid}")
        return respond(S.ThreadState, await m.thread_state(tid))

    async def thread_run(request: Request) -> Response:
        need(request, "threads.run")
        text = (await body(request)).get("input")
        tid = request.path_params["tid"]
        rid = await m.submit(tid, text if isinstance(text, str) else None)
        return respond(S.RunCreated, {"run_id": rid}, 201)

    async def thread_resume(request: Request) -> Response:
        who = need(request, "threads.resume")
        tid = request.path_params["tid"]
        if m.store.thread(tid) is None:
            raise KeyError(f"no thread {tid}")
        check_approver(who, m, tid)
        value = (await body(request)).get("value")
        approver = who.session.user.username if who.session else "local-cli"
        rid = await m.resume(tid, value, source=f"user:{approver}")
        if cfg.accounts is not None:
            cfg.accounts.audit(who.user_id, "approval", f"{tid} → {value!r}")
        return respond(S.RunCreated, {"run_id": rid}, 201)

    async def runs(request: Request) -> Response:
        need(request, "runs.list")
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
        found = m.store.run(rid)
        if found is None:
            raise KeyError(f"no run {rid}")
        return respond(S.Run, found)

    async def ledger(request: Request) -> Response:
        need(request, "ledger")
        totals = cfg.ledger.totals(request.query_params.get("by", "agent"))
        return respond(S.LedgerTotals, totals)

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
        return respond(
            list[S.Team],
            [
                {"name": name, "main": comp.main, "members": comp.members}
                for name, comp in resolver().teams().items()
            ],
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
        return respond(list[S.Agent], out)

    # ------------------------------------------------------------------ connections · budget

    def server_country() -> str | None:
        return server_cfg().server_country if cfg.workspace else None

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
            if entity is None and providers_reached(conn.provider, conn.harness, conn.models):
                raise ValueError(ENTITY_REQUIRED)  # C18 — eligibility is judged on the holder
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
            return respond(S.ConnectionOut, conn_public(conn), 201)
        need(request, "connections.list")
        return respond(list[S.ConnectionOut], [conn_public(c) for c in all_connections()])

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
            return respond(S.Ok, {"ok": True})
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
        if (
            "entity" in data
            and changed.entity is None
            and providers_reached(changed.provider, changed.harness, changed.models)
        ):
            raise ValueError(ENTITY_REQUIRED)
        verdict = judge(
            changed.provider, changed.harness, changed.models, changed.entity, server_country()
        )
        if changed.active and not verdict.ok:
            raise HTTPException(422, f"{verdict.reason} — see {verdict.source}")
        save_connections(path, [changed if c.id == cid else c for c in existing])
        refresh_router()
        accounts().audit(who.user_id, "connection.update", f"{cid} {sorted(update)}")
        return respond(S.ConnectionOut, conn_public(changed))

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

    # ------------------------------------------------------------- workflows · uploads · artifacts

    def engine() -> WorkflowEngine:
        if cfg.workflows is None:
            raise HTTPException(404, "workflows are not enabled on this office")
        return cfg.workflows

    def store() -> ArtifactStore:
        if cfg.artifacts is None:
            raise HTTPException(404, "artifacts are not enabled on this office")
        return cfg.artifacts

    async def workflows(request: Request) -> Response:
        need(request, "workflows.list")
        e = engine()
        return respond(S.WorkflowList, {"workflows": e.summaries(), "errors": e.errors})

    async def workflow_update(request: Request) -> Response:
        who = need(request, "workflows.update")
        name = request.path_params["name"]
        data = await body(request)
        if "enabled" not in data:
            raise ValueError("send {enabled: true|false}")
        engine().set_enabled(name, bool(data["enabled"]))
        accounts().audit(
            who.user_id, "workflow.enable" if data["enabled"] else "workflow.disable", name
        )
        found = next(w for w in engine().summaries() if w["name"] == name)
        return respond(S.WorkflowSummary, found)

    async def workflow_run(request: Request) -> Response:
        who = need(request, "workflows.run")
        name = request.path_params["name"]
        inputs = (await body(request)).get("inputs") or {}
        if not isinstance(inputs, dict):
            raise ValueError("inputs must be an object")
        by = who.session.user.username if who.session else "local-cli"
        tid, rid = await engine().run_now(name, inputs, source=f"user:{by}")
        if cfg.accounts is not None:
            cfg.accounts.audit(who.user_id, "workflow.run", name)
        return respond(S.WorkflowRunCreated, {"thread_id": tid, "run_id": rid}, 201)

    async def workflow_runs(request: Request) -> Response:
        need(request, "workflows.list")
        q = request.query_params
        store = engine().manager.store
        limit = int(q.get("limit", "50"))
        name = q.get("workflow")
        found = store.runs(
            thread_id=q.get("thread_id"),
            status=q.get("status"),
            limit=limit if name is None else max(limit, 200),
        )
        if name is not None:  # the run's thread remembers which workflow it belongs to
            found = [
                r
                for r in found
                if (store.thread(r["thread_id"]) or {}).get("metadata", {}).get("workflow") == name
            ][:limit]
        return respond(list[S.Run], found)

    async def workflow_run_get(request: Request) -> Response:
        need(request, "workflows.list")
        found = engine().manager.store.run(request.path_params["rid"])
        if found is None:
            raise KeyError(f"no workflow run {request.path_params['rid']}")
        return respond(S.Run, found)

    async def workflow_state(request: Request) -> Response:
        need(request, "workflows.list")
        tid = request.path_params["tid"]
        if engine().manager.store.thread(tid) is None:
            raise KeyError(f"no workflow thread {tid}")
        return respond(S.WorkflowThreadState, await engine().manager.thread_state(tid))

    async def workflow_resume(request: Request) -> Response:
        who = need(request, "workflows.approve")
        tid = request.path_params["tid"]
        e = engine()
        if e.manager.store.thread(tid) is None:
            raise KeyError(f"no workflow thread {tid}")
        check_approver(who, e.manager, tid)
        value = (await body(request)).get("value")
        approver = who.session.user.username if who.session else "local-cli"
        rid = await e.manager.resume(tid, value, source=f"user:{approver}")
        if cfg.accounts is not None:
            cfg.accounts.audit(who.user_id, "approval", f"workflow {tid} → {value!r}")
        return respond(S.RunCreated, {"run_id": rid}, 201)

    async def uploads(request: Request) -> Response:
        if request.method == "POST":
            who = need(request, "uploads.create")
            filename = request.query_params.get("filename") or ""
            declared = int(request.headers.get("content-length") or "0")
            if declared > UPLOAD_LIMIT:
                raise HTTPException(413, f"file is larger than {UPLOAD_LIMIT // (1024 * 1024)} MB")
            meta = engine().save_upload(filename, await request.body())
            if cfg.accounts is not None:
                cfg.accounts.audit(who.user_id, "upload", f"{meta['filename']} ({meta['size']} B)")
            return respond(S.Upload, meta, 201)
        need(request, "uploads.list")
        return respond(list[S.Upload], engine().uploads_list())

    async def artifacts(request: Request) -> Response:
        need(request, "artifacts.list")
        q = request.query_params
        review = q.get("needs_review")
        found = store().find(
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
        return respond(S.Artifact, _artifact_public(store().get(request.path_params["aid"])))

    async def artifact_review(request: Request) -> Response:
        who = need(request, "artifacts.review")
        by = who.session.user.username if who.session else "local-cli"
        art = store().mark_reviewed(request.path_params["aid"], by)
        if cfg.accounts is not None:
            cfg.accounts.audit(who.user_id, "artifact.review", art.id)
        return respond(S.Artifact, _artifact_public(art))

    # ------------------------------------------------------------- approvals · org chart

    async def approvals(request: Request) -> Response:
        who = need(request, "approvals.list")
        sources = [("company", m)]
        if cfg.workflows is not None:
            sources.append(("workflow", cfg.workflows.manager))
        out = []
        for source, mgr in sources:
            for run in mgr.store.runs(status=RunStatus.INTERRUPTED, limit=200):
                card = waiting_card(mgr, run["thread_id"])
                newest = mgr.store.runs(thread_id=run["thread_id"], limit=1)
                if card is None or newest[0]["id"] != run["id"]:
                    continue
                out.append(
                    {
                        "source": source,
                        "thread_id": run["thread_id"],
                        "run_id": run["id"],
                        "created": run["created"],
                        "card": card,
                        "tier": policy().tier(card.get("category")).value,
                        "can_approve": may_approve(who, card),
                    }
                )
        return respond(list[S.ApprovalItem], sorted(out, key=lambda a: -float(a["created"])))

    async def approval_policy(request: Request) -> Response:
        if request.method == "PUT":
            who = need(request, "approval_policy.update")
            if cfg.approvals_path is None:
                raise HTTPException(404, "the approval policy is not editable on this office")
            tiers = (await body(request)).get("tiers")
            if not isinstance(tiers, dict):
                raise ValueError("send {tiers: {category: owner|team}}")
            if UNCLASSIFIED in tiers:
                raise ValueError("unclassified approvals always go to the owner")
            before = policy()
            updated = {**before.overrides, **{str(k): Tier(str(v)) for k, v in tiers.items()}}
            # keep only what differs from the recommendation — the file stays a list of choices
            overrides = {k: v for k, v in updated.items() if RECOMMENDED.get(k) is not v}
            save_policy(cfg.approvals_path, ApprovalPolicy(overrides))
            after = ApprovalPolicy(overrides)
            changes = [
                {"category": c, "before": before.tier(c).value, "after": after.tier(c).value}
                for c in sorted({str(k) for k in tiers})
                if before.tier(c) is not after.tier(c)
            ]
            deviations = [r["category"] for r in after.table() if r["deviates"]]
            accounts().audit(  # C25 — who · when (the row) · category · before · after
                who.user_id,
                "approval_policy.update",
                json.dumps({"changes": changes, "deviates": deviations}, ensure_ascii=False),
            )
            return respond(list[S.ApprovalPolicyRow], ApprovalPolicy(overrides).table())
        need(request, "approval_policy.get")
        return respond(list[S.ApprovalPolicyRow], policy().table())

    async def org_chart(request: Request) -> Response:
        need(request, "org_chart")
        r = resolver()
        agents = r.available("agents")
        people = [u for u in accounts().users() if not u.disabled] if cfg.accounts else []

        def agent_card(name: str) -> dict[str, Any]:
            res = agents.get(name)
            appearance = res.spec.extra.get("appearance") if res else None
            return {
                "name": name,
                "description": res.spec.description if res else "",
                "appearance": appearance if isinstance(appearance, dict) else None,
            }

        def person_card(u: Any) -> dict[str, Any]:
            return {"id": u.id, "display": u.display, "title": u.title, "role": u.role.value}

        teams = []
        named = set()
        for name, comp in r.teams().items():
            named.add(name)
            teams.append(
                {
                    "name": name,
                    "lead_agent": agent_card(comp.main) if comp.main in agents else None,
                    "agents": [agent_card(a) for a in comp.members if a in agents],
                    "people": [person_card(u) for u in people if name in u.teams],
                }
            )
        owners = [person_card(u) for u in people if u.role is Role.OWNER]
        unassigned = [
            person_card(u)
            for u in people
            if u.role is not Role.OWNER and not (set(u.teams) & named)
        ]
        chart = {"owners": owners, "teams": teams, "unassigned": unassigned}
        return respond(S.OrgChart, chart)

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
        ("/approvals", approvals, ["GET"]),
        ("/approval-policy", approval_policy, ["GET", "PUT"]),
        ("/org-chart", org_chart, ["GET"]),
        ("/workflows", workflows, ["GET"]),
        ("/workflows/{name}", workflow_update, ["PATCH"]),
        ("/workflows/{name}/run", workflow_run, ["POST"]),
        ("/workflow-runs", workflow_runs, ["GET"]),
        ("/workflow-runs/{rid}", workflow_run_get, ["GET"]),
        ("/workflow-threads/{tid}/state", workflow_state, ["GET"]),
        ("/workflow-threads/{tid}/resume", workflow_resume, ["POST"]),
        ("/uploads", uploads, ["GET", "POST"]),
        ("/artifacts", artifacts, ["GET"]),
        ("/artifacts/{aid}", artifact_get, ["GET"]),
        ("/artifacts/{aid}/review", artifact_review, ["POST"]),
        ("/screens/{name}", screen, ["GET"]),
        ("/settings", settings, ["GET", "PUT"]),
        ("/profile", profile, ["GET", "PUT"]),
        ("/snapshot", snapshot, ["GET", "PUT"]),
        ("/snapshot/run", snapshot_run, ["POST"]),
    ]
    routes: list[Route | Mount] = [
        Mount("/api", routes=[Route(path, fn, methods=methods) for path, fn, methods in api])
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
