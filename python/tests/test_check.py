"""`validate` / `doctor` / `cron list|run` — broken wiring is reported before a run."""

from __future__ import annotations

from pathlib import Path

from test_surface import openai_server  # noqa: F401 — fixture re-export
from typer.testing import CliRunner

from solosquad.check import doctor_checks, validate_solution
from solosquad.cli import app

run = CliRunner().invoke


def _init(tmp_path: Path) -> Path:
    sol = tmp_path / "moa"
    assert run(app, ["init", str(sol), "--org", "moa-living"]).exit_code == 0
    return sol


def _org(sol: Path) -> Path:
    return sol / "orgs" / "moa-living"


def _codes(sol: Path, repo_root: Path) -> set[str]:
    return {i.code for r in validate_solution(sol, repo_root).values() for i in r.issues}


def test_fresh_solution_has_no_errors(tmp_path: Path, repo_root: Path) -> None:
    sol = _init(tmp_path)
    reports = validate_solution(sol, repo_root)
    assert set(reports) == {"moa-living/hq", ""}
    assert all(r.ok for r in reports.values())
    assert [i.code for i in reports[""].issues] == ["PROFILE_INCOMPLETE"]  # a warning
    res = run(app, ["validate", "-s", str(sol)])
    assert res.exit_code == 0, res.output


def test_broken_wiring_is_reported(tmp_path: Path, repo_root: Path) -> None:
    sol = _init(tmp_path)
    agents = _org(sol) / "team" / "agents"
    (agents / "broken").mkdir(parents=True)
    (agents / "broken" / "SKILL.md").write_text("---\nname: [unclosed\n---\n", encoding="utf-8")
    (agents / "buyer").mkdir()
    (agents / "buyer" / "SKILL.md").write_text(
        "---\nname: buyer\nschema_version: 1\ndescription: Buys stock. 사용 시점 — 발주할 때\n"
        "handoffs: [chief, ghost]\n---\nbody\n",
        encoding="utf-8",
    )
    chief = (repo_root / "agents" / "main" / "chief" / "SKILL.md").read_text(encoding="utf-8")
    (agents / "chief").mkdir()
    (agents / "chief" / "SKILL.md").write_text(chief, encoding="utf-8")  # no derived_from
    crons = _org(sol) / "crons"
    (crons / "nightly.md").write_text("---\nschedule: 99 * * * *\n---\ngo\n", encoding="utf-8")
    (crons / "notes.md").write_text("just notes\n", encoding="utf-8")
    (_org(sol) / "policy.yaml").write_text(
        "agents:\n  nobody: {models: [x]}\ndefault: {connections: [missing]}\n", encoding="utf-8"
    )
    codes = _codes(sol, repo_root)
    assert {
        "PARSE_ERROR",
        "HANDOFF_UNKNOWN",
        "OVERRIDE_NOT_ATTRIBUTED",
        "CRON_SCHEDULE_INVALID",
        "CRON_NO_SCHEDULE",
        "POLICY_UNKNOWN_AGENT",
        "POLICY_UNKNOWN_CONNECTION",
    } <= codes
    res = run(app, ["validate", "-s", str(sol)])
    assert res.exit_code == 1 and "HANDOFF_UNKNOWN" in res.output


def test_customer_layers_get_the_strict_name_gate(tmp_path: Path, repo_root: Path) -> None:
    sol = _init(tmp_path)
    skill = _org(sol) / "team" / "skills" / "Claude_Notes"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: Claude_Notes\nschema_version: 1\ndescription: Notes. use when noting\n---\nb\n",
        encoding="utf-8",
    )
    assert {"NAME_MALFORMED", "NAME_RESERVED_WORD"} <= _codes(sol, repo_root)


def test_missing_entry_agent(tmp_path: Path) -> None:
    sol = _init(tmp_path)
    empty_bundle = tmp_path / "bundle"
    (empty_bundle / "agents" / "main").mkdir(parents=True)
    (empty_bundle / "teams").mkdir()
    assert "ENTRY_MISSING" in _codes(sol, empty_bundle)


def test_layout_errors(tmp_path: Path, repo_root: Path) -> None:
    assert "LAYOUT" in _codes(tmp_path / "nothing", repo_root)


def test_doctor(tmp_path: Path, repo_root: Path) -> None:
    sol = _init(tmp_path)
    checks = {c.name: c for c in doctor_checks(sol, repo_root)}
    assert checks["python"].status == "ok"
    assert checks["definitions"].status == "warn"  # the empty customer profile
    assert checks["profile"].status == "warn"
    assert checks["connections"].status == "warn"
    assert checks["data:moa-living/hq"].status == "ok"
    assert doctor_checks(sol, None)[-1].status == "fail"
    res = run(app, ["doctor", "-s", str(sol)])
    assert res.exit_code == 0, res.output


