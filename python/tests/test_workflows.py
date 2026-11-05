"""v2.1.0 workflows — definitions, the P&L tool, the step graph, approvals, API.

PRD v2.1.0: W10 · W11 · W14 · I12 · I13 · I26 · I27 · C16 (workflow run) · C22 (Excel → P&L).
"""

from __future__ import annotations

import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
from company_fixtures import Company
from test_ops_api import Office as OpsOffice

from solosquad.artifacts import ArtifactStore
from solosquad.check import validate_solution
from solosquad.company import build_company
from solosquad.runtime import RunManager, RunStatus
from solosquad.runtime.store import RunStore
from solosquad.web_api.accounts import Role
from solosquad.web_api.app import WebConfig, create_app
from solosquad.workflows import WorkflowDef, render
from solosquad.workflows.engine import WorkflowEngine, company_asker
from solosquad.workflows.tools import finance_pnl

TEMPLATE = (
    Path(__file__).resolve().parents[1] / "src/solosquad/workflows/templates/monthly-pnl.yaml"
)
LEDGER_CSV = (
    "날짜,구분,계정,금액\n"
    '2026-10-01,매출,상품매출,"1,200,000"\n'
    "2026-10-03,비용,배송비,150000\n"
    "2026-10-09,비용,광고비,300000\n"
    "2026-11-02,매출,상품매출,800000\n"
    "2026-11-05,지출,배송비,100000\n"
    "2026-11-06,비용,포장재,abc\n"
    "2026-11-07,환불,상품매출,50000\n"
)


# ---------------------------------------------------------------------- the P&L tool


def test_pnl_from_a_korean_ledger(tmp_path: Path) -> None:
    f = tmp_path / "ledger.csv"
    f.write_text(LEDGER_CSV, encoding="utf-8")
    out = finance_pnl(str(f))
    assert out["revenue"] == 2_000_000 and out["expenses"] == 550_000
    assert out["net_income"] == 1_450_000 and out["currency"] == "KRW"
    assert out["by_month"] == [
        {"month": "2026-10", "revenue": 1_200_000, "expenses": 450_000, "net": 750_000},
        {"month": "2026-11", "revenue": 800_000, "expenses": 100_000, "net": 700_000},
    ]
    # unreadable rows are reported with the row a person sees, never guessed
    assert [(r["row"], r["reason"]) for r in out["needs_review"]] == [
        (7, "금액을 읽을 수 없음"),
        (8, "구분을 알 수 없음"),
    ]
    assert out["period"] == "2026-10-01 ~ 2026-11-05"
    assert "순이익 1,450,000" in out["summary"] and "확인 필요 2행" in out["summary"]


def test_pnl_from_xlsx_with_signed_amounts(tmp_path: Path) -> None:
    f = tmp_path / "ledger.xlsx"
    pd.DataFrame(
        {"Date": ["2026-10-01", "2026-10-02"], "Account": ["Sales", "Rent"], "Amount": [500, -200]}
    ).to_excel(f, index=False)
    out = finance_pnl(str(f), currency="USD")
    assert (out["revenue"], out["expenses"], out["net_income"]) == (500, 200, 300)
    assert out["needs_review"] == []


def test_pnl_rejects_a_sheet_without_the_columns(tmp_path: Path) -> None:
    f = tmp_path / "x.csv"
    f.write_text("a,b\n1,2\n", encoding="utf-8")
    with pytest.raises(ValueError, match="계정"):
        finance_pnl(str(f))


# ---------------------------------------------------------------------- definitions


def test_definition_rules() -> None:
    ok = {"name": "w", "steps": [{"id": "a", "tool": "finance.pnl"}]}
    assert WorkflowDef.model_validate(ok).steps[0].type == "tool"
    for bad in (
        {"name": "w", "steps": []},
        {"name": "w", "steps": [{"id": "a", "tool": "x", "agent": "chief", "prompt": "p"}]},
        {"name": "w", "steps": [{"id": "a", "agent": "chief"}]},
        {"name": "w", "steps": [{"id": "a", "tool": "x"}, {"id": "a", "tool": "y"}]},
    ):
        with pytest.raises(ValueError):
            WorkflowDef.model_validate(bad)
    scope = {"inputs": {"n": 3}, "steps": {"c": {"net": 1450.5}}}
    assert render("{{ inputs.n }}", scope) == 3  # a lone placeholder keeps its type
    assert render("net {{ steps.c.net }} KRW", scope) == "net 1450.5 KRW"
    with pytest.raises(KeyError):
        render("{{ steps.nope.x }}", scope)


# ---------------------------------------------------------------------- engine end to end


