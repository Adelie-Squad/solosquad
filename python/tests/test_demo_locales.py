"""The demo's scripted text follows the visitor's screen language (`demo issue --locale`).

tables     every scripted line (agent replies, Chief's answers, suggested requests, tool
           work products, the copy's people and calendar) exists in ko · en · zh-CN, and
           the en · zh-CN lines carry no Korean
template   `template/locales/<lang>/` mirrors the Korean template file for file: the same
           workflow steps (agents, tools, approvals, branches), the same artifact kinds,
           sample files with the same rows whose columns the tools read
a run      an English account's copy: workflow titles, approval cards, work products,
           agent messages and Chief's chat answers in English
"""

from __future__ import annotations

import csv
import re
import time
from pathlib import Path
from typing import Any

import pytest
import yaml

from solosquad.demo import ORG_WORKSPACE
from solosquad.demo import harness as H
from solosquad.demo import scenario as S
from solosquad.demo import seed as D
from solosquad.demo.i18n import LOCALES, read_locale
from solosquad.demo.seed import TEMPLATE, create_account, demo_builder, init_solution, seed_account
from solosquad.demo.seed import open_stores as stores
from solosquad.engine_server import build_engine, start_engine, stop_engine
from solosquad.harness.claude_code import ClaudeCodeHarness
from solosquad.harness.codex import CodexHarness
from solosquad.harness.lite import LiteHarness
from solosquad.harness.opencode import OpenCodeHarness
from solosquad.layout import solosquad_home

HANGUL = re.compile(r"[가-힣]")
HAN = re.compile(r"[一-鿿]")
FAST = D.DemoConfig(step_seconds=0, chat_seconds=0)


@pytest.fixture(autouse=True)
def no_real_model(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("a real harness was spawned in demo mode")

    for harness in (ClaudeCodeHarness, CodexHarness, OpenCodeHarness, LiteHarness):
        monkeypatch.setattr(harness, "spawn", refuse)


def strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in strings(v)]
    if isinstance(value, (list, tuple)):
        return [s for v in value for s in strings(v)]
    return []


def check_lines(table: dict[str, str], where: str) -> None:
    assert set(table) == set(LOCALES), where
    assert all(table[lang].strip() for lang in LOCALES), where
    assert HANGUL.search(table["ko"]), f"{where}: the Korean source is not Korean"
    for lang in ("en", "zh-CN"):
        assert not HANGUL.search(table[lang]), f"{where} [{lang}] has Korean: {table[lang]!r}"
    assert HAN.search(table["zh-CN"]), f"{where}: the Chinese line has no Chinese"


# ---------------------------------------------------------------------- tables


def test_every_scripted_line_exists_in_all_three_languages() -> None:
    tables: dict[str, dict[str, str]] = {
        **{f"STEP_REPLIES.{k}": v for k, v in H.STEP_REPLIES.items()},
        **{f"HANDING.{k}": v for k, v in H.HANDING.items()},
        "FALLBACK": H.FALLBACK,
        **{f"INTENTS.{i.key}.chief": i.chief for i in H.INTENTS},
        **{f"INTENTS.{i.key}.answer": i.answer for i in H.INTENTS if i.answer},
        **{f"TEXT.{k}": v for k, v in S.TEXT.items() if k != "ads.channel"},
        **{f"REVIEW_REASONS.{k}": v for k, v in S.REVIEW_REASONS.items()},
        "ORG_DISPLAY": D.ORG_DISPLAY,
        "WS_DISPLAY": D.WS_DISPLAY,
        "OWNER_TITLE": D.OWNER_TITLE,
        **{f"MEMBERS.{m[0]}.{n}": t for m in D.MEMBERS for n, t in (("display", m[1]), ("title", m[2]))},
        **{f"QUESTION.{i}": q for i, q in enumerate(D.QUESTION)},
        **{f"CALENDAR.{i}.{n}": t for i, c in enumerate(D.CALENDAR) for n, t in (("title", c[0]), ("notes", c[3]))},
    }  # fmt: skip
    for where, table in tables.items():
        if where.startswith("TEXT.") and not HANGUL.search(table["ko"]):
            continue  # a number format (po.total) — nothing to translate
        check_lines(table, where)
    # Instagram is Instagram in every language; its Korean name is the source
    assert (
        S.TEXT["ads.channel"]["ko"] == "인스타그램" and S.TEXT["ads.channel"]["en"] == "Instagram"
    )


def test_the_formats_take_the_same_values_in_every_language() -> None:
    fields = re.compile(r"\{(\w+)\}")
    for key, table in S.TEXT.items():
        names = {lang: sorted(fields.findall(table[lang])) for lang in LOCALES}
        assert names["en"] == names["ko"] == names["zh-CN"], key


