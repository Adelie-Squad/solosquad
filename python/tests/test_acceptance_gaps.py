"""PRD v2.1.0 §7 — the acceptance rows that were "일부": what each one's Then still missed.

C6 · C23 (approve on the web → the run finishes · who, when, what kind and whose team are
recorded) · C24 (another team's member is refused and the run keeps waiting) · C27 (a team
move takes effect in the same session) · C20 (a person's language survives a new login, is
theirs alone, and never touches the conversation) · C11 (a web restart keeps sessions until
they expire) · C22 (an .xlsx ledger through the API) · C25 (the owner opens an owner-tier
category to a team) · C26 (people stay out of the repo).
"""

from __future__ import annotations

import io
import json
import sqlite3
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
from test_approvals import _asks, _waiting
from test_ops_api import Office
from test_workflows import TEMPLATE

from solosquad.artifacts import ArtifactStore
from solosquad.runtime import RunStatus
from solosquad.web_api.accounts import AccountStore, Role
from solosquad.web_api.app import CSRF_HEADER, SESSION_COOKIE
from solosquad.web_api.org_store import OrgStore
from solosquad.workflows.engine import WorkflowEngine, company_asker

# one approval step per team — the card's team is the workflow's (decision 51)
TEAM_WORKFLOW = (
    "name: {name}\ntitle: {title}\nteam: {team}\nsteps:\n"
    "  - id: check\n    approval: {{title: {title}, summary: 확인해 주세요, risk: low, category: {category}}}\n"
)


class Desk:
    """An office with workflows switched on — finance and marketing each own one."""

    def __init__(self, tmp: Path) -> None:
        self.o = o = Office(tmp)
        c = o.company
        folder = c.ctx.org_root / "workflows"
        folder.mkdir(parents=True, exist_ok=True)
        for name, title, team, category in (
            ("close", "월말 결산 확인", "finance", "review"),
            ("campaign", "캠페인 집행 확인", "marketing", "review"),
            ("order", "포장재 발주", "finance", "purchase"),
        ):
            (folder / f"{name}.yaml").write_text(
                TEAM_WORKFLOW.format(name=name, title=title, team=team, category=category),
                encoding="utf-8",
            )
        (folder / "monthly-pnl.yaml").write_bytes(TEMPLATE.read_bytes())
        self.artifacts = ArtifactStore(c.ctx.data_dir / "artifacts.sqlite")
        self.wf = WorkflowEngine(
            c.ctx.org_root, c.ctx.data_dir, self.artifacts, company_asker(o.manager)
        )
        view = o.web.config.runtimes[("tesla", "hq")]
        view.workflows, view.artifacts = self.wf, self.artifacts
        o.web.rebuild()
        o.app = o.web.app

    def uid(self, name: str) -> str:
        return next(u.id for u in self.o.accounts.users() if u.username == name)

    async def waiting(self, name: str) -> tuple[str, str]:
        tid, rid = await self.wf.run_now(name, {})
        run = await self.wf.manager.wait(rid, timeout=10)
        assert run["status"] == RunStatus.INTERRUPTED, run
        return tid, rid

    def approvals(self) -> list[dict[str, Any]]:
        out = []
        for e in self.o.web.org.audit_log():
            if e["action"] == "approval":
                out.append({**e, "detail": json.loads(e["detail"])})
        return out


@pytest.fixture
async def desk(tmp_path: Path) -> AsyncIterator[Desk]:
    d = Desk(tmp_path)
    await d.o.manager.start()
    await d.wf.start()
    yield d
    await d.wf.stop()
    await d.o.manager.stop()


def _newest(manager: Any, tid: str) -> dict[str, Any]:
    run: dict[str, Any] = manager.store.runs(thread_id=tid, limit=1)[0]
    return run


# ---------------------------------------------------------------------- C6 · C23