class Engines:
    def __init__(self, tmp: Path) -> None:
        self.c = Company(tmp)
        (self.c.ctx.org_root / "workflows").mkdir(parents=True, exist_ok=True)
        shutil.copy(TEMPLATE, self.c.ctx.org_root / "workflows" / "monthly-pnl.yaml")
        self.company = RunManager(
            build_company(self.c.rt), RunStore(self.c.ctx.data_dir / "runs.sqlite")
        )
        self.artifacts = ArtifactStore(self.c.ctx.data_dir / "artifacts.sqlite")
        self.wf = self.new_engine()

    def new_engine(self) -> WorkflowEngine:
        return WorkflowEngine(
            self.c.ctx.org_root, self.c.ctx.data_dir, self.artifacts, company_asker(self.company)
        )

    def upload(self) -> str:
        return str(self.wf.save_upload("10월 원장.csv", LEDGER_CSV.encode())["id"])


@pytest.fixture
async def engines(tmp_path: Path) -> AsyncIterator[Engines]:
    e = Engines(tmp_path)
    await e.company.start()
    await e.wf.start()
    yield e
    await e.wf.stop()
    await e.company.stop()


async def _status(e: WorkflowEngine, rid: str, want: str) -> dict[str, Any]:
    run = await e.manager.wait(rid, timeout=10)
    assert run["status"] == want, run
    return run


async def test_monthly_pnl_runs_end_to_end(engines: Engines) -> None:
    wf = engines.wf
    tid, rid = await wf.run_now("monthly-pnl", {"ledger": engines.upload()})
    run = await _status(wf, rid, RunStatus.INTERRUPTED)
    card = run["interrupts"][0]["value"]
    assert (card["kind"], card["workflow"], card["step"], card["risk"]) == (
        "approval", "monthly-pnl", "review", "low"
    )  # fmt: skip
    assert card["title"] == "손익표 확인" and "순이익 1,450,000" in card["summary"]
    [pnl] = engines.artifacts.find(kind="finance.pnl")
    assert pnl.needs_review is True and pnl.workflow == "monthly-pnl" and pnl.thread_id == tid
    assert pnl.data["net_income"] == 1_450_000
    # approve → the agent step runs on the company and its answer becomes a brief
    rid2 = await wf.manager.resume(tid, "approved")
    await _status(wf, rid2, RunStatus.SUCCESS)
    [brief] = engines.artifacts.find(kind="brief")
    assert brief.data == {"text": "chief done", "agent": "chief"}
    state = (await wf.manager.thread_state(tid))["values"]
    assert state["status"] == "done" and state["artifacts"] == [pnl.id, brief.id]
    company_threads = [t["id"] for t in engines.company.store.threads(50)]
    assert f"{tid}-agent" in company_threads  # visible as an ordinary company thread


async def test_declining_stops_before_the_agent_step(engines: Engines) -> None:
    wf = engines.wf
    tid, rid = await wf.run_now("monthly-pnl", {"ledger": engines.upload()})
    await _status(wf, rid, RunStatus.INTERRUPTED)
    rid2 = await wf.manager.resume(tid, "declined")
    await _status(wf, rid2, RunStatus.SUCCESS)
    state = (await wf.manager.thread_state(tid))["values"]
    assert state["status"] == "declined" and engines.artifacts.find(kind="brief") == []


async def test_a_waiting_approval_survives_a_restart(engines: Engines) -> None:
    tid, rid = await engines.wf.run_now("monthly-pnl", {"ledger": engines.upload()})
    await _status(engines.wf, rid, RunStatus.INTERRUPTED)
    await engines.wf.stop()
    engines.wf = engines.new_engine()  # a fresh process reading the same data folder
    await engines.wf.start()
    rid2 = await engines.wf.manager.resume(tid, "approved")
    await _status(engines.wf, rid2, RunStatus.SUCCESS)
    assert len(engines.artifacts.find(kind="finance.pnl")) == 1  # the tool step did not re-run


async def test_uploads_keep_a_korean_file_name(engines: Engines) -> None:
    """Windows' default code page cannot write Hangul — every text write names UTF-8."""
    meta = engines.wf.save_upload("10월 거래 원장.csv", LEDGER_CSV.encode())
    assert engines.wf.uploads_list()[0]["filename"] == "10월 거래 원장.csv"
    assert engines.wf.upload_path(meta["id"]).read_bytes() == LEDGER_CSV.encode()


async def test_inputs_and_uploads_are_checked(engines: Engines) -> None:
    with pytest.raises(ValueError, match="ledger"):
        await engines.wf.run_now("monthly-pnl", {})
    with pytest.raises(ValueError):
        await engines.wf.run_now("monthly-pnl", {"ledger": "../../etc/passwd"})
    with pytest.raises(ValueError, match="xlsx"):
        engines.wf.save_upload("evil.sh", b"rm -rf /")
    with pytest.raises(KeyError):
        await engines.wf.run_now("nope", {})


