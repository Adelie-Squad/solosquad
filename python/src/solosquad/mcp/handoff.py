"""Handoff MCP server: one `transfer_to_<agent>` tool per allowed destination (M21 · decision 34).

The server only acknowledges the call; the agent node sees the tool use in the harness
stream and turns it into `Command(goto=<agent>)`. Nothing here holds state.

    python -m solosquad.mcp.handoff --to pm="Product questions" --to engineer="Build it"
"""

from __future__ import annotations

import argparse
import sys

from solosquad import __version__
from solosquad.harness.base import McpServer
from solosquad.mcp.stdio import Tool, serve
from solosquad.swarm import HANDOFF_PREFIX

SERVER_NAME = "solosquad"
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "task": {
            "type": "string",
            "description": "What the next agent should do, with all the context it needs.",
        }
    },
    "required": ["task"],
}


def server_spec(destinations: dict[str, str]) -> McpServer:
    args = ["-m", "solosquad.mcp.handoff"]
    for name, desc in destinations.items():
        args += ["--to", f"{name}={desc}"]
    return McpServer(SERVER_NAME, sys.executable, tuple(args))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="solosquad.mcp.handoff")
    parser.add_argument("--to", action="append", default=[], help="agent=description")
    ns = parser.parse_args(argv)
    tools = []
    for item in ns.to:
        name, _, desc = item.partition("=")

        def handler(args: dict[str, object], name: str = name) -> str:
            return f"Transferred to {name}. Stop here — {name} continues from this point."

        tools.append(
            Tool(
                f"{HANDOFF_PREFIX}{name}", desc or f"Hand the work to {name}", INPUT_SCHEMA, handler
            )
        )
    serve(SERVER_NAME, __version__, tools)


if __name__ == "__main__":
    main()