async def test_c6_the_owner_approves_on_the_web_and_the_run_finishes(desk: Desk) -> None:
    o = desk.o
    async with o.client() as boss:
        hb = await o.login(boss, "boss", Role.OWNER)
        o.company.scripts["max"] = _asks("transfer")  # chief asks for a 송금 — owner tier
        tid = await _waiting(o, boss, hb)
        before = time.time()
        r = await boss.post(f"/api/threads/{tid}/resume", json={"value": "approved"}, headers=hb)
        assert r.status_code == 201
        rid = r.json()["run_id"]
        done = await o.manager.wait(rid, timeout=10)
        assert done["status"] == RunStatus.SUCCESS and done["source"] == "user:boss"
        assert (await boss.get(f"/api/runs/{rid}")).json()["status"] == "success"
        # carried on from where it stopped: the same thread, the answer in the conversation
        msgs = (await boss.get(f"/api/threads/{tid}/state")).json()["values"]["messages"]
        text = json.dumps(msgs, ensure_ascii=False)
        assert "(approved by owner" in text and text.index("(approved by owner") < text.rindex(
            "done"
        )
        [entry] = desk.approvals()
        assert entry["user_id"] == desk.uid("boss") and before <= entry["ts"] <= time.time()
        assert entry["detail"] == {
            "source": "company", "thread": tid, "run": rid, "value": "approved",
            "category": "transfer", "team": "core", "tier": "owner", "approver": "boss",
        }  # fmt: skip


async def test_c23_a_team_member_approves_and_the_record_names_category_and_team(
    desk: Desk,
) -> None:
    o = desk.o
    async with o.client() as boss, o.client("203.0.113.9") as kim:
        hb = await o.login(boss, "boss", Role.OWNER)
        hk = await o.login(kim, "kim", Role.STAFF)
        await boss.patch(f"/api/people/{desk.uid('kim')}", json={"teams": ["finance"]}, headers=hb)
        tid, _ = await desk.waiting("close")
        listed = (await kim.get("/api/approvals")).json()
        assert [(a["card"]["team"], a["tier"], a["can_approve"]) for a in listed] == [
            ("finance", "team", True)
        ]
        before = time.time()
        r = await kim.post(f"/api/workflow-threads/{tid}/resume", json={"value": "approved"},
                           headers=hk)  # fmt: skip
        assert r.status_code == 201, r.text
        rid = r.json()["run_id"]
        done = await desk.wf.manager.wait(rid, timeout=10)
        assert done["status"] == RunStatus.SUCCESS and done["source"] == "user:kim"
        state = (await kim.get(f"/api/workflow-threads/{tid}/state")).json()["values"]
        assert state["status"] == "done"
        [entry] = desk.approvals()
        assert entry["user_id"] == desk.uid("kim") and before <= entry["ts"] <= time.time()
        assert entry["detail"] == {
            "source": "workflow", "thread": tid, "run": rid, "value": "approved",
            "category": "review", "team": "finance", "tier": "team", "approver": "kim",
        }  # fmt: skip
        assert hb


# ---------------------------------------------------------------------- C24


async def test_c24_another_teams_member_is_refused_and_the_run_keeps_waiting(desk: Desk) -> None:
    o = desk.o
    async with o.client() as boss, o.client("203.0.113.9") as lee:
        hb = await o.login(boss, "boss", Role.OWNER)
        hl = await o.login(lee, "lee", Role.STAFF)
        await boss.patch(f"/api/people/{desk.uid('lee')}", json={"teams": ["marketing"]},
                         headers=hb)  # fmt: skip
        tid, rid = await desk.waiting("close")  # finance's card
        assert (await lee.get("/api/approvals")).json()[0]["can_approve"] is False
        r = await lee.post(f"/api/workflow-threads/{tid}/resume", json={"value": "approved"},
                           headers=hl)  # fmt: skip
        assert r.status_code == 403
        assert r.json()["code"] == "approval_needs_team"
        assert r.json()["params"] == {"team": "finance"}
        # nothing moved: the same run is still the newest, still waiting, still listed
        newest = _newest(desk.wf.manager, tid)
        assert newest["id"] == rid and newest["status"] == RunStatus.INTERRUPTED
        assert [a["run_id"] for a in (await boss.get("/api/approvals")).json()] == [rid]
        assert desk.approvals() == []
        # the same refusal on a company card of another team (chief → core)
        o.company.scripts["max"] = _asks("review")
        ctid = await _waiting(o, boss, hb)
        crid = _newest(o.manager, ctid)["id"]
        r = await lee.post(f"/api/threads/{ctid}/resume", json={"value": "approved"}, headers=hl)
        assert r.status_code == 403 and r.json()["params"] == {"team": "core"}
        newest = _newest(o.manager, ctid)
        assert newest["id"] == crid and newest["status"] == RunStatus.INTERRUPTED


