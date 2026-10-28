"""Provider-neutral message schema (M26).

State channels store these, never a vendor's wire format, so any harness can pick up
a thread another harness started. Adapters translate at the edge.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

Role = Literal["system", "user", "assistant", "tool"]


@dataclass(frozen=True)
class TextPart:
    text: str
    kind: Literal["text"] = "text"


@dataclass(frozen=True)
class ToolCallPart:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    kind: Literal["tool_call"] = "tool_call"


@dataclass(frozen=True)
class ToolResultPart:
    tool_call_id: str
    content: str
    is_error: bool = False
    kind: Literal["tool_result"] = "tool_result"


Part = TextPart | ToolCallPart | ToolResultPart


def new_id() -> str:
    return uuid.uuid4().hex


@dataclass(frozen=True)
class Message:
    role: Role
    parts: tuple[Part, ...]
    name: str | None = None
    """For assistant/tool messages: the agent that produced it."""
    id: str = field(default_factory=new_id)

    @property
    def text(self) -> str:
        return "".join(p.text for p in self.parts if isinstance(p, TextPart))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "name": self.name,
            "parts": [_part_to_dict(p) for p in self.parts],
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> Message:
        return Message(
            id=data["id"],
            role=data["role"],
            name=data.get("name"),
            parts=tuple(_part_from_dict(p) for p in data["parts"]),
        )


def _part_to_dict(p: Part) -> dict[str, Any]:
    if isinstance(p, TextPart):
        return {"kind": "text", "text": p.text}
    if isinstance(p, ToolCallPart):
        return {"kind": "tool_call", "id": p.id, "name": p.name, "arguments": p.arguments}
    return {
        "kind": "tool_result",
        "tool_call_id": p.tool_call_id,
        "content": p.content,
        "is_error": p.is_error,
    }


def _part_from_dict(d: dict[str, Any]) -> Part:
    kind = d["kind"]
    if kind == "text":
        return TextPart(d["text"])
    if kind == "tool_call":
        return ToolCallPart(d["id"], d["name"], dict(d.get("arguments") or {}))
    if kind == "tool_result":
        return ToolResultPart(d["tool_call_id"], d["content"], bool(d.get("is_error")))
    raise ValueError(f"unknown message part kind {kind!r}")


def user(text: str) -> Message:
    return Message("user", (TextPart(text),))


def assistant(text: str, name: str | None = None) -> Message:
    return Message("assistant", (TextPart(text),), name=name)


def system(text: str) -> Message:
    return Message("system", (TextPart(text),))
