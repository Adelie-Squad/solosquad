from __future__ import annotations

import asyncio
import json
import plistlib
import threading
import urllib.error
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest
from company_fixtures import Company
from typer.testing import CliRunner

from solosquad.cli import app
from solosquad.client import HttpClient, message_text
from solosquad.company import build_company
from solosquad.runtime import RunManager
from solosquad.runtime.store import RunStore
from solosquad.server import ApiServer, load_or_create_token
from solosquad.service import ServiceSpec, plan


async def test_http_boundary(tmp_path: Path) -> None:
    c = Company(tmp_path)
    m = RunManager(build_company(c.rt), RunStore(c.ctx.data_dir / "runs.sqlite"))
    await m.start()
    token = load_or_create_token(c.ctx.data_dir)
    assert load_or_create_token(c.ctx.data_dir) == token
    api = ApiServer(m, c.ledger, token)
    port = await api.start()
    client = HttpClient(f"http://127.0.0.1:{port}", token)
    events: list[dict[str, Any]] = []

    async def watch() -> None:
        async for e in client.events():
            events.append(e)

    watcher = asyncio.create_task(watch())
    try:
        assert (await client._a("GET", "/health"))["ok"] is True
        with pytest.raises(urllib.error.HTTPError) as e:
            await HttpClient(f"http://127.0.0.1:{port}", "wrong")._a("GET", "/health")
        assert e.value.code == 401
        tid = await client.create_thread("hello")
        run = await client.wait(await client.submit(tid, "hi there"), timeout=5)
        assert run["status"] == "success"
        msgs = await client.messages(tid)
        assert [message_text(x) for x in msgs] == ["hi there", "chief done"]
        assert (await client.ledger("agent"))["chief"]["calls"] == 1
        assert [r["id"] for r in await client.runs(thread_id=tid)] == [run["id"]]
        with pytest.raises(urllib.error.HTTPError) as e:
            await client._a("GET", "/nope")
        assert e.value.code == 404
        await asyncio.sleep(0.2)
        assert "run.completed" in [x["event"] for x in events]
    finally:
        watcher.cancel()
        await api.stop()
        await m.stop()


def test_service_plans(tmp_path: Path) -> None:
    spec = ServiceSpec(Path("/srv/elon solution"), "tesla", "hq", 7421, python="/opt/py")
    mac = plan(spec, tmp_path, "Darwin")
    assert mac.path == tmp_path / "Library/LaunchAgents/ai.solosquad.elon-solution.tesla.hq.plist"
    assert mac.content is not None
    parsed = plistlib.loads(mac.content.encode())
    assert parsed["ProgramArguments"][:4] == ["/opt/py", "-m", "solosquad", "serve"]
    assert parsed["KeepAlive"] is True and "/srv/elon solution" in parsed["ProgramArguments"]
    linux = plan(spec, tmp_path, "Linux")
    assert linux.content is not None and "Restart=always" in linux.content
    assert "'/srv/elon solution'" in linux.content
    win = plan(spec, tmp_path, "Windows")
    assert win.path is None and win.enable[0][:2] == ["schtasks", "/Create"]


@pytest.fixture
def openai_server() -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            last = body["messages"][-1]["content"].split("---")[0].strip().splitlines()[-1]
            data = json.dumps(
                {
                    "choices": [
                        {"message": {"content": f"chief heard: {last}"}, "finish_reason": "stop"}
                    ],
                    "usage": {"prompt_tokens": 9, "completion_tokens": 3, "cost": 0.0002},
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a: object) -> None:
            pass

    s = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{s.server_port}/v1"
    s.shutdown()


def test_cli_end_to_end_with_a_real_api_connection(tmp_path: Path, openai_server: str) -> None:
    run = CliRunner().invoke
    sol = tmp_path / "moa"
    assert run(app, ["init", str(sol), "--org", "moa-living"]).exit_code == 0
    res = run(
        app,
        [
            "connections",
            "add",
            "router",
            "--kind",
            "api_key",
            "--harness",
            "lite",
            "--provider",
            "openrouter",
            "--models",
            "gpt-5",
            "--base-url",
            openai_server,
            "--secret-env",
            "OPENROUTER_API_KEY",
            "-s",
            str(sol),
        ],
    )
    assert res.exit_code == 0, res.output
    assert (
        run(
            app, ["connections", "set-secret", "router", "-s", str(sol)], input="sk-test\n"
        ).exit_code
        == 0
    )
    listed = run(app, ["connections", "list", "-s", str(sol)])
    assert (
        "router" in listed.output
        and "sk-test" not in (sol / "core" / "connections.yaml").read_text()
    )
    res = run(app, ["chat", "-s", str(sol), "-m", "hello company"])
    assert res.exit_code == 0, res.output
    assert "chief heard: [user] hello company" in res.output
    res = run(app, ["status", "-s", str(sol)])
    assert res.exit_code == 0 and "router" in res.output, res.output
    assert "success" in run(app, ["runs", "-s", str(sol)]).output
    assert run(app, ["connections", "disable", "router", "-s", str(sol)]).exit_code == 0
    res = run(app, ["chat", "-s", str(sol), "-m", "anyone?"])
    assert "run failed" in res.output and "no usable connection" in res.output
    res = run(app, ["add", "org", "moa-wholesale", "-s", str(sol)])
    assert res.exit_code == 0 and (sol / "orgs" / "moa-wholesale" / "workspaces" / "hq").is_dir()
    assert (
        run(
            app,
            [
                "add",
                "workspace",
                "busan",
                "--org",
                "moa-living",
                "--type",
                "intranet",
                "-s",
                str(sol),
            ],
        ).exit_code
        == 0
    )
    res = run(
        app, ["service", "print", "-s", str(sol), "--org", "moa-living", "--workspace", "busan"]
    )
    assert res.exit_code == 0 and "serve" in res.output