# ---------------------------------------------------------------------- C25


async def test_c25_the_owner_opens_purchases_to_the_team(desk: Desk) -> None:
    o = desk.o
    async with o.client() as boss, o.client("203.0.113.9") as kim:
        hb = await o.login(boss, "boss", Role.OWNER)
        hk = await o.login(kim, "kim", Role.STAFF)
        await boss.patch(f"/api/people/{desk.uid('kim')}", json={"teams": ["finance"]}, headers=hb)
        tid, rid = await desk.waiting("order")  # 발주 = purchase, owner tier by default
        r = await kim.post(f"/api/workflow-threads/{tid}/resume", json={"value": "approved"},
                           headers=hk)  # fmt: skip
        assert r.status_code == 403 and r.json()["code"] == "approval_needs_owner"
        table = await boss.put(
            "/api/approval-policy", json={"tiers": {"purchase": "team"}}, headers=hb
        )
        row = next(t for t in table.json() if t["category"] == "purchase")
        assert row == {"category": "purchase", "label": row["label"], "tier": "team",
                       "recommended": "owner", "deviates": True}  # fmt: skip
        entry = next(e for e in o.web.org.audit_log() if e["action"] == "approval_policy.update")
        assert entry["user_id"] == desk.uid("boss") and entry["ts"]
        assert json.loads(entry["detail"]) == {
            "changes": [{"category": "purchase", "before": "owner", "after": "team"}],
            "deviates": ["purchase"],
        }
        # the waiting card is judged by the new tier at once
        listed = (await kim.get("/api/approvals")).json()
        assert [(a["run_id"], a["tier"], a["can_approve"]) for a in listed] == [(rid, "team", True)]
        r = await kim.post(f"/api/workflow-threads/{tid}/resume", json={"value": "approved"},
                           headers=hk)  # fmt: skip
        assert r.status_code == 201, r.text
        assert desk.approvals()[0]["detail"]["tier"] == "team"


# ---------------------------------------------------------------------- C27


async def test_c27_a_team_move_applies_in_the_same_session(desk: Desk) -> None:
    o = desk.o
    async with o.client() as boss, o.client("203.0.113.9") as kim:
        hb = await o.login(boss, "boss", Role.OWNER)
        hk = await o.login(kim, "kim", Role.STAFF)
        kim_id = desk.uid("kim")
        await boss.patch(f"/api/people/{kim_id}", json={"teams": ["finance"]}, headers=hb)
        close_tid, close_rid = await desk.waiting("close")
        camp_tid, _ = await desk.waiting("campaign")
        can = {
            a["card"]["team"]: a["can_approve"] for a in (await kim.get("/api/approvals")).json()
        }
        assert can == {"finance": True, "marketing": False}
        before = len(o.web.org.audit_log())
        moved = await boss.patch(f"/api/people/{kim_id}", json={"teams": ["marketing"]},
                                 headers=hb)  # fmt: skip
        assert moved.status_code == 200 and moved.json()["teams"] == ["marketing"]
        # kim keeps the session that was open before the move — no new login
        can = {
            a["card"]["team"]: a["can_approve"] for a in (await kim.get("/api/approvals")).json()
        }
        assert can == {"finance": False, "marketing": True}
        r = await kim.post(f"/api/workflow-threads/{close_tid}/resume",
                           json={"value": "approved"}, headers=hk)  # fmt: skip
        assert r.status_code == 403 and r.json()["params"] == {"team": "finance"}
        assert _newest(desk.wf.manager, close_tid)["id"] == close_rid
        r = await kim.post(f"/api/workflow-threads/{camp_tid}/resume",
                           json={"value": "approved"}, headers=hk)  # fmt: skip
        assert r.status_code == 201, r.text
        moves = [e for e in o.web.org.audit_log()[: len(o.web.org.audit_log()) - before]
                 if e["action"] == "user.profile"]  # fmt: skip
        assert len(moves) == 1
        assert moves[0]["user_id"] == desk.uid("boss") and kim_id in moves[0]["detail"]
        assert "marketing" in moves[0]["detail"] and "finance" not in moves[0]["detail"]


