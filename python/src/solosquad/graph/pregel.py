"""Pregel super-step runtime for `StateGraph` — the in-house twin of LangGraph's (decision 20).

One super-step: run every scheduled task concurrently → apply their writes through the
channel reducers → follow edges / branches / Command.goto / Send to schedule the next step
→ checkpoint. Interrupts stop the step after recording what finished, so a resume re-runs
only the interrupted tasks; a crash mid-step re-runs only the unfinished ones.

Async is the core (decision 23). `invoke` / `stream` are thin sync faces for CLI and tests.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import itertools
import queue
import threading
import time
from collections.abc import AsyncIterator, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from solosquad.graph.channels import _MISSING, ChannelSpec
from solosquad.graph.checkpoint import BaseCheckpointSaver, Config
from solosquad.graph.state import NodeSpec, StateGraph
from solosquad.graph.store import BaseStore
from solosquad.graph.types import (
    END,
    INTERRUPT_KEY,
    START,
    Command,
    Durability,
    GraphInterrupt,
    GraphRecursionError,
    Interrupt,
    InvalidUpdateError,
    ParentCommand,
    PregelTask,
    Runtime,
    Send,
    StateSnapshot,
    StreamMode,
    _scope,
    _TaskScope,
)

RESULT = "__result__"
INTERRUPTS = "__interrupt__"
RESUME = "__resume__"
DEFAULT_RECURSION_LIMIT = 25

_seq = itertools.count()


def _new_id() -> str:
    return f"{time.time_ns():020d}{next(_seq) % 10000:04d}"


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class _Task:
    id: str
    name: str
    send: bool = False
    arg: Any = None

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "send": self.send, "arg": self.arg}

    @staticmethod
    def from_dict(d: dict[str, Any]) -> _Task:
        return _Task(d["id"], d["name"], bool(d.get("send")), d.get("arg"))


@dataclass
class _Outcome:
    task: _Task
    writes: list[tuple[str, Any]] = field(default_factory=list)
    gotos: list[str | Send] = field(default_factory=list)
    update: Any = None
    interrupts: tuple[Interrupt, ...] = ()


class _Emit:
    """Collects stream chunks for the requested modes."""

    def __init__(self, modes: set[str]) -> None:
        self.modes = modes
        self.q: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

    def __call__(self, mode: str, payload: Any) -> None:
        if mode in self.modes:
            self.q.put_nowait((mode, payload))


class CompiledStateGraph:
    def __init__(
        self,
        builder: StateGraph,
        *,
        checkpointer: BaseCheckpointSaver | None,
        store: BaseStore | None,
        interrupt_before: tuple[str, ...],
        interrupt_after: tuple[str, ...],
        name: str,
    ) -> None:
        self.builder = builder
        self.channels: dict[str, ChannelSpec] = builder.channels
        self.nodes: dict[str, NodeSpec] = builder.nodes
        self.checkpointer = checkpointer
        self.store = store
        self.interrupt_before = interrupt_before
        self.interrupt_after = interrupt_after
        self.name = name

    # ------------------------------------------------------------------ public async

    async def astream(
        self,
        input: Any,
        config: Config | None = None,
        *,
        context: Any = None,
        stream_mode: StreamMode | Sequence[StreamMode] = "updates",
        durability: Durability | None = None,
    ) -> AsyncIterator[Any]:
        modes = [stream_mode] if isinstance(stream_mode, str) else list(stream_mode)
        single = isinstance(stream_mode, str)
        emit = _Emit(set(modes))
        runner = asyncio.create_task(
            self._run(input, dict(config or {}), context, emit, durability or "async")
        )
        try:
            while True:
                getter = asyncio.create_task(emit.q.get())
                done, _ = await asyncio.wait({getter, runner}, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    mode, payload = getter.result()
                    yield payload if single else (mode, payload)
                    continue
                getter.cancel()
                while not emit.q.empty():
                    mode, payload = emit.q.get_nowait()
                    yield payload if single else (mode, payload)
                runner.result()
                return
        finally:
            if not runner.done():
                runner.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await runner

    async def ainvoke(
        self,
        input: Any,
        config: Config | None = None,
        *,
        context: Any = None,
        durability: Durability | None = None,
    ) -> dict[str, Any]:
        emit = _Emit({"updates"})
        out = await self._run(input, dict(config or {}), context, emit, durability or "async")
        interrupts: list[Interrupt] = []
        while not emit.q.empty():
            _, chunk = emit.q.get_nowait()
            if INTERRUPT_KEY in chunk:
                interrupts.extend(chunk[INTERRUPT_KEY])
        if interrupts:
            out[INTERRUPT_KEY] = interrupts
        return out

    async def aget_state(self, config: Config) -> StateSnapshot:
        saver = self._saver()
        tup = await saver.aget_tuple(config)
        return self._snapshot(tup)

    async def aget_state_history(
        self, config: Config, *, limit: int | None = None
    ) -> list[StateSnapshot]:
        saver = self._saver()
        return [self._snapshot(t) for t in await saver.alist(config, limit=limit)]

    async def aupdate_state(
        self, config: Config, values: dict[str, Any] | None, as_node: str | None = None
    ) -> Config:
        saver = self._saver()
        tup = await saver.aget_tuple(config)
        state = dict(tup.checkpoint["values"]) if tup else self._initial()
        barriers = dict(tup.checkpoint.get("barriers", {})) if tup else {}
        writes = [(k, v) for k, v in (values or {}).items() if k in self.channels]
        state = self._apply(state, writes)
        step = (tup.checkpoint["step"] + 1) if tup else -1
        cid = _new_id()
        if as_node is not None:
            next_tasks = self._schedule(cid, [(as_node, state, [])], barriers)
        else:
            next_tasks = [_Task.from_dict(t) for t in tup.checkpoint["next"]] if tup else []
        cp = self._checkpoint(cid, step, state, barriers, next_tasks)
        return await saver.aput(
            tup.config if tup else config,
            cp,
            {"source": "update", "step": step, "writes": {as_node: values}},
        )

    # ------------------------------------------------------------------ sync faces

    def invoke(self, input: Any, config: Config | None = None, **kw: Any) -> dict[str, Any]:
        result: dict[str, Any] = _run_sync(self.ainvoke(input, config, **kw))
        return result

    def stream(self, input: Any, config: Config | None = None, **kw: Any) -> Iterator[Any]:
        return _iter_sync(self.astream(input, config, **kw))

    def get_state(self, config: Config) -> StateSnapshot:
        snap: StateSnapshot = _run_sync(self.aget_state(config))
        return snap

    def get_state_history(
        self, config: Config, *, limit: int | None = None
    ) -> Iterator[StateSnapshot]:
        return iter(_run_sync(self.aget_state_history(config, limit=limit)))

    def update_state(
        self, config: Config, values: dict[str, Any] | None, as_node: str | None = None
    ) -> Config:
        out: Config = _run_sync(self.aupdate_state(config, values, as_node))
        return out

    # ------------------------------------------------------------------ internals

    def _saver(self) -> BaseCheckpointSaver:
        if self.checkpointer is None:
            raise ValueError("No checkpointer set")
        return self.checkpointer

    def _initial(self) -> dict[str, Any]:
        return {k: v for k, spec in self.channels.items() if (v := spec.initial()) is not _MISSING}

    def _output(self, values: dict[str, Any]) -> dict[str, Any]:
        keys = self.builder.output_keys
        return {k: v for k, v in values.items() if keys is None or k in keys}

    def _apply(self, state: dict[str, Any], writes: Sequence[tuple[str, Any]]) -> dict[str, Any]:
        grouped: dict[str, list[Any]] = {}
        for k, v in writes:
            grouped.setdefault(k, []).append(v)
        out = dict(state)
        for k, vs in grouped.items():
            spec = self.channels[k]
            new = spec.apply(out.get(k, _MISSING), vs)
            if new is not _MISSING:
                out[k] = new
        return out

    @staticmethod
    def _checkpoint(
        cid: str,
        step: int,
        state: dict[str, Any],
        barriers: dict[str, list[str]],
        tasks: list[_Task],
    ) -> dict[str, Any]:
        return {
            "v": 1,
            "id": cid,
            "ts": _now(),
            "step": step,
            "values": state,
            "barriers": barriers,
            "next": [t.to_dict() for t in tasks],
            "skip_before": False,
        }

    def _snapshot(self, tup: Any) -> StateSnapshot:
        if tup is None:
            return StateSnapshot({}, (), {}, None, None, None, ())
        cp = tup.checkpoint
        tasks = [_Task.from_dict(t) for t in cp["next"]]
        ints: dict[str, tuple[Interrupt, ...]] = {}
        for task_id, ch, value in tup.pending_writes:
            if ch == INTERRUPTS:
                ints[task_id] = tuple(value)
        done = {task_id for task_id, ch, _ in tup.pending_writes if ch == RESULT}
        pregel_tasks = tuple(PregelTask(t.id, t.name, ints.get(t.id, ())) for t in tasks)
        return StateSnapshot(
            values=self._output(cp["values"]),
            next=tuple(t.name for t in tasks if t.id not in done),
            config=tup.config,
            metadata=tup.metadata,
            created_at=cp.get("ts"),
            parent_config=tup.parent_config,
            tasks=pregel_tasks,
            interrupts=tuple(i for t in pregel_tasks for i in t.interrupts),
        )

    def _schedule(
        self,
        cid: str,
        finished: Sequence[tuple[str, dict[str, Any], list[str | Send]]],
        barriers: dict[str, list[str]],
    ) -> list[_Task]:
        """Next tasks from (finished node, its local view of state, its Command gotos)."""
        pull: list[str] = []
        push: list[Send] = []

        def add(target: str | Send) -> None:
            if isinstance(target, Send):
                if target.node not in self.nodes:
                    raise InvalidUpdateError(f"Invalid node name {target.node}")
                push.append(target)
            elif target != END:
                if target not in self.nodes:
                    raise ValueError(f"At '{target}': unknown node")
                if target not in pull:
                    pull.append(target)

        for name, local, gotos in finished:
            for s, e in sorted(self.builder.edges):
                if s == name:
                    add(e)
            for starts, end in sorted(self.builder.waiting_edges):
                if name in starts:
                    key = f"join:{'+'.join(starts)}:{end}"
                    seen = set(barriers.get(key, [])) | {name}
                    if seen >= set(starts):
                        barriers.pop(key, None)
                        add(end)
                    else:
                        barriers[key] = sorted(seen)
            for branch in self.builder.branches.get(name, []):
                result = _call_path(branch.path, local)
                for r in result if isinstance(result, list | tuple) else [result]:
                    if branch.path_map is not None and not isinstance(r, Send):
                        if r not in branch.path_map:
                            raise ValueError(f"Branch returned unknown destination {r!r}")
                        r = branch.path_map[r]
                    add(r)
            for g in gotos:
                add(g)
        tasks = [_Task(f"{cid}:{i}", n) for i, n in enumerate(pull)]
        tasks += [_Task(f"{cid}:{len(pull) + i}", s.node, True, s.arg) for i, s in enumerate(push)]
        return tasks

    def _normalize(self, name: str, result: Any) -> _Outcome:
        out = _Outcome(_Task("", name), update=result)
        if result is None:
            return out
        if isinstance(result, Command):
            if result.graph == Command.PARENT:
                raise ParentCommand(
                    Command(update=result.update, goto=result.goto, resume=result.resume)
                )
            if isinstance(result.update, dict):
                out.writes = [(k, v) for k, v in result.update.items() if k in self.channels]
                out.update = dict(out.writes)
            else:
                out.update = result.update
            out.gotos = result.goto_list()
            return out
        if isinstance(result, dict):
            out.writes = [(k, v) for k, v in result.items() if k in self.channels]
            out.update = dict(out.writes)
            return out
        raise InvalidUpdateError(f"Expected dict, got {result!r}")

    async def _call_node(
        self, task: _Task, state: dict[str, Any], config: Config, context: Any, scope: _TaskScope
    ) -> _Outcome:
        node = self.nodes[task.name]
        arg = task.arg if task.send else dict(state)
        action = node.action
        token = _scope.set(scope)
        try:
            if isinstance(action, CompiledStateGraph):
                sub_input = {k: v for k, v in arg.items() if k in action.channels}
                try:
                    sub = await action._run_nested(sub_input, config, context)
                except ParentCommand as pc:
                    outcome = self._normalize(task.name, pc.command)
                    outcome.task = task
                    return outcome
                result: Any = {k: v for k, v in sub.items() if k in self.channels}
            else:
                kwargs = _node_kwargs(
                    action, config, Runtime(context, self.store, scope.writer), scope
                )
                if inspect.iscoroutinefunction(action) or inspect.iscoroutinefunction(
                    getattr(action, "__call__", None)  # noqa: B004
                ):
                    result = await action(arg, **kwargs)
                else:
                    result = await asyncio.to_thread(action, arg, **kwargs)
        finally:
            _scope.reset(token)
        outcome = self._normalize(task.name, result)
        outcome.task = task
        return outcome

    async def _run_nested(
        self, input: dict[str, Any], config: Config, context: Any
    ) -> dict[str, Any]:
        """Subgraph as a node: no own checkpoint; interrupts and PARENT commands bubble up."""
        emit = _Emit(set())
        return await self._run(
            input,
            {k: v for k, v in config.items() if k != "configurable"},
            context,
            emit,
            "exit",
            nested=True,
        )

    async def _run(
        self,
        input: Any,
        config: Config,
        context: Any,
        emit: _Emit,
        durability: Durability,
        nested: bool = False,
    ) -> dict[str, Any]:
        saver = None if nested else self.checkpointer
        limit = int(config.get("recursion_limit", DEFAULT_RECURSION_LIMIT))
        tup = await saver.aget_tuple(config) if saver is not None else None
        parent_scope = _scope.get() if nested else None

        state = dict(tup.checkpoint["values"]) if tup else self._initial()
        barriers: dict[str, list[str]] = dict(tup.checkpoint.get("barriers", {})) if tup else {}
        step = tup.checkpoint["step"] if tup else -1
        cp_config: Config = tup.config if tup else config
        pending = list(tup.pending_writes) if tup else []
        skip_before = bool(tup.checkpoint.get("skip_before")) if tup else False
        tasks: list[_Task]
        deferred: list[tuple[dict[str, Any], dict[str, Any]]] = []
        background: list[asyncio.Task[Any]] = []

        async def put(cp: dict[str, Any], metadata: dict[str, Any]) -> None:
            nonlocal cp_config
            if saver is None:
                return
            if durability == "exit":
                deferred.append((cp, metadata))
                cp_config = {
                    "configurable": {**cp_config.get("configurable", {}), "checkpoint_id": cp["id"]}
                }
                return
            if background:
                await asyncio.gather(*background)
                background.clear()
            if durability == "sync":
                cp_config = await saver.aput(cp_config, cp, metadata)
            else:
                target = cp_config
                cp_config = {
                    "configurable": {**target.get("configurable", {}), "checkpoint_id": cp["id"]}
                }
                background.append(asyncio.create_task(saver.aput(target, cp, metadata)))
            emit(
                "checkpoints",
                {
                    "config": cp_config,
                    "values": self._output(cp["values"]),
                    "next": [t["name"] for t in cp["next"]],
                    "metadata": metadata,
                },
            )
            emit(
                "debug",
                {
                    "type": "checkpoint",
                    "step": cp["step"],
                    "timestamp": cp["ts"],
                    "payload": {"config": cp_config, "values": cp["values"]},
                },
            )

        async def put_writes(task_id: str, writes: list[tuple[str, Any]]) -> None:
            if saver is None or durability == "exit":
                return
            if durability == "sync":
                await saver.aput_writes(cp_config, writes, task_id)
            else:
                if background:
                    await asyncio.gather(*background)
                    background.clear()
                await saver.aput_writes(cp_config, writes, task_id)

        if (
            saver is not None
            and tup is None
            and input is not None
            and not isinstance(input, Command)
        ):
            pass
        if isinstance(input, Command):
            if tup is None:
                raise ValueError("Cannot resume a thread that has no checkpoint")
            tasks = [_Task.from_dict(t) for t in tup.checkpoint["next"]]
            if input.resume is not None:
                interrupted = {tid: v for tid, ch, v in pending if ch == INTERRUPTS}
                for tid, ints in interrupted.items():
                    prior: list[Any] = next(
                        (v for t, ch, v in reversed(pending) if t == tid and ch == RESUME), []
                    )
                    if isinstance(input.resume, dict) and any(i.id in input.resume for i in ints):
                        value = next(input.resume[i.id] for i in ints if i.id in input.resume)
                    else:
                        value = input.resume
                    resume_list = [*prior, value]
                    pending.append((tid, RESUME, resume_list))
                    await put_writes(tid, [(RESUME, resume_list)])
        elif input is None:
            if tup is None or not tup.checkpoint["next"]:
                return self._output(state)
            tasks = [_Task.from_dict(t) for t in tup.checkpoint["next"]]
        else:
            if not isinstance(input, dict):
                raise InvalidUpdateError(f"Expected dict input, got {input!r}")
            keys = self.builder.input_keys
            writes = [
                (k, v)
                for k, v in input.items()
                if k in self.channels and (keys is None or k in keys)
            ]
            state = self._apply(state, writes)
            step += 1
            cid = _new_id()
            tasks = self._schedule(cid, [(START, state, [])], barriers)
            pending = []
            await put(
                self._checkpoint(cid, step, state, barriers, tasks),
                {"source": "input", "step": step, "writes": {START: input}},
            )
            if writes:
                emit("values", self._output(state))

        while tasks:
            if step >= limit:
                raise GraphRecursionError(
                    f"Recursion limit of {limit} reached without hitting a stop condition. "
                    "You can increase the limit by setting the `recursion_limit` config key."
                )
            if (
                not skip_before
                and any(t.name in self.interrupt_before for t in tasks)
                and saver is not None
            ):
                cp = self._checkpoint(_new_id(), step, state, barriers, tasks)
                cp["skip_before"] = True
                await put(cp, {"source": "loop", "step": step, "writes": None})
                emit("updates", {INTERRUPT_KEY: ()})
                break
            skip_before = False

            done: dict[str, _Outcome] = {}
            resumes: dict[str, list[Any]] = {}
            for tid, ch, value in pending:
                if ch == RESULT:
                    done[tid] = _Outcome(
                        next(t for t in tasks if t.id == tid)
                        if any(t.id == tid for t in tasks)
                        else _Task(tid, value["name"]),
                        writes=[tuple(w) for w in value["writes"]],
                        gotos=list(value["gotos"]),
                        update=value["update"],
                    )
                elif ch == RESUME:
                    resumes[tid] = list(value)
            to_run = [t for t in tasks if t.id not in done]

            async def run_one(
                t: _Task,
                state: dict[str, Any] = state,
                step: int = step,
                resumes: dict[str, list[Any]] = resumes,
            ) -> _Outcome:
                if parent_scope is not None:
                    scope = parent_scope
                    scope.node = t.name
                else:
                    scope = _TaskScope(
                        task_id=t.id,
                        resume=resumes.get(t.id, []),
                        writer=lambda x: emit("custom", x),
                        message_writer=lambda c, m: emit("messages", (c, m)),
                        node=t.name,
                    )
                emit(
                    "tasks",
                    {
                        "id": t.id,
                        "name": t.name,
                        "input": t.arg if t.send else None,
                        "triggers": (),
                    },
                )
                emit(
                    "debug",
                    {
                        "type": "task",
                        "step": step + 1,
                        "timestamp": _now(),
                        "payload": {"id": t.id, "name": t.name},
                    },
                )
                try:
                    outcome = await self._call_node(t, state, config, context, scope)
                except GraphInterrupt as gi:
                    emit(
                        "tasks",
                        {
                            "id": t.id,
                            "name": t.name,
                            "result": None,
                            "error": None,
                            "interrupts": gi.interrupts,
                        },
                    )
                    if nested:
                        raise
                    await put_writes(t.id, [(INTERRUPTS, list(gi.interrupts))])
                    return _Outcome(t, interrupts=gi.interrupts)
                await put_writes(
                    t.id,
                    [
                        (
                            RESULT,
                            {
                                "name": t.name,
                                "writes": outcome.writes,
                                "gotos": outcome.gotos,
                                "update": outcome.update,
                            },
                        )
                    ],
                )
                emit("updates", {t.name: outcome.update})
                emit(
                    "tasks",
                    {
                        "id": t.id,
                        "name": t.name,
                        "result": outcome.writes,
                        "error": None,
                        "interrupts": (),
                    },
                )
                emit(
                    "debug",
                    {
                        "type": "task_result",
                        "step": step + 1,
                        "timestamp": _now(),
                        "payload": {"id": t.id, "name": t.name, "result": outcome.writes},
                    },
                )
                return outcome

            results = await _gather_in_order(to_run, run_one)
            for o in results:
                done[o.task.id] = o
            interrupts = tuple(i for o in results for i in o.interrupts)
            if interrupts:
                emit("updates", {INTERRUPT_KEY: interrupts})
                break

            ordered = [done[t.id] for t in tasks]
            all_writes = [w for o in ordered for w in o.writes]
            new_state = self._apply(state, all_writes)
            cid = _new_id()
            finished = [(o.task.name, self._apply(state, o.writes), o.gotos) for o in ordered]
            next_tasks = self._schedule(cid, finished, barriers)
            state = new_state
            step += 1
            pending = []
            await put(
                self._checkpoint(cid, step, state, barriers, next_tasks),
                {
                    "source": "loop",
                    "step": step,
                    "writes": {o.task.name: o.update for o in ordered},
                },
            )
            if all_writes:
                emit("values", self._output(state))
            if saver is not None and any(o.task.name in self.interrupt_after for o in ordered):
                emit("updates", {INTERRUPT_KEY: ()})
                break
            tasks = next_tasks

        if background:
            await asyncio.gather(*background)
        if deferred and saver is not None:
            target = tup.config if tup else config
            for cp, md in deferred:
                target = await saver.aput(target, cp, md)
        return self._output(state)


def _node_kwargs(
    action: Any, config: Config, runtime: Runtime, scope: _TaskScope
) -> dict[str, Any]:
    try:
        params = inspect.signature(action).parameters
    except (TypeError, ValueError):
        return {}
    kwargs: dict[str, Any] = {}
    if "config" in params:
        kwargs["config"] = config
    if "runtime" in params:
        kwargs["runtime"] = runtime
    if "writer" in params:
        kwargs["writer"] = scope.writer
    if "store" in params:
        kwargs["store"] = runtime.store
    return kwargs


def _call_path(path: Any, state: dict[str, Any]) -> Any:
    if inspect.iscoroutinefunction(path):
        raise TypeError("async branch functions are not supported in the sync scheduler")
    return path(dict(state))


async def _gather_in_order(tasks: list[_Task], fn: Any) -> list[_Outcome]:
    if not tasks:
        return []
    running = [asyncio.create_task(fn(t)) for t in tasks]
    try:
        return list(await asyncio.gather(*running))
    except BaseException:
        for r in running:
            r.cancel()
        raise


def _run_sync(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    box: dict[str, Any] = {}

    def target() -> None:
        try:
            box["value"] = asyncio.run(coro)
        except BaseException as e:
            box["error"] = e

    th = threading.Thread(target=target)
    th.start()
    th.join()
    if "error" in box:
        raise box["error"]
    return box["value"]


def _iter_sync(agen: AsyncIterator[Any]) -> Iterator[Any]:
    q: queue.Queue[tuple[str, Any]] = queue.Queue()

    async def drain() -> None:
        try:
            async for item in agen:
                q.put(("item", item))
        except BaseException as e:
            q.put(("error", e))
        else:
            q.put(("done", None))

    th = threading.Thread(target=lambda: asyncio.run(drain()), daemon=True)
    th.start()
    while True:
        kind, item = q.get()
        if kind == "item":
            yield item
        elif kind == "error":
            raise item
        else:
            return
