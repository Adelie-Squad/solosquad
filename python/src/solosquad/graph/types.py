"""Public graph types, named and shaped after `langgraph.types` (decision 19 mimicry table)."""

from __future__ import annotations

import contextvars
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

START = "__start__"
END = "__end__"
INTERRUPT_KEY = "__interrupt__"

StreamMode = Literal["values", "updates", "custom", "checkpoints", "tasks", "debug", "messages"]
Durability = Literal["sync", "async", "exit"]


@dataclass(frozen=True)
class Send:
    node: str
    arg: Any


@dataclass(frozen=True)
class Interrupt:
    value: Any
    id: str


@dataclass(frozen=True)
class Command:
    graph: str | None = None
    update: Any = None
    resume: Any = None
    goto: str | Send | Sequence[str | Send] = ()

    PARENT: ClassVar[str] = "__parent__"

    def goto_list(self) -> list[str | Send]:
        if isinstance(self.goto, str | Send):
            return [self.goto]
        return list(self.goto)


@dataclass(frozen=True)
class PregelTask:
    id: str
    name: str
    interrupts: tuple[Interrupt, ...] = ()
    error: str | None = None


@dataclass(frozen=True)
class StateSnapshot:
    values: dict[str, Any]
    next: tuple[str, ...]
    config: dict[str, Any]
    metadata: dict[str, Any] | None
    created_at: str | None
    parent_config: dict[str, Any] | None
    tasks: tuple[PregelTask, ...]
    interrupts: tuple[Interrupt, ...] = ()


class GraphInterrupt(Exception):
    def __init__(self, interrupts: Sequence[Interrupt]) -> None:
        super().__init__(interrupts)
        self.interrupts = tuple(interrupts)


class ParentCommand(Exception):
    def __init__(self, command: Command) -> None:
        super().__init__(command)
        self.command = command


class InvalidUpdateError(Exception):
    pass


class GraphRecursionError(RecursionError):
    pass


@dataclass
class Runtime:
    """What a node may ask for besides the state (`runtime` parameter)."""

    context: Any = None
    store: Any = None
    stream_writer: Callable[[Any], None] = lambda _x: None


@dataclass
class _TaskScope:
    task_id: str
    resume: list[Any] = field(default_factory=list)
    counter: int = 0
    writer: Callable[[Any], None] = lambda _x: None
    message_writer: Callable[[Any, dict[str, Any]], None] = lambda _c, _m: None
    node: str = ""


_scope: contextvars.ContextVar[_TaskScope | None] = contextvars.ContextVar(
    "solosquad_graph_task", default=None
)


def interrupt(value: Any) -> Any:
    """Pause the running node; on resume the node re-runs and this returns the resume value.

    Several `interrupt` calls in one node are matched to resume values by call order.
    """
    scope = _scope.get()
    if scope is None:
        raise RuntimeError("interrupt() called outside a graph node")
    index = scope.counter
    scope.counter += 1
    if index < len(scope.resume):
        return scope.resume[index]
    raise GraphInterrupt([Interrupt(value=value, id=f"{scope.task_id}:{index}")])


def get_stream_writer() -> Callable[[Any], None]:
    """Writer for `stream_mode="custom"` from inside a node."""
    scope = _scope.get()
    return scope.writer if scope is not None else (lambda _x: None)


def emit_message_chunk(chunk: Any, metadata: dict[str, Any] | None = None) -> None:
    """Feed `stream_mode="messages"` — LangGraph does this from its chat models; our agent
    nodes call it for each text delta from the harness."""
    scope = _scope.get()
    if scope is not None:
        scope.message_writer(chunk, {"langgraph_node": scope.node, **(metadata or {})})
