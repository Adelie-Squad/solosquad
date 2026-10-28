"""Harness contract — the five methods of §C1, one seam for every LLM backend.

    auth_status()            is this connection usable right now           (blocker 5)
    spawn(request)           run one activation, stream LlmStreamEvent       (blockers 1-3)
    assemble_system_prompt   layers → the backend's system prompt            (blockers 4, 6)
    parse_cost(end)          End event → cost in USD                         (blockers 7, 10)
    match_tool_use(event)    guard verdict for a tool call                   (blocker 8)

plus `capabilities` (blocker 9 — context window, MCP support). Async lives here and
below (decision 23); nothing in this layer knows about graphs or agents.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from solosquad.harness.events import End, LlmStreamEvent, ToolUse
from solosquad.harness.guard import GuardPolicy, Verdict


@dataclass(frozen=True)
class McpServer:
    name: str
    command: str
    args: tuple[str, ...] = ()
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PromptLayer:
    name: str
    text: str


@dataclass(frozen=True)
class SpawnRequest:
    prompt: str
    system_prompt: str = ""
    model: str | None = None
    cwd: Path = field(default_factory=Path.cwd)
    mcp_servers: tuple[McpServer, ...] = ()
    allowed_tools: tuple[str, ...] | None = None
    max_budget_usd: float | None = None
    env: dict[str, str] = field(default_factory=dict)
    timeout_s: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AuthStatus:
    logged_in: bool
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Cost:
    usd: float
    estimated: bool = False


@dataclass(frozen=True)
class Capabilities:
    max_context_tokens: int
    supports_mcp: bool
    supports_tools: bool


@runtime_checkable
class Harness(Protocol):
    name: str
    capabilities: Capabilities

    async def auth_status(self) -> AuthStatus: ...

    def spawn(self, request: SpawnRequest) -> AsyncIterator[LlmStreamEvent]: ...

    def assemble_system_prompt(self, layers: Sequence[PromptLayer]) -> str: ...

    def parse_cost(self, end: End) -> Cost: ...

    def match_tool_use(self, event: ToolUse, policy: GuardPolicy) -> Verdict: ...


def default_system_prompt(layers: Sequence[PromptLayer]) -> str:
    return "\n\n".join(f"## {layer.name}\n\n{layer.text.strip()}" for layer in layers if layer.text)


class BaseHarness:
    """Shared defaults; adapters override what their backend does differently."""

    name = "base"
    capabilities = Capabilities(
        max_context_tokens=200_000, supports_mcp=False, supports_tools=False
    )

    def assemble_system_prompt(self, layers: Sequence[PromptLayer]) -> str:
        return default_system_prompt(layers)

    def parse_cost(self, end: End) -> Cost:
        return Cost(usd=end.cost_usd or 0.0, estimated=end.cost_usd is None)

    def match_tool_use(self, event: ToolUse, policy: GuardPolicy) -> Verdict:
        return policy.verdict(event.name, event.input)
