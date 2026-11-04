"""Swarm layer — the in-house twin of `langgraph-swarm` (decision 19).

    create_swarm(agents, default_active_agent=)   → StateGraph (caller compiles it)
    create_handoff_tool(agent_name=)              → a tool whose call becomes Command(goto=agent)
    add_active_agent_router(builder, route_to=, default_active_agent=)
    SwarmState                                    MessagesState + active_agent

One agent is active at a time per thread; it hands control over by calling a handoff
tool, and the next agent reads the same `messages` channel. The thread's next input
goes to whichever agent was active last.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Any, TypedDict

from solosquad.graph import START, Command, StateGraph, add_messages
from solosquad.messages import Message, ToolResultPart

HANDOFF_PREFIX = "transfer_to_"
HANDOFF_TOOL = re.compile(r"transfer_to_([A-Za-z0-9_-]+)$")


class SwarmState(TypedDict, total=False):
    messages: Annotated[list[Message], add_messages]
    active_agent: str | None


@dataclass(frozen=True)
class HandoffTool:
    agent_name: str
    name: str
    description: str

    def command(
        self, messages: Sequence[Message], tool_call_id: str, task: str | None = None
    ) -> Command:
        """Same shape as langgraph-swarm: append a tool message, switch active_agent."""
        note = f"Successfully transferred to {self.agent_name}"
        if task:
            note += f"\nTask: {task}"
        tool_msg = Message("tool", (ToolResultPart(tool_call_id, note),), name=self.name)
        return Command(
            goto=self.agent_name,
            graph=Command.PARENT,
            update={"messages": [*messages, tool_msg], "active_agent": self.agent_name},
        )


def create_handoff_tool(
    *, agent_name: str, name: str | None = None, description: str | None = None
) -> HandoffTool:
    return HandoffTool(
        agent_name=agent_name,
        name=name or f"{HANDOFF_PREFIX}{agent_name}",
        description=description or f"Ask agent '{agent_name}' for help",
    )


def handoff_target(tool_name: str) -> str | None:
    """`mcp__solosquad__transfer_to_pm` · `solosquad_transfer_to_pm` · `transfer_to_pm` → `pm`."""
    m = HANDOFF_TOOL.search(tool_name)
    return m.group(1) if m else None


def get_handoff_destinations(agent: Any) -> tuple[str, ...]:
    tools: Sequence[HandoffTool] = getattr(agent, "handoff_tools", ())
    return tuple(t.agent_name for t in tools)


def add_active_agent_router(
    builder: StateGraph, *, route_to: list[str], default_active_agent: str
) -> StateGraph:
    if "active_agent" not in builder.channels:
        raise ValueError("Missing required key 'active_agent' in state_schema")
    if default_active_agent not in route_to:
        raise ValueError(
            f"Default active agent '{default_active_agent}' not found in routes {route_to}"
        )

    def route_to_active_agent(state: dict[str, Any]) -> str:
        active = state.get("active_agent") or default_active_agent
        return active if active in route_to else default_active_agent

    builder.add_conditional_edges(START, route_to_active_agent, path_map=route_to)
    return builder


def create_swarm(
    agents: Sequence[Any],
    *,
    default_active_agent: str,
    state_schema: Any = SwarmState,
    context_schema: Any = None,
) -> StateGraph:
    names = [a.name for a in agents]
    if default_active_agent not in names:
        raise ValueError(
            f"Default active agent '{default_active_agent}' not found in routes {names}"
        )
    builder = StateGraph(state_schema, context_schema)
    for agent in agents:
        builder.add_node(agent.name, agent, destinations=get_handoff_destinations(agent))
    return add_active_agent_router(
        builder, route_to=names, default_active_agent=default_active_agent
    )
