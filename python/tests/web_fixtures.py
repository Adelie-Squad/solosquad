"""The web app over a test company, and a client that puts the scope in the address.

Since decision 57 the API lives under three prefixes — `/api/...` (the customer),
`/api/o/{org}/...` and `/api/o/{org}/w/{ws}/...` (I40). Tests written for one office keep
their short paths: `ScopedTransport` looks each one up in the app's own route table
(customer → workspace → org, the first level that has that path and method) and sends it
to the given org and workspace. A path that already carries a scope is sent unchanged.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from company_fixtures import Company
from starlette.applications import Starlette

from solosquad.artifacts import ArtifactStore
from solosquad.instance import connections_for
from solosquad.layout import Solution
from solosquad.routing.vault import SecretStore
from solosquad.runtime import RunManager
from solosquad.web_api.accounts import AccountStore, Role
from solosquad.web_api.app import AppConfig, RuntimeView, create_app, route_table
from solosquad.web_api.org_store import OrgStore
from solosquad.workflows.engine import WorkflowEngine

PREFIX = {"workspace": "/api/o/{org}/w/{ws}", "org": "/api/o/{org}", "customer": "/api"}


def _regex(template: str) -> re.Pattern[str]:
    return re.compile(re.sub(r"\{[^}]+\}", "[^/]+", template) + "$")


def scoped(app: Starlette, path: str, method: str, org: str, ws: str) -> str:
    if not path.startswith("/api/") or path.startswith("/api/o/"):
        return path
    rest = path[len("/api") :]
    table = route_table(app)
    for level in ("customer", "workspace", "org"):
        for info in table:
            if info.level != level or method not in info.methods:
                continue
            if _regex(info.path[len(PREFIX[level]) :]).match(rest):
                return PREFIX[level].format(org=org, ws=ws) + rest
    return path


class ScopedTransport(httpx.AsyncBaseTransport):
    def __init__(self, app: Starlette, client: tuple[str, int], org: str, ws: str) -> None:
        self.app = app
        self.inner = httpx.ASGITransport(app=app, client=client)
        self.org = org
        self.ws = ws

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        path = scoped(self.app, request.url.path, request.method, self.org, self.ws)
        if path != request.url.path:
            request.url = request.url.copy_with(path=path)
        return await self.inner.handle_async_request(request)


def scoped_client(
    app: Starlette,
    ip: str = "203.0.113.5",
    org: str = "tesla",
    ws: str = "hq",
    **headers: str,
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=ScopedTransport(app, (ip, 50000), org, ws),
        base_url="https://office.example",
        headers=headers,
    )


def plain_client(app: Starlette, ip: str = "203.0.113.5", **headers: str) -> httpx.AsyncClient:
    """No rewriting — the path is sent exactly as written."""
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=(ip, 50000)),
        base_url="https://office.example",
        headers=headers,
    )


@dataclass
class WebOffice:
    """One workspace (tesla/hq) of a test company behind the scoped app."""

    company: Company
    manager: RunManager
    accounts: AccountStore
    org: OrgStore
    config: AppConfig
    app: Starlette

    @property
    def workspace(self) -> Any:
        return self.config.runtimes[("tesla", "hq")].workspace

    @property
    def solution(self) -> Solution:
        return Solution(self.company.ctx.solution_root)

    def client(self, ip: str = "203.0.113.5", **headers: str) -> httpx.AsyncClient:
        return scoped_client(self.app, ip, **headers)

    def rebuild(self, **changes: Any) -> None:
        for k, v in changes.items():
            setattr(self.config, k, v)
        self.app = create_app(self.config)

    def staff(self, name: str, password: str, *, whole_org: str = "tesla") -> Any:
        """A staff account assigned to the whole org (what rev6 meant by 'staff')."""
        from solosquad.web_api.accounts import Assignment

        return self.accounts.create_user(
            name, password, Role.STAFF, assignments=[Assignment(whole_org, None, Role.STAFF)]
        )


def web_office(
    company: Company,
    manager: RunManager,
    *,
    workflows: WorkflowEngine | None = None,
    artifacts: ArtifactStore | None = None,
    secrets: SecretStore | None = None,
    run_snapshot: Callable[[], dict[str, Any]] | None = None,
    static_dir: Path | None = None,
    token: str = "tok",
) -> WebOffice:
    ctx = company.ctx
    sol = Solution(ctx.solution_root)
    accounts = AccountStore(ctx.data_dir.parent.parent / "core.db")
    org = OrgStore(ctx.data_dir.parent / "org.db", "tesla")
    view = RuntimeView(
        sol.org("tesla").workspace("hq"),
        manager,
        company.ledger,
        router=company.router,
        secrets=company.secrets,
        resolver=company.rt.resolver,
        reload_connections=lambda: connections_for(ctx),
        workflows=workflows,
        artifacts=artifacts,
    )
    cfg = AppConfig(
        sol,
        token,
        accounts,
        {("tesla", "hq"): view},
        orgs={"tesla": org},
        secrets=secrets,
        run_snapshot=run_snapshot,
        static_dir=static_dir,
    )
    return WebOffice(company, manager, accounts, org, cfg, create_app(cfg))
