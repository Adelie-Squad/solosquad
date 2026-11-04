"""Deterministic in-process harness for tests and offline runs."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Sequence

from solosquad.harness.base import AuthStatus, BaseHarness, Capabilities, SpawnRequest
from solosquad.harness.events import End, LlmStreamEvent, Start, TextDelta, Usage

Script = Callable[[SpawnRequest], Sequence[LlmStreamEvent]]


def echo_script(req: SpawnRequest) -> Sequence[LlmStreamEvent]:
    last = req.prompt.strip().splitlines()[-1] if req.prompt.strip() else ""
    return [
        Start(model=req.model),
        TextDelta(f"ok: {last}"),
        End("end_turn", Usage(10, 5), 0.0),
    ]


class FakeHarness(BaseHarness):
    name = "fake"
    capabilities = Capabilities(max_context_tokens=50_000, supports_mcp=True, supports_tools=True)

    def __init__(self, script: Script = echo_script, delay_s: float = 0.0) -> None:
        self.script = script
        self.delay_s = delay_s
        self.requests: list[SpawnRequest] = []

    async def spawn(self, request: SpawnRequest) -> AsyncIterator[LlmStreamEvent]:
        self.requests.append(request)
        for event in self.script(request):
            if self.delay_s:
                await asyncio.sleep(self.delay_s)
            yield event

    async def auth_status(self) -> AuthStatus:
        return AuthStatus(True, {"fake": True})
