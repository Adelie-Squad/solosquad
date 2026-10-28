"""History injection for a fresh CLI session (M20, M21 — state is the only source of truth).

"Store everything, inject selectively": the full `messages` channel stays in the
checkpoint; what an activation sees is cut to the receiving model's window. Up to 60% of
that window the whole history goes in; beyond it the recent turns stay verbatim and older
ones collapse into a one-line-per-message digest.
"""

from __future__ import annotations

from collections.abc import Sequence

from solosquad.context.prompt import estimate_tokens
from solosquad.messages import Message, TextPart, ToolCallPart, ToolResultPart

FULL_HISTORY_SHARE = 0.6
RECENT_TURNS = 8
DIGEST_CHARS = 160


def _speaker(m: Message) -> str:
    if m.role == "user":
        return "user"
    if m.role == "tool":
        return f"tool:{m.name}" if m.name else "tool"
    return m.name or m.role


def _render(m: Message) -> str:
    chunks = []
    for p in m.parts:
        if isinstance(p, TextPart):
            chunks.append(p.text)
        elif isinstance(p, ToolCallPart):
            chunks.append(f"(called {p.name})")
        elif isinstance(p, ToolResultPart):
            chunks.append(f"(tool result{' — error' if p.is_error else ''}: {p.content[:500]})")
    return f"[{_speaker(m)}] " + "\n".join(chunks).strip()


def render_transcript(messages: Sequence[Message], window_tokens: int) -> tuple[str, bool]:
    """→ (transcript text, whether older turns were digested)."""
    lines = [_render(m) for m in messages if m.role != "system"]
    full = "\n\n".join(lines)
    if estimate_tokens(full) <= int(window_tokens * FULL_HISTORY_SHARE):
        return full, False
    older, recent = lines[:-RECENT_TURNS], lines[-RECENT_TURNS:]
    digest = [line.split("\n", 1)[0][:DIGEST_CHARS] for line in older]
    text = "(earlier conversation, condensed)\n" + "\n".join(digest) + "\n\n" + "\n\n".join(recent)
    return text, True
