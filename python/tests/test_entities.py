"""여러 법인 (2026-11-14) — "어 여러 개 등록할 수 있어".

The 회사 is now a list of legal entities in core.db: each 사업 (org) runs under one (its
소속 법인), each connection is held by one (its 보유 법인), both default to the 대표 법인.
Decision 45 judges a connection on both entities and the server.
"""

from __future__ import annotations

import json
import random
import shutil
import sqlite3
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import yaml
from test_web_settings import Settings

from solosquad.entities import check_registration, registration_kind, validate_entity
from solosquad.routing.connections import Connection, ConnectionKind
from solosquad.routing.eligibility import Entity, Holders, judge, judge_use
from solosquad.routing.router import eligible
from solosquad.storage import migrate
from solosquad.web_api.accounts import COMPONENT, AccountStore, Role, migrations
from solosquad.web_api.errors import CodedError

REPO = Path(__file__).resolve().parents[2]
COMPANY_NO = REPO / "marketing" / "scripts" / "lib" / "company-no.mjs"

KR_CORPORATE = "1101111234569"
KR_BUSINESS = "1234567891"
CN_USCC = "91370200MA3C5XL01G"

# ---------------------------------------------------------------------- registration number


def test_registration_number_rules() -> None:
    assert check_registration("110111-1234569", "corporate") == KR_CORPORATE
    assert check_registration("123-45-67891", "business") == KR_BUSINESS
    assert check_registration("91370200ma3c5xl01g", "uscc") == CN_USCC  # upper-cased
    assert check_registration("hrb 12345", "foreign") == "HRB12345"
    for raw, kind, reason in (
        ("1101111234568", "corporate", "check"),
        ("12345", "business", "length"),
        ("12a4567891", "business", "invalid"),
        ("91370200MA3C5XL01H", "uscc", "check"),
        ("91370200MA3C5XL0", "uscc", "length"),
        ("AB1", "foreign", "length"),
        ("한국123456", "foreign", "invalid"),
    ):
        with pytest.raises(CodedError) as e:
            check_registration(raw, kind)  # type: ignore[arg-type]
        assert e.value.code == "entity_registration_invalid"
        assert e.value.params["reason"] == reason, raw
    assert registration_kind("KR", "sole_proprietor") == "business"
    assert registration_kind("KR", "corporation") == "corporate"
    assert registration_kind("CN", "foreign") == "uscc"
    assert registration_kind("JP", "foreign") == "foreign"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_registration_rules_match_the_marketing_form() -> None:
    """The same verdicts as `marketing/scripts/lib/company-no.mjs` for many numbers."""
    rng = random.Random(14)
    cases: list[tuple[str, str]] = [(KR_CORPORATE, "corporate"), (KR_BUSINESS, "business"),
                                    (CN_USCC, "uscc")]  # fmt: skip
    for _ in range(300):
        cases.append(("".join(rng.choice("0123456789") for _ in range(10)), "business"))
        cases.append(("".join(rng.choice("0123456789") for _ in range(13)), "corporate"))
        cases.append(("".join(rng.choice("0123456789ABCDEFGHJKLMNPQRTUWXY") for _ in range(18)),
                      "uscc"))  # fmt: skip
    script = (
        f"import({json.dumps(COMPANY_NO.as_uri())}).then(m => {{"
        " const cases = JSON.parse(process.argv[1]);"
        " console.log(JSON.stringify(cases.map(([raw, kind]) => m.checkCompanyNo(raw, kind))));"
        " })"
    )
    out = subprocess.run(
        ["node", "-e", script, json.dumps(cases)], capture_output=True, text=True, check=True
    )
    theirs = json.loads(out.stdout)
    for (raw, kind), want in zip(cases, theirs, strict=True):
        try:
            got = {"ok": True, "digits": check_registration(raw, kind), "kind": kind}  # type: ignore[arg-type]
        except CodedError as e:
            got = {"ok": False, "error": e.params["reason"]}
        assert got == want, (raw, kind)
    assert sum(1 for w in theirs if w["ok"]) > 3  # the random ones hit a valid number too


