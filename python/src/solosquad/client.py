"""One client interface for the CLI: HTTP to a running instance, or the instance in-process."""

from __future__ import annotations

import asyncio
import json
import time
import urllib.request
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Protocol

from solosquad.instance import Instance, start_instance
from solosquad.messages import Message

TERMINAL = {"success", "error", "interrupted", "cancelled"}


class Client(Protocol):
    async def create_thread(self, title: str, metadata: dict[str, Any] | None = None) -> str: ...
    async def submit(self, thread_id: str, text: str | None) -> str: ...
    async def resume(self, thread_id: str, value: Any) -> str: ...
    async def wait(self, run_id: str, timeout: float = 3600) -> dict[str, Any]: ...
    async def messages(self, thread_id: str) -> list[dict[str, Any]]: ...
    async def threads(self) -> list[dict[str, Any]]: ...
    async def runs(
        self, thread_id: str | None = None, status: str | None = None
    ) -> list[dict[str, Any]]: ...
    async def ledger(self, by: str) -> dict[str, Any]: ...
    async def close(self) -> None: ...


def server_file(data_dir: Path) -> Path:
    return data_dir / "server.json"


class HttpClient:
    def __init__(self, base: str, token: str) -> None:
        self.base = base.rstrip("/")
        self.token = token

    def _call(self, method: str, path: str, body: Any = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read() or b"null")

    async def _a(self, method: str, path: str, body: Any = None) -> Any:
        return await asyncio.to_thread(self._call, method, path, body)

    async def create_thread(self, title: str, metadata: dict[str, Any] | None = None) -> str:
        return str(
            (await self._a("POST", "/threads", {"title": title, "metadata": metadata}))["thread_id"]
        )

    async def submit(self, thread_id: str, text: str | None) -> str:
        return str((await self._a("POST", f"/threads/{thread_id}/runs", {"input": text}))["run_id"])

    async def resume(self, thread_id: str, value: Any) -> str:
        return str(
            (await self._a("POST", f"/threads/{thread_id}/resume", {"value": value}))["run_id"]
        )

    async def wait(self, run_id: str, timeout: float = 3600) -> dict[str, Any]:
        deadline = time.time() + timeout
        while True:
            run: dict[str, Any] = await self._a("GET", f"/runs/{run_id}")
            if run["status"] in TERMINAL or time.time() > deadline:
                return run
            await asyncio.sleep(0.5)

    async def messages(self, thread_id: str) -> list[dict[str, Any]]:
        state = await self._a("GET", f"/threads/{thread_id}/state")
        return list((state.get("values") or {}).get("messages") or [])

    async def threads(self) -> list[dict[str, Any]]:
        return list(await self._a("GET", "/threads"))

    async def runs(
        self, thread_id: str | None = None, status: str | None = None
    ) -> list[dict[str, Any]]:
        q = "&".join(f"{k}={v}" for k, v in (("thread_id", thread_id), ("status", status)) if v)
        return list(await self._a("GET", f"/runs?{q}"))

    async def ledger(self, by: str) -> dict[str, Any]:
        return dict(await self._a("GET", f"/ledger?by={by}"))

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        req = urllib.request.Request(
            self.base + "/events", headers={"Authorization": f"Bearer {self.token}"}
        )
        resp = await asyncio.to_thread(urllib.request.urlopen, req)
        while True:
            line = await asyncio.to_thread(resp.readline)
            if not line:
                return
            if line.startswith(b"data: "):
                yield json.loads(line[6:])

    async def close(self) -> None:
        return None


class LocalClient:
    def __init__(self, inst: Instance) -> None:
        self.inst = inst
        self.m = inst.manager
        self._started = False

    async def _ensure(self) -> None:
        if not self._started:
            await start_instance(self.inst)
            self._started = True

    async def create_thread(self, title: str, metadata: dict[str, Any] | None = None) -> str:
        return self.m.create_thread(title, metadata)

    async def submit(self, thread_id: str, text: str | None) -> str:
        await self._ensure()
        return await self.m.submit(thread_id, text)

    async def resume(self, thread_id: str, value: Any) -> str:
        await self._ensure()
        return await self.m.resume(thread_id, value)

    async def wait(self, run_id: str, timeout: float = 3600) -> dict[str, Any]:
        return await self.m.wait(run_id, timeout)

    async def messages(self, thread_id: str) -> list[dict[str, Any]]:
        values = (await self.m.thread_state(thread_id))["values"]
        return [m.to_dict() if isinstance(m, Message) else m for m in values.get("messages") or []]

    async def threads(self) -> list[dict[str, Any]]:
        return self.m.store.threads()

    async def runs(
        self, thread_id: str | None = None, status: str | None = None
    ) -> list[dict[str, Any]]:
        return self.m.store.runs(thread_id=thread_id, status=status)

    async def ledger(self, by: str) -> dict[str, Any]:
        return dict(self.inst.ledger.totals(by))

    async def close(self) -> None:
        if self._started:
            await self.m.stop()


def message_text(m: dict[str, Any]) -> str:
    return "".join(p.get("text", "") for p in m.get("parts", []) if p.get("kind") == "text")
