from __future__ import annotations

from pathlib import Path

import pytest

from solosquad.context import (
    Candidate,
    Ledger,
    LedgerEntry,
    PromptAssembler,
    Resolver,
    build_context,
    estimate_tokens,
    render_transcript,
)
from solosquad.context.execution import ExecutionContext
from solosquad.layout import scaffold_org, scaffold_solution, scaffold_workspace
from solosquad.messages import assistant, user

SKILL = "---\nname: {name}\ndescription: {desc}\n{extra}---\n{body}\n"


def write_skill(root: Path, name: str, desc: str, extra: str = "", body: str = "body") -> None:
    (root / name).mkdir(parents=True, exist_ok=True)
    (root / name / "SKILL.md").write_text(
        SKILL.format(name=name, desc=desc, extra=extra, body=body), encoding="utf-8"
    )


@pytest.fixture
def ctx(tmp_path: Path, repo_root: Path) -> ExecutionContext:
    sol = scaffold_solution(tmp_path / "elon", "2.0.0", repo_root / "user")
    org = scaffold_org(sol, "tesla", "bundled", "2.0.0")
    scaffold_workspace(org, "hq")
    return build_context(sol.root, "tesla", "hq", repo_root)


def test_context_paths(ctx: ExecutionContext, isolated_home: Path) -> None:
    assert ctx.org_root.name == "tesla"
    assert ctx.data_dir.is_relative_to(isolated_home)
    assert ctx.engine_version == "2.0.0"
    assert (ctx.solution.owner_dir / "profile.md").is_file(), "owner seeded from bundle user/"


def test_resolve_order_workspace_then_org_then_package(ctx: ExecutionContext) -> None:
    r = Resolver(ctx)
    assert r.agent("chief").layer == "package"
    write_skill(
        ctx.org_root / "team" / "agents", "chief", "tesla chief", "derived_from: chief@2.0.0\n"
    )
    assert r.agent("chief").layer == "org"
    assert r.agent("chief").derived_from == "chief@2.0.0"
    write_skill(ctx.workspace_root / "overrides" / "agents", "chief", "busan chief")
    assert r.agent("chief").spec.description == "busan chief"
    assert [o.name for o in r.unattributed_overrides()] == ["chief"]
    write_skill(ctx.org_root / "team" / "agents", "tesla-only", "org-specific agent")
    assert "tesla-only" in r.available("agents") and "chief" in r.available("agents")
    with pytest.raises(KeyError):
        r.agent("nobody")


def test_teams_and_knowledge(ctx: ExecutionContext) -> None:
    r = Resolver(ctx)
    assert r.team_of("chief") == "core"
    assert r.team("product") is not None
    assert r.team_knowledge("product")
    (ctx.org_root / "knowledge" / "market.md").write_text("EV market notes", encoding="utf-8")
    assert "EV market" in r.org_knowledge()
    assert r.owner_knowledge()


def test_prompt_budget_drops_lowest_priority_never_identity() -> None:
    a = PromptAssembler(budget_tokens=60)
    layers, report = a.assemble(
        [
            Candidate("owner", "o" * 90, priority=3),
            Candidate("org knowledge", "k" * 300, priority=1),
            Candidate("agent", "a" * 90, priority=9, droppable=False),
        ]
    )
    assert [layer.name for layer in layers] == ["owner", "agent"]
    assert report.dropped == ["org knowledge"]
    tiny = PromptAssembler(budget_tokens=1).assemble(
        [Candidate("agent", "x" * 300, 9, droppable=False)]
    )
    assert [layer.name for layer in tiny[0]] == ["agent"]


def test_report_dump(tmp_path: Path) -> None:
    layers, report = PromptAssembler(1000).assemble([Candidate("agent", "hello", 9, False)])
    report.dump(tmp_path / "dump.json", layers)
    assert '"agent"' in (tmp_path / "dump.json").read_text()


def test_transcript_full_then_digest() -> None:
    msgs = [user("hi"), assistant("hello", name="chief")]
    text, digested = render_transcript(msgs, window_tokens=10_000)
    assert text == "[user] hi\n\n[chief] hello" and not digested
    long = [user(f"turn {i} " + "x" * 300) for i in range(30)]
    text, digested = render_transcript(long, window_tokens=1_000)
    assert digested and "(earlier conversation, condensed)" in text
    assert estimate_tokens(text) < estimate_tokens("\n\n".join(m.text for m in long))
    assert "turn 29" in text


def test_ledger(tmp_path: Path) -> None:
    led = Ledger(tmp_path / "l.sqlite")
    for agent, cost in (("chief", 0.1), ("chief", 0.2), ("pm", 0.5)):
        led.record(
            LedgerEntry(
                "t1",
                "tesla",
                "hq",
                agent,
                "claude-max",
                "claude-code",
                "sonnet",
                10,
                5,
                cost_usd=cost,
            )
        )
    assert led.spend(connection_id="claude-max") == pytest.approx(0.8)
    assert led.spend(agent="pm") == pytest.approx(0.5)
    by_agent = led.totals("agent")
    assert by_agent["chief"]["calls"] == 2 and by_agent["chief"]["tokens"] == 30
    assert len(led.entries(thread_id="t1")) == 3
    with pytest.raises(ValueError):
        led.totals("nope")
