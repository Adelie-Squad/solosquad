"""서버 · 회사 (user 2026-11-11) — the retired customer profile split in two.

서버 = what this engine server is, detected (local vs cloud, provider, region, OS, version,
country) with core/server.yaml as the builder's override. 회사 = the customer company in
core.db (법인 / 개인 사업자, 법인명 · 상호, 대표자, 소재지) — the one account holder that
decision 45 judges every connection on.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import yaml
from test_web_settings import Settings

from solosquad.company_info import Company, validate_company
from solosquad.layout import Solution, scaffold_org, scaffold_solution, scaffold_workspace
from solosquad.server_facts import detect, region_country
from solosquad.web_api.accounts import Role
from solosquad.web_api.errors import CodedError
from solosquad.web_api.org_store import open_accounts

# ---------------------------------------------------------------------- detection


def _dmi(root: Path, **files: str) -> Path:
    d = root / "sys" / "class" / "dmi" / "id"
    d.mkdir(parents=True)
    for name, text in files.items():
        (d / name).write_text(text + "\n", encoding="utf-8")
    return root


def test_a_laptop_is_local(tmp_path: Path) -> None:
    facts = detect({}, env={"AWS_REGION": "ap-northeast-2", "HOME": "/x"}, root=tmp_path)
    # a developer's AWS_REGION is not a cloud hint
    assert (facts.where, facts.cloud, facts.region, facts.country) == ("local", None, None, None)
    assert facts.sources["where"] == "default" and facts.version and facts.os


def test_aws_from_the_platform_env_and_the_region_gives_the_country(tmp_path: Path) -> None:
    env = {"AWS_EXECUTION_ENV": "AWS_ECS_FARGATE", "AWS_REGION": "ap-northeast-2"}
    facts = detect({}, env=env, root=tmp_path)
    assert (facts.where, facts.cloud, facts.region, facts.country) == (
        "cloud", "aws", "ap-northeast-2", "KR",
    )  # fmt: skip
    assert facts.sources == {
        "cloud": "detected", "where": "detected", "region": "detected", "country": "detected",
    }  # fmt: skip


def test_a_vm_is_known_by_its_dmi_vendor(tmp_path: Path) -> None:
    root = _dmi(tmp_path, sys_vendor="Google", product_name="Google Compute Engine")
    facts = detect({}, env={"GOOGLE_CLOUD_REGION": "asia-northeast3"}, root=root)
    assert (facts.where, facts.cloud, facts.country) == ("cloud", "gcp", "KR")
    ec2 = tmp_path / "ec2"
    (ec2 / "sys" / "hypervisor").mkdir(parents=True)
    (ec2 / "sys" / "hypervisor" / "uuid").write_text("ec2a1b2c3\n", encoding="utf-8")
    assert detect({}, env={}, root=ec2).cloud == "aws"


def test_the_builders_values_win(tmp_path: Path) -> None:
    env = {"AWS_EXECUTION_ENV": "AWS_ECS_FARGATE", "AWS_REGION": "us-east-1"}
    facts = detect({"region": "ap-east-1", "server_country": "kr"}, env=env, root=tmp_path)
    assert (facts.region, facts.country) == ("ap-east-1", "KR")
    assert facts.sources["region"] == "override" and facts.sources["country"] == "override"
    local = detect({"type": "local"}, env=env, root=tmp_path)
    assert (local.where, local.cloud, local.region) == ("local", None, None)
    assert region_country("eu-west-1") == "IE" and region_country("cn-north-1") == "CN"
    assert region_country("nowhere") is None


# ---------------------------------------------------------------------- 회사


def test_company_validation_codes() -> None:
    ok = validate_company({"kind": "corporation", "name": "  Moa  Korea ", "country": "kr",
                           "representative": "김대표", "address": "서울시\n강남구"})  # fmt: skip
    assert (ok.name, ok.country, ok.address, ok.complete) == (
        "Moa Korea",
        "KR",
        "서울시\n강남구",
        True,
    )
    assert ok.holder() is not None and ok.holder().control_country == "KR"  # type: ignore[union-attr]
    for bad, code in (
        ({"kind": "llc"}, "company_kind_invalid"),
        ({"country": "Korea"}, "company_country_invalid"),
        ({"kind": "sole_proprietor", "controlled_by": "CN"}, "company_control_corporation_only"),
        ({"name": "x" * 121}, "company_field_too_long"),
        ({"name": 3}, "company_field_invalid"),
        ({"entities": []}, "company_field_invalid"),
    ):
        with pytest.raises(CodedError) as e:
            validate_company(bad)
        assert e.value.code.value == code, bad
    assert Company().holder() is None  # no country yet → the rules wait (C18)
    solo = validate_company({"kind": "sole_proprietor", "country": "CN", "name": "Li"})
    assert solo.holder() is not None and solo.holder().control_country == "CN"  # type: ignore[union-attr]


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Settings]:
    o = Settings(tmp_path)
    await o.manager.start()
    yield o
    await o.manager.stop()


async def test_company_owner_edits_everyone_reads(office: Settings) -> None:
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.login(kim, "kim", Role.STAFF)
        empty = (await kim.get("/api/company")).json()
        assert empty == {"kind": None, "name": "", "representative": "", "country": None,
                         "address": "", "controlled_by": None, "complete": False}  # fmt: skip
        body = {"kind": "corporation", "name": "Moa Korea Co.", "representative": "김대표",
                "country": "KR", "address": "서울특별시 강남구 테헤란로 1"}  # fmt: skip
        assert (await kim.put("/api/company", json=body, headers=hk)).status_code == 403
        r = await boss.put("/api/company", json=body, headers=hb)
        assert r.status_code == 200 and r.json()["complete"] is True
        assert (await kim.get("/api/company")).json()["name"] == "Moa Korea Co."
        bad = await boss.put("/api/company", json={**body, "country": "KOR"}, headers=hb)
        assert (bad.status_code, bad.json()["code"]) == (400, "company_country_invalid")
        assert bad.json()["params"] == {"field": "country"}
        assert office.accounts.company().country == "KR"  # nothing half-written
        server = (await kim.get("/api/server")).json()
        assert set(server) == {"where", "cloud", "region", "country", "os", "version", "sources"}
        assert (await boss.put("/api/server", json={}, headers=hb)).status_code in (404, 405)
    actions = [e["action"] for e in office.accounts.audit_log()]
    assert actions.count("company.update") == 1


# ---------------------------------------------------------------------- migration


def test_entities_become_the_company_and_leave_the_connections(tmp_path: Path) -> None:
    sol = scaffold_solution(tmp_path / "moa", "2.1.0")
    scaffold_workspace(scaffold_org(sol, "moa", "bundled", "2.1.0"), "hq")
    (sol.root / "core" / "profile.yaml").write_text(
        yaml.safe_dump({
            "schema_version": 1,
            "server": {"cloud": "ncp", "region": "KR-2", "access": "VPN"},
            "entities": [{"id": "moa-qd", "name": "Moa Qingdao 3PL", "country": "CN"}],
            "languages": {"default": "ko", "enabled": ["ko"]},
            "privacy": {"regimes": ["PIPA"], "reviewer": "법무팀"},
        }, allow_unicode=True),
        encoding="utf-8",
    )  # fmt: skip
    sol.connections_path.write_text(
        yaml.safe_dump({"schema_version": 1, "connections": [{
            "id": "claude", "kind": "api_key", "provider": "anthropic", "harness": "lite",
            "entity": {"name": "Moa Korea Co.", "country": "KR", "controlled_by": "CN"},
        }]}),
        encoding="utf-8",
    )  # fmt: skip
    core = open_accounts(Solution(sol.root))
    company = core.company()
    # the entity a connection named wins over the profile's list
    assert (company.kind, company.name, company.country, company.controlled_by) == (
        "corporation", "Moa Korea Co.", "KR", "CN",
    )  # fmt: skip
    assert "entity" not in sol.connections_path.read_text(encoding="utf-8")
    assert not (sol.root / "core" / "profile.yaml").exists()
    server = Solution(sol.root).server_config()
    assert (server.cloud, server.region, server.agency_access) == ("ncp", "KR-2", "VPN")
    moved = [e for e in core.audit_log() if e["action"] == "profile.retire"]
    assert moved and "Moa Qingdao 3PL" in moved[0]["detail"]  # the dropped one is on record
    # a second start finds nothing to move and keeps what the owner entered since
    core.set_company(Company(kind="sole_proprietor", name="Moa", country="KR"))
    assert open_accounts(Solution(sol.root)).company().name == "Moa"