def test_entity_validation() -> None:
    kr = validate_entity({"kind": "corporation", "name": " 모아리빙  주식회사 ",
                          "registration_no": "110111-1234569", "country": "kr"})  # fmt: skip
    assert (kr["kind"], kr["name"], kr["country"]) == ("corporation", "모아리빙 주식회사", "KR")
    assert (kr["registration_no"], kr["registration_kind"]) == (KR_CORPORATE, "corporate")
    # outside Korea the country says 해외, whatever was sent
    cn = validate_entity({"kind": "sole_proprietor", "name": "青岛摩阿", "country": "CN",
                          "registration_no": CN_USCC})  # fmt: skip
    assert (cn["kind"], cn["registration_kind"]) == ("foreign", "uscc")
    # the number may wait; a Korean entity must say which kind it is
    assert (
        validate_entity({"kind": "sole_proprietor", "name": "Moa", "country": "KR"})[
            "registration_no"
        ]
        == ""
    )
    for data, code in (
        ({"name": "x", "country": "KR"}, "company_kind_invalid"),
        ({"kind": "corporation", "country": "KR"}, "entity_name_required"),
        ({"kind": "corporation", "name": "x"}, "company_country_invalid"),
        ({"kind": "corporation", "name": "x", "country": "KR", "registration_no": "1"},
         "entity_registration_invalid"),
        ({"kind": "sole_proprietor", "name": "x", "country": "KR", "controlled_by": "CN"},
         "company_control_corporation_only"),
        ({"name": "x", "country": "JP", "nickname": "y"}, "company_field_invalid"),
    ):  # fmt: skip
        with pytest.raises(CodedError) as e:
            validate_entity(data)
        assert e.value.code == code, data


# ---------------------------------------------------------------------- eligibility

KR_HQ = Entity(name="모아리빙 주식회사", country="KR")
CN_SUB = Entity(name="青岛摩阿", country="CN")
BOOK = Holders({1: KR_HQ, 2: CN_SUB}, primary=1)


def _conn(provider: str = "anthropic", models: list[str] | None = None,
          entity_id: int | None = None) -> Connection:  # fmt: skip
    return Connection(id="c", kind=ConnectionKind.API_KEY, provider=provider, harness="lite",
                      models=models or [], entity_id=entity_id)  # fmt: skip


def test_kr_entity_kr_business_is_eligible() -> None:
    assert eligible(_conn(entity_id=1), "KR", BOOK, 1).ok


def test_a_cn_business_cannot_use_a_provider_that_does_not_serve_china() -> None:
    v = eligible(_conn(entity_id=1), "KR", BOOK, 2)  # a KR-held key used for the CN 사업
    assert not v.ok and (v.by, v.country, v.provider, v.entity) == ("entity", "CN", "anthropic",
                                                                    "青岛摩阿")  # fmt: skip
    assert not eligible(_conn("openai", ["gpt-5"], 2), "KR", BOOK, 2).ok
    # a model with no such rule is fine for the CN 사업 and its own entity
    assert eligible(_conn("openrouter", ["qwen/qwen3"], 2), "KR", BOOK, 2).ok


def test_cross_entity_ownership_is_judged_on_the_holder() -> None:
    v = eligible(_conn(entity_id=2), "KR", BOOK, 1)  # a CN-held key used for the KR 사업
    assert not v.ok and (v.by, v.entity) == ("entity", "青岛摩阿")
    # the server still counts, after both entities
    v = eligible(_conn(entity_id=1), "HK", BOOK, 1)
    assert not v.ok and (v.by, v.country) == ("server", "HK")


def test_unset_or_unknown_ids_fall_back_to_the_primary() -> None:
    assert eligible(_conn(), "KR", BOOK, None).ok
    assert eligible(_conn(entity_id=99), "KR", BOOK, 99).ok  # unknown → 대표 (KR)
    cn_first = Holders({1: KR_HQ, 2: CN_SUB}, primary=2)
    assert not eligible(_conn(), "KR", cn_first, None).ok


def test_one_entity_behaves_like_the_single_company() -> None:
    for entity in (KR_HQ, CN_SUB, Entity(name="x", country="KR", controlled_by="CN"), None):
        for server in ("KR", "HK", None):
            for conn in (_conn(), _conn("openai", ["gpt-5"]), _conn("moonshot", ["kimi"])):
                single = eligible(conn, server, Holders.single(entity), None)
                assert single == judge(conn.provider, conn.harness, conn.models, entity, server)
                assert single == judge_use(conn.provider, conn.harness, conn.models, entity,
                                           entity, server)  # fmt: skip


# ---------------------------------------------------------------------- migration 8


