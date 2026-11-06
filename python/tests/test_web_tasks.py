"""2026-11-07 menu restructure — the dashboard screen, Task's agent work and the schedule list.

The sidebar became 대시보드 · 사무실 · 메일 · Task · 워크플로: home → dashboard (the screen
name, with `home` kept as an alias), approvals + artifacts + agent work → Task (`GET …/work`),
the scheduler → a schedule view inside workflows (`GET …/schedules`).
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import pytest
from company_fixtures import reply
from test_ops_api import Office as OpsOffice
from test_workflows import LEDGER_CSV, TEMPLATE

from solosquad.artifacts import ArtifactStore
from solosquad.runtime import RunStatus
from solosquad.runtime.manager import load_crons
from solosquad.screens import DEFAULTS, load_screen
from solosquad.web_api.accounts import Role
from solosquad.workflows.engine import WorkflowEngine, company_asker

MORNING = (
    "name: morning\ntitle: 아침 브리핑\nschedule: '0 9 * * 1'\nsteps:\n"
    "  - {id: brief, agent: chief, prompt: '오늘 할 일 정리', save_as: {kind: brief}}\n"
)


class Office(OpsOffice):
    """The ops office with workflows, artifacts and two crons (a standing goal, a routine)."""

    def __init__(self, tmp: Path) -> None:
        super().__init__(tmp)
        root = self.company.ctx.org_root
        (root / "workflows").mkdir(parents=True, exist_ok=True)
        shutil.copy(TEMPLATE, root / "workflows" / "monthly-pnl.yaml")  # needs an upload
        (root / "workflows" / "morning.yaml").write_text(MORNING, encoding="utf-8")
        (root / "crons").mkdir(parents=True, exist_ok=True)
        (root / "crons" / "sales.md").write_text(
            "---\nschedule: '30 8 * * 1-5'\nthread: goal-sales\n---\n매출 목표 확인\n",
            encoding="utf-8",
        )
        (root / "crons" / "close.md").write_text(
            "---\nschedule: '0 18 1 * *'\nenabled: false\n---\n마감 확인\n", encoding="utf-8"
        )
        self.artifacts = ArtifactStore(self.company.ctx.data_dir / "artifacts.sqlite")
        self.wf = WorkflowEngine(
            root, self.company.ctx.data_dir, self.artifacts, company_asker(self.manager)
        )
        view = self.web.config.runtimes[("tesla", "hq")]
        view.workflows, view.artifacts = self.wf, self.artifacts
        self.web.rebuild()
        self.app = self.web.app


@pytest.fixture
async def office(tmp_path: Path) -> Any:
    o = Office(tmp_path)
    o.company.scripts["max"] = lambda req: reply("done")
    await o.manager.start()
    await o.wf.start()
    yield o
    await o.wf.stop()
    await o.manager.stop()


# ---------------------------------------------------------------------- the dashboard screen


def test_dashboard_is_the_first_screen_and_home_is_its_alias(tmp_path: Path) -> None:
    assert "home" not in DEFAULTS
    widgets = [w.widget for w in DEFAULTS["dashboard"].widgets]
    assert widgets[0] == "stats" and widgets[-1] == "budget"  # the cost area closes it
    assert load_screen(None, "home").name == "dashboard"
    folder = tmp_path / "screens"
    folder.mkdir()
    (folder / "home.yaml").write_text("format_version: 1\ntitle: 옛 홈\nwidgets: []\n")
    r = load_screen(tmp_path, "dashboard")
    assert r.source == "org" and r.screen is not None and r.screen.title == "옛 홈"
    (folder / "dashboard.yaml").write_text("format_version: 1\ntitle: 새 화면\nwidgets: []\n")
    r = load_screen(tmp_path, "home")
    assert r.screen is not None and r.screen.title == "새 화면"  # its own file wins
    with pytest.raises(ValueError):
        load_screen(tmp_path, "../home")


# ---------------------------------------------------------------------- schedules


async def test_schedules_list_workflows_and_crons(office: Office) -> None:
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        await office.login(kim, "kim", Role.STAFF)
        r = await kim.get("/api/schedules")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["timezone"] == office.manager.timezone and body["errors"] == []
        by_id = {s["id"]: s for s in body["schedules"]}
        # monthly-pnl needs an upload, so it never runs on a schedule — not listed
        assert set(by_id) == {"wf:morning", "cron:sales", "cron:close"}
        assert by_id["wf:morning"]["kind"] == "workflow" and by_id["wf:morning"]["workflow"]
        assert by_id["cron:sales"]["kind"] == "goal" and by_id["cron:sales"]["workflow"] is None
        assert by_id["cron:close"]["kind"] == "routine"
        assert by_id["cron:close"]["enabled"] is False and by_id["cron:close"]["next_run"] is None
        assert (
            by_id["wf:morning"]["next_run"] > 0 and by_id["wf:morning"]["schedule"] == "0 9 * * 1"
        )
        # switched off with the workflow's own switch (owner) → no next run
        off = await boss.patch("/api/workflows/morning", json={"enabled": False}, headers=hb)
        assert off.status_code == 200
        again = {s["id"]: s for s in (await kim.get("/api/schedules")).json()["schedules"]}
        assert again["wf:morning"]["enabled"] is False and again["wf:morning"]["next_run"] is None
        # a cron's last run is the newest run it started
        crons = load_crons(office.company.ctx.org_root / "crons")
        rid = await office.manager.fire_cron(next(c for c in crons if c.name == "sales"))
        await office.manager.wait(rid, 5)
        fired = {s["id"]: s for s in (await kim.get("/api/schedules")).json()["schedules"]}
        assert fired["cron:sales"]["last_run"]["id"] == rid


async def test_staff_cannot_switch_a_schedule(office: Office) -> None:
    async with office.client("203.0.113.9") as kim:
        hk = await office.login(kim, "kim", Role.STAFF)
        r = await kim.patch("/api/workflows/morning", json={"enabled": False}, headers=hk)
        assert r.status_code == 403 and r.json()["code"] == "role_forbidden"


# ---------------------------------------------------------------------- agent work (Task)


async def test_work_lists_chats_and_workflow_runs_once(office: Office) -> None:
    async with office.client() as boss:
        hb = await office.login(boss, "boss", Role.OWNER)
        tid = office.manager.create_thread("발주서 비교")
        rid = await office.manager.submit(tid, "거래처 단가 비교해줘")
        assert (await office.manager.wait(rid, 5))["status"] == RunStatus.SUCCESS
        up = await boss.post("/api/uploads", params={"filename": "원장.csv"},
                             content=LEDGER_CSV.encode(), headers=hb)  # fmt: skip
        run = await boss.post("/api/workflows/monthly-pnl/run",
                              json={"inputs": {"ledger": up.json()["id"]}}, headers=hb)  # fmt: skip
        wtid, wrid = run.json()["thread_id"], run.json()["run_id"]
        assert (await office.wf.manager.wait(wrid, 10))["status"] == RunStatus.INTERRUPTED

        r = await boss.get("/api/work")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert [i["thread_id"] for i in items].count(tid) == 1  # one row per thread
        chat = next(i for i in items if i["thread_id"] == tid)
        assert chat["source"] == "chat" and chat["status"] == "success"
        assert chat["agents"], "the ledger says who worked on it"
        flow = next(i for i in items if i["thread_id"] == wtid)
        assert flow["source"] == "workflow" and flow["workflow"] == "monthly-pnl"
        assert flow["status"] == "interrupted" and flow["steps"] == 3 and flow["step"] == 1
        assert flow["current_step"] == "손익표 확인"
        assert [a["kind"] for a in flow["artifacts"]] == ["finance.pnl"]
        assert flow["artifacts"][0]["needs_review"] is True
        # newest first, and `limit` holds
        assert items == sorted(items, key=lambda i: -i["created"])
        assert len((await boss.get("/api/work", params={"limit": 1})).json()["items"]) == 1
        # the workflow's agent-step thread is folded into the run, not listed as a chat
        assert not any(i["thread_id"].endswith("-agent") for i in items)
