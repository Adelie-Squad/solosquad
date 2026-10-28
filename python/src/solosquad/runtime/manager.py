"""Run manager (M24, decision 34): the part of LangGraph Server a 24/7 company needs.

    threads   one task each; its checkpoint thread_id is the thread id
    runs      one execution of a thread — pending → running → success · error · interrupted
    crons     a schedule that starts a run (on a fixed thread for a standing goal)

Runs execute concurrently up to `max_concurrency`; connection slots in the router are the
second limiter. On start, runs left `running` by a crash are resumed from their last
checkpoint. Router escalations (budget, rate limits) become a message to Chief on a
dedicated ops thread (decision 35). Every run event is fanned out to subscribers (CLI
watch now, the web in v2.1.0).
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from solosquad.assets.text import load_yaml, match_frontmatter, normalize_line
from solosquad.graph import Command, CompiledStateGraph, Interrupt
from solosquad.messages import Message, user
from solosquad.routing.router import Escalation
from solosquad.runtime.store import RunStore

OPS_THREAD = "chief-ops"


class RunStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    INTERRUPTED = "interrupted"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class CronSpec:
    name: str
    schedule: str
    """Five-field crontab, in the workspace timezone."""
    prompt: str
    thread: str | None = None
    """Fixed thread for a standing goal; None starts a fresh thread each time."""
    enabled: bool = True


def load_crons(directory: Path) -> list[CronSpec]:
    """`orgs/<org>/crons/<name>.md` with frontmatter `schedule:`.

    Optional keys: `thread:` (a standing-goal thread) and `enabled:`.
    """
    out: list[CronSpec] = []
    if not directory.is_dir():
        return out
    for path in sorted(directory.glob("*.md")):
        text = normalize_line(path.read_text(encoding="utf-8"))
        fm = match_frontmatter(text)
        meta = load_yaml(fm.text) if fm else None
        if fm is None or not isinstance(meta, dict) or not isinstance(meta.get("schedule"), str):
            continue
        thread = meta.get("thread")
        out.append(
            CronSpec(
                name=path.stem,
                schedule=meta["schedule"],
                prompt=text[fm.full_length :].strip(),
                thread=thread if isinstance(thread, str) else None,
                enabled=meta.get("enabled", True) is not False,
            )
        )
    return out


Subscriber = asyncio.Queue[dict[str, Any]]


@dataclass
class RunManager:
    graph: CompiledStateGraph
    store: RunStore
    timezone: str = "Asia/Seoul"
    max_concurrency: int = 4
    context: Any = None
    thread_defaults: Callable[[str], dict[str, Any]] = field(default=lambda _tid: {})
    _queue: asyncio.Queue[str] = field(init=False)
    _workers: list[asyncio.Task[None]] = field(init=False, default_factory=list)
    _subscribers: set[Subscriber] = field(init=False, default_factory=set)
    _done: dict[str, asyncio.Event] = field(init=False, default_factory=dict)
    _scheduler: AsyncIOScheduler | None = field(init=False, default=None)
    _ops_last: dict[str, float] = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        self._queue = asyncio.Queue()

    # ------------------------------------------------------------------ lifecycle

    async def start(self, crons: list[CronSpec] | None = None) -> list[str]:
        """Start workers; resume crashed runs. Returns the ids of runs that were resumed."""
        resumed = []
        for run in self.store.runs(status=RunStatus.RUNNING, limit=1000):
            self.store.set_status(run["id"], RunStatus.CANCELLED, error="engine restarted")
            rid = self.store.create_run(run["thread_id"], "continue", None, "crash-resume")
            resumed.append(rid)
        for run in self.store.runs(status=RunStatus.PENDING, limit=1000):
            self._done.setdefault(run["id"], asyncio.Event())
            await self._queue.put(run["id"])
        self._workers = [asyncio.create_task(self._worker()) for _ in range(self.max_concurrency)]
        if crons:
            self._scheduler = AsyncIOScheduler(timezone=self.timezone)
            for c in crons:
                if c.enabled:
                    self._scheduler.add_job(
                        self.fire_cron,
                        CronTrigger.from_crontab(c.schedule, timezone=self.timezone),
                        args=[c],
                        id=c.name,
                    )
            self._scheduler.start()
        return resumed

    async def stop(self) -> None:
        if self._scheduler is not None:
            self._scheduler.shutdown(wait=False)
        for w in self._workers:
            w.cancel()
        for w in self._workers:
            with contextlib.suppress(asyncio.CancelledError):
                await w

    # ------------------------------------------------------------------ API

    def create_thread(
        self, title: str, metadata: dict[str, Any] | None = None, thread_id: str | None = None
    ) -> str:
        return self.store.create_thread(title, metadata, thread_id)

    async def submit(self, thread_id: str, text: str | None, *, source: str = "user") -> str:
        """New input on a thread (None = continue from the checkpoint)."""
        if self.store.thread(thread_id) is None:
            self.store.create_thread(text[:40] if text else thread_id, thread_id=thread_id)
        kind = "message" if text is not None else "continue"
        rid = self.store.create_run(thread_id, kind, text, source)
        self._done[rid] = asyncio.Event()
        await self._queue.put(rid)
        self._publish({"event": "run.created", "run_id": rid, "thread_id": thread_id})
        return rid

    async def resume(self, thread_id: str, value: Any, *, source: str = "user") -> str:
        rid = self.store.create_run(thread_id, "resume", value, source)
        self._done[rid] = asyncio.Event()
        await self._queue.put(rid)
        return rid

    async def wait(self, run_id: str, timeout: float | None = None) -> dict[str, Any]:
        ev = self._done.setdefault(run_id, asyncio.Event())
        run = self.store.run(run_id)
        if run and run["status"] in (
            RunStatus.SUCCESS,
            RunStatus.ERROR,
            RunStatus.INTERRUPTED,
            RunStatus.CANCELLED,
        ):
            return run
        await asyncio.wait_for(ev.wait(), timeout)
        result = self.store.run(run_id)
        assert result is not None
        return result

    async def fire_cron(self, cron: CronSpec) -> str:
        tid = cron.thread or self.store.create_thread(
            f"cron {cron.name} {time.strftime('%Y-%m-%d %H:%M')}", {"cron": cron.name}
        )
        if cron.thread:
            self.store.create_thread(
                f"goal {cron.name}", {"cron": cron.name}, thread_id=cron.thread
            )
        return await self.submit(tid, cron.prompt, source=f"cron:{cron.name}")

    def escalate(self, esc: Escalation) -> None:
        """Router callback (sync): tell Chief, at most once per kind+connection per hour."""
        key = f"{esc.kind}:{esc.connection_id}"
        if time.time() - self._ops_last.get(key, 0) < 3600:
            return
        self._ops_last[key] = time.time()
        self._publish(
            {
                "event": "escalation",
                "kind": esc.kind,
                "connection": esc.connection_id,
                "detail": esc.detail,
            }
        )
        text = (
            f"[engine] {esc.kind}: {esc.detail}. "
            "Review the connections and budget policy and report to the owner."
        )
        with contextlib.suppress(RuntimeError):
            asyncio.get_running_loop().create_task(
                self.submit(OPS_THREAD, text, source="escalation")
            )

    async def subscribe(self) -> AsyncIterator[dict[str, Any]]:
        q: Subscriber = asyncio.Queue()
        self._subscribers.add(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._subscribers.discard(q)

    async def thread_state(self, thread_id: str) -> dict[str, Any]:
        snap = await self.graph.aget_state({"configurable": {"thread_id": thread_id}})
        return {
            "values": snap.values,
            "next": list(snap.next),
            "interrupts": [{"id": i.id, "value": i.value} for i in snap.interrupts],
        }

    # ------------------------------------------------------------------ internals

    def _publish(self, event: dict[str, Any]) -> None:
        event = {"ts": time.time(), **event}
        for q in list(self._subscribers):
            q.put_nowait(event)

    async def _worker(self) -> None:
        while True:
            rid = await self._queue.get()
            try:
                await self._execute(rid)
            finally:
                self._done.setdefault(rid, asyncio.Event()).set()
                self._queue.task_done()

    async def _execute(self, rid: str) -> None:
        run = self.store.run(rid)
        if run is None or run["status"] != RunStatus.PENDING:
            return
        tid = run["thread_id"]
        config = {"configurable": {"thread_id": tid}}
        if run["kind"] == "message":
            graph_input: Any = {"messages": [user(run["input"])], **self.thread_defaults(tid)}
        elif run["kind"] == "resume":
            graph_input = Command(resume=run["input"])
        else:
            graph_input = None
        self.store.set_status(rid, RunStatus.RUNNING)
        self._publish({"event": "run.started", "run_id": rid, "thread_id": tid})
        interrupts: list[Interrupt] = []
        try:
            async for mode, chunk in self.graph.astream(
                graph_input,
                config,
                context=self.context,
                stream_mode=["updates", "messages"],
                durability="sync",
            ):
                if mode == "messages":
                    text, meta = chunk
                    self._publish(
                        {
                            "event": "run.message",
                            "run_id": rid,
                            "thread_id": tid,
                            "agent": meta.get("agent"),
                            "text": text,
                        }
                    )
                    continue
                for node, update in chunk.items():
                    if node == "__interrupt__":
                        interrupts.extend(update)
                        continue
                    self._publish(
                        {
                            "event": "run.update",
                            "run_id": rid,
                            "thread_id": tid,
                            "node": node,
                            "summary": _summary(update),
                        }
                    )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.store.set_status(rid, RunStatus.ERROR, error=f"{type(e).__name__}: {e}")
            self._publish({"event": "run.failed", "run_id": rid, "thread_id": tid, "error": str(e)})
            return
        finally:
            self.store.touch(tid)
        if interrupts:
            payload = [{"id": i.id, "value": i.value} for i in interrupts]
            self.store.set_status(rid, RunStatus.INTERRUPTED, interrupts=payload)
            self._publish(
                {"event": "run.interrupted", "run_id": rid, "thread_id": tid, "interrupts": payload}
            )
        else:
            self.store.set_status(rid, RunStatus.SUCCESS)
            self._publish({"event": "run.completed", "run_id": rid, "thread_id": tid})


def _summary(update: Any) -> Any:
    if isinstance(update, dict):
        msgs = update.get("messages") or []
        texts = [
            m.text for m in msgs if isinstance(m, Message) and m.role == "assistant" and m.text
        ]
        return {
            "text": texts[-1][:500] if texts else None,
            "active_agent": update.get("active_agent"),
            "pending_approval": update.get("pending_approval"),
        }
    return None