# ---------------------------------------------------------------------- C20


async def test_c20_a_language_is_the_persons_own_and_survives_a_new_login(desk: Desk) -> None:
    o = desk.o
    async with o.client() as boss, o.client("203.0.113.9") as kim:
        hb = await o.login(boss, "boss", Role.OWNER)
        hk = await o.login(kim, "kim", Role.STAFF)
        tid = (await kim.post("/api/threads", json={"title": "주간 보고"}, headers=hk)).json()[
            "thread_id"
        ]
        rid = (await kim.post(f"/api/threads/{tid}/runs", json={"input": "이번 주 매출 정리해줘"},
                              headers=hk)).json()["run_id"]  # fmt: skip
        assert (await o.manager.wait(rid, timeout=10))["status"] == RunStatus.SUCCESS
        said = (await kim.get(f"/api/threads/{tid}/state")).json()["values"]["messages"]
        assert "이번 주 매출 정리해줘" in json.dumps(said, ensure_ascii=False)
        boss_before = (await boss.get("/api/me")).json()
        assert (await kim.patch("/api/me", json={"locale": "en"}, headers=hk)).json()[
            "locale"
        ] == "en"
        assert (await kim.post("/api/auth/logout", headers=hk)).status_code == 200
        assert (await kim.get("/api/me")).status_code == 401
    async with o.client("203.0.113.9") as again:
        await o.login_existing(again, "kim")
        me = (await again.get("/api/me")).json()
        assert (me["locale"], me["user"]["locale"]) == ("en", "en")
        # the conversation is what was said, in the language it was said
        assert (await again.get(f"/api/threads/{tid}/state")).json()["values"]["messages"] == said
        assert (await again.get("/api/threads")).json()[0]["title"] == "주간 보고"
    async with o.client() as boss2:
        await o.login_existing(boss2, "boss")
        boss_after = (await boss2.get("/api/me")).json()
        assert (boss_after["locale"], boss_after["user"]["locale"]) == (
            boss_before["locale"],
            boss_before["user"]["locale"],
        ) == ("ko", "ko")  # fmt: skip
        assert "org_locale" not in boss_after  # no customer default (2026-11-11)
    assert hb


# ---------------------------------------------------------------------- C11


async def test_c11_a_restarted_web_keeps_sessions_until_they_expire(desk: Desk) -> None:
    o = desk.o
    async with o.client() as boss, o.client("203.0.113.9") as kim:
        hb = await o.login(boss, "boss", Role.OWNER)
        await o.login(kim, "kim", Role.STAFF)
        tid = (await boss.post("/api/threads", json={"title": "출시 준비"}, headers=hb)).json()[
            "thread_id"
        ]
        kept = {c: dict(cl.cookies) for c, cl in (("boss", boss), ("kim", kim))}
    # the web server restarts: new stores over the same files, a new app
    core_db = o.accounts.path
    accounts = AccountStore(core_db)
    org = OrgStore(o.web.org.path, "tesla")
    o.accounts = o.web.accounts = accounts
    o.web.org = org
    o.web.rebuild(accounts=accounts, orgs={"tesla": org})
    o.app = o.web.app
    # kim's session has run out by now; boss's has not
    with sqlite3.connect(core_db) as db:
        db.execute(
            "UPDATE sessions SET expires = ? WHERE user_id = ?", (time.time() - 1, desk.uid("kim"))
        )
    async with o.client() as boss2, o.client("203.0.113.9") as kim2:
        boss2.cookies.update(kept["boss"])
        kim2.cookies.update(kept["kim"])
        me = await boss2.get("/api/me")
        assert me.status_code == 200 and me.json()["user"]["username"] == "boss"
        assert [t["id"] for t in (await boss2.get("/api/threads")).json()] == [tid]
        r = await kim2.get("/api/me")
        assert r.status_code == 401 and r.json()["code"] == "unauthorized"
        assert (await kim2.get("/api/threads")).status_code == 401
        # the old csrf still pairs with the old session
        csrf = me.json()["csrf"]
        made = await boss2.post("/api/threads", json={"title": "다음"}, headers={CSRF_HEADER: csrf})
        assert made.status_code == 201
    assert SESSION_COOKIE in kept["boss"]


