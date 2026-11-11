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

import hmac
import re
import unicodedata

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


_KR_NO = re.compile(r"^(?:[0-9]{10}|[0-9]{13})$")
_OTHER_NO = re.compile(r"^[A-Z0-9-]{4,30}$")


def normalize_company_no(raw: str) -> str:
    """The company's registration number as stored (2026-11-12 — the demo login asks for it).

    A Korean 사업자등록번호 (`NNN-NN-NNNNN`) or 법인등록번호 (`NNNNNN-NNNNNNN`) → its 10 or 13
    digits; any other country's number → 4 to 30 letters, digits and dashes, upper-cased. The
    marketing Worker (`marketing/src/validate.ts`) applies the same rule to the request."""
    text = unicodedata.normalize("NFKC", raw or "").strip()
    digits = re.sub(r"[\s-]", "", text)
    if _KR_NO.fullmatch(digits):
        return digits
    other = text.upper()
    if _OTHER_NO.fullmatch(other):
        return other
    raise ValueError(
        f"company number {raw!r} must be a 사업자등록번호 (10 digits), a 법인등록번호"
        " (13 digits) or another country's number (4–30 letters, digits and dashes)"
    )


def company_no_matches(stored: str, typed: str) -> bool:
    """The number typed at the demo login is the account's — dashes and case do not count."""
    if not stored:
        return False
    try:
        given = normalize_company_no(typed)
    except ValueError:
        return False
    return hmac.compare_digest(given.replace("-", ""), stored.replace("-", ""))


def org_for(demo_id: str) -> str:
    """The visitor's copy — and their login name: the id in lower case (`samsungdemo`).
    A login is case-insensitive (`samsungDemo` · `samsungdemo` are the same account)."""
    return demo_id.lower()


__all__ = [
    "ID_PATTERN",
    "ORG_WORKSPACE",
    "DemoConfig",
    "check_id",
    "company_no_matches",
    "is_demo",
    "load_config",
    "normalize_company_no",
    "org_for",
    "save_config",
]
