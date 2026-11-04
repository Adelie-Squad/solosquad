"""Event replay for the web's live view (PRD v2.1.0 I9).

One pump subscribes to the run manager, numbers every event and keeps the last
`BUFFER` of them. A browser that reconnects sends `Last-Event-ID` and receives only what
it missed — as long as it was gone for fewer than `BUFFER` events; past that it reloads
state from the API (the event stream is a hint, the API is the truth).
"""

from __future__ import annotations

import asyncio
import contextlib
from collections import deque
from collections.abc import AsyncIterator
from typing import Any

from solosquad.runtime import RunManager

BUFFER = 500
Item = tuple[int, dict[str, Any]]


class EventHub:
    def __init__(
        self,
        manager: RunManager,
        size: int = BUFFER,
        *,
        others: dict[str, RunManager] | None = None,
    ) -> None:
        """`others` = more run managers (e.g. `{"workflow": …}`); their events carry `source`."""
        self.manager = manager
        self.others = others or {}
        self.buffer: deque[Item] = deque(maxlen=size)
        self.seq = 0
        self._clients: set[asyncio.Queue[Item]] = set()
        self._pump: asyncio.Task[None] | None = None
        self._ready = asyncio.Event()

    async def ensure_started(self) -> None:
        if self._pump is None:
            sources = {"company": self.manager, **self.others}
            readies = []
            tasks = []
            for name, mgr in sources.items():
                ready = asyncio.Event()
                readies.append(ready)
                tasks.append(asyncio.create_task(self._run(name, mgr, ready)))
            self._pump = asyncio.create_task(self._hold(tasks))
            for ready in readies:
                await ready.wait()
            self._ready.set()
        await self._ready.wait()

    async def _hold(self, tasks: list[asyncio.Task[None]]) -> None:
        try:
            await asyncio.gather(*tasks)
        finally:
            for t in tasks:
                t.cancel()

    async def _run(self, source: str, manager: RunManager, ready: asyncio.Event) -> None:
        stream = manager.subscribe().__aiter__()
        nxt = asyncio.ensure_future(stream.__anext__())
        await asyncio.sleep(0)  # registered with the manager before anyone is told "ready"
        ready.set()
        try:
            while True:
                event = await nxt
                if source != "company":
                    event = {**event, "source": source}
                self.seq += 1
                item = (self.seq, event)
                self.buffer.append(item)
                for q in list(self._clients):
                    q.put_nowait(item)
                nxt = asyncio.ensure_future(stream.__anext__())
        finally:
            nxt.cancel()
            with contextlib.suppress(Exception):
                await stream.aclose()  # type: ignore[attr-defined]

    async def subscribe(self, last_id: int = 0) -> AsyncIterator[Item]:
        await self.ensure_started()
        q: asyncio.Queue[Item] = asyncio.Queue()
        self._clients.add(q)
        try:
            missed = [item for item in self.buffer if item[0] > last_id]
            sent = last_id
            for item in missed:
                sent = item[0]
                yield item
            while True:
                item = await q.get()
                if item[0] > sent:
                    sent = item[0]
                    yield item
        finally:
            self._clients.discard(q)

    async def stop(self) -> None:
        if self._pump is not None:
            self._pump.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._pump
            self._pump = None
