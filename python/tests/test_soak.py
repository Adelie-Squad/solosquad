"""Compressed soak (PRD v2.0.0 §7): many threads, recurring crons, two crashes and a rate
limit, all inside a few seconds. Pass = no task lost, no manual step except approvals.

The real 24-hour soak runs the same scenario against `solosquad serve` on a machine for a
day; this keeps its invariants in CI.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from company_fixtures import Company, agent_of, reply

from solosquad.company import build_company
from solosquad.harness.base import SpawnRequest
from solosquad.harness.events import End, Error, RateLimit, Start
from solosquad.messages import Message
from solosquad.runtime import CronSpec, RunManager, RunStatus
from solosquad.runtime.store import RunStore

THREADS = 4
ROUNDS = 6


async def test_compressed_soak(tmp_path: Path) -> None:
    c = Company(tmp_path)
    for conn in c.connections:
        conn.slots = 4
    state = {"limited": False}

    def max_script(req: SpawnRequest) -> list[Any]:
        if state["limited"]:
            state["limited"] = False
            return [
                Start(),
                RateLimit("exceeded", None, "five_hour"),
                Error("limit", True),
                End("error"),
            ]
        return reply(f"{agent_of(req)} answered")

    c.scripts["max"] = max_script
    for conn in c.connections:
        c._factory(conn, c.secrets).delay_s = 0.01  # type: ignore[attr-defined]  # keep runs in flight
    store_path = c.ctx.data_dir / "runs.sqlite"
    cron = CronSpec("pulse", "*/5 * * * *", "Pulse check.", thread="goal-pulse")

    def new_manager() -> RunManager:
        graph = build_company(c.rt)
        return RunManager(graph, RunStore(store_path), max_concurrency=4)

    m = new_manager()
    await m.start()
    threads = [m.create_thread(f"t{i}") for i in range(THREADS)]
    sent: dict[str, list[str]] = {t: [] for t in threads}
    for rnd in range(ROUNDS):
        if rnd == 5:  # after the last crash, so the limited activation is not cancelled
            state["limited"] = True
        for t in threads:
            text = f"round {rnd} on {t}"
            sent[t].append(text)
            await m.submit(t, text)
        await m.fire_cron(cron)
        if rnd in (1, 4):  # crash while runs are in flight, then a fresh process
            await asyncio.sleep(0.005)
            await m.stop()
            m = new_manager()
            await m.start()
        else:
            await asyncio.sleep(0.02)

    for _ in range(200):
        open_runs = m.store.runs(status=RunStatus.PENDING, limit=1000) + m.store.runs(
            status=RunStatus.RUNNING, limit=1000
        )
        if not open_runs:
            break
        await asyncio.sleep(0.05)
    await m.stop()
    assert not open_runs, f"{len(open_runs)} runs never finished"
    assert not m.store.runs(status=RunStatus.ERROR, limit=1000), "no run may fail"
    all_runs = m.store.runs(limit=1000)
    assert any(r["source"] == "crash-resume" for r in all_runs), (
        "the crashes must hit runs in flight"
    )
    assert any(r["error"] == "engine restarted" for r in all_runs)

    for t in threads:
        msgs: list[Message] = (await m.thread_state(t))["values"]["messages"]
        texts = [x.text for x in msgs]
        for text in sent[t]:
            assert texts.count(text) == 1, f"{text!r} lost or duplicated on {t}"
            i = texts.index(text)
            assert any(x.role == "assistant" for x in msgs[i + 1 :]), f"{text!r} never answered"
        positions = [texts.index(text) for text in sent[t]]
        assert positions == sorted(positions), f"runs on {t} ran out of order"
    pulses = [x.text for x in (await m.thread_state("goal-pulse"))["values"]["messages"]]
    assert pulses.count("Pulse check.") == ROUNDS
    assert "rate_limited" in [e.kind for e in c.escalations]