def test_the_suggested_requests_run_the_same_scenario_in_every_language() -> None:
    ko = [H.match_intent(s) for s in H.SUGGESTIONS_BY_LOCALE["ko"]]
    assert H.SUGGESTIONS_BY_LOCALE["ko"] == H.SUGGESTIONS
    for lang in LOCALES:
        mine = H.suggestions(lang)
        assert len(mine) == len(ko)
        for i, (text, want) in enumerate(zip(mine, ko, strict=True), start=1):
            got = H.match_intent(text)
            assert got is not None and want is not None and got.key == want.key, (lang, text)
            assert H.suggestion_number(text) == i
    assert H.suggestions("fr") == H.SUGGESTIONS


def test_the_script_answers_in_the_copy_language() -> None:
    step = "[workflow job for finance] #demo:finance.read go\n\n---\nYou are finance in x"
    assert script_text(step, "en") == H.STEP_REPLIES["finance.read"]["en"]
    assert script_text(step, "zh-CN") == H.STEP_REPLIES["finance.read"]["zh-CN"]
    assert script_text(step, None) == H.STEP_REPLIES["finance.read"]["ko"]
    hand = "[workflow job for finance] #demo:finance.read go\n\n---\nYou are chief in x"
    assert script_text(hand, "en") == H.HANDING["finance"]["en"]
    # a chat follows the copy's language, whatever language is typed
    chat = "[user] 10월 손익 정리해줘\n\n---\nYou are chief in x"
    assert script_text(chat, "en") == H.INTENTS[0].chief["en"]
    assert script_text("[user] what?\n\n---\nYou are chief in x", "zh-CN") == H.FALLBACK["zh-CN"]
    # no language given (a bare call): the one typed, as before
    assert script_text("[user] what?\n\n---\nYou are chief in x", None) == H.FALLBACK["en"]


def script_text(prompt: str, lang: str | None) -> str:
    return H.script(prompt, lang).text


# ---------------------------------------------------------------------- template


def base_files() -> list[Path]:
    return sorted(
        p.relative_to(TEMPLATE)
        for p in TEMPLATE.rglob("*")
        if p.is_file() and p.relative_to(TEMPLATE).parts[0] != "locales"
    )


def step_shape(step: dict[str, Any]) -> dict[str, Any]:
    tag = H.STEP_TAG.search(str(step.get("prompt", "")))
    approval = step.get("approval") or {}
    return {
        "id": step["id"],
        "agent": step.get("agent"),
        "tool": step.get("tool"),
        "tag": tag.group(1) if tag else None,
        "with": sorted(set(step.get("with") or {}) - {"lang"}),
        "save_as": (step.get("save_as") or {}).get("kind"),
        "approval": {k: approval.get(k) for k in ("risk", "category", "on_decline")},
        "end": step.get("end"),
    }


@pytest.mark.parametrize("lang", ["en", "zh-CN"])
def test_each_language_has_every_template_file(lang: str) -> None:
    layer = TEMPLATE / "locales" / lang
    mine = sorted(p.relative_to(layer) for p in layer.rglob("*") if p.is_file())
    assert mine == base_files()


@pytest.mark.parametrize("lang", ["en", "zh-CN"])
def test_a_language_workflow_is_the_korean_one_in_other_words(lang: str) -> None:
    for name in S.SCENARIOS:
        ko = yaml.safe_load((TEMPLATE / "workflows" / f"{name}.yaml").read_text("utf-8"))
        mine = yaml.safe_load(
            (TEMPLATE / "locales" / lang / "workflows" / f"{name}.yaml").read_text("utf-8")
        )
        assert {k: mine[k] for k in ("name", "team", "enabled")} == {
            k: ko[k] for k in ("name", "team", "enabled")
        }
        assert [step_shape(s) for s in mine["steps"]] == [step_shape(s) for s in ko["steps"]]
        texts = [mine["title"], mine["description"]]
        for step, src in zip(mine["steps"], ko["steps"], strict=True):
            if "tool" in step:
                assert step["with"].get("lang") == lang, (name, step["id"])
                assert "lang" not in src["with"]
            if "prompt" in step:
                texts.append(H.STEP_TAG.sub("", step["prompt"]))
            texts += [(step.get("save_as") or {}).get("title") or ""]
            texts += [
                v for k, v in (step.get("approval") or {}).items() if k in ("title", "summary")
            ]
        for text in filter(None, texts):
            assert not HANGUL.search(text), f"{lang} {name}: {text!r}"
        if lang == "zh-CN":
            assert HAN.search(mine["title"])


@pytest.mark.parametrize("lang", ["en", "zh-CN"])
def test_a_language_artifact_kind_and_knowledge(lang: str) -> None:
    for path in (TEMPLATE / "artifact-kinds").glob("*.yaml"):
        ko = yaml.safe_load(path.read_text("utf-8"))
        mine = yaml.safe_load(
            (TEMPLATE / "locales" / lang / "artifact-kinds" / path.name).read_text("utf-8")
        )
        assert {**mine, "title": None} == {**ko, "title": None}
        assert not HANGUL.search(mine["title"])
    text = (TEMPLATE / "locales" / lang / "knowledge" / "company.md").read_text("utf-8")
    assert not HANGUL.search(text)


