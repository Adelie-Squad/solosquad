"""Live checks against the real Claude Code CLI. Opt in with SOLOSQUAD_LIVE=1 (uses the
logged-in account; each test is one or two tiny haiku activations)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
from company_fixtures import Company

from solosquad.company import build_company
from solosquad.harness.claude_code import ClaudeCodeHarness
from solosquad.messages import user
from solosquad.routing import Connection, ConnectionKind

pytestmark = pytest.mark.skipif(
    os.environ.get("SOLOSQUAD_LIVE") != "1", reason="live: set SOLOSQUAD_LIVE=1"
)


def cfg(t: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": t}}


async def test_live_handoff_through_real_claude_code(tmp_path: Path) -> None:
    """Chief calls our MCP transfer tool inside Claude Code; the graph moves to pm."""
    c = Company(
        tmp_path,
        connections=[
            Connection(
                id="max",
                kind=ConnectionKind.SUBSCRIPTION,
                provider="anthropic",
                harness="claude-code",
                models=["haiku"],
            )
        ],
    )
    c.router.harness_factory = lambda conn, _s: ClaudeCodeHarness()
    c.rt.timeout_s = 180
    app = build_company(c.rt)
    out = await app.ainvoke(
        {
            "messages": [
                user(
                    "This is a planning request. Do not answer it yourself: hand it to pm right now "
                    "using the transfer_to_pm tool with the task 'plan a bakery launch'. Then stop."
                )
            ]
        },
        cfg("live"),
    )
    names = [m.name for m in out["messages"]]
    assert "transfer_to_pm" in names, names
    assert out["active_agent"] == "pm"
    assert out["messages"][-1].name == "pm" and out["messages"][-1].text
    assert {e["agent"] for e in c.ledger.entries()} == {"chief", "pm"}
