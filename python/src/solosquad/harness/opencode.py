"""OpenCode CLI adapter (`opencode run --format json`) — runs API-key connections
(OpenRouter, OpenAI-compatible, local servers) with a full tool loop (decision 24).

Envelope per packages/cli/src/run/noninteractive.ts: `{type, timestamp, sessionID, part}`
with type in text · reasoning · step_start · tool_use · step_finish · error. MCP servers
reach opencode through a generated config file (`OPENCODE_CONFIG`). Fixture-tested;
not yet run against a live binary on the development machine.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

from solosquad.harness.base import AuthStatus, BaseHarness, Capabilities, SpawnRequest
from solosquad.harness.events import (
    End,
    Error,
    LlmStreamEvent,
    Start,
    TextDelta,
    ToolResult,
    ToolUse,
    Usage,
)
from solosquad.harness.process import ProcessOutcome, stream_jsonl


class OpenCodeHarness(BaseHarness):
    name = "opencode"
    capabilities = Capabilities(max_context_tokens=128_000, supports_mcp=True, supports_tools=True)

    def __init__(self, command: str = "opencode") -> None:
        self.command = command

    def argv(self, req: SpawnRequest) -> list[str]:
        args = [self.command, "run", "--format", "json", "--auto", "--dir", str(req.cwd)]
        if req.model:
            args += ["--model", req.model]
        return args

    def config(self, req: SpawnRequest) -> dict[str, Any]:
        cfg: dict[str, Any] = {"$schema": "https://opencode.ai/config.json"}
        if req.system_prompt:
            cfg["instructions"] = []
            cfg["agent"] = {"build": {"prompt": req.system_prompt}}
        if req.mcp_servers:
            cfg["mcp"] = {
                s.name: {"type": "local", "command": [s.command, *s.args], "environment": s.env}
                for s in req.mcp_servers
            }
        return cfg

    async def spawn(self, request: SpawnRequest) -> AsyncIterator[LlmStreamEvent]:
        outcome = ProcessOutcome()
        cost = 0.0
        usage = Usage()
        reason: str | None = None
        with tempfile.TemporaryDirectory(prefix="solosquad-opencode-") as tmp:
            cfg_path = Path(tmp) / "opencode.json"
            cfg_path.write_text(json.dumps(self.config(request)), encoding="utf-8")
            env = {**request.env, "OPENCODE_CONFIG": str(cfg_path)}
            async for obj in stream_jsonl(
                self.argv(request),
                stdin=request.prompt,
                cwd=request.cwd,
                env=env,
                timeout_s=request.timeout_s,
                outcome=outcome,
            ):
                for event in translate(obj):
                    if isinstance(event, End):
                        # one step_finish per model step — sum them into one End
                        cost += event.cost_usd or 0.0
                        usage = usage + event.usage
                        reason = event.stop_reason
                    else:
                        yield event
        if outcome.returncode not in (0, None) and reason is None:
            yield Error(f"opencode exited ({outcome.returncode}): {outcome.stderr[-500:]}", True)
        yield End(stop_reason=reason or "error", usage=usage, cost_usd=cost)

    async def auth_status(self) -> AuthStatus:
        found = shutil.which(self.command) is not None
        return AuthStatus(found, {"binary": found})


def translate(obj: dict[str, Any]) -> Iterator[LlmStreamEvent]:
    kind = obj.get("type")
    part = obj.get("part") or {}
    if kind == "step_start":
        yield Start(session_id=obj.get("sessionID"))
    elif kind == "text" and part.get("text"):
        yield TextDelta(part["text"])
    elif kind == "tool_use":
        state = part.get("state") or {}
        call_id = str(part.get("callID") or part.get("id"))
        tool_input = state.get("input")
        yield ToolUse(
            call_id, str(part.get("tool")), tool_input if isinstance(tool_input, dict) else {}
        )
        if state.get("status") in ("completed", "error"):
            out = state.get("output") if state.get("status") == "completed" else state.get("error")
            yield ToolResult(call_id, str(out or ""), state.get("status") == "error")
    elif kind == "step_finish":
        tokens = part.get("tokens") or {}
        cache = tokens.get("cache") or {}
        yield End(
            stop_reason=part.get("reason"),
            usage=Usage(
                input_tokens=int(tokens.get("input") or 0),
                output_tokens=int(tokens.get("output") or 0) + int(tokens.get("reasoning") or 0),
                cache_read_tokens=int(cache.get("read") or 0),
                cache_write_tokens=int(cache.get("write") or 0),
            ),
            cost_usd=float(part.get("cost") or 0.0),
        )
    elif kind == "error":
        err = obj.get("error") or {}
        message = (err.get("data") or {}).get("message") or err.get("name") or "opencode error"
        yield Error(str(message), retryable=True)