@pytest.mark.parametrize("lang", ["en", "zh-CN"])
def test_a_language_sample_file_keeps_the_columns_and_rows(lang: str) -> None:
    for path in (TEMPLATE / "files").glob("*.csv"):
        with path.open(encoding="utf-8", newline="") as f:
            ko = list(csv.reader(f))
        mine_path = TEMPLATE / "locales" / lang / "files" / path.name
        with mine_path.open(encoding="utf-8", newline="") as f:
            mine = list(csv.reader(f))
        assert len(mine) == len(ko), path.name
        if path.name.startswith(("bank-", "market-")):
            continue  # read by finance.pnl, which knows en · zh column names itself
        assert [S.HEADERS.get(h, h) for h in mine[0]] == ko[0], path.name
        for row in mine:
            for cell in row:
                assert not HANGUL.search(cell), f"{lang} {path.name}: {cell!r}"


@pytest.mark.parametrize("lang", ["en", "zh-CN"])
def test_the_tools_read_a_language_copy(lang: str) -> None:
    S.Pace.tool_seconds = 0
    files = TEMPLATE / "locales" / lang / "files"
    pnl = S.demo_pnl(
        str(files / "bank-2026-10.csv"), str(files / "market-settlement-2026-10.csv"), lang=lang
    )
    ko = S.demo_pnl(
        str(TEMPLATE / "files" / "bank-2026-10.csv"),
        str(TEMPLATE / "files" / "market-settlement-2026-10.csv"),
    )
    assert (pnl["revenue"], pnl["expenses"], len(pnl["needs_review"])) == (
        ko["revenue"],
        ko["expenses"],
        len(ko["needs_review"]),
    )
    outs = [
        pnl,
        S.demo_payables(str(files / "payables-2026-11.csv"), lang=lang),
        cmp := S.demo_supplier_compare(str(files / "supplier-quotes.csv"), lang=lang),
        S.demo_purchase_order(str(files / "po-lines.csv"), cmp["recommended"], lang=lang),
        S.demo_sns_calendar(str(files / "sns-week.csv"), str(files / "sns-last-week.csv"), lang=lang),
        S.demo_sns_posts(str(files / "sns-posts.csv"), lang=lang),
        S.demo_ad_plan(lang=lang),
    ]  # fmt: skip
    for out in outs:
        for text in strings(out):
            assert not HANGUL.search(text), f"{lang}: {text!r}"


# ---------------------------------------------------------------------- a run


async def test_an_english_account_runs_in_english(tmp_path: Path) -> None:
    sol = init_solution(tmp_path / "demo", FAST)
    accounts, store = stores(sol)
    D.ensure_company(accounts)
    acct, _pw = create_account(
        sol, store, accounts, "acmeDemo", "INQ-1", time.time() + 86400, locale="en",
        company_no="ACME-12345",
    )  # fmt: skip
    build = demo_builder(FAST)
    await seed_account(sol, solosquad_home(), acct, accounts, build=build)
    org = sol.org("acmedemo")
    assert read_locale(org.root) == "en"
    assert org.config().display_name == "Moa Living (example)"
    titles = {r[0] for r in accounts.connection().execute(
        "SELECT title FROM cal_items WHERE org = ? AND kind = 'work'", ("acmedemo",))}  # fmt: skip
    assert "Winter tumbler launch" in titles

    engine = build_engine(sol.root, build=build)
    await start_engine(engine)
    try:
        rt = engine.runtime("acmedemo", ORG_WORKSPACE)
        assert rt is not None and rt.workflows is not None and rt.artifacts is not None
        wf = rt.workflows
        assert wf.defs["finance-monthly"].title == "Monthly finance"
        lines: list[str] = []
        for name in S.SCENARIOS:
            tid, cards = await S.run_through(wf, name)
            assert cards
            for card in cards:
                lines += [str(card.get("title")), str(card.get("summary"))]
            state = await wf.manager.thread_state(tid)
            lines += strings(state["values"].get("outputs"))
        assert any("Pay the vendors ₩" in s for s in lines)
        assert H.STEP_REPLIES["finance.read"]["en"] in "\n".join(lines)
        for art in rt.artifacts.find(limit=100):
            lines += [art.title, *strings(art.data)]
        assert "October P&L" in {a.title for a in rt.artifacts.find(kind="finance.pnl", limit=5)}
        for text in lines:
            assert not HANGUL.search(text), text
        # Chief answers a request in English (the copy's language), whatever is typed
        tid = rt.manager.create_thread("chat")
        rid = await rt.manager.submit(tid, "Sum up October's P&L")
        assert (await rt.manager.wait(rid, 20))["status"] == "success"
        said = [m.text for m in (await rt.manager.thread_state(tid))["values"]["messages"]]
        assert H.INTENTS[0].chief["en"] in said, said
        assert not any(HANGUL.search(s) for s in said[1:]), said
    finally:
        await stop_engine(engine)
