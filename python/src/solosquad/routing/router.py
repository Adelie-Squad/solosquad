"""The router: pick (connection, model) for one activation, three filters deep (decision 40).

    1. connection pool       active connections the owner (or this org) added
    2. workspace policy      where models may run from this office (cloud · intranet · local)
    3. Chief's policy        model preferences, budget, tag rules (decision 35)

then the live state: a connection that reported `exceeded` is skipped until it resets, and a
connection over its monthly budget is skipped. Each connection has a slot semaphore, so a
lease blocks when every slot is busy instead of overloading the account.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Literal

from solosquad.context.ledger import Ledger, month_start
from solosquad.harness.base import Harness
from solosquad.harness.claude_code import ClaudeCodeHarness
from solosquad.harness.codex import CodexHarness
from solosquad.harness.lite import LiteHarness
from solosquad.harness.opencode import OpenCodeHarness
from solosquad.layout import ExecutionPolicy
from solosquad.routing.connections import Connection, ConnectionKind
from solosquad.routing.policy import ChiefPolicy
from solosquad.routing.vault import SecretStore


class NoConnection(Exception):
    pass


@dataclass(frozen=True)
class Selection:
    connection: Connection
    model: str | None
    harness: Harness
    env: dict[str, str]


EscalationKind = Literal["budget_warning", "budget_exhausted", "rate_limited", "no_connection"]


@dataclass(frozen=True)
class Escalation:
    """Something Chief should look at (decision 35)."""

    kind: EscalationKind
    connection_id: str | None
    detail: str
    ts: float


HarnessFactory = Callable[[Connection, SecretStore], Harness]


def default_harness(conn: Connection, secrets: SecretStore) -> Harness:
    if conn.harness == "claude-code":
        return ClaudeCodeHarness()
    if conn.harness == "codex":
        return CodexHarness()
    if conn.harness == "opencode":
        return OpenCodeHarness()
    if conn.harness == "lite":
        key = secrets.get(conn.secret_ref) if conn.secret_ref else None
        return LiteHarness(conn.base_url or "http://localhost:11434/v1", key)
    raise ValueError(f"unknown harness {conn.harness!r} for connection {conn.id}")


def allowed_by_workspace(conn: Connection, policy: ExecutionPolicy) -> bool:
    if conn.network == "local":
        return policy.allow_local_llm
    if conn.network == "internal":
        return policy.allow_internal_llm
    if conn.kind is ConnectionKind.SUBSCRIPTION:
        return policy.allow_subscription_cli
    return policy.allow_external_api


class Router:
    def __init__(
        self,
        connections: list[Connection],
        workspace_policy: ExecutionPolicy,
        chief_policy: ChiefPolicy,
        ledger: Ledger,
        secrets: SecretStore,
        *,
        org: str,
        harness_factory: HarnessFactory = default_harness,
        on_escalation: Callable[[Escalation], None] | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.connections = connections
        self.workspace_policy = workspace_policy
        self.chief_policy = chief_policy
        self.ledger = ledger
        self.secrets = secrets
        self.org = org
        self.harness_factory = harness_factory
        self.on_escalation = on_escalation
        self.clock = clock
        self.limited_until: dict[str, float] = {}
        self._slots: dict[str, asyncio.Semaphore] = {}
        self._warned: set[tuple[str, str]] = set()

    def _escalate(self, kind: EscalationKind, conn: str | None, detail: str) -> None:
        key = (kind, conn or "")
        if key in self._warned:
            return
        self._warned.add(key)
        if self.on_escalation is not None:
            self.on_escalation(Escalation(kind, conn, detail, self.clock()))

    def candidates(
        self, agent: str, tags: tuple[str, ...] = ()
    ) -> list[tuple[Connection, str | None]]:
        pref = self.chief_policy.preference(agent, tags)
        pool = [
            c
            for c in self.connections
            if c.active and allowed_by_workspace(c, self.workspace_policy)
        ]
        if pref.connections:
            order = {cid: i for i, cid in enumerate(pref.connections)}
            pool.sort(key=lambda c: order.get(c.id, len(order)))
        now = self.clock()
        since = month_start(now)
        org_budget = self.chief_policy.budget.monthly_usd
        if org_budget is not None:
            org_spend = self.ledger.spend(since=since, org=self.org)
            if org_spend >= org_budget:
                self._escalate(
                    "budget_exhausted",
                    None,
                    f"org {self.org} spent {org_spend:.2f} of {org_budget}",
                )
                return []
            if org_spend >= org_budget * self.chief_policy.budget.warn_at:
                self._escalate(
                    "budget_warning", None, f"org {self.org} at {org_spend / org_budget:.0%}"
                )
        out: list[tuple[Connection, str | None]] = []
        for conn in pool:
            if self.limited_until.get(conn.id, 0) > now:
                continue
            if conn.monthly_budget_usd is not None:
                spent = self.ledger.spend(since=since, connection_id=conn.id)
                if spent >= conn.monthly_budget_usd:
                    self._escalate("budget_exhausted", conn.id, f"{conn.id} spent {spent:.2f}")
                    continue
                if spent >= conn.monthly_budget_usd * self.chief_policy.budget.warn_at:
                    self._escalate(
                        "budget_warning",
                        conn.id,
                        f"{conn.id} at {spent / conn.monthly_budget_usd:.0%}",
                    )
            model = next((m for m in pref.models if m in conn.models), None)
            if pref.models and model is None and conn.models:
                out.append((conn, None))  # usable, but not a preferred model — ranked last
                continue
            out.append((conn, model or (conn.models[0] if conn.models else None)))
        preferred = [
            c for c in out if c[1] is not None and (not pref.models or c[1] in pref.models)
        ]
        fallback = [c for c in out if c not in preferred]
        return preferred + [(c, c.models[0] if c.models else None) for c, _ in fallback]

    def select(
        self, agent: str, tags: tuple[str, ...] = (), exclude: set[str] | None = None
    ) -> Selection:
        for conn, model in self.candidates(agent, tags):
            if exclude and conn.id in exclude:
                continue
            env: dict[str, str] = {}
            if conn.secret_ref and conn.secret_env:
                secret = self.secrets.get(conn.secret_ref)
                if secret:
                    env[conn.secret_env] = secret
            return Selection(conn, model, self.harness_factory(conn, self.secrets), env)
        self._escalate("no_connection", None, f"no usable connection for {agent}")
        raise NoConnection(f"no usable connection for agent {agent!r}")

    def mark_limited(self, connection_id: str, resets_at: float | None) -> None:
        until = resets_at if resets_at and resets_at > self.clock() else self.clock() + 15 * 60
        self.limited_until[connection_id] = until
        self._escalate("rate_limited", connection_id, f"{connection_id} limited until {until:.0f}")

    @contextlib.asynccontextmanager
    async def lease(self, selection: Selection) -> AsyncIterator[Selection]:
        sem = self._slots.setdefault(
            selection.connection.id, asyncio.Semaphore(selection.connection.slots)
        )
        async with sem:
            yield selection