def test_the_rev7_company_becomes_the_primary_entity(tmp_path: Path) -> None:
    path = tmp_path / "core.db"
    db = sqlite3.connect(path, isolation_level=None)
    migrate(db, COMPONENT, migrations()[:7])
    db.execute(
        "INSERT INTO company (id, kind, name, representative, country, address, controlled_by,"
        " updated, updated_by) VALUES (1, 'corporation', 'Moa Korea Co.', '김대표', 'KR',"
        " '서울', 'CN', 100.0, 'u1')"
    )
    db.close()
    store = AccountStore(path)
    [only] = store.entities()
    assert (only.id, only.kind, only.name, only.country, only.controlled_by, only.is_primary) == (
        1, "corporation", "Moa Korea Co.", "KR", "CN", True,
    )  # fmt: skip
    assert store.company().name == "Moa Korea Co."  # the old shape still reads
    # a second entity never takes the 대표 by itself; at most one 대표 in the file
    store.add_entity(validate_entity({"name": "青岛摩阿", "country": "CN"}))
    assert [e.is_primary for e in store.entities()] == [True, False]
    with pytest.raises(sqlite3.IntegrityError):
        store.connection().execute("UPDATE entities SET is_primary = 1")


def test_a_new_customer_has_no_entity_until_one_is_added(tmp_path: Path) -> None:
    store = AccountStore(tmp_path / "core.db")
    assert store.entities() == [] and not store.has_company()
    first = store.add_entity(validate_entity({"kind": "sole_proprietor", "name": "Moa",
                                              "country": "KR"}))  # fmt: skip
    assert first.is_primary


# ---------------------------------------------------------------------- API


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Settings]:
    o = Settings(tmp_path)
    await o.manager.start()
    yield o
    await o.manager.stop()


