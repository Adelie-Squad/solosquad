"""Decision 51 (two-tier approval) · decision 55 (org chart with agents and people)."""

from __future__ import annotations

import asyncio
import json
import shutil
import sqlite3
from pathlib import Path
from typing import Any

from company_fixtures import agent_of, reply
from test_ops_api import Office
from test_workflows import LEDGER_CSV, TEMPLATE

from solosquad.approvals import RECOMMENDED, ApprovalPolicy, Tier, can_approve, load_policy
from solosquad.artifacts import ArtifactStore
from solosquad.harness.base import SpawnRequest
from solosquad.harness.events import End, Start, TextDelta, ToolResult
from solosquad.harness.guard_hook import MARKER
from solosquad.runtime import RunStatus
from solosquad.web_api.accounts import AccountStore, Role
from solosquad.web_api.app import WebConfig, create_app
from solosquad.workflows.engine import WorkflowEngine, company_asker

# ---------------------------------------------------------------------- the rule


def test_policy_tiers_and_who_may_approve() -> None:
    p = ApprovalPolicy({})
    assert p.tier("transfer") is Tier.OWNER and p.tier("review") is Tier.TEAM
    # what cannot be classified is the owner's (K41): unknown, missing, older cards
    assert p.tier("something-new") is Tier.OWNER
    assert p.tier(None) is Tier.OWNER and p.tier("unclassified") is Tier.OWNER
    older = [{"team": "product"}, {"category": "", "team": "product"}]
    for old in [*older, {"category": "purhcase", "team": "product"}]:
        assert not can_approve(p, old, is_owner=False, teams=["product"])
        assert can_approve(p, old, is_owner=True, teams=[])
    # the owner may still open up a category of their own on purpose
    assert ApprovalPolicy({"inventory": Tier.TEAM}).tier("inventory") is Tier.TEAM
    assert "unclassified" not in [r["category"] for r in p.table()]
    card = {"category": "review", "team": "product"}
    assert can_approve(p, card, is_owner=False, teams=["product"])
    assert not can_approve(p, card, is_owner=False, teams=["brand"])
    assert not can_approve(p, {**card, "category": "payment"}, is_owner=False, teams=["product"])
    assert not can_approve(
        p, {"category": "review", "team": None}, is_owner=False, teams=["product"]
    )
    assert can_approve(p, {**card, "category": "payment"}, is_owner=True, teams=[])
    stricter = ApprovalPolicy({"review": Tier.OWNER})
    assert not can_approve(stricter, card, is_owner=False, teams=["product"])
    row = next(r for r in stricter.table() if r["category"] == "review")
    assert row == {"category": "review", "label": "검토 · 확인", "tier": "owner",
                   "recommended": "team", "deviates": True}  # fmt: skip
    assert {r["category"] for r in p.table()} >= set(RECOMMENDED)


# ---------------------------------------------------------------------- org chart


async def _office(tmp: Path) -> Office:
    o = Office(tmp)
    cfg_path = o.company.ctx.org_root / "approvals.yaml"
    o.app = create_app(
        WebConfig(o.manager, o.company.ledger, "tok", o.accounts, o.workspace,
                  resolver=o.company.rt.resolver, approvals_path=cfg_path)
    )  # fmt: skip
    await o.manager.start()
    return o


async def test_org_chart_shows_agents_and_people(tmp_path: Path) -> None:
    o = await _office(tmp_path)
    try:
        async with o.client() as boss:
            h = await o.login(boss, "boss", Role.OWNER)
            kim = o.accounts.create_user(
                "kim", "correct horse battery", Role.STAFF, display="김대리"
            )
            r = await boss.patch(
                f"/api/users/{kim.id}", json={"teams": ["product"], "title": "MD"}, headers=h
            )
            assert (
                r.status_code == 200
                and r.json()["teams"] == ["product"]
                and r.json()["title"] == "MD"
            )
            chart = (await boss.get("/api/org-chart")).json()
            product = next(t for t in chart["teams"] if t["name"] == "product")
            assert product["lead_agent"]["name"] == "pm"
            assert [a["name"] for a in product["agents"]] == ["engineer"]
            assert product["people"] == [
                {"id": kim.id, "display": "김대리", "title": "MD", "role": "staff"}
            ]
            assert [p["display"] for p in chart["owners"]] == ["boss"] and chart["unassigned"] == []
            # move kim: the chart follows
            await boss.patch(f"/api/users/{kim.id}", json={"teams": ["core"]}, headers=h)
            chart = (await boss.get("/api/org-chart")).json()
            assert [
                p["id"] for t in chart["teams"] if t["name"] == "core" for p in t["people"]
            ] == [kim.id]
            await boss.patch(f"/api/users/{kim.id}", json={"teams": []}, headers=h)
            assert [p["id"] for p in (await boss.get("/api/org-chart")).json()["unassigned"]] == [
                kim.id
            ]
    finally:
        await o.manager.stop()


