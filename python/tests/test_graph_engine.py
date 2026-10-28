"""Engine behaviour beyond the LangGraph golden set: persistence, crash resume, streams."""

from __future__ import annotations

import asyncio
import operator
from pathlib import Path
from typing import Annotated, Any, TypedDict

import pytest

from solosquad.graph import (
    START,
    Command,
    InMemorySaver,
    InMemoryStore,
    MessagesState,
    RemoveMessage,
    Runtime,
    SqliteSaver,
    StateGraph,
    add_messages,
    emit_message_chunk,
    get_stream_writer,
    interrupt,
)
from solosquad.messages import assistant, user


class S(TypedDict, total=False):
    x: int
    log: Annotated[list[Any], operator.add]


def cfg(tid: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": tid}}


def crashy_graph(runs: dict[str, int], crash: dict[str, bool]) -> StateGraph:
    async def fast(s: S) -> dict[str, Any]:
        runs["fast"] += 1
        return {"log": ["fast"]}

    async def slow(s: S) -> dict[str, Any]:
        runs["slow"] += 1
        await asyncio.sleep(0.05)
        if crash["now"]:
            raise RuntimeError("power cut")
        return {"log": ["slow"]}

    g = StateGraph(S)
    g.add_node("fast", fast)
    g.add_node("slow", slow)
    g.add_node("join", lambda s: {"x": len(s["log"])})
    g.add_edge(START, "fast")
    g.add_edge(START, "slow")
    g.add_edge(["fast", "slow"], "join")
    return g


@pytest.mark.parametrize("durability", ["sync", "async"])
async def test_crash_mid_step_reruns_only_unfinished_tasks(tmp_path: Path, durability: str) -> None:
    db = tmp_path / "cp.sqlite"
    runs = {"fast": 0, "slow": 0}
    crash = {"now": True}
    g = crashy_graph(runs, crash)
    with pytest.raises(RuntimeError, match="power cut"):
        await g.compile(checkpointer=SqliteSaver(db)).ainvoke(
            {"x": 0}, cfg("t"), durability=durability
        )  # type: ignore[arg-type]

    crash["now"] = False
    restarted = crashy_graph(runs, crash).compile(checkpointer=SqliteSaver(db))  # a fresh process
    assert (await restarted.aget_state(cfg("t"))).next == ("slow",)
    out = await restarted.ainvoke(None, cfg("t"))
    assert runs == {"fast": 1, "slow": 2}
    assert sorted(out["log"]) == ["fast", "slow"] and out["x"] == 2


async def test_interrupt_survives_restart(tmp_path: Path) -> None:
    db = tmp_path / "cp.sqlite"

    def ask(s: S) -> dict[str, Any]:
        return {"log": [interrupt("pay 500?")]}

    def build() -> Any:
        g = StateGraph(S)
        g.add_node("ask", ask)
        g.add_edge(START, "ask")
        return g.compile(checkpointer=SqliteSaver(db))

    first = await build().ainvoke({"x": 1}, cfg("p"))
    assert first["__interrupt__"][0].value == "pay 500?"
    snap = await build().aget_state(cfg("p"))
    assert snap.next == ("ask",) and snap.interrupts[0].value == "pay 500?"
    done = await build().ainvoke(Command(resume="approved"), cfg("p"))
    assert done == {"x": 1, "log": ["approved"]}


async def test_exit_durability_writes_only_at_the_end() -> None:
    saver = InMemorySaver()
    g = StateGraph(S)
    g.add_node("a", lambda s: {"log": ["a"]})
    g.add_node("b", lambda s: {"log": ["b"]})
    g.add_edge(START, "a")
    g.add_edge("a", "b")
    await g.compile(checkpointer=saver).ainvoke({"x": 0}, cfg("e"), durability="exit")
    history = list(saver.list(cfg("e")))
    assert len(history) == 3  # input + two steps, flushed together
    assert history[0].checkpoint["values"]["log"] == ["a", "b"]


async def test_custom_messages_and_checkpoint_streams() -> None:
    async def talk(s: S) -> dict[str, Any]:
        get_stream_writer()({"progress": 50})
        emit_message_chunk("hel")
        emit_message_chunk("lo")
        return {"log": ["talk"]}

    g = StateGraph(S)
    g.add_node("talk", talk)
    g.add_edge(START, "talk")
    c = g.compile(checkpointer=InMemorySaver())
    chunks = [
        c
        async for c in c.astream(
            {"x": 0}, cfg("s"), stream_mode=["custom", "messages", "checkpoints"]
        )
    ]
    modes = [m for m, _ in chunks]
    assert ("custom", {"progress": 50}) in chunks
    assert [p[0] for m, p in chunks if m == "messages"] == ["hel", "lo"]
    assert (
        chunks[next(i for i, m in enumerate(modes) if m == "messages")][1][1]["langgraph_node"]
        == "talk"
    )
    assert modes.count("checkpoints") == 2


async def test_runtime_context_store_and_config() -> None:
    store = InMemoryStore()

    def node(s: S, runtime: Runtime, config: dict[str, Any]) -> dict[str, Any]:
        runtime.store.put(("org", "tesla"), "seen", {"by": runtime.context["agent"]})
        return {"log": [config["configurable"]["thread_id"]]}

    g = StateGraph(S)
    g.add_node("node", node)
    g.add_edge(START, "node")
    c = g.compile(checkpointer=InMemorySaver(), store=store)
    out = await c.ainvoke({"x": 0}, cfg("rt"), context={"agent": "chief"})
    assert out["log"] == ["rt"]
    item = store.get(("org", "tesla"), "seen")
    assert item is not None and item.value == {"by": "chief"}


async def test_history_and_update_state() -> None:
    g = StateGraph(S)
    g.add_node("a", lambda s: {"log": ["a"]})
    g.add_edge(START, "a")
    c = g.compile(checkpointer=InMemorySaver())
    await c.ainvoke({"x": 1}, cfg("h"))
    history = await c.aget_state_history(cfg("h"))
    assert [h.metadata["source"] for h in history if h.metadata] == ["loop", "input"]
    await c.aupdate_state(cfg("h"), {"x": 42, "log": ["edited"]})
    snap = await c.aget_state(cfg("h"))
    assert snap.values == {"x": 42, "log": ["a", "edited"]}


def test_sync_faces() -> None:
    g = StateGraph(S)
    g.add_node("a", lambda s: {"log": ["a"]})
    g.add_edge(START, "a")
    c = g.compile()
    assert c.invoke({"x": 1}) == {"x": 1, "log": ["a"]}
    assert list(c.stream({"x": 1})) == [{"a": {"log": ["a"]}}]


async def test_sync_face_inside_running_loop() -> None:
    g = StateGraph(S)
    g.add_node("a", lambda s: {"log": ["a"]})
    g.add_edge(START, "a")
    assert g.compile().invoke({"x": 1})["log"] == ["a"]


def test_add_messages_replaces_by_id_and_removes() -> None:
    hi = user("hi")
    draft = assistant("draft", name="chief")
    merged = add_messages([hi, draft], [type(draft)(draft.role, draft.parts, "chief", draft.id)])
    assert [m.id for m in merged] == [hi.id, draft.id]
    assert add_messages(merged, [RemoveMessage(hi.id)]) == [merged[1]]

    g = StateGraph(MessagesState)
    g.add_node("reply", lambda s: {"messages": [assistant(f"echo {s['messages'][-1].text}")]})
    g.add_edge(START, "reply")
    out = g.compile().invoke({"messages": [user("ping")]})
    assert [m.text for m in out["messages"]] == ["ping", "echo ping"]
