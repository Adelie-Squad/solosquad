"""`StateGraph` builder — same methods and validation points as `langgraph.graph.StateGraph`."""

from __future__ import annotations

from collections.abc import Callable, Hashable, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from solosquad.graph.channels import ChannelSpec, channels_from_schema
from solosquad.graph.types import END, START

if TYPE_CHECKING:
    from solosquad.graph.checkpoint import BaseCheckpointSaver
    from solosquad.graph.pregel import CompiledStateGraph
    from solosquad.graph.store import BaseStore

RESERVED = {START, END}


@dataclass
class NodeSpec:
    name: str
    action: Any
    destinations: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Branch:
    path: Callable[..., Any]
    path_map: dict[Hashable, str] | None = None


class StateGraph:
    def __init__(
        self,
        state_schema: Any,
        context_schema: Any = None,
        *,
        input_schema: Any = None,
        output_schema: Any = None,
    ) -> None:
        self.state_schema = state_schema
        self.context_schema = context_schema
        self.channels: dict[str, ChannelSpec] = channels_from_schema(state_schema)
        self.input_keys = set(channels_from_schema(input_schema)) if input_schema else None
        self.output_keys = set(channels_from_schema(output_schema)) if output_schema else None
        self.nodes: dict[str, NodeSpec] = {}
        self.edges: set[tuple[str, str]] = set()
        self.waiting_edges: set[tuple[tuple[str, ...], str]] = set()
        self.branches: dict[str, list[Branch]] = {}
        self.compiled = False

    def add_node(
        self,
        node: str | Callable[..., Any],
        action: Any = None,
        *,
        destinations: Sequence[str] | dict[str, str] | None = None,
        metadata: dict[str, Any] | None = None,
        **_ignored: Any,
    ) -> StateGraph:
        if not isinstance(node, str):
            action = node
            inferred = getattr(node, "name", None) or getattr(node, "__name__", None)
            if not isinstance(inferred, str):
                raise ValueError("node name could not be inferred; pass it explicitly")
            node = inferred
        if action is None:
            raise ValueError(f"node {node!r} needs an action")
        if node in self.nodes:
            raise ValueError(f"Node `{node}` already present.")
        if node in RESERVED:
            raise ValueError(f"Node `{node}` is reserved.")
        dests = tuple(destinations) if destinations is not None else ()
        self.nodes[node] = NodeSpec(node, action, dests, dict(metadata or {}))
        return self

    def add_edge(self, start_key: str | list[str], end_key: str) -> StateGraph:
        if isinstance(start_key, str):
            if start_key == END:
                raise ValueError("END cannot be a start node")
            if end_key == START:
                raise ValueError("START cannot be an end node")
            self.edges.add((start_key, end_key))
        else:
            self.waiting_edges.add((tuple(start_key), end_key))
        return self

    def add_conditional_edges(
        self,
        source: str,
        path: Callable[..., Any],
        path_map: dict[Hashable, str] | list[str] | None = None,
    ) -> StateGraph:
        mapping: dict[Hashable, str] | None = (
            {name: name for name in path_map} if isinstance(path_map, list) else path_map
        )
        self.branches.setdefault(source, []).append(Branch(path, mapping))
        return self

    def add_sequence(self, nodes: Sequence[Callable[..., Any] | tuple[str, Any]]) -> StateGraph:
        previous: str | None = None
        for item in nodes:
            if isinstance(item, tuple):
                name, action = item
                self.add_node(name, action)
            else:
                name = item.__name__
                self.add_node(item)
            if previous is not None:
                self.add_edge(previous, name)
            previous = name
        return self

    def set_entry_point(self, key: str) -> StateGraph:
        return self.add_edge(START, key)

    def set_finish_point(self, key: str) -> StateGraph:
        return self.add_edge(key, END)

    def validate(self) -> None:
        sources = {s for s, _ in self.edges} | set(self.branches)
        sources |= {s for starts, _ in self.waiting_edges for s in starts}
        if START not in sources:
            raise ValueError(
                "Graph must have an entrypoint: add at least one edge from START to another node"
            )
        known = set(self.nodes) | RESERVED
        for s, e in self.edges:
            for n in (s, e):
                if n not in known:
                    raise ValueError(f"Found edge referencing unknown node `{n}`")
        for starts, e in self.waiting_edges:
            for n in (*starts, e):
                if n not in known:
                    raise ValueError(f"Found edge referencing unknown node `{n}`")
        for s in self.branches:
            if s not in known:
                raise ValueError(f"Found edge starting at unknown node `{s}`")

    def compile(
        self,
        checkpointer: BaseCheckpointSaver | None = None,
        *,
        store: BaseStore | None = None,
        interrupt_before: Sequence[str] | None = None,
        interrupt_after: Sequence[str] | None = None,
        name: str | None = None,
        **_ignored: Any,
    ) -> CompiledStateGraph:
        from solosquad.graph.pregel import CompiledStateGraph

        self.validate()
        self.compiled = True
        return CompiledStateGraph(
            self,
            checkpointer=checkpointer,
            store=store,
            interrupt_before=tuple(interrupt_before or ()),
            interrupt_after=tuple(interrupt_after or ()),
            name=name or "LangGraph",
        )
