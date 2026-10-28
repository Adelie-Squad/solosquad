"""Core ↔ surface JSON boundary (decision 10) — local HTTP + server-sent events.

Stdlib asyncio only. Binds 127.0.0.1 by default; every request needs the bearer token
stored in the workspace data folder. The CLI is the first client; the v2.1.0 web uses the
same routes.

    GET  /health
    GET  /threads                       POST /threads            {title, metadata?}
    GET  /threads/{id}/state            POST /threads/{id}/runs  {input: text | null}
    POST /threads/{id}/resume {value}   GET  /runs?thread_id=&status=
    GET  /runs/{id}                     GET  /ledger?by=agent|connection_id|model
    GET  /events                        (text/event-stream of run events)
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import secrets as pysecrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from solosquad import __version__
from solosquad.context.ledger import Ledger
from solosquad.messages import Message
from solosquad.runtime import RunManager

Handler = Callable[["Request"], Awaitable["Response"]]


@dataclass
class Request:
    method: str
    path: str
    query: dict[str, str]
    headers: dict[str, str]
    body: Any


@dataclass
class Response:
    status: int
    payload: Any = None


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Message):
        return obj.to_dict()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)


def dumps(obj: Any) -> bytes:
    return json.dumps(obj, default=_json_default, ensure_ascii=False).encode()


def load_or_create_token(data_dir: Path) -> str:
    path = data_dir / "api-token"
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    data_dir.mkdir(parents=True, exist_ok=True)
    token = pysecrets.token_urlsafe(32)
    path.write_text(token, encoding="utf-8")
    path.chmod(0o600)
    return token


REASONS = {
    200: "OK",
    201: "Created",
    400: "Bad Request",
    401: "Unauthorized",
    404: "Not Found",
    500: "Internal Server Error",
}


class ApiServer:
    def __init__(self, manager: RunManager, ledger: Ledger, token: str) -> None:
        self.manager = manager
        self.ledger = ledger
        self.token = token
        self._server: asyncio.base_events.Server | None = None

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> int:
        self._server = await asyncio.start_server(self._handle, host, port)
        sock = self._server.sockets[0]
        return int(sock.getsockname()[1])

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._server.wait_closed(), 2)

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            req = await self._read(reader)
            if req is None:
                return
            if req.headers.get("authorization") != f"Bearer {self.token}":
                await self._write(writer, Response(401, {"error": "unauthorized"}))
                return
            if req.method == "GET" and req.path == "/events":
                await self._events(writer)
                return
            try:
                resp = await self._route(req)
            except KeyError as e:
                resp = Response(404, {"error": str(e)})
            except (ValueError, TypeError) as e:
                resp = Response(400, {"error": str(e)})
            await self._write(writer, resp)
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            with contextlib.suppress(Exception):
                writer.close()

    async def _read(self, reader: asyncio.StreamReader) -> Request | None:
        line = await reader.readline()
        if not line:
            return None
        method, target, _ = line.decode().split(" ", 2)
        headers: dict[str, str] = {}
        while (h := await reader.readline()) not in (b"\r\n", b"\n", b""):
            k, _, v = h.decode().partition(":")
            headers[k.strip().lower()] = v.strip()
        body: Any = None
        if n := int(headers.get("content-length", "0")):
            raw = await reader.readexactly(n)
            body = json.loads(raw) if raw else None
        parts = urlsplit(target)
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
        return Request(method.upper(), parts.path.rstrip("/") or "/", query, headers, body)

    async def _write(self, writer: asyncio.StreamWriter, resp: Response) -> None:
        data = dumps(resp.payload)
        writer.write(
            f"HTTP/1.1 {resp.status} {REASONS.get(resp.status, '')}\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(data)}\r\nConnection: close\r\n\r\n".encode()
            + data
        )
        await writer.drain()

    async def _events(self, writer: asyncio.StreamWriter) -> None:
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n\r\n"
        )
        await writer.drain()
        async for event in self.manager.subscribe():
            writer.write(b"data: " + dumps(event) + b"\n\n")
            await writer.drain()

    async def _route(self, req: Request) -> Response:
        seg = [s for s in req.path.split("/") if s]
        m = self.manager
        body = req.body or {}
        if seg == ["health"]:
            return Response(200, {"ok": True, "version": __version__})
        if seg == ["threads"]:
            if req.method == "POST":
                tid = m.create_thread(str(body.get("title") or "task"), body.get("metadata"))
                return Response(201, {"thread_id": tid})
            return Response(200, m.store.threads(int(req.query.get("limit", 50))))
        if len(seg) == 3 and seg[0] == "threads":
            tid = seg[1]
            if m.store.thread(tid) is None and seg[2] != "runs":
                raise KeyError(f"no thread {tid}")
            if seg[2] == "state" and req.method == "GET":
                return Response(200, await m.thread_state(tid))
            if seg[2] == "runs" and req.method == "POST":
                text = body.get("input")
                return Response(
                    201, {"run_id": await m.submit(tid, text if isinstance(text, str) else None)}
                )
            if seg[2] == "resume" and req.method == "POST":
                return Response(201, {"run_id": await m.resume(tid, body.get("value"))})
        if seg == ["runs"]:
            return Response(
                200,
                m.store.runs(thread_id=req.query.get("thread_id"), status=req.query.get("status")),
            )
        if len(seg) == 2 and seg[0] == "runs":
            run = m.store.run(seg[1])
            if run is None:
                raise KeyError(f"no run {seg[1]}")
            return Response(200, run)
        if seg == ["ledger"]:
            return Response(200, self.ledger.totals(req.query.get("by", "agent")))
        raise KeyError(f"no route {req.method} {req.path}")