# ---------------------------------------------------------------------- C22


async def test_c22_an_xlsx_ledger_through_the_api(desk: Desk) -> None:
    o = desk.o
    buf = io.BytesIO()
    pd.DataFrame(
        {
            "날짜": ["2026-10-01", "2026-10-03", "2026-11-02", "2026-11-05"],
            "구분": ["매출", "비용", "매출", "비용"],
            "계정": ["상품매출", "배송비", "상품매출", "광고비"],
            "금액": [1_200_000, 150_000, 800_000, 300_000],
        }
    ).to_excel(buf, index=False)
    async with o.client() as boss:
        hb = await o.login(boss, "boss", Role.OWNER)
        up = await boss.post("/api/uploads", params={"filename": "10-11월 원장.xlsx"},
                             content=buf.getvalue(), headers=hb)  # fmt: skip
        assert up.status_code == 201, up.text
        assert up.json()["filename"] == "10-11월 원장.xlsx"
        assert up.json()["size"] == len(buf.getvalue())
        run = await boss.post("/api/workflows/monthly-pnl/run",
                              json={"inputs": {"ledger": up.json()["id"]}}, headers=hb)  # fmt: skip
        assert run.status_code == 201, run.text
        assert (await desk.wf.manager.wait(run.json()["run_id"], timeout=10))[
            "status"
        ] == RunStatus.INTERRUPTED  # at the review step
        [art] = (await boss.get("/api/artifacts", params={"kind": "finance.pnl"})).json()
        d = art["data"]
        assert (d["revenue"], d["expenses"], d["net_income"], d["currency"]) == (
            2_000_000, 450_000, 1_550_000, "KRW",
        )  # fmt: skip
        assert d["by_month"] == [
            {"month": "2026-10", "revenue": 1_200_000, "expenses": 150_000, "net": 1_050_000},
            {"month": "2026-11", "revenue": 800_000, "expenses": 300_000, "net": 500_000},
        ]
        assert d["needs_review"] == [] and d["rows"] == 4
        assert art["workflow"] == "monthly-pnl" and art["title"] == "손익표"


# ---------------------------------------------------------------------- C26


async def test_c26_people_never_reach_the_solution_repo(desk: Desk) -> None:
    o = desk.o
    repo = o.company.ctx.solution_root

    def files() -> dict[Path, bytes]:
        return {p: p.read_bytes() for p in repo.rglob("*") if p.is_file()}

    async with o.client() as boss:
        hb = await o.login(boss, "boss", Role.OWNER)
        made = await boss.post(
            "/api/users",
            json={"username": "minji", "display": "한민지", "password": "correct horse battery",
                  "role": "staff", "assignments": [{"org": "tesla", "workspace": None,
                                                    "role": "staff"}]},
            headers=hb,
        )  # fmt: skip
        assert made.status_code == 201, made.text
        uid = made.json()["id"]
        for change in (
            {"title": "재무팀장", "teams": ["finance"]},
            {"title": "마케팅 리드", "teams": ["marketing", "product"]},
        ):
            r = await boss.patch(f"/api/people/{uid}", json=change, headers=hb)
            assert r.status_code == 200, r.text
        chart = (await boss.get("/api/org-chart")).json()
        product = next(t for t in chart["teams"] if t["name"] == "product")
        assert {"id": uid, "display": "한민지", "title": "마케팅 리드", "role": "staff"} in product[
            "people"
        ]
    words = ["한민지", "minji", "재무팀장", "마케팅 리드"]
    leaks = {
        str(p.relative_to(repo)): w
        for p, raw in files().items()
        for w in words
        if w.encode() in raw
    }
    assert leaks == {}
    # where they do live: the org's records and the customer's accounts, outside the repo
    for db in (o.accounts.path, o.web.org.path):
        assert repo not in db.resolve().parents
