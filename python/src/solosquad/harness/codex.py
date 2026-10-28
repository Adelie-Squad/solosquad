"""OpenAI Codex CLI adapter (`codex exec --json`, JSONL ThreadEvents).

Event shapes follow codex-rs/exec/src/exec_events.rs. Not yet exercised against a live
binary on the development machine — the translation is fixture-tested.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import AsyncIterator, Iterator
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


class CodexHarness(BaseHarness):
    name = "codex"
    capabilities = Capabilities(max_context_tokens=272_000, supports_mcp=True, supports_tools=True)

    def __init__(self, command: str = "codex", sandbox: str = "workspace-write") -> None:
        self.command = command
        self.sandbox = sandbox

    def argv(self, req: SpawnRequest) -> list[str]:
        args = [self.command, "exec", "--json", "--ephemeral", "--skip-git-repo-check"]
        args += ["--sandbox", self.sandbox, "--cd", str(req.cwd)]
        if req.model:
            args += ["--model", req.model]
        if req.system_prompt:
            args += ["-c", f"developer_instructions={json.dumps(req.system_prompt)}"]
        for s in req.mcp_servers:
            args += ["-c", f"mcp_servers.{s.name}.command={json.dumps(s.command)}"]
            args += ["-c", f"mcp_servers.{s.name}.args={json.dumps(list(s.args))}"]
        args.append("-")  # prompt from stdin
        return args

    async def spawn(self, request: SpawnRequest) -> AsyncIterator[LlmStreamEvent]:
        outcome = ProcessOutcome()
        ended = False
        async for obj in stream_jsonl(
            self.argv(request),
            stdin=request.prompt,
            cwd=request.cwd,
            env=request.env,
            timeout_s=request.timeout_s,
            outcome=outcome,
        ):
            for event in translate(obj):
                ended = ended or isinstance(event, End)
                yield event
        if not ended:
            yield Error(f"codex exited ({outcome.returncode}): {outcome.stderr[-500:]}", True)
            yield End(stop_reason="error")

    async def auth_status(self) -> AuthStatus:
        found = shutil.which(self.command) is not None
        return AuthStatus(found, {"binary": found})


def translate(obj: dict[str, Any]) -> Iterator[LlmStreamEvent]:
    kind = obj.get("type")
    if kind == "thread.started":
        yield Start(session_id=obj.get("thread_id"))
    elif kind == "item.completed":
        item = obj.get("item") or {}
        itype = item.get("type")
        if itype == "agent_message" and item.get("text"):
            yield TextDelta(item["text"])
        elif itype == "mcp_tool_call":
            name = f"mcp__{item.get('server')}__{item.get('tool')}"
            args = item.get("arguments")
            yield ToolUse(str(item.get("id")), name, args if isinstance(args, dict) else {})
            result = item.get("result")
            yield ToolResult(
                str(item.get("id")),
                json.dumps(result) if result is not None else "",
                item.get("status") == "failed",
            )
        elif itype == "command_execution":
            yield ToolUse(
                str(item.get("id")), "command_execution", {"command": item.get("command")}
            )
            yield ToolResult(
                str(item.get("id")),
                str(item.get("aggregated_output") or ""),
                item.get("status") == "failed",
            )
    elif kind == "turn.completed":
        u = obj.get("usage") or {}
        yield End(
            stop_reason="end_turn",
            usage=Usage(
                input_tokens=int(u.get("input_tokens") or 0),
                output_tokens=int(u.get("output_tokens") or 0),
                cache_read_tokens=int(u.get("cached_input_tokens") or 0),
            ),
        )
    elif kind == "turn.failed":
        yield Error(str((obj.get("error") or {}).get("message", "turn failed")))
        yield End(stop_reason="error")
    elif kind == "error":
        yield Error(str(obj.get("message", "codex error")), retryable=True)
