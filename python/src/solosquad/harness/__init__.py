"""LLM backends behind one contract (§C1). Async stays inside this package (decision 23)."""

from solosquad.harness.base import (
    AuthStatus,
    BaseHarness,
    Capabilities,
    Cost,
    Harness,
    McpServer,
    PromptLayer,
    SpawnRequest,
)
from solosquad.harness.events import (
    End,
    Error,
    LlmStreamEvent,
    RateLimit,
    Start,
    TextDelta,
    ToolResult,
    ToolUse,
    Usage,
)
from solosquad.harness.guard import GuardPolicy, GuardRule, Verdict

__all__ = [
    "AuthStatus",
    "BaseHarness",
    "Capabilities",
    "Cost",
    "End",
    "Error",
    "GuardPolicy",
    "GuardRule",
    "Harness",
    "LlmStreamEvent",
    "McpServer",
    "PromptLayer",
    "RateLimit",
    "SpawnRequest",
    "Start",
    "TextDelta",
    "ToolResult",
    "ToolUse",
    "Usage",
    "Verdict",
    "collect",
]


async def collect(harness: Harness, request: SpawnRequest) -> list[LlmStreamEvent]:
    return [e async for e in harness.spawn(request)]
