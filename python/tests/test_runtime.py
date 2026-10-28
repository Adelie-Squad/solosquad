from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from company_fixtures import Company, agent_of, reply

from solosquad.company import build_company
from solosquad.harness.base import SpawnRequest
from solosquad.harness.events import ToolResult
from solosquad.harness.guard import GuardPolicy
from solosquad.harness.guard_hook import MARKER, decide, signature
from solosquad.routing.router import Escalation
from solosquad.runtime import CronSpec, RunManager, RunStatus
from solosquad.runtime.manager import OPS_THREAD, load_crons
from solosquad.runtime.store import RunStore
from solosquad.runtime.worktree import ensure_worktree


def manager(c: Company, **kw: Any) -> RunManager:
    return RunManager(build_company(c.rt), RunStore(c.ctx.data_dir / "runs.sqlite"), **kw)


async def test_runs_execute_concurrently(tmp_path: Path) -> None:
    c = Company(tmp_path)
    c.connections[0].slots = 10
    active = {"now": 0, "peak": 0}

    async def slow(req: SpawnRequest) -> None:
        active["now"] += 1
        active["peak"] = max(active["peak"], active["now"])
        await asyncio.sleep(0.05)
        active["now"] -= 1

    m = manager(c, max_concurrency=5)
    await m.start()
    harness = c._factory(c.connections[0], c.secrets)
    original = harness.spawn  # type: ignore[attr-defined]

    async def spawn(req: SpawnRequest) -> Any:
        await slow(req)
        async for e in original(req):
            yield e

    harness.spawn = spawn  # type: ignore[method-assign]
    runs = [await m.submit(m.create_thread(f"task {i}"), f"job {i}") for i in range(5)]
    results = await asyncio.gather(*(m.wait(r, timeout=5) for r in runs))
    await m.stop()
    assert {r["status"] for r in results} == {RunStatus.SUCCESS}
    assert active["peak"] >= 3, "independent tasks should overlap"


async def test_crashed_run_is_resumed_on_restart(tmp_path: Path) -> None:
    c = Company(tmp_path)
    calls = {"n": 0}

    def flaky(req: SpawnRequest) -> list[Any]:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("process killed")
        return reply("recovered")

    c.scripts["max"] = flaky
    m = manager(c)
    await m.start()
    tid = m.create_thread("long task")
    rid = await m.submit(tid, "do the long thing")
    assert (await m.wait(rid, timeout=5))["status"] == RunStatus.ERROR
    await m.stop()
    m.store.set_status(rid, RunStatus.RUNNING)  # what a crash leaves behind

    restarted = manager(c)
    resumed = await restarted.start()
    assert len(resumed) == 1
    run = await restarted.wait(resumed[0], timeout=5)
    await restarted.stop()
    assert run["status"] == RunStatus.SUCCESS and run["source"] == "crash-resume"
    state = await restarted.thread_state(tid)
    assert state["values"]["messages"][-1].text == "recovered"
    assert [m.text for m in state["values"]["messages"]].count("do the long thing") == 1


async def test_interrupt_then_resume_through_the_manager(tmp_path: Path) -> None:
    c = Company(tmp_path)
    c.scripts["max"] = lambda req: (
        reply("deleted")
        if "(approved by owner" in req.prompt
        else [
            *reply("asking")[:-1],
            ToolResult("x", f"{MARKER}:5e1:rm"),
            reply("")[-1],
        ]
    )
    m = manager(c)
    events: list[dict[str, Any]] = []

    async def collect() -> None:
        async for e in m.subscribe():
            events.append(e)

    watcher = asyncio.create_task(collect())
    await m.start()
    tid = m.create_thread("cleanup")
    run = await m.wait(await m.submit(tid, "clean the disk"), timeout=5)
    assert run["status"] == RunStatus.INTERRUPTED
    assert run["interrupts"][0]["value"]["signature"] == "5e1"
    done = await m.wait(await m.resume(tid, "yes"), timeout=5)
    await m.stop()
    watcher.cancel()
    assert done["status"] == RunStatus.SUCCESS
    kinds = [e["event"] for e in events]
    assert "run.interrupted" in kinds and "run.completed" in kinds and "run.message" in kinds


