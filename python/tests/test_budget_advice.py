"""Chief's suggestions next to a budget warning (PRD v2.1.0 C9 · I14).

The rules behind `/budget` `suggestions`: which connection to move the work to, and what
monthly cap to propose — at a fixed moment so the pace is known.
"""

from __future__ import annotations

import time

from solosquad.routing.budget_advice import Line, month_end, proposed_cap, suggestions
from solosquad.web_api import schemas as S

# 2026-11-16 00:00 local — 15 of November's 30 days have passed: the pace doubles the spend
MID = time.mktime((2026, 11, 16, 0, 0, 0, 0, 0, -1))
WARN = 0.8


def test_the_month_ends_where_the_next_one_starts() -> None:
    assert month_end(MID) == time.mktime((2026, 12, 1, 0, 0, 0, 0, 0, -1))
    dec = time.mktime((2026, 12, 20, 0, 0, 0, 0, 0, -1))
    assert month_end(dec) == time.mktime((2027, 1, 1, 0, 0, 0, 0, 0, -1))


def test_the_proposed_cap_covers_the_pace_and_clears_the_warning_line() -> None:
    assert proposed_cap(85, 100, WARN, MID) == 170  # halfway through: 85 → 170 by the end
    late = time.mktime((2026, 11, 29, 0, 0, 0, 0, 0, -1))
    # near the end the pace barely grows, but 85 must sit under 80 % again: 85 / 0.8 = 106.25
    assert proposed_cap(85, 100, WARN, late) == 107
    # never the same cap or lower, even when the arithmetic lands on it
    assert proposed_cap(80, 100, WARN, time.mktime((2026, 11, 30, 23, 0, 0, 0, 0, -1))) == 101


def test_a_warned_connection_gets_the_roomiest_usable_other_and_a_cap() -> None:
    conns = [
        Line("claude-max", 85, 100, warning=True),
        Line("router", 10, 50, warning=False),  # 40 left
        Line("local", 3, None, warning=False),  # no cap: the most room
        Line("blocked", 0, None, warning=False, usable=False),  # not allowed in this workspace
        Line("kimi", 9, 10, warning=True),  # itself over the line
    ]
    company = Line(None, 107, 500, warning=False)
    out = suggestions(company, conns, WARN, MID)
    about = {(s["subject"], s["kind"]): s for s in out}
    assert about[("claude-max", "switch_connection")]["to_connection"] == "local"
    assert about[("claude-max", "raise_budget")]["budget_usd"] == 170
    assert about[("kimi", "switch_connection")]["to_connection"] == "local"
    assert about[("kimi", "raise_budget")]["budget_usd"] == 18
    assert not any(s["subject"] in {"router", "local", "blocked"} for s in out)
    assert not any(s["subject"] is None for s in out)  # the company is under its line
    for s in out:
        S.BudgetSuggestion.model_validate(s)  # the contract the web reads


def test_no_usable_other_means_only_the_cap() -> None:
    conns = [Line("claude-max", 90, 100, True), Line("blocked", 0, None, False, usable=False)]
    out = suggestions(Line(None, 90, None, False), conns, WARN, MID)
    assert [s["kind"] for s in out] == ["raise_budget"]


def test_the_company_line_suggests_its_own_cap() -> None:
    out = suggestions(Line(None, 90, 100, True), [], WARN, MID)
    assert out == [
        {"kind": "raise_budget", "subject": None, "to_connection": None, "budget_usd": 180.0}
    ]


def test_nothing_warned_nothing_suggested() -> None:
    conns = [Line("claude-max", 10, 100, False), Line("local", 0, None, False)]
    assert suggestions(Line(None, 10, 100, False), conns, WARN, MID) == []
