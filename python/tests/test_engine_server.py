"""One engine server, many workspace runtimes (decision 57 ⑶ · PRD v2.1.0 I38 · K49).

C31 (runtime side): one `serve` runs every placed workspace; runs, ledgers and artifacts
stay in each workspace's own `office.db`; one runtime's broken settings, failed start,
failing calls or full concurrency limit never hold the others up.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
import yaml
from engine_fixtures import Customer, make_customer
from rev6_fixtures import write_rev6_org_db

from solosquad.engine_server import build_engine, start_engine, stop_engine
from solosquad.layout import Placement, ServerConfigConflict
from solosquad.runtime import RunStatus
from solosquad.storage import MigrationFailed
from solosquad.web_api.org_store import org_path

SCOPES = ("spacex/rocket", "tesla/cars", "tesla/charging")


async def test_one_server_runs_every_workspace_apart(tmp_path: Path) -> None:
    c = Customer(tmp_path, max_concurrency=1)
    assert sorted(f"{o}/{w}" for o, w in c.engine.runtimes) == list(SCOPES)
    assert not c.engine.failed
    data = {s: c.runtime(s).ctx.data_dir for s in SCOPES}
    assert len(set(data.values())) == 3 and all((d / "office.db").is_file() for d in data.values())
    assert set(c.engine.orgs) == {"spacex", "tesla"}
    await start_engine(c.engine)
    try:
        # cars fills its one slot and waits; the other two keep working (K49)
        cars = c.runtime("tesla/cars").manager
        blocked = [await cars.submit(cars.create_thread(f"slow {i}"), "slow work") for i in (1, 2)]
        rocket = c.runtime("spacex/rocket").manager
        failing = await rocket.submit(rocket.create_thread("bad"), "boom")
        charging = c.runtime("tesla/charging").manager
        ok = await charging.submit(charging.create_thread("fine"), "hello")
        assert (await charging.wait(ok, 5))["status"] == RunStatus.SUCCESS
        assert (await rocket.wait(failing, 5))["status"] == RunStatus.ERROR
        after = await rocket.submit(rocket.create_thread("again"), "hello")  # it goes on
        assert (await rocket.wait(after, 5))["status"] == RunStatus.SUCCESS
        assert [cars.store.run(r)["status"] for r in blocked] in (  # type: ignore[index]
            [RunStatus.RUNNING, RunStatus.PENDING],
            [RunStatus.RUNNING, RunStatus.RUNNING],
        )
        c.gates["tesla/cars"].set()
        for rid in blocked:
            assert (await cars.wait(rid, 5))["status"] == RunStatus.SUCCESS
        # nothing crossed: each office holds only its own threads, ledger and answers
        titles = {
            s: sorted(t["title"] for t in c.runtime(s).manager.store.threads()) for s in SCOPES
        }
        assert titles == {
            "spacex/rocket": ["again", "bad"],
            "tesla/cars": ["slow 1", "slow 2"],
            "tesla/charging": ["fine"],
        }
        for s in SCOPES:
            rows = c.runtime(s).ledger.totals("workspace")
            assert set(rows) == {s.split("/")[1]}, (s, rows)  # each ledger: its own spend
    finally:
        await stop_engine(c.engine)


async def test_a_broken_workspace_or_a_failed_start_leaves_the_rest_running(
    tmp_path: Path,
) -> None:
    sol = make_customer(tmp_path)
    bad = sol.org("tesla").workspace("charging").root / "workspace.yaml"
    bad.write_text("schema_version: 1\nname: charging\ntimezone: [not, a, zone]\n", "utf-8")
    c = Customer(tmp_path, sol)
    assert set(c.engine.failed) == {("tesla", "charging")}
    assert "timezone" in c.engine.failed[("tesla", "charging")]
    assert set(c.engine.runtimes) == {("tesla", "cars"), ("spacex", "rocket")}

    async def refuse(_crons: object = None) -> list[str]:
        raise RuntimeError("crontab is broken")

    c.runtime("spacex/rocket").manager.start = refuse  # type: ignore[method-assign,assignment]
    await start_engine(c.engine)
    try:
        assert ("spacex", "rocket") in c.engine.failed
        assert set(c.engine.runtimes) == {("tesla", "cars")}
        cars = c.runtime("tesla/cars").manager
        rid = await cars.submit(cars.create_thread("t"), "hello")
        assert (await cars.wait(rid, 5))["status"] == RunStatus.SUCCESS
    finally:
        await stop_engine(c.engine)


def test_placement_says_what_this_server_runs(tmp_path: Path) -> None:
    sol = make_customer(tmp_path)
    sol.update_server_config(placement=Placement(include=["tesla"]))
    engine = build_engine(sol.root)
    assert set(engine.runtimes) == {("tesla", "cars"), ("tesla", "charging")}
    assert set(engine.orgs) == {"tesla"}
    narrowed = build_engine(sol.root, include=["tesla/charging"])  # serve --org/--workspace
    assert set(narrowed.runtimes) == {("tesla", "charging")}
    doc = yaml.safe_load(sol.server_config_path.read_text(encoding="utf-8"))
    assert doc["placement"] == {"include": ["tesla"]}


def test_what_concerns_the_whole_customer_refuses_the_start(tmp_path: Path) -> None:
    sol = make_customer(tmp_path)
    ws = sol.org("spacex").workspace("rocket").root / "workspace.yaml"
    ws.write_text(ws.read_text(encoding="utf-8") + "server_country: US\n", encoding="utf-8")
    other = sol.org("tesla").workspace("cars").root / "workspace.yaml"
    other.write_text(other.read_text(encoding="utf-8") + "server_country: KR\n", "utf-8")
    with pytest.raises(ServerConfigConflict):  # C33
        build_engine(sol.root)
    sol.update_server_country("KR")
    write_rev6_org_db(org_path(sol, "spacex"), staff="kim")
    write_rev6_org_db(org_path(sol, "tesla"), owner="musk", staff="kim")
    with pytest.raises(MigrationFailed, match="kim"):  # C32
        build_engine(sol.root)


async def test_the_serve_placement_options(tmp_path: Path) -> None:
    from typer.testing import CliRunner

    from solosquad.cli import app

    sol = make_customer(tmp_path)
    res = CliRunner().invoke(app, ["serve", "-s", str(sol.root), "--workspace", "cars"])
    assert res.exit_code == 1 and "--workspace needs --org" in res.output
    await asyncio.sleep(0)
