"""Minimal MCP server over stdio — initialize · tools/list · tools/call.

Newline-delimited JSON-RPC, enough for Claude Code, Codex and OpenCode.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import IO, Any

DEFAULT_PROTOCOL = "2025-06-18"


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], str]


def serve(
    name: str,
    version: str,
    tools: list[Tool],
    stdin: IO[str] | None = None,
    stdout: IO[str] | None = None,
) -> None:
    inp = stdin or sys.stdin
    out = stdout or sys.stdout
    by_name = {t.name: t for t in tools}

    def reply(
        msg_id: Any, result: dict[str, Any] | None = None, error: dict[str, Any] | None = None
    ) -> None:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": msg_id}
        if error is not None:
            payload["error"] = error
        else:
            payload["result"] = result or {}
        out.write(json.dumps(payload) + "\n")
        out.flush()

    for line in inp:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = msg.get("method")
        msg_id = msg.get("id")
        if msg_id is None:
            continue  # notifications (e.g. notifications/initialized)
        if method == "initialize":
            requested = (msg.get("params") or {}).get("protocolVersion") or DEFAULT_PROTOCOL
            reply(
                msg_id,
                {
                    "protocolVersion": requested,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": name, "version": version},
                },
            )
        elif method == "tools/list":
            reply(
                msg_id,
                {
                    "tools": [
                        {
                            "name": t.name,
                            "description": t.description,
                            "inputSchema": t.input_schema,
                        }
                        for t in tools
                    ]
                },
            )
        elif method == "tools/call":
            params = msg.get("params") or {}
            tool = by_name.get(str(params.get("name")))
            if tool is None:
                reply(
                    msg_id, error={"code": -32602, "message": f"unknown tool {params.get('name')}"}
                )
                continue
            text = tool.handler(params.get("arguments") or {})
            reply(msg_id, {"content": [{"type": "text", "text": text}], "isError": False})
        elif method == "ping":
            reply(msg_id, {})
        else:
            reply(msg_id, error={"code": -32601, "message": f"method not found: {method}"})
