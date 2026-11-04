"""Run a CLI harness as a child process and stream its JSONL stdout."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class ProcessOutcome:
    returncode: int | None = None
    stderr: str = ""


async def stream_jsonl(
    argv: Sequence[str],
    *,
    stdin: str | None,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout_s: float | None = None,
    outcome: ProcessOutcome | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield each JSON object line; non-JSON lines are ignored.

    The child is killed if the consumer stops early or the timeout passes, so an
    abandoned activation never keeps a backend session running.
    """
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(cwd),
        env={**os.environ, **(env or {})},
        limit=16 * 1024 * 1024,
    )
    assert proc.stdout is not None and proc.stderr is not None
    stderr_task = asyncio.create_task(proc.stderr.read())
    if stdin is not None and proc.stdin is not None:
        proc.stdin.write(stdin.encode())
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            await proc.stdin.drain()
        proc.stdin.close()
    try:
        async with asyncio.timeout(timeout_s):
            while line := await proc.stdout.readline():
                text = line.decode(errors="replace").strip()
                if not text:
                    continue
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict):
                    yield obj
            await proc.wait()
    finally:
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()
        err = await stderr_task
        if outcome is not None:
            outcome.returncode = proc.returncode
            outcome.stderr = err.decode(errors="replace")
