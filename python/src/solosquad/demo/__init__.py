"""Demo mode (decision 62 · PRD v2.1.0 §3.6.4) — a SoloSquad that shows itself without doing
anything in the world.

A demo server is an ordinary engine server whose `core/server.yaml` says `mode: demo` (a
server property, I41 — with its `demo:` settings next to it). Then, enforced by the server
and shown by the web through `/api/me`:

① **example company** — every demo account gets its own copy of the fictional 모아 리빙
   (`template/` → an org per account, `seed.py`), so a visitor only sees what they did.
② **scripted run** — every agent answers through the `scripted` harness (`harness.py`), the
   connection pool is empty (the one scripted connection lives only in memory) and the
   workspace forbids external APIs; the scenario steps make the work products a payment,
   order or post would need and stop at the decision-51 approval points (`scenario.py`).
③ **settings locked** — `READ_ONLY_ROUTES` answer `403 demo_read_only`; the web locks the
   same controls.
④ **reset · isolation** — 처음 상태로 (the visitor), the nightly reset and the supervisor
   (`supervisor.py`); usage per account in `core.db` `demo_usage` (`store.py`).
"""

from __future__ import annotations

import re

from solosquad.layout import DemoSettings, Solution

DemoConfig = DemoSettings
"""`server.yaml` `demo:` (see `layout.DemoSettings`)."""

ORG_WORKSPACE = "hq"
"""Every visitor's copy has one workspace (본사)."""

ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,35}Demo[0-9]{0,2}$")
"""`<slug>Demo`, then a number when the slug was taken (`samsungDemo2`) — PRD §3.6.3."""


def is_demo(sol: Solution) -> bool:
    try:
        return sol.server_config(strict=False).mode == "demo"
    except Exception:  # an unreadable server.yaml is not a demo
        return False


def load_config(sol: Solution) -> DemoSettings:
    return sol.server_config(strict=False).demo or DemoSettings()


def save_config(sol: Solution, cfg: DemoSettings) -> None:
    """Turn the server into a demo server with these settings."""
    sol.update_server_config(mode="demo", demo=cfg)


def check_id(demo_id: str) -> str:
    """→ the id as given, or ValueError. Uniqueness is the store's (case-insensitive)."""
    if not ID_PATTERN.fullmatch(demo_id or ""):
        raise ValueError(
            f"demo id {demo_id!r} must be <slug>Demo — ASCII letters and digits, starting with"
            " a letter, ending with 'Demo' (and a number when taken: samsungDemo2),"
            " at most 40 characters"
        )
    return demo_id


def org_for(demo_id: str) -> str:
    """The visitor's copy — and their login name: the id in lower case (`samsungdemo`).
    A login is case-insensitive (`samsungDemo` · `samsungdemo` are the same account)."""
    return demo_id.lower()


__all__ = [
    "ID_PATTERN",
    "ORG_WORKSPACE",
    "DemoConfig",
    "check_id",
    "is_demo",
    "load_config",
    "org_for",
    "save_config",
]