async def test_entities_through_the_api(office: Settings) -> None:
    org_yaml = office.workspace.org.root / "org.yaml"
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.login(kim, "kim", Role.STAFF)
        assert (await kim.get("/api/entities")).json() == {"entities": []}
        hq = {"kind": "corporation", "name": "모아리빙 주식회사", "representative": "김대표",
              "country": "KR", "registration_no": "110111-1234569"}  # fmt: skip
        r = await boss.post("/api/entities", json=hq, headers=hb)
        assert r.status_code == 201, r.text
        assert r.json()["is_primary"] is True and r.json()["registration_no"] == KR_CORPORATE
        hq_id = r.json()["id"]
        bad = await boss.post("/api/entities", json={"name": "x", "country": "CN",
                                                     "registration_no": "123"}, headers=hb)  # fmt: skip
        assert (bad.status_code, bad.json()["code"]) == (400, "entity_registration_invalid")
        assert bad.json()["params"]["field"] == "registration_no"
        sub = {"name": "青岛摩阿贸易有限公司", "representative": "李", "country": "CN",
               "registration_no": CN_USCC}  # fmt: skip
        r = await boss.post("/api/entities", json=sub, headers=hb)
        cn_id = r.json()["id"]
        assert (r.json()["kind"], r.json()["is_primary"]) == ("foreign", False)
        # the 사업 runs under the 대표 until told otherwise
        assert (await kim.get("/api/o/tesla/entity")).json() == {"entity_id": hq_id,
                                                                 "explicit": False}  # fmt: skip
        assert (await kim.put("/api/o/tesla/entity", json={"entity_id": cn_id},
                              headers=hk)).status_code == 403  # fmt: skip
        r = await boss.put("/api/o/tesla/entity", json={"entity_id": 999}, headers=hb)
        assert (r.status_code, r.json()["code"]) == (400, "entity_unknown")
        conn = {"id": "claude-1", "provider": "anthropic", "harness": "lite",
                "models": ["claude-sonnet"]}  # fmt: skip
        assert (await boss.post("/api/o/tesla/connections", json=conn,
                                headers=hb)).status_code == 201  # fmt: skip
        r = await boss.put("/api/o/tesla/entity", json={"entity_id": cn_id}, headers=hb)
        assert r.json() == {"entity_id": cn_id, "explicit": True}
        assert yaml.safe_load(org_yaml.read_text(encoding="utf-8"))["entity_id"] == cn_id
        assert office.company.router.org_entity == cn_id  # the router follows at once
        [listed] = (await kim.get("/api/o/tesla/connections")).json()
        assert listed["entity_id"] == hq_id and listed["eligible"] is False
        assert (listed["eligibility_by"], listed["eligibility_country"],
                listed["eligibility_entity"]) == ("entity", "CN", "青岛摩阿贸易有限公司")  # fmt: skip
        assert office.company.router.candidates("chief") == [] or all(
            c.id != "claude-1" for c, _m in office.company.router.candidates("chief")
        )
        # switching it back on for the CN 사업 is refused with the same code as adding
        await boss.patch("/api/o/tesla/connections/claude-1", json={"active": False}, headers=hb)
        r = await boss.patch("/api/o/tesla/connections/claude-1", json={"active": True},
                             headers=hb)  # fmt: skip
        assert (r.status_code, r.json()["code"]) == (422, "connection_ineligible_company")
        # the owner moves the key to the CN entity: still refused (anthropic, China)
        r = await boss.patch("/api/o/tesla/connections/claude-1", json={"entity_id": cn_id},
                             headers=hb)  # fmt: skip
        assert r.status_code == 200 and r.json()["entity_id"] == cn_id
        # deleting a referenced entity says what still uses it; the 대표 cannot go
        r = await boss.delete(f"/api/entities/{cn_id}", headers=hb)
        assert (r.status_code, r.json()["code"]) == (409, "entity_in_use")
        assert r.json()["params"] == {"businesses": "tesla", "connections": "tesla/claude-1",
                                      "business_count": 1, "connection_count": 1}  # fmt: skip
        r = await boss.delete(f"/api/entities/{hq_id}", headers=hb)
        assert (r.status_code, r.json()["code"]) == (409, "entity_primary_locked")
        rows = {e["id"]: e for e in (await boss.get("/api/entities")).json()["entities"]}
        assert rows[cn_id]["blocked_by"] == "in_use" and rows[hq_id]["blocked_by"] == "primary"
        assert rows[cn_id]["businesses"] == [{"org": "tesla", "name": "tesla"}]
        staff_rows = (await kim.get("/api/entities")).json()["entities"]
        assert all(e["businesses"] == [] and e["connections"] == [] for e in staff_rows)
        # back to the 대표, then the CN entity can go
        await boss.put("/api/o/tesla/entity", json={"entity_id": None}, headers=hb)
        await boss.patch("/api/o/tesla/connections/claude-1", json={"entity_id": None},
                         headers=hb)  # fmt: skip
        assert "entity_id" not in org_yaml.read_text(encoding="utf-8")
        r = await boss.patch(f"/api/entities/{cn_id}", json={"name": "青岛摩阿"}, headers=hb)
        assert r.json()["name"] == "青岛摩阿" and r.json()["removable"] is True
        assert (await boss.delete(f"/api/entities/{cn_id}", headers=hb)).status_code == 200
    actions = [e["action"] for e in office.accounts.audit_log()]
    assert actions.count("entity.create") == 2 and "entity.delete" in actions
    assert "entity.update" in actions
    assert any(e["action"] == "org.entity" for e in office.web.org.audit_log())


async def test_a_new_primary_keeps_what_followed_the_old_one(office: Settings) -> None:
    org_yaml = office.workspace.org.root / "org.yaml"
    async with office.client() as boss:
        hb = await office.login(boss, "boss", Role.OWNER)
        hq = (await boss.post("/api/entities", json={"kind": "corporation", "name": "HQ",
                                                      "country": "KR"}, headers=hb)).json()  # fmt: skip
        jp = (await boss.post("/api/entities", json={"name": "Moa Japan", "country": "JP"},
                              headers=hb)).json()  # fmt: skip
        conn = {"id": "kimi", "provider": "moonshot", "harness": "lite", "models": ["kimi"]}
        assert (await boss.post("/api/o/tesla/connections", json=conn,
                                headers=hb)).status_code == 201  # fmt: skip
        r = await boss.post(f"/api/entities/{jp['id']}/primary", headers=hb)
        assert [(e["id"], e["is_primary"]) for e in r.json()["entities"]] == [
            (jp["id"], True), (hq["id"], False),
        ]  # fmt: skip
        # the 사업 and its connection were following HQ — they still are, now written down
        assert yaml.safe_load(org_yaml.read_text(encoding="utf-8"))["entity_id"] == hq["id"]
        [listed] = (await boss.get("/api/o/tesla/connections")).json()
        assert listed["entity_id"] == hq["id"]
        assert (await boss.get("/api/company")).json()["name"] == "Moa Japan"
    assert any(e["action"] == "entity.primary" for e in office.accounts.audit_log())