# ---------------------------------------------------------------------- team approvals


def _asks(category: str) -> Any:
    def script(req: SpawnRequest) -> list[Any]:
        if agent_of(req) == "chief" and "(approved by owner" not in req.prompt:
            return [
                Start(),
                TextDelta("…"),
                ToolResult("t", f"{MARKER}:abc123:[{category}] {category} it"),
                End("end_turn"),
            ]
        return reply("done")

    return script


async def _waiting(o: Office, c: Any, h: dict[str, str]) -> str:
    tid = (await c.post("/api/threads", json={"title": "t"}, headers=h)).json()["thread_id"]
    rid = (await c.post(f"/api/threads/{tid}/runs", json={"input": "go"}, headers=h)).json()[
        "run_id"
    ]
    for _ in range(250):
        if o.manager.store.run(rid)["status"] == RunStatus.INTERRUPTED:  # type: ignore[index]
            return str(tid)
        await asyncio.sleep(0.02)
    raise AssertionError("never asked for approval")


async def test_staff_approve_their_team_only_and_never_owner_tier(tmp_path: Path) -> None:
    o = await _office(tmp_path)
    try:
        async with o.client() as boss, o.client("203.0.113.9") as kim:
            hb = await o.login(boss, "boss", Role.OWNER)
            hk = await o.login(kim, "kim", Role.STAFF)
            kim_id = next(u.id for u in o.accounts.users() if u.username == "kim")

            o.company.scripts["max"] = _asks("review")  # chief (team core) asks for a review
            tid = await _waiting(o, boss, hb)
            listed = (await kim.get("/api/approvals")).json()
            assert listed[0]["card"]["team"] == "core" and listed[0]["tier"] == "team"
            assert listed[0]["can_approve"] is False  # kim is in no team yet
            r = await kim.post(f"/api/threads/{tid}/resume", json={"value": "approved"}, headers=hk)
            assert r.status_code == 403 and "team core" in r.json()["error"]
            await boss.patch(f"/api/users/{kim_id}", json={"teams": ["core"]}, headers=hb)
            async with o.client("203.0.113.9") as kim2:  # a fresh session sees the new teams
                hk2 = await o.login_existing(kim2, "kim")
                assert (await kim2.get("/api/approvals")).json()[0]["can_approve"] is True
                r = await kim2.post(
                    f"/api/threads/{tid}/resume", json={"value": "approved"}, headers=hk2
                )
                assert r.status_code == 201
                assert o.manager.store.run(r.json()["run_id"])["source"] == "user:kim"  # type: ignore[index]

                o.company.scripts["max"] = _asks("transfer")  # 송금 — owner tier
                tid2 = await _waiting(o, boss, hb)
                r = await kim2.post(
                    f"/api/threads/{tid2}/resume", json={"value": "approved"}, headers=hk2
                )
                assert r.status_code == 403 and "owner" in r.json()["error"]
                assert (
                    await boss.post(
                        f"/api/threads/{tid2}/resume", json={"value": "approved"}, headers=hb
                    )
                ).status_code == 201

                # the owner tightens `review` to owner tier → kim can no longer approve it
                assert (
                    await kim2.put(
                        "/api/approval-policy", json={"tiers": {"review": "owner"}}, headers=hk2
                    )
                ).status_code == 403
                table = (
                    await boss.put(
                        "/api/approval-policy", json={"tiers": {"review": "owner"}}, headers=hb
                    )
                ).json()
                assert next(t for t in table if t["category"] == "review")["deviates"] is True
                assert load_policy(o.company.ctx.org_root / "approvals.yaml").overrides == {
                    "review": Tier.OWNER
                }
                # C25 — who and when (the row), the category, the old and the new tier
                entry = next(
                    e for e in o.accounts.audit_log() if e["action"] == "approval_policy.update"
                )
                assert entry["user_id"] and entry["ts"]
                assert json.loads(entry["detail"])["changes"] == [
                    {"category": "review", "before": "team", "after": "owner"}
                ]
                o.company.scripts["max"] = _asks("review")
                tid3 = await _waiting(o, boss, hb)
                r = await kim2.post(
                    f"/api/threads/{tid3}/resume", json={"value": "approved"}, headers=hk2
                )
                assert r.status_code == 403
                # back to the recommendation: the file keeps only real deviations
                await boss.put(
                    "/api/approval-policy", json={"tiers": {"review": "team"}}, headers=hb
                )
                assert load_policy(o.company.ctx.org_root / "approvals.yaml").overrides == {}
    finally:
        await o.manager.stop()


