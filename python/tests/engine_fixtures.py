"""A customer with two orgs and three workspaces on one engine server (decision 57)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from company_fixtures import make_bundle

from solosquad.engine_server import EngineServer, build_engine
from solosquad.harness.base import AuthStatus, BaseHarness, Capabilities, SpawnRequest
from solosquad.harness.events import End, LlmStreamEvent, Start, TextDelta, Usage
from solosquad.instance import Instance, build_instance
from solosquad.layout import Solution, scaffold_org, scaffold_solution, scaffold_workspace

LAYOUT = {"tesla": ("cars", "charging"), "spacex": ("rocket",)}
CONNECTIONS = """schema_version: 1
connections:
  - {id: local, kind: local_llm, provider: local, harness: lite, models: [m], network: local,
     slots: 8}
"""


class ScopeHarness(BaseHarness):
    """Answers with its own workspace's name; `boom` fails the call; `slow` waits for `gate`."""

    name = "scope"
    capabilities = Capabilities(max_context_tokens=50_000, supports_mcp=True, supports_tools=True)

    def __init__(self, scope: str, gate: asyncio.Event) -> None:
        self.scope = scope
        self.gate = gate
        self.prompts: list[str] = []

    async def spawn(self, request: SpawnRequest) -> AsyncIterator[LlmStreamEvent]:
        self.prompts.append(request.prompt)
        if "boom" in request.prompt:
            raise RuntimeError(f"{self.scope} harness exploded")
        if "slow" in request.prompt:
            await self.gate.wait()
        yield Start()
        yield TextDelta(f"answer from {self.scope}")
        yield End("end_turn", Usage(10, 5), 0.01)

    async def auth_status(self) -> AuthStatus:
        return AuthStatus(True, {})


def make_customer(tmp: Path, layout: dict[str, tuple[str, ...]] | None = None) -> Solution:
    sol = scaffold_solution(tmp / "elon", "2.1.0")
    sol.connections_path.write_text(CONNECTIONS, encoding="utf-8")
    for org, wss in (layout or LAYOUT).items():
        o = scaffold_org(sol, org, "bundled", "2.1.0")
        for ws in wss:
            scaffold_workspace(o, ws)
    return sol


class Customer:
    """The engine plus a scripted harness per workspace."""

    def __init__(self, tmp: Path, solution: Solution | None = None, **build: Any) -> None:
        self.solution = solution or make_customer(tmp)
        self.bundle = make_bundle(tmp / "bundle")
        self.gates: dict[str, asyncio.Event] = {}
        self.harnesses: dict[str, ScopeHarness] = {}
        self.engine: EngineServer = build_engine(
            self.solution.root, bundle=self.bundle, build=self._build, **build
        )

    def _build(self, solution: Path, org: str, workspace: str, **kw: Any) -> Instance:
        inst = build_instance(solution, org, workspace, **kw)
        scope = f"{org}/{workspace}"
        gate = self.gates.setdefault(scope, asyncio.Event())
        harness = self.harnesses.setdefault(scope, ScopeHarness(scope, gate))
        inst.router.harness_factory = lambda _conn, _secrets: harness
        return inst

    def runtime(self, scope: str) -> Instance:
        org, ws = scope.split("/")
        return self.engine.runtimes[(org, ws)]
