"""`add_messages` reducer and `MessagesState` over the neutral `Message` (M26)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, TypedDict

from solosquad.messages import Message


@dataclass(frozen=True)
class RemoveMessage:
    id: str


def add_messages(left: Any, right: Any) -> list[Message]:
    """Append, but a message whose id already exists replaces it; `RemoveMessage` deletes."""
    current: list[Message] = list(left or [])
    incoming = right if isinstance(right, list | tuple) else [right]
    index = {m.id: i for i, m in enumerate(current)}
    removed: set[str] = set()
    for m in incoming:
        if isinstance(m, RemoveMessage):
            removed.add(m.id)
        elif isinstance(m, Message):
            if m.id in index:
                current[index[m.id]] = m
            else:
                index[m.id] = len(current)
                current.append(m)
        else:
            raise TypeError(f"add_messages expects Message, got {type(m).__name__}")
    return [m for m in current if m.id not in removed]


class MessagesState(TypedDict):
    messages: Annotated[list[Message], add_messages]
