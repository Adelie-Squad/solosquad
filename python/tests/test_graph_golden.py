"""PRD v2.0.0 [3] AC (golden): our engine and LangGraph produce the same state transitions
and `updates` streams for the same graph (decision 20 — langgraph is a test-only reference).

Each scenario is written once against a `lib` namespace and run on both engines.
"""

from __future__ import annotations

import json
import operator
from collections.abc import Callable
from types import SimpleNamespace
from typing import Annotated, Any, TypedDict

import pytest

import solosquad.graph as ours


def _langgraph() -> SimpleNamespace:
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.errors import GraphRecursionError, InvalidUpdateError
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Command, Send, interrupt

    return SimpleNamespace(
        StateGraph=StateGraph, START=START, END=END, Command=Command, Send=Send,
        interrupt=interrupt, InMemorySaver=InMemorySaver,
        InvalidUpdateError=InvalidUpdateError, GraphRecursionError=GraphRecursionError,
    )  # fmt: skip


OURS = SimpleNamespace(
    StateGraph=ours.StateGraph, START=ours.START, END=ours.END, Command=ours.Command,
    Send=ours.Send, interrupt=ours.interrupt, InMemorySaver=ours.InMemorySaver,
    InvalidUpdateError=ours.InvalidUpdateError, GraphRecursionError=ours.GraphRecursionError,
)  # fmt: skip


class S(TypedDict, total=False):
    x: int
    log: Annotated[list[Any], operator.add]
    route: str