def test_cron_list_and_run(tmp_path: Path, openai_server: str) -> None:  # noqa: F811
    sol = _init(tmp_path)
    (_org(sol) / "crons" / "brief.md").write_text(
        "---\nschedule: 30 9 * * *\n---\nmorning brief please\n", encoding="utf-8"
    )
    listed = run(app, ["cron", "list", "-s", str(sol)])
    assert listed.exit_code == 0 and "30 9 * * *" in listed.output, listed.output
    res = run(
        app,
        [
            "connections", "add", "router", "--kind", "api_key", "--harness", "lite",
            "--provider", "openrouter", "--models", "gpt-5", "--base-url", openai_server,
            "--secret-env", "OPENROUTER_API_KEY", "-s", str(sol),
        ],
    )  # fmt: skip
    assert res.exit_code == 0, res.output
    run(app, ["connections", "set-secret", "router", "-s", str(sol)], input="sk-test\n")
    res = run(app, ["cron", "run", "brief", "-s", str(sol)])
    assert res.exit_code == 0, res.output
    assert "chief heard" in res.output and "morning brief please" in res.output
    assert "cron:" not in run(app, ["cron", "run", "nope", "-s", str(sol)]).output
    assert run(app, ["cron", "run", "nope", "-s", str(sol)]).exit_code == 1


def test_customer_profile_at_setup(tmp_path: Path, repo_root: Path) -> None:
    """Decision 50: region, entities, languages, privacy are per customer, set at init."""
    sol = tmp_path / "moa"
    res = run(
        app,
        [
            "init", str(sol), "--org", "moa", "--server-country", "kr", "--cloud", "aws",
            "--region", "ap-northeast-2", "--cloud-access", "FDE IAM role",
            "--entity", "moa-kr=Moa Korea Co.:KR", "--entity", "moa-qd=Moa Qingdao 3PL:CN",
            "--language", "ko", "--privacy-regime", "PIPA", "--privacy-regime", "PIPL",
            "--privacy-reviewer", "고객 법무팀",
        ],
    )  # fmt: skip
    assert res.exit_code == 0, res.output
    from solosquad.layout import Solution
    from solosquad.profile import load_profile

    profile = load_profile(sol)
    assert all(i["done"] for i in profile.checklist())
    assert Solution(sol).org("moa").workspace("hq").config().server_country == "KR"
    codes = {i.code for r in validate_solution(sol, repo_root).values() for i in r.issues}
    assert "PROFILE_INCOMPLETE" not in codes
    # an account held by the Korean entity may reach Anthropic; one held from China may not
    base = ["connections", "add", "--kind", "api_key", "--harness", "lite", "--provider",
            "anthropic", "--models", "claude-sonnet", "-s", str(sol)]  # fmt: skip
    ok = run(app, [*base[:2], "claude-kr", *base[2:], "--entity", "moa-kr"])
    assert ok.exit_code == 0, ok.output
    bad = run(app, [*base[:2], "claude-qd", *base[2:], "--entity", "moa-qd"])
    assert bad.exit_code == 1 and "anthropic" in bad.output
    assert run(app, [*base[:2], "x", *base[2:], "--entity", "nope"]).exit_code == 1
    # Chinese models for the Chinese entity are fine
    qwen = run(app, ["connections", "add", "qwen", "--kind", "api_key", "--harness", "lite",
                     "--provider", "dashscope", "--models", "qwen3", "--entity", "moa-qd", "-s", str(sol)])  # fmt: skip
    assert qwen.exit_code == 0, qwen.output
    # moving the server to Hong Kong is applied to every office and blocks the Claude key
    assert run(app, ["profile", "set", "--server-country", "HK", "-s", str(sol)]).exit_code == 0
    assert Solution(sol).org("moa").workspace("hq").config().server_country == "HK"
    codes = {i.code for r in validate_solution(sol, repo_root).values() for i in r.issues}
    assert "CONNECTION_INELIGIBLE" in codes
    assert run(app, ["add", "workspace", "branch", "--org", "moa", "-s", str(sol)]).exit_code == 0
    assert Solution(sol).org("moa").workspace("branch").config().server_country == "HK"
    assert (
        run(app, ["init", str(tmp_path / "bad"), "--org", "x", "--entity", "nonsense"]).exit_code
        == 1
    )
