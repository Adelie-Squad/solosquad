"""Chief's suggestions next to a budget warning (PRD v2.1.0 C9 · I14 · decision 35).

When a connection or the whole company passes the warning line, the budget answer carries
what Chief would do about it — rules, no LLM call, so the web shows the same thing every
time and never acts on its own:

- `switch_connection` — for a connection line: another connection the router could use for
  this workspace (active, allowed by its execution policy, eligible for the holder) that is
  itself under the warning line. The one with the most room left; no cap counts as most.
- `raise_budget` — for a connection or the company: a monthly cap that covers this month at
  the current pace and puts today's spend back under the warning line, rounded up to whole
  dollars. Changing the cap stays the owner's call on the connections screen (C15).
"""

from __future__ import annotations

import math
import time
from collections.abc import Sequence
from dataclasses import dataclass

from solosquad.context.ledger import month_start


@dataclass(frozen=True)
class Line:
    """One budget line as the budget answer reports it."""

    id: str | None
    """The connection, or `None` for the company line."""
    spent_usd: float
    budget_usd: float | None
    warning: bool
    usable: bool = True
    """A connection the router may pick in this workspace (ignored for the company line)."""


def month_end(now: float) -> float:
    t = time.localtime(month_start(now))
    return time.mktime((t.tm_year, t.tm_mon + 1, 1, 0, 0, 0, 0, 0, -1))


def proposed_cap(spent: float, cap: float, warn_at: float, now: float) -> float:
    """Enough for the month at this pace, and today's spend back under the warning line."""
    start, end = month_start(now), month_end(now)
    elapsed = max(now - start, 1.0) / (end - start)
    pace = spent / min(elapsed, 1.0)
    clear = spent / warn_at if warn_at > 0 else spent
    out = float(math.ceil(max(pace, clear) - 1e-9))
    return out if out > cap else float(math.floor(cap) + 1)


def suggestions(
    company: Line, connections: Sequence[Line], warn_at: float, now: float
) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    room = [c for c in connections if c.usable and not c.warning]

    def left(c: Line) -> float:
        return math.inf if c.budget_usd is None else c.budget_usd - c.spent_usd

    for line in connections:
        if not line.warning or line.budget_usd is None:
            continue
        others = sorted((c for c in room if c.id != line.id), key=left, reverse=True)
        if others:
            out.append(
                {"kind": "switch_connection", "subject": line.id, "to_connection": others[0].id,
                 "budget_usd": None}
            )  # fmt: skip
        out.append(
            {"kind": "raise_budget", "subject": line.id, "to_connection": None,
             "budget_usd": proposed_cap(line.spent_usd, line.budget_usd, warn_at, now)}
        )  # fmt: skip
    if company.warning and company.budget_usd is not None:
        out.append(
            {"kind": "raise_budget", "subject": None, "to_connection": None,
             "budget_usd": proposed_cap(company.spent_usd, company.budget_usd, warn_at, now)}
        )  # fmt: skip
    return out