async def test_escalation_goes_to_chief_ops_thread(tmp_path: Path) -> None:
    c = Company(tmp_path)
    m = manager(c)
    await m.start()
    m.escalate(Escalation("budget_warning", "max", "max at 85%", 0.0))
    m.escalate(Escalation("budget_warning", "max", "max at 86%", 0.0))  # throttled
    await asyncio.sleep(0.05)
    runs = m.store.runs(thread_id=OPS_THREAD)
    assert len(runs) == 1
    await m.wait(runs[0]["id"], timeout=5)
    await m.stop()
    seen = [r for r in c.harnesses["max"].requests if agent_of(r) == "chief"]
    assert "budget_warning" in seen[-1].prompt


async def test_cron_fires_a_run_on_a_standing_goal_thread(tmp_path: Path) -> None:
    c = Company(tmp_path)
    crons_dir = c.ctx.org_root / "crons"
    (crons_dir / "brief.md").write_text(
        "---\nschedule: '0 8 * * *'\nthread: goal-brief\n---\nWrite the morning brief.\n",
        encoding="utf-8",
    )
    (crons_dir / "notes.md").write_text("no frontmatter", encoding="utf-8")
    specs = load_crons(crons_dir)
    assert specs == [CronSpec("brief", "0 8 * * *", "Write the morning brief.", "goal-brief")]
    m = manager(c)
    await m.start(specs)
    run = await m.wait(await m.fire_cron(specs[0]), timeout=5)
    await m.wait(await m.fire_cron(specs[0]), timeout=5)
    await m.stop()
    assert run["thread_id"] == "goal-brief" and run["source"] == "cron:brief"
    msgs = (await m.thread_state("goal-brief"))["values"]["messages"]
    assert [x.text for x in msgs].count("Write the morning brief.") == 2


def test_worktree_per_thread(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    git = ["git", "-C", str(repo)]
    subprocess.run([*git, "init", "-q", "-b", "main"], check=True)
    subprocess.run(
        [
            *git,
            "-c",
            "user.email=a@b",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "init",
        ],
        check=True,
    )
    a = ensure_worktree(repo, tmp_path / "data", "th-1")
    b = ensure_worktree(repo, tmp_path / "data", "th-2")
    assert a != b and (a / ".git").exists() and (b / ".git").exists()
    assert ensure_worktree(repo, tmp_path / "data", "th-1") == a


def test_handoff_mcp_server_speaks_jsonrpc() -> None:
    lines = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2025-06-18"},
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "transfer_to_pm", "arguments": {"task": "plan"}},
        },
    ]
    proc = subprocess.run(
        [sys.executable, "-m", "solosquad.mcp.handoff", "--to", "pm=Plans the work"],
        input="\n".join(json.dumps(x) for x in lines) + "\n",
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    replies = [json.loads(x) for x in proc.stdout.splitlines()]
    assert [r["id"] for r in replies] == [1, 2, 3]
    assert replies[0]["result"]["protocolVersion"] == "2025-06-18"
    tool = replies[1]["result"]["tools"][0]
    assert tool["name"] == "transfer_to_pm" and tool["inputSchema"]["required"] == ["task"]
    assert "Transferred to pm" in replies[2]["result"]["content"][0]["text"]


def test_guard_hook_decisions_and_process(tmp_path: Path) -> None:
    policy = GuardPolicy()
    rm = {"command": "rm -rf build"}
    out = decide(policy, set(), "Bash", rm)
    assert out is not None
    reason = out["hookSpecificOutput"]["permissionDecisionReason"]
    assert reason.startswith(f"{MARKER}:{signature('Bash', rm)}:")
    assert decide(policy, {signature("Bash", rm)}, "Bash", rm) is None
    assert decide(policy, set(), "Bash", {"command": "ls"}) is None

    grants = tmp_path / "grants.json"
    grants.write_text("[]", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "solosquad.harness.guard_hook"],
        input=json.dumps({"tool_name": "Bash", "tool_input": rm}),
        capture_output=True,
        text=True,
        env={"SOLOSQUAD_GUARD_GRANTS": str(grants), "PATH": ""},
        timeout=30,
        check=True,
    )
    assert json.loads(proc.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"
