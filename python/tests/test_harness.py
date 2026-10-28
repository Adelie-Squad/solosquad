from __future__ import annotations

import json
import os
import stat
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest

from solosquad.harness import (
    End,
    Error,
    GuardPolicy,
    Harness,
    McpServer,
    RateLimit,
    SpawnRequest,
    Start,
    TextDelta,
    ToolResult,
    ToolUse,
    Verdict,
    claude_code,
    codex,
    collect,
    opencode,
)
from solosquad.harness.claude_code import ClaudeCodeHarness
from solosquad.harness.codex import CodexHarness
from solosquad.harness.fake import FakeHarness
from solosquad.harness.lite import LiteHarness
from solosquad.harness.opencode import OpenCodeHarness

CLAUDE_LINES = [
    {"type": "system", "subtype": "init", "session_id": "s1", "model": "claude-x"},
    {"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}},
    {
        "type": "assistant",
        "message": {
            "content": [
                {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}}
            ]
        },
    },
    {
        "type": "user",
        "message": {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "t1",
                    "content": [{"type": "text", "text": "a.txt"}],
                }
            ]
        },
    },
    {
        "type": "rate_limit_event",
        "rate_limit_info": {"status": "warning", "resetsAt": 123, "rateLimitType": "five_hour"},
    },
    {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "result": "hi",
        "total_cost_usd": 0.01,
        "usage": {"input_tokens": 3, "output_tokens": 2, "cache_read_input_tokens": 7},
        "stop_reason": "end_turn",
    },
]


def test_claude_translation() -> None:
    events = [e for line in CLAUDE_LINES for e in claude_code.translate(line)]
    assert events[0] == Start("s1", "claude-x")
    assert events[1] == TextDelta("hi")
    assert events[2] == ToolUse("t1", "Bash", {"command": "ls"})
    assert events[3] == ToolResult("t1", "a.txt", False)
    assert events[4] == RateLimit("warning", 123, "five_hour")
    end = events[5]
    assert isinstance(end, End)
    assert end.cost_usd == 0.01
    assert end.usage.cache_read_tokens == 7


def test_claude_argv_isolates_mcp() -> None:
    req = SpawnRequest(
        prompt="p",
        system_prompt="sys",
        model="m",
        mcp_servers=(McpServer("solosquad", "python", ("-m", "x")),),
    )
    argv = ClaudeCodeHarness().argv(req)
    assert "--strict-mcp-config" in argv
    cfg = json.loads(argv[argv.index("--mcp-config") + 1])
    assert cfg["mcpServers"]["solosquad"]["args"] == ["-m", "x"]
    assert argv[argv.index("--append-system-prompt") + 1] == "sys"


def test_codex_translation() -> None:
    lines: list[dict[str, Any]] = [
        {"type": "thread.started", "thread_id": "th"},
        {"type": "item.completed", "item": {"id": "i1", "type": "agent_message", "text": "done"}},
        {
            "type": "item.completed",
            "item": {
                "id": "i2",
                "type": "mcp_tool_call",
                "server": "solosquad",
                "tool": "transfer_to_pm",
                "arguments": {"why": "x"},
                "status": "completed",
            },
        },
        {
            "type": "turn.completed",
            "usage": {"input_tokens": 5, "cached_input_tokens": 1, "output_tokens": 2},
        },
    ]
    events = [e for line in lines for e in codex.translate(line)]
    assert events[0] == Start("th")
    assert events[1] == TextDelta("done")
    assert events[2] == ToolUse("i2", "mcp__solosquad__transfer_to_pm", {"why": "x"})
    end = events[-1]
    assert isinstance(end, End) and end.usage.input_tokens == 5


def test_opencode_translation() -> None:
    lines: list[dict[str, Any]] = [
        {"type": "step_start", "sessionID": "ses"},
        {"type": "text", "part": {"type": "text", "text": "hello"}},
        {
            "type": "tool_use",
            "part": {
                "callID": "c1",
                "tool": "bash",
                "state": {"status": "completed", "input": {"command": "pwd"}, "output": "/x"},
            },
        },
        {
            "type": "step_finish",
            "part": {
                "reason": "stop",
                "cost": 0.002,
                "tokens": {
                    "input": 10,
                    "output": 4,
                    "reasoning": 1,
                    "cache": {"read": 2, "write": 0},
                },
            },
        },
    ]
    events = [e for line in lines for e in opencode.translate(line)]
    assert events[:4] == [
        Start("ses"),
        TextDelta("hello"),
        ToolUse("c1", "bash", {"command": "pwd"}),
        ToolResult("c1", "/x", False),
    ]
    end = events[4]
    assert isinstance(end, End) and end.usage.output_tokens == 5 and end.cost_usd == 0.002


