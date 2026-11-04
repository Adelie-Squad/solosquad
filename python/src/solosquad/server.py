"""Core ↔ surface JSON boundary (decision 10) — HTTP + server-sent events under `/api`.

Starlette on uvicorn since v2.1.0 (W2 — the stdlib server of v2.0.0 could not carry
cookie sessions, CSRF and security headers safely on the internet). Binds 127.0.0.1;
a reverse proxy on the same VM terminates TLS (W1). The CLI authenticates with the
bearer token in the workspace data folder, which only works from the machine itself;
people use accounts (`web_api/`). Routes: see `web_api/app.py`.
"""

from __future__ import annotations

import asyncio
import contextlib
import secrets as pysecrets
import socket
from collections.abc import Iterator
from pathlib import Path

import uvicorn

from solosquad.context.ledger import Ledger
from solosquad.layout import Workspace
from solosquad.runtime import RunManager
from solosquad.web_api.accounts import AccountStore
from solosquad.web_api.app import WebConfig, create_app, dumps

__all__ = ["ApiServer", "dumps", "load_or_create_token"]


def load_or_create_token(data_dir: Path) -> str:
    path = data_dir / "api-token"
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    data_dir.mkdir(parents=True, exist_ok=True)
    token = pysecrets.token_urlsafe(32)
    path.write_text(token, encoding="utf-8")
    path.chmod(0o600)
    return token


class _Server(uvicorn.Server):
    """The caller owns signals (CLI `serve` · tests); uvicorn must not install its own."""

    @contextlib.contextmanager
    def capture_signals(self) -> Iterator[None]:
        yield


class ApiServer:
    def __init__(
        self,
        manager: RunManager,
        ledger: Ledger,
        token: str,
        *,
        accounts: AccountStore | None = None,
        workspace: Workspace | None = None,
        static_dir: Path | None = None,
        secure_cookies: bool = True,
    ) -> None:
        self._closing = asyncio.Event()
        self.app = create_app(
            WebConfig(
                manager,
                ledger,
                token,
                accounts,
                workspace,
                static_dir,
                secure_cookies,
                self._closing,
            )
        )
        self._server: _Server | None = None
        self._task: asyncio.Task[None] | None = None

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> int:
        sock = socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, port))
        config = uvicorn.Config(
            self.app,
            log_level="warning",
            lifespan="off",
            access_log=False,
            timeout_graceful_shutdown=1,
            proxy_headers=False,  # the app reads X-Forwarded-For itself, from loopback only
        )
        self._server = _Server(config)
        self._task = asyncio.create_task(self._server.serve(sockets=[sock]))
        while not self._server.started:
            if self._task.done():
                self._task.result()  # surface a startup failure
            await asyncio.sleep(0.01)
        return int(sock.getsockname()[1])

    async def stop(self) -> None:
        if self._server is None or self._task is None:
            return
        self._closing.set()
        self._server.should_exit = True
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self._task, 5)
