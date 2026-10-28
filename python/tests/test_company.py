from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from company_fixtures import Company, agent_of, reply

from solosquad.company import AgentError, build_company, derive_handoffs
from solosquad.graph import START, Command, StateGraph
from solosquad.harness.base import SpawnRequest
from solosquad.harness.events import End, Error, RateLimit, Start, TextDelta, ToolResult
from solosquad.harness.guard_hook import MARKER
from solosquad.layout import ExecutionPolicy
from solosquad.messages import user
from solosquad.routing import ChiefPolicy, Connection, ConnectionKind
from solosquad.routing.policy import AgentPreference, Budget
from solosquad.swarm import (
    SwarmState,
    add_active_agent_router,
    create_handoff_tool,
    create_swarm,
    handoff_target,
)


def cfg(t: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": t}}


def test_swarm_api_mirrors_langgraph_swarm() -> None:
    assert handoff_target("mcp__solosquad__transfer_to_pm") == "pm"
    assert handoff_target("solosquad_transfer_to_data-analyst") == "data-analyst"
    assert handoff_target("Bash") is None
    b = StateGraph(SwarmState)
    b.add_node("Alice", lambda s: {})
    with pytest.raises(
        ValueError, match="Default active agent 'Bob' not found in routes \\['Alice'\\]"
    ):
        add_active_agent_router(b, route_to=["Alice"], default_active_agent="Bob")

    class Agent:
        def __init__(self, name: str, to: str) -> None:
            self.name = name
            self.handoff_tools = [create_handoff_tool(agent_name=to)]

        def __call__(self, state: dict[str, Any]) -> Any:
            if self.name == "alice":
                cmd = self.handoff_tools[0].command(state["messages"], "c1")
                return Command(goto=cmd.goto, update=cmd.update)
            return {"messages": [user("bob here")]}

    app = create_swarm(
        [Agent("alice", "bob"), Agent("bob", "alice")], default_active_agent="alice"
    ).compile()
    out = app.invoke({"messages": [user("hi")]})
    assert out["active_agent"] == "bob"
    assert [m.role for m in out["messages"]] == ["user", "tool", "user"]


def test_derived_handoffs(tmp_path: Path) -> None:
    c = Company(tmp_path)
    h = derive_handoffs(c.rt.resolver, ["chief", "pm", "engineer"])
    assert set(h["chief"]) == {"pm"}
    assert set(h["pm"]) == {"chief", "engineer"}
    assert set(h["engineer"]) == {"pm", "chief"}


async def test_chief_hands_off_and_next_turn_goes_to_active_agent(tmp_path: Path) -> None:
    c = Company(tmp_path)
    app = build_company(c.rt)
    out = await app.ainvoke({"messages": [user("please plan the launch")]}, cfg("t1"))
    roles = [(m.role, m.name) for m in out["messages"]]
    assert roles == [
        ("user", None),
        ("assistant", "chief"),
        ("tool", "transfer_to_pm"),
        ("assistant", "pm"),
    ]
    assert out["active_agent"] == "pm"
    assert "Task: plan the launch" in out["messages"][2].parts[0].content  # type: ignore[union-attr]
    out = await app.ainvoke({"messages": [user("status?")]}, cfg("t1"))
    assert out["messages"][-1].name == "pm"
    req: SpawnRequest = c.harnesses["max"].requests[-1]
    assert (
        "[user] please plan the launch" in req.prompt and "[pm] pm done" in req.prompt
    )  # fresh session, full history
    assert req.mcp_servers and req.mcp_servers[0].name == "solosquad"
    by_agent = c.ledger.totals("agent")
    assert by_agent["chief"]["calls"] == 1 and by_agent["pm"]["calls"] == 2


async def test_rate_limited_connection_falls_back_and_tells_chief(tmp_path: Path) -> None:
    c = Company(tmp_path)
    c.scripts["max"] = lambda req: [
        Start(),
        RateLimit("exceeded", 9e12, "five_hour"),
        Error("limit", True),
        End("error"),
    ]
    app = build_company(c.rt)
    out = await app.ainvoke({"messages": [user("hello")]}, cfg("t2"))
    assert out["messages"][-1].text == "chief done"
    assert [e["connection_id"] for e in c.ledger.entries()] == ["router", "max"]
    assert c.router.limited_until["max"] == 9e12
    assert [e.kind for e in c.escalations] == ["rate_limited"]
    await app.ainvoke({"messages": [user("again")]}, cfg("t2"))
    assert len(c.harnesses["max"].requests) == 1, "a limited connection is skipped until it resets"


async def test_workspace_policy_filters_connections(tmp_path: Path) -> None:
    local = Connection(
        id="ollama",
        kind=ConnectionKind.LOCAL_LLM,
        provider="ollama",
        harness="fake",
        models=["qwen"],
        network="local",
    )
    c = Company(
        tmp_path,
        connections=[
            Connection(
                id="router",
                kind=ConnectionKind.API_KEY,
                provider="openrouter",
                harness="fake",
                models=["gpt-5"],
            ),
            local,
        ],
        workspace_policy=ExecutionPolicy(allow_external_api=False),
    )
    await build_company(c.rt).ainvoke({"messages": [user("x")]}, cfg("t3"))
    assert [e["connection_id"] for e in c.ledger.entries()] == ["ollama"]

    c2 = Company(
        tmp_path / "2", connections=[local], workspace_policy=ExecutionPolicy(allow_local_llm=False)
    )
    with pytest.raises(AgentError, match="no usable connection"):
        await build_company(c2.rt).ainvoke({"messages": [user("x")]}, cfg("t4"))
    assert [e.kind for e in c2.escalations] == ["no_connection"]


async def test_chief_policy_picks_models_and_enforces_budget(tmp_path: Path) -> None:
    policy = ChiefPolicy(
        agents={"chief": AgentPreference(models=["gpt-5"])},
        budget=Budget(monthly_usd=0.015, warn_at=0.5),
    )
    c = Company(tmp_path, chief_policy=policy)
    app = build_company(c.rt)
    await app.ainvoke({"messages": [user("one")]}, cfg("b"))
    first = c.ledger.entries()[0]
    assert first["connection_id"] == "router" and first["model"] == "gpt-5"
    await app.ainvoke({"messages": [user("two")]}, cfg("b"))
    assert "budget_warning" in [e.kind for e in c.escalations]
    with pytest.raises(AgentError):
        await app.ainvoke({"messages": [user("three")]}, cfg("b"))
    assert "budget_exhausted" in [e.kind for e in c.escalations]


async def test_guard_approval_round_trip(tmp_path: Path) -> None:
    c = Company(tmp_path)

    def script(req: SpawnRequest) -> list[Any]:
        if agent_of(req) == "chief" and "(approved by owner" not in req.prompt:
            return [
                Start(),
                TextDelta("need to clean up"),
                ToolResult("t", f"{MARKER}:abc123:recursive delete"),
                End("end_turn"),
            ]
        return reply("cleaned up" if "(approved by owner" in req.prompt else "ok")

    c.scripts["max"] = script
    app = build_company(c.rt)
    first = await app.ainvoke({"messages": [user("tidy the disk")]}, cfg("g"))
    assert first["__interrupt__"][0].value == {
        "kind": "approval",
        "agent": "chief",
        "signature": "abc123",
        "reason": "recursive delete",
    }
    done = await app.ainvoke(Command(resume="approved"), cfg("g"))
    assert done["grants"] == ["abc123"] and done["pending_approval"] is None
    assert done["messages"][-1].text == "cleaned up"


async def test_unknown_agent_company_needs_chief(tmp_path: Path) -> None:
    c = Company(tmp_path)
    with pytest.raises(ValueError, match="chief"):
        build_company(c.rt, agents=["pm"])


def test_start_constant_is_shared() -> None:
    assert START == "__start__"