def norm(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: norm(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [norm(v) for v in obj]
    if type(obj).__name__ == "Interrupt":
        return {"interrupt": norm(obj.value)}
    return obj


def sorted_chunks(chunks: list[Any]) -> list[Any]:
    return sorted(norm(chunks), key=lambda c: json.dumps(c, sort_keys=True, default=str))


def cfg(tid: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": tid}}


# ---------------------------------------------------------------- scenarios


def linear(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    g.add_node("a", lambda s: {"x": s.get("x", 0) + 1, "log": ["a"]})
    g.add_node("b", lambda s: {"log": ["b"]})
    g.add_edge(lib.START, "a")
    g.add_edge("a", "b")
    g.add_edge("b", lib.END)
    c = g.compile()
    return {
        "default": norm(list(c.stream({"x": 1}))),
        "values": norm(list(c.stream({"x": 1}, stream_mode="values"))),
        "multi": norm(list(c.stream({"x": 1}, stream_mode=["updates", "values"]))),
        "invoke": norm(c.invoke({"x": 1})),
    }


def fan_out_join(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    g.add_node("a", lambda s: {"log": ["a"]})
    g.add_node("b", lambda s: {"log": ["b"]})
    g.add_node("c", lambda s: {"x": len(s["log"]), "log": ["c"]})
    g.add_edge(lib.START, "a")
    g.add_edge(lib.START, "b")
    g.add_edge(["a", "b"], "c")
    c = g.compile()
    final = c.invoke({"x": 0})
    final["log"] = sorted(final["log"][:2]) + final["log"][2:]
    return {"updates": sorted_chunks(list(c.stream({"x": 0}))), "final": norm(final)}


def conditional(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    g.add_node("router", lambda s: {"route": "left" if s["x"] > 0 else "right"})
    g.add_node("l", lambda s: {"log": ["l"]})
    g.add_node("r", lambda s: {"log": ["r"]})
    g.add_edge(lib.START, "router")
    g.add_conditional_edges("router", lambda s: s["route"], {"left": "l", "right": "r"})
    g.add_edge("l", lib.END)
    g.add_edge("r", lib.END)
    c = g.compile()
    return [norm(list(c.stream({"x": v}))) for v in (1, -1)]


def conditional_from_start_with_list(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    for n in ("p", "q", "z"):
        g.add_node(n, lambda s, n=n: {"log": [n]})
    g.add_conditional_edges(
        lib.START, lambda s: ["p", "q"] if s["x"] else [lib.END], ["p", "q", "z", lib.END]
    )
    c = g.compile()
    return {"go": sorted_chunks(list(c.stream({"x": 1}))), "stop": norm(c.invoke({"x": 0}))}


def send_map_reduce(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    g.add_node("w", lambda s: {"log": [s["x"] * 10]})
    g.add_node("total", lambda s: {"x": sum(s["log"])})
    g.add_conditional_edges(lib.START, lambda s: [lib.Send("w", {"x": i}) for i in range(s["x"])])
    g.add_edge("w", "total")
    c = g.compile()
    out = c.invoke({"x": 3})
    out["log"] = sorted(out["log"])
    return {"updates": sorted_chunks(list(c.stream({"x": 3}))), "final": norm(out)}


def command_goto(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    g.add_node(
        "c",
        lambda s: lib.Command(update={"log": ["c"]}, goto="b" if s["x"] else "d"),
        destinations=("b", "d"),
    )
    g.add_node("b", lambda s: {"log": ["b"]})
    g.add_node("d", lambda s: {"log": ["d"]})
    g.add_edge(lib.START, "c")
    c = g.compile()
    return [norm(list(c.stream({"x": v}))) for v in (1, 0)]


def interrupt_resume(lib: SimpleNamespace) -> Any:
    def ask(s: S) -> dict[str, Any]:
        answer = lib.interrupt({"q": "approve?"})
        return {"log": [f"answer:{answer}"]}

    g = lib.StateGraph(S)
    g.add_node("prep", lambda s: {"log": ["prep"]})
    g.add_node("ask", ask)
    g.add_node("after", lambda s: {"log": ["after"]})
    g.add_edge(lib.START, "prep")
    g.add_edge("prep", "ask")
    g.add_edge("ask", "after")
    c = g.compile(checkpointer=lib.InMemorySaver())
    first = norm(list(c.stream({"x": 1}, cfg("t"))))
    state = c.get_state(cfg("t"))
    pending = {
        "next": list(state.next),
        "values": norm(state.values),
        "interrupts": norm(state.interrupts),
    }
    resumed = norm(list(c.stream(lib.Command(resume="yes"), cfg("t"))))
    final = c.get_state(cfg("t"))
    invoked = norm(c.invoke({"x": 2}, cfg("t2")))
    return {
        "first": first,
        "pending": pending,
        "resumed": resumed,
        "final": [norm(final.values), list(final.next)],
        "invoke": invoked,
    }


def double_interrupt(lib: SimpleNamespace) -> Any:
    def two(s: S) -> dict[str, Any]:
        a = lib.interrupt("first")
        b = lib.interrupt("second")
        return {"log": [a, b]}

    g = lib.StateGraph(S)
    g.add_node("two", two)
    g.add_edge(lib.START, "two")
    c = g.compile(checkpointer=lib.InMemorySaver())
    steps = [norm(list(c.stream({"x": 0}, cfg("d"))))]
    steps.append(norm(list(c.stream(lib.Command(resume="A"), cfg("d")))))
    steps.append(norm(list(c.stream(lib.Command(resume="B"), cfg("d")))))
    return {"steps": steps, "final": norm(c.get_state(cfg("d")).values)}


def interrupt_before(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    g.add_node("a", lambda s: {"log": ["a"]})
    g.add_node("b", lambda s: {"log": ["b"]})
    g.add_edge(lib.START, "a")
    g.add_edge("a", "b")
    c = g.compile(checkpointer=lib.InMemorySaver(), interrupt_before=["b"])
    first = norm(list(c.stream({"x": 0}, cfg("ib"))))
    nxt = list(c.get_state(cfg("ib")).next)
    rest = norm(list(c.stream(None, cfg("ib"))))
    return {"first": first, "next": nxt, "rest": rest, "final": norm(c.get_state(cfg("ib")).values)}


def duplicate_write(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    g.add_node("p1", lambda s: {"x": 1})
    g.add_node("p2", lambda s: {"x": 2})
    g.add_edge(lib.START, "p1")
    g.add_edge(lib.START, "p2")
    with pytest.raises(lib.InvalidUpdateError) as e:
        g.compile().invoke({"route": "go"})
    return str(e.value).split("\n")[0]


def recursion_limit(lib: SimpleNamespace) -> Any:
    runs: list[int] = []
    g = lib.StateGraph(S)
    g.add_node("loop", lambda s: runs.append(1) or {"x": s.get("x", 0) + 1})
    g.add_edge(lib.START, "loop")
    g.add_edge("loop", "loop")
    with pytest.raises(lib.GraphRecursionError):
        g.compile().invoke({"x": 0}, {"recursion_limit": 5})
    return len(runs)


def odd_returns(lib: SimpleNamespace) -> Any:
    g = lib.StateGraph(S)
    g.add_node("none", lambda s: None)
    g.add_node("unknown", lambda s: {"nope": 1, "log": ["u"]})
    g.add_edge(lib.START, "none")
    g.add_edge("none", "unknown")
    c = g.compile()
    return {
        "stream": norm(list(c.stream({"x": 1}))),
        "empty_input": norm(list(c.stream({}, stream_mode="values"))),
        "unknown_input": norm(list(c.stream({"bogus": 1}))),
    }


def subgraph_node(lib: SimpleNamespace) -> Any:
    sub = lib.StateGraph(S)
    sub.add_node("inner", lambda s: {"x": s["x"] * 2, "log": ["inner"]})
    sub.add_edge(lib.START, "inner")
    g = lib.StateGraph(S)
    g.add_node("child", sub.compile())
    g.add_node("after", lambda s: {"log": ["after"]})
    g.add_edge(lib.START, "child")
    g.add_edge("child", "after")
    return norm(g.compile().invoke({"x": 3}))


def parent_command(lib: SimpleNamespace) -> Any:
    """The swarm handoff shape: a node inside a subgraph sends control to a sibling."""
    sub = lib.StateGraph(S)
    sub.add_node(
        "tool",
        lambda s: lib.Command(
            graph=lib.Command.PARENT, goto="bob", update={"route": "bob", "log": ["handoff"]}
        ),
    )
    sub.add_edge(lib.START, "tool")
    g = lib.StateGraph(S)
    g.add_node("alice", sub.compile(), destinations=("bob",))
    g.add_node("bob", lambda s: {"log": [f"bob saw {s['route']}"]})
    g.add_edge(lib.START, "alice")
    c = g.compile()
    return {"updates": norm(list(c.stream({"x": 0}))), "final": norm(c.invoke({"x": 0}))}


SCENARIOS: list[Callable[[SimpleNamespace], Any]] = [
    linear, fan_out_join, conditional, conditional_from_start_with_list, send_map_reduce,
    command_goto, interrupt_resume, double_interrupt, interrupt_before, duplicate_write,
    recursion_limit, odd_returns, subgraph_node, parent_command,
]  # fmt: skip


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda f: f.__name__)
def test_matches_langgraph(scenario: Callable[[SimpleNamespace], Any]) -> None:
    expected = scenario(_langgraph())
    actual = scenario(OURS)
    assert actual == expected
