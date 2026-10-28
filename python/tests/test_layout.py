from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from solosquad.cli import app
from solosquad.layout import (
    EngineStore,
    LayoutError,
    Solution,
    WorkspaceType,
    scaffold_org,
    scaffold_solution,
    scaffold_workspace,
    solosquad_home,
)


def make(tmp_path: Path) -> Solution:
    sol = scaffold_solution(tmp_path / "elon", "2.0.0")
    scaffold_workspace(scaffold_org(sol, "tesla", "commerce-ax", "1.0.0"), "hq")
    return sol


def test_scaffold_creates_decision_40_tree(tmp_path: Path) -> None:
    sol = make(tmp_path)
    for rel in (
        "core/engine.lock",
        "core/solution.yaml",
        "core/connections.yaml",
        "core/owner",
        "core/custom/hooks",
        "core/custom/patches",
        "orgs/tesla/org.lock",
        "orgs/tesla/org.yaml",
        "orgs/tesla/team/agents",
        "orgs/tesla/team/teams.yaml",
        "orgs/tesla/knowledge",
        "orgs/tesla/workspaces/hq/workspace.yaml",
        "orgs/tesla/workspaces/hq/local.yaml",
        "orgs/tesla/workspaces/hq/repositories",
    ):
        assert (sol.root / rel).exists(), rel
    assert sol.engine_lock().version == "2.0.0"
    assert sol.meta().id.startswith("sol-")


def test_discovery(tmp_path: Path) -> None:
    sol = make(tmp_path)
    scaffold_workspace(sol.org("tesla"), "busan", WorkspaceType.INTRANET)
    scaffold_org(sol, "spacex", "bundled", "2.0.0")
    assert [o.name for o in sol.orgs()] == ["spacex", "tesla"]
    tesla = sol.org("tesla")
    assert tesla.lock().package == "commerce-ax"
    assert [w.name for w in tesla.workspaces()] == ["busan", "hq"]
    assert tesla.workspace("busan").config().type is WorkspaceType.INTRANET
    assert tesla.workspace("hq").config().execution.allow_external_api is True


def test_refuses_to_overwrite(tmp_path: Path) -> None:
    sol = make(tmp_path)
    with pytest.raises(LayoutError):
        scaffold_solution(sol.root, "2.0.0")
    with pytest.raises(LayoutError):
        scaffold_org(sol, "tesla", "x", "1")
    with pytest.raises(LayoutError):
        scaffold_workspace(sol.org("tesla"), "hq")
    with pytest.raises(LayoutError):
        sol.org("nope")


def test_engine_store_is_per_machine_and_data_is_per_workspace(
    tmp_path: Path, isolated_home: Path
) -> None:
    store = EngineStore(solosquad_home())
    assert store.home == isolated_home
    for v in ("2.1.0", "2.0.0"):
        store.engine_path(v).mkdir(parents=True)
    assert store.versions() == ["2.0.0", "2.1.0"]

    sol = make(tmp_path)
    ws = sol.org("tesla").workspace("hq")
    data = store.data_dir(ws)
    assert data == isolated_home / "data" / sol.meta().id / "tesla" / "hq"
    assert not data.is_relative_to(sol.root)


def test_cli_init_and_layout(tmp_path: Path) -> None:
    runner = CliRunner()
    target = tmp_path / "moa"
    res = runner.invoke(app, ["init", str(target), "--org", "moa-living", "--type", "cloud"])
    assert res.exit_code == 0, res.output
    assert Solution(target).org("moa-living").workspace("hq").config().type is WorkspaceType.CLOUD
    res = runner.invoke(app, ["layout", str(target)])
    assert res.exit_code == 0, res.output
    assert "moa-living" in res.output
    assert "cloud" in res.output
    assert runner.invoke(app, ["init", str(target), "--org", "x"]).exit_code == 1


def test_cli_assets(repo_root: Path) -> None:
    res = CliRunner().invoke(app, ["assets", "--root", str(repo_root)])
    assert res.exit_code == 0, res.output
    assert "agents" in res.output
