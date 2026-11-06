"""Compressed soak across one engine server (decision 57 · PRD v2.1.0 C31 · K49).

Three workspaces in two orgs share one `serve`: each gets threads and a recurring cron
every round, the whole server crashes once with runs in flight, and one workspace's
calls start failing. Pass = in every workspace no task is lost, duplicated or reordered,
every answer comes from that workspace's own runtime, the crash is resumed, and the
failure stays where it happened.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from engine_fixtures import Customer

from solosquad.engine_server import build_engine, start_engine, stop_engine
from solosquad.messages import Message
from solosquad.runtime import CronSpec, RunStatus

SCOPES = ("spacex/rocket", "tesla/cars", "tesla/charging")
THREADS = 2
ROUNDS = 4
CRASH_AFTER = 1
FAIL_ROUND = 3
FAILING = "spacex/rocket"


async def _settle(c: Customer) -> None:
    for _ in range(200):
        open_runs = [
            r
            for s in SCOPES
            for status in (RunStatus.PENDING, RunStatus.RUNNING)
            for r in c.runtime(s).manager.store.runs(status=status, limit=1000)
        ]
        if not open_runs:
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"{len(open_runs)} runs never finished")


async def _until_running(c: Customer) -> None:
    for _ in range(400):
        busy = [s for s in SCOPES if c.runtime(s).manager.store.runs(status=RunStatus.RUNNING)]
        if len(busy) == len(SCOPES):
            return
        await asyncio.sleep(0.025)
    raise AssertionError(f"slow runs never started everywhere: running in {busy}")


async def test_one_server_soak_keeps_every_workspace_whole(tmp_path: Path) -> None:
    c = Customer(tmp_path, max_concurrency=2)
    await start_engine(c.engine)
    threads = {s: [c.runtime(s).manager.create_thread(f"{s} t{i}") for i in range(THREADS)]
               for s in SCOPES}  # fmt: skip
    sent: dict[str, dict[str, list[str]]] = {s: {t: [] for t in threads[s]} for s in SCOPES}
    crons = {s: CronSpec("pulse", "*/5 * * * *", "Pulse check.", thread="goal-pulse")
             for s in SCOPES}  # fmt: skip
    boom_threads: dict[str, str] = {}
    try:
        for rnd in range(ROUNDS):
            for s in SCOPES:
                m = c.runtime(s).manager
                for t in threads[s]:
                    text = f"round {rnd} on {t}" + (" slow" if rnd == CRASH_AFTER else "")
                    sent[s][t].append(text)
                    await m.submit(t, text)
                if rnd == FAIL_ROUND and s == FAILING:
                    bt = m.create_thread("broken")
                    boom_threads[s] = bt
                    await m.submit(bt, "boom")
                await m.fire_cron(crons[s])
            if rnd == CRASH_AFTER:
                # wait until a slow run is in flight on every workspace (not a fixed sleep —
                # slower machines start them later), then the whole server dies
                await _until_running(c)
                await stop_engine(c.engine)
                c.engine = build_engine(c.solution.root, bundle=c.bundle, build=c._build,
                                        max_concurrency=2)  # fmt: skip
                assert not c.engine.failed
                await start_engine(c.engine)
                for gate in c.gates.values():
                    gate.set()  # the resumed slow runs may now finish
            else:
                await asyncio.sleep(0.02)
        await _settle(c)
    finally:
        await stop_engine(c.engine)

    for s in SCOPES:
        store = c.runtime(s).manager.store
        runs = store.runs(limit=1000)
        errors = [r for r in runs if r["status"] == RunStatus.ERROR]
        if s == FAILING:  # the failure stayed with the failing call
            assert [r["thread_id"] for r in errors] == [boom_threads[s]], errors
        else:
            assert not errors, (s, errors)
        assert any(r["source"].startswith("crash-resume") for r in runs), (
            f"{s}: the crash must hit runs in flight and resume them"
        )
        own = f"answer from {s}"
        mine = (
            set(threads[s]) | {"goal-pulse"} | ({boom_threads[s]} if s in boom_threads else set())
        )
        assert {t["id"] for t in store.threads()} == mine, s  # no thread crossed
        for t in threads[s]:
            msgs: list[Message] = (await c.runtime(s).manager.thread_state(t))["values"]["messages"]
            texts = [x.text for x in msgs]
            for text in sent[s][t]:
                assert texts.count(text) == 1, f"{s}: {text!r} lost or duplicated"
                after = [x for x in msgs[texts.index(text) + 1 :] if x.role == "assistant"]
                assert after and after[0].text == own, f"{s}: {text!r} answered by {after[:1]}"
            positions = [texts.index(text) for text in sent[s][t]]
            assert positions == sorted(positions), f"{s}: runs on {t} ran out of order"
            assert not any(x.text.startswith("answer from ") and x.text != own for x in msgs)
        state = await c.runtime(s).manager.thread_state("goal-pulse")
        pulses = [x.text for x in state["values"]["messages"]]
        assert pulses.count("Pulse check.") == ROUNDS, (s, pulses.count("Pulse check."))
