"""Server settings in core, business settings per workspace (decision 57 ⑷ · PRD v2.1.0 I41).

C33: a rev6 repository keeps the server's address, country, type and snapshot target in
every `workspace.yaml`. Read through the engine they come from one place, a disagreement
is a `validate` error that is never merged, and the business settings stay per workspace.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml
from company_fixtures import make_bundle

from solosquad.check import validate_solution
from solosquad.context import build_context
from solosquad.instance import build_instance
from solosquad.layout import (
    ServerConfigConflict,
    Solution,
    WorkspaceType,
    scaffold_org,
    scaffold_solution,
    scaffold_workspace,
)
from solosquad.profile import load_profile

SERVER = {
    "public_url": "https://ai.moa.example",
    "server_country": "kr",
    "type": "cloud",
    "snapshot": {"type": "dir", "path": "/backups", "keep_days": 30},
    "web": {"locale": "zh-CN"},
}


def rev6(tmp: Path, **per_ws: dict[str, Any]) -> Solution:
    """A rev6 repository: no core/server.yaml, server fields in each workspace.yaml."""
    sol = scaffold_solution(tmp / "moa", "2.1.0")
    sol.server_config_path.unlink()
    for org, wss in (("tesla", ("cars", "charging")), ("spacex", ("rocket",))):
        o = scaffold_org(sol, org, "bundled", "2.1.0")
        for name in wss:
            ws = scaffold_workspace(o, name)
            key = f"{org}/{name}"
            doc = {
                "schema_version": 1,
                "name": name,
                "timezone": "Asia/Seoul" if org == "tesla" else "America/Los_Angeles",
                "access": {"allowed_networks": ["10.0.0.0/8"] if name == "charging" else []},
                "execution": {"allow_external_api": name != "rocket"},
                **SERVER,
                **per_ws.get(key, {}),
            }
            (ws.root / "workspace.yaml").write_text(
                yaml.safe_dump(doc, allow_unicode=True), encoding="utf-8"
            )
    return sol


def _codes(sol: Solution, bundle: Path) -> dict[str, str]:
    return {
        i.code: i.severity
        for r in validate_solution(sol.root, bundle).values()
        for i in r.issues
        if i.code.startswith("SERVER_CONFIG")
    }


def test_rev6_server_fields_are_read_from_one_place(tmp_path: Path) -> None:
    bundle = make_bundle(tmp_path / "bundle")
    sol = rev6(tmp_path)
    server = sol.server_config()
    assert server.public_url == "https://ai.moa.example"
    assert server.server_country == "KR" and server.type is WorkspaceType.CLOUD
    assert server.snapshot.type == "dir" and server.web.locale == "zh-CN"
    assert _codes(sol, bundle) == {"SERVER_CONFIG_LEGACY": "warn"}  # agree → only a notice

    # the engine sees the same server from every workspace, and each business its own
    ctxs = {
        f"{o}/{w}": build_context(sol.root, o, w, bundle)
        for o, w in (("tesla", "cars"), ("tesla", "charging"), ("spacex", "rocket"))
    }
    assert {c.server.server_country for c in ctxs.values()} == {"KR"}
    assert {c.workspace_type for c in ctxs.values()} == {WorkspaceType.CLOUD}
    assert ctxs["spacex/rocket"].timezone == "America/Los_Angeles"
    assert ctxs["tesla/cars"].timezone == "Asia/Seoul"
    assert ctxs["spacex/rocket"].workspace_config.execution.allow_external_api is False
    assert ctxs["tesla/charging"].workspace_config.access.allowed_networks == ["10.0.0.0/8"]
    inst = build_instance(sol.root, "tesla", "cars", bundle=bundle)
    assert inst.router.server_country == "KR"

    # the lift is made permanent once: server.yaml holds it, workspace.yaml only business
    sol.lift_server_config()
    assert sol.server_config_path.is_file()
    for ws in sol.workspaces():
        doc = yaml.safe_load((ws.root / "workspace.yaml").read_text(encoding="utf-8"))
        assert not set(doc) & set(SERVER), doc
        assert "timezone" in doc and "access" in doc
    assert sol.server_config().public_url == "https://ai.moa.example"
    assert _codes(sol, bundle) == {}


def test_workspaces_that_disagree_are_a_validate_error_never_merged(tmp_path: Path) -> None:
    bundle = make_bundle(tmp_path / "bundle")
    sol = rev6(tmp_path, **{"spacex/rocket": {"server_country": "US"}})
    before = {ws.name: (ws.root / "workspace.yaml").read_bytes() for ws in sol.workspaces()}
    assert _codes(sol, bundle) == {
        "SERVER_CONFIG_CONFLICT": "error",
        "SERVER_CONFIG_LEGACY": "warn",
    }
    issue = next(
        i
        for r in validate_solution(sol.root, bundle).values()
        for i in r.issues
        if i.code == "SERVER_CONFIG_CONFLICT"
    )
    assert "spacex/rocket='US'" in issue.message and "tesla/cars='KR'" in issue.message
    with pytest.raises(ServerConfigConflict, match="server_country"):
        sol.server_config()
    with pytest.raises(ServerConfigConflict):
        sol.lift_server_config()
    with pytest.raises(ServerConfigConflict):  # the engine refuses to start on it
        build_instance(sol.root, "tesla", "cars", bundle=bundle)
    after = {ws.name: (ws.root / "workspace.yaml").read_bytes() for ws in sol.workspaces()}
    assert after == before and not sol.server_config_path.exists()  # nothing was merged

    # the FDE settles it by setting the value once; the leftovers go away
    sol.update_server_country("KR")
    assert sol.server_config().server_country == "KR"
    assert _codes(sol, bundle) == {}


def test_a_server_value_left_in_workspace_yaml_must_match_the_server_file(
    tmp_path: Path,
) -> None:
    bundle = make_bundle(tmp_path / "bundle")
    sol = rev6(tmp_path)
    sol.lift_server_config()
    ws = sol.org("tesla").workspace("cars")
    doc = yaml.safe_load((ws.root / "workspace.yaml").read_text(encoding="utf-8"))
    doc["public_url"] = "https://other.example"  # a stale hand edit
    (ws.root / "workspace.yaml").write_text(yaml.safe_dump(doc), encoding="utf-8")
    assert _codes(sol, bundle)["SERVER_CONFIG_CONFLICT"] == "error"


def test_the_profile_country_is_the_server_country(tmp_path: Path) -> None:
    sol = rev6(tmp_path)
    sol.lift_server_config()
    (sol.profile_path).write_text(
        "schema_version: 1\nserver: {country: KR, cloud: aws}\n", encoding="utf-8"
    )
    assert load_profile(sol.root).server.country == "KR"
    sol.update_server_country("JP")  # profile set / the web profile write here
    assert load_profile(sol.root).server.country == "JP"
    assert "country" not in sol.profile_path.read_text(encoding="utf-8")
    assert load_profile(sol.root).server.cloud == "aws"