def _fake_cli(tmp_path: Path, lines: list[dict[str, Any]], extra: str = "") -> Path:
    script = tmp_path / "fake-cli"
    payload = json.dumps([json.dumps(x) for x in lines])
    script.write_text(
        f"#!{sys.executable}\nimport sys, json, time\nprompt = sys.stdin.read()\n{extra}\n"
        f"for line in json.loads({payload!r}):\n    print(line, flush=True)\n",
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return script


async def test_claude_spawn_through_a_real_child_process(tmp_path: Path) -> None:
    cli = _fake_cli(tmp_path, CLAUDE_LINES)
    events = await collect(ClaudeCodeHarness(command=str(cli)), SpawnRequest("hello", cwd=tmp_path))
    assert isinstance(events[-1], End)
    assert TextDelta("hi") in events


async def test_missing_result_becomes_retryable_error(tmp_path: Path) -> None:
    cli = _fake_cli(tmp_path, CLAUDE_LINES[:2], extra="sys.exit(3)")
    events = await collect(ClaudeCodeHarness(command=str(cli)), SpawnRequest("x", cwd=tmp_path))
    errors = [e for e in events if isinstance(e, Error)]
    assert errors and errors[0].retryable
    assert isinstance(events[-1], End) and events[-1].stop_reason == "error"


async def test_timeout_kills_the_child(tmp_path: Path) -> None:
    cli = _fake_cli(tmp_path, CLAUDE_LINES, extra="time.sleep(30)")
    with pytest.raises(TimeoutError):
        await collect(
            ClaudeCodeHarness(command=str(cli)), SpawnRequest("x", cwd=tmp_path, timeout_s=0.5)
        )


@pytest.fixture
def openai_server() -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            reply = {
                "choices": [
                    {
                        "message": {"content": f"echo {body['messages'][-1]['content']}"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 4, "completion_tokens": 2, "cost": 0.0001},
            }
            data = json.dumps(reply).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/v1"
    server.shutdown()


async def test_lite_against_openai_compatible_endpoint(openai_server: str) -> None:
    h = LiteHarness(openai_server, "key", "m")
    events = await collect(h, SpawnRequest("classify this"))
    assert TextDelta("echo classify this") in events
    end = events[-1]
    assert isinstance(end, End) and end.cost_usd == 0.0001
    assert h.parse_cost(end).usd == 0.0001


async def test_lite_network_failure_is_retryable() -> None:
    events = await collect(
        LiteHarness("http://127.0.0.1:9/v1", None), SpawnRequest("x", timeout_s=1)
    )
    assert isinstance(events[-2], Error) and events[-2].retryable


@pytest.mark.parametrize(
    "harness",
    [
        ClaudeCodeHarness(),
        CodexHarness(),
        OpenCodeHarness(),
        LiteHarness("http://x", None),
        FakeHarness(),
    ],
)
def test_every_adapter_meets_the_contract(harness: Harness) -> None:
    assert isinstance(harness, Harness)
    assert harness.capabilities.max_context_tokens > 0


def test_guard_defaults_and_custom_rules() -> None:
    policy = GuardPolicy()
    assert policy.verdict("Bash", {"command": "rm -rf /tmp/x"}) is Verdict.INTERRUPT
    assert policy.verdict("Bash", {"command": "git push --force origin main"}) is Verdict.INTERRUPT
    assert policy.verdict("Bash", {"command": "ls"}) is Verdict.ALLOW
    custom = GuardPolicy.from_dicts(
        [{"tool": "mcp__browser__*", "command": "checkout|pay", "action": "interrupt"}]
    )
    assert (
        custom.verdict("mcp__browser__click", {"url": "https://shop/checkout"}) is Verdict.INTERRUPT
    )
    assert custom.verdict("mcp__browser__click", {"url": "https://shop/item"}) is Verdict.ALLOW
    deny = GuardPolicy.from_dicts([{"tool": "WebFetch", "action": "deny"}], include_defaults=False)
    assert ClaudeCodeHarness().match_tool_use(ToolUse("1", "WebFetch", {}), deny) is Verdict.DENY


@pytest.mark.skipif(os.environ.get("SOLOSQUAD_LIVE") != "1", reason="live: set SOLOSQUAD_LIVE=1")
async def test_live_claude_code(tmp_path: Path) -> None:
    events = await collect(
        ClaudeCodeHarness(),
        SpawnRequest("Reply with exactly: pong", model="haiku", cwd=tmp_path, timeout_s=120),
    )
    end = events[-1]
    assert isinstance(end, End) and end.stop_reason not in (None, "error"), events
    assert "pong" in "".join(e.text for e in events if isinstance(e, TextDelta)).lower()