async def test_workflow_review_is_approved_by_its_team(tmp_path: Path) -> None:
    o = Office(tmp_path)
    c = o.company
    (c.ctx.org_root / "workflows").mkdir(parents=True, exist_ok=True)
    shutil.copy(TEMPLATE, c.ctx.org_root / "workflows" / "monthly-pnl.yaml")  # team: business
    wf = WorkflowEngine(c.ctx.org_root, c.ctx.data_dir, ArtifactStore(c.ctx.data_dir / "a.sqlite"),
                        company_asker(o.manager))  # fmt: skip
    o.app = create_app(WebConfig(o.manager, c.ledger, "tok", o.accounts, o.workspace, workflows=wf))
    await o.manager.start()
    await wf.start()
    try:
        async with o.client() as boss, o.client("203.0.113.9") as lee:
            hb = await o.login(boss, "boss", Role.OWNER)
            lee_user = o.accounts.create_user("lee", "correct horse battery", Role.STAFF)
            o.accounts.set_profile(lee_user.id, teams=["business"])
            hl = await o.login_existing(lee, "lee")
            up = wf.save_upload("원장.csv", LEDGER_CSV.encode())
            tid, rid = await wf.run_now("monthly-pnl", {"ledger": up["id"]})
            await wf.manager.wait(rid, timeout=10)
            card = wf.manager.store.run(rid)["interrupts"][0]["value"]  # type: ignore[index]
            assert (card["category"], card["team"]) == ("review", "business")
            r = await lee.post(
                f"/api/workflow-threads/{tid}/resume", json={"value": "approved"}, headers=hl
            )
            assert r.status_code == 201, r.text
            assert hb  # the owner was not needed
    finally:
        await wf.stop()
        await o.manager.stop()


# ---------------------------------------------------------------------- crash re-run · migration


async def test_agent_step_re_run_reuses_the_company_run(tmp_path: Path) -> None:
    o = Office(tmp_path)
    await o.manager.start()
    try:
        ask = company_asker(o.manager)
        first = await ask("chief", "summarise", "wf-th-1", "brief")
        again = await ask("chief", "summarise", "wf-th-1", "brief")  # the node re-ran after a crash
        assert first == again == "chief done"
        runs = o.manager.store.runs(thread_id="wf-th-1-agent", limit=10)
        assert len(runs) == 1 and runs[0]["source"] == "workflow:wf-th-1:brief"
        await ask("chief", "next", "wf-th-1", "other-step")  # a different step is a new job
        assert len(o.manager.store.runs(thread_id="wf-th-1-agent", limit=10)) == 2
    finally:
        await o.manager.stop()


def test_an_older_accounts_file_gains_the_new_columns(tmp_path: Path) -> None:
    path = tmp_path / "accounts.sqlite"
    db = sqlite3.connect(path)
    db.execute(
        "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display TEXT NOT NULL,"
        " role TEXT NOT NULL, pw_hash TEXT NOT NULL, totp_secret TEXT, totp_last_step INTEGER,"
        " pending_totp TEXT, locale TEXT NOT NULL DEFAULT 'ko', disabled INTEGER NOT NULL DEFAULT 0,"
        " created REAL NOT NULL)"
    )
    db.execute(
        "INSERT INTO users (id, username, display, role, pw_hash, created) VALUES ('u-1','old','Old','staff','x',0)"
    )
    db.commit()
    db.close()
    store = AccountStore(path)
    user = store.set_profile("u-1", title="팀장", teams=["brand", "product", "brand"])
    assert (user.title, user.teams) == ("팀장", ("brand", "product"))
