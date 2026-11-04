"""`LlmStreamEvent` — the one stream shape every harness adapter emits (§C1 blocker 3)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @property
    def total(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_read_tokens
            + self.cache_write_tokens
        )

    def __add__(self, other: Usage) -> Usage:
        return Usage(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
            self.cache_read_tokens + other.cache_read_tokens,
            self.cache_write_tokens + other.cache_write_tokens,
        )


@dataclass(frozen=True)
class Start:
    session_id: str | None = None
    model: str | None = None


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ToolUse:
    id: str
    name: str
    input: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolResult:
    tool_use_id: str
    content: str
    is_error: bool = False


@dataclass(frozen=True)
class RateLimit:
    """Quota signal from the provider. `exceeded` makes the router fall back (decision 22)."""

    status: Literal["allowed", "warning", "exceeded"]
    resets_at: float | None = None
    kind: str | None = None


@dataclass(frozen=True)
class End:
    stop_reason: str | None = None
    usage: Usage = field(default_factory=Usage)
    cost_usd: float | None = None
    result_text: str | None = None


@dataclass(frozen=True)
class Error:
    message: str
    retryable: bool = False


LlmStreamEvent = Start | TextDelta | ToolUse | ToolResult | RateLimit | End | Error