async def test_switching_a_scheduled_workflow(engines: Engines, tmp_path: Path) -> None:
    folder = engines.c.ctx.org_root / "workflows"
    (folder / "morning.yaml").write_text(
        "name: morning\nschedule: '30 8 * * *'\nsteps:\n"
        "  - {id: brief, agent: chief, prompt: '오늘 할 일 정리', save_as: {kind: brief}}\n",
        encoding="utf-8",
    )
    wf = engines.new_engine()
    await wf.start()
    try:
        assert wf.manager._scheduler is not None and wf.manager._scheduler.get_job("wf:morning")
        wf.set_enabled("morning", False)
        assert wf.manager._scheduler.get_job("wf:morning") is None
        assert not wf.enabled("morning")
        wf.set_enabled("morning", True)
        assert wf.manager._scheduler.get_job("wf:morning") is not None
        # the scheduled payload runs like "run now"
        rid = await wf.manager.fire_cron(wf._cron("morning"))  # type: ignore[arg-type]
        await _status(wf, rid, RunStatus.SUCCESS)
        assert engines.artifacts.find(kind="brief")[0].data["text"] == "chief done"
    finally:
        await wf.stop()


# ---------------------------------------------------------------------- API


async def test_workflow_api_roles_and_review(tmp_path: Path) -> None:
    office = OpsOffice(tmp_path)
    c = office.company
    (c.ctx.org_root / "workflows").mkdir(parents=True, exist_ok=True)
    shutil.copy(TEMPLATE, c.ctx.org_root / "workflows" / "monthly-pnl.yaml")
    artifacts = ArtifactStore(c.ctx.data_dir / "artifacts.sqlite")
    wf = WorkflowEngine(c.ctx.org_root, c.ctx.data_dir, artifacts, company_asker(office.manager))
    office.app = create_app(
        WebConfig(office.manager, c.ledger, "tok", office.accounts, office.workspace,
                  workflows=wf, artifacts=artifacts)
    )  # fmt: skip
    await office.manager.start()
    await wf.start()
    try:
        async with office.client() as boss, office.client("203.0.113.9") as kim:
            hb = await office.login(boss, "boss", Role.OWNER)
            hk = await office.login(kim, "kim", Role.STAFF)
            listed = (await kim.get("/api/workflows")).json()
            assert listed["errors"] == [] and listed["workflows"][0]["name"] == "monthly-pnl"
            assert [s["type"] for s in listed["workflows"][0]["steps"]] == [
                "tool",
                "approval",
                "agent",
            ]
            up = await kim.post("/api/uploads", params={"filename": "원장.csv"},
                                content=LEDGER_CSV.encode(), headers=hk)  # fmt: skip
            assert up.status_code == 201, up.text
            bad = await kim.post(
                "/api/uploads", params={"filename": "x.exe"}, content=b"MZ", headers=hk
            )
            assert bad.status_code == 400
            run = await kim.post("/api/workflows/monthly-pnl/run",
                                 json={"inputs": {"ledger": up.json()["id"]}}, headers=hk)  # fmt: skip
            assert run.status_code == 201
            tid, rid = run.json()["thread_id"], run.json()["run_id"]
            await _status(wf, rid, RunStatus.INTERRUPTED)
            # staff runs workflows but does not approve (owner-only default, I25)
            denied = await kim.post(
                f"/api/workflow-threads/{tid}/resume", json={"value": "approved"}, headers=hk
            )
            assert denied.status_code == 403
            assert (
                await kim.patch("/api/workflows/monthly-pnl", json={"enabled": False}, headers=hk)
            ).status_code == 403
            ok = await boss.post(
                f"/api/workflow-threads/{tid}/resume", json={"value": "approved"}, headers=hb
            )
            await _status(wf, ok.json()["run_id"], RunStatus.SUCCESS)
            assert (await boss.get("/api/approvals")).json() == []  # answered → off the list
            arts = (await kim.get("/api/artifacts", params={"needs_review": "true"})).json()
            assert [a["kind"] for a in arts] == ["finance.pnl"]
            reviewed = await kim.post(f"/api/artifacts/{arts[0]['id']}/review", headers=hk)
            assert (
                reviewed.json()["needs_review"] is False and reviewed.json()["reviewed_by"] == "kim"
            )
            assert (await boss.get(f"/api/workflow-threads/{tid}/state")).json()["values"][
                "status"
            ] == "done"
    finally:
        await wf.stop()
        await office.manager.stop()


def test_validate_catches_broken_workflows(tmp_path: Path, repo_root: Path) -> None:
    c = Company(tmp_path)
    folder = c.ctx.org_root / "workflows"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "bad.yaml").write_text(
        "name: bad\nschedule: '99 * * * *'\ninputs: [{name: f, type: upload}]\nsteps:\n"
        "  - {id: a, tool: nope}\n  - {id: b, agent: ghost, prompt: hi, save_as: {kind: nope}}\n",
        encoding="utf-8",
    )
    (folder / "renamed.yaml").write_text("name: other\nsteps: [{id: a, tool: finance.pnl}]\n")
    codes = {
        i.code for r in validate_solution(c.ctx.solution_root, repo_root).values() for i in r.issues
    }
    assert {
        "WORKFLOW_INVALID",
        "WORKFLOW_SCHEDULE_INVALID",
        "WORKFLOW_SCHEDULE_NEEDS_UPLOAD",
        "WORKFLOW_TOOL_UNKNOWN",
        "WORKFLOW_KIND_UNKNOWN",
        "WORKFLOW_AGENT_UNKNOWN",
    } <= codes
