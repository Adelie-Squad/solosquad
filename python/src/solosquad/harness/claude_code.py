"""Claude Code CLI adapter (`claude --print --output-format stream-json`).

Each activation is a fresh session (M21 — graph state is the only source of truth), so
no `--resume`. MCP servers are passed with `--strict-mcp-config` so a customer's global
Claude settings never leak tools into an agent.
"""

from __future__ import annotations

import json
import shlex
import sys
from collections.abc import AsyncIterator, Iterator
from typing import Any

from solosquad.harness.base import AuthStatus, BaseHarness, Capabilities, SpawnRequest
from solosquad.harness.events import (
    End,
    Error,
    LlmStreamEvent,
    RateLimit,
    Start,
    TextDelta,
    ToolResult,
    ToolUse,
    Usage,
)
from solosquad.harness.process import ProcessOutcome, stream_jsonl


class ClaudeCodeHarness(BaseHarness):
    name = "claude-code"
    capabilities = Capabilities(max_context_tokens=200_000, supports_mcp=True, supports_tools=True)

    def __init__(self, command: str = "claude", permission_mode: str = "bypassPermissions") -> None:
        self.command = command
        self.permission_mode = permission_mode

    def argv(self, req: SpawnRequest) -> list[str]:
        args = [self.command, "--print", "--output-format", "stream-json", "--verbose"]
        if req.model:
            args += ["--model", req.model]
        if req.system_prompt:
            args += ["--append-system-prompt", req.system_prompt]
        if req.mcp_servers:
            config = {
                "mcpServers": {
                    s.name: {"command": s.command, "args": list(s.args), "env": s.env}
                    for s in req.mcp_servers
                }
            }
            args += ["--mcp-config", json.dumps(config), "--strict-mcp-config"]
        if req.allowed_tools is not None:
            args += ["--allowed-tools", ",".join(req.allowed_tools)]
        if req.max_budget_usd is not None:
            args += ["--max-budget-usd", str(req.max_budget_usd)]
        if req.guard_files is not None:
            hook = f"{shlex.quote(sys.executable)} -m solosquad.harness.guard_hook"
            settings = {
                "hooks": {
                    "PreToolUse": [
                        {"matcher": "*", "hooks": [{"type": "command", "command": hook}]}
                    ]
                }
            }
            args += ["--settings", json.dumps(settings)]
        args += ["--permission-mode", self.permission_mode]
        return args

    @staticmethod
    def env(req: SpawnRequest) -> dict[str, str]:
        env = dict(req.env)
        if req.guard_files is not None:
            env["SOLOSQUAD_GUARD_POLICY"] = str(req.guard_files[0])
            env["SOLOSQUAD_GUARD_GRANTS"] = str(req.guard_files[1])
        return env

    async def spawn(self, request: SpawnRequest) -> AsyncIterator[LlmStreamEvent]:
        outcome = ProcessOutcome()
        ended = False
        async for obj in stream_jsonl(
            self.argv(request),
            stdin=request.prompt,
            cwd=request.cwd,
            env=self.env(request),
            timeout_s=request.timeout_s,
            outcome=outcome,
        ):
            for event in translate(obj):
                ended = ended or isinstance(event, End)
                yield event
        if not ended:
            yield Error(
                f"claude exited ({outcome.returncode}) without a result: {outcome.stderr[-500:]}",
                retryable=True,
            )
            yield End(stop_reason="error")

    async def auth_status(self) -> AuthStatus:
        import asyncio

        try:
            proc = await asyncio.create_subprocess_exec(
                self.command,
                "auth",
                "status",
                "--json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except FileNotFoundError:
            return AuthStatus(False, {"error": f"{self.command} not found"})
        out, _ = await proc.communicate()
        try:
            data: dict[str, Any] = json.loads(out or b"{}")
        except json.JSONDecodeError:
            return AuthStatus(False, {})
        return AuthStatus(bool(data.get("loggedIn")), data)


def _usage(raw: object) -> Usage:
    if not isinstance(raw, dict):
        return Usage()
    return Usage(
        input_tokens=int(raw.get("input_tokens") or 0),
        output_tokens=int(raw.get("output_tokens") or 0),
        cache_read_tokens=int(raw.get("cache_read_input_tokens") or 0),
        cache_write_tokens=int(raw.get("cache_creation_input_tokens") or 0),
    )


def translate(obj: dict[str, Any]) -> Iterator[LlmStreamEvent]:
    kind = obj.get("type")
    if kind == "system" and obj.get("subtype") == "init":
        yield Start(session_id=obj.get("session_id"), model=obj.get("model"))
    elif kind == "assistant":
        for block in (obj.get("message") or {}).get("content") or []:
            if block.get("type") == "text" and block.get("text"):
                yield TextDelta(block["text"])
            elif block.get("type") == "tool_use":
                yield ToolUse(
                    str(block.get("id")), str(block.get("name")), block.get("input") or {}
                )
    elif kind == "user":
        for block in (obj.get("message") or {}).get("content") or []:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                content = block.get("content")
                if isinstance(content, list):
                    content = "".join(c.get("text", "") for c in content if isinstance(c, dict))
                yield ToolResult(
                    str(block.get("tool_use_id")), str(content or ""), bool(block.get("is_error"))
                )
    elif kind == "rate_limit_event":
        info = obj.get("rate_limit_info") or {}
        status = info.get("status")
        if status in ("allowed", "warning", "exceeded"):
            yield RateLimit(status, info.get("resetsAt"), info.get("rateLimitType"))
    elif kind == "result":
        if obj.get("is_error"):
            yield Error(str(obj.get("result") or obj.get("subtype")), retryable=False)
        yield End(
            stop_reason=obj.get("stop_reason") or obj.get("subtype"),
            usage=_usage(obj.get("usage")),
            cost_usd=obj.get("total_cost_usd"),
            result_text=obj.get("result"),
        )
