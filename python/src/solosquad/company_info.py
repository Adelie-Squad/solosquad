"""The customer company (회사) — who the customer is, for people and for the provider rules.

User 2026-11-11: the settings get a 회사 tab — 법인 or 개인 사업자, 법인명 / 상호, 대표자,
소재지 (country + address). It replaces the customer profile's list of "account-holding
entities": the company *is* the holder of every model account, and decision 45's entity rule
reads its country here.

Where it lives: `core.db` (component `core`, table `company` — one row), not a file in the
customer's repository. Decision 54 ⑶ keeps personal data out of git: 대표자 is a person's
name, and a 개인 사업자's 소재지 is often a home address. The owner edits it in the web
(`PUT /api/company`) or with `solosquad company set`; everyone signed in reads it.

Eligibility (decision 45): the holder's country = the 소재지 country — for a 개인 사업자 that
is the owner's own country, treated the same way. A 법인 may also record the **controlling
company's country** (지배 회사 나라): Anthropic refuses entities controlled from an
unsupported region wherever they are incorporated (a Korean subsidiary of a Chinese group),
so the field stays — optional, 법인 only.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from solosquad.routing.eligibility import Entity
from solosquad.web_api.errors import CodedError, ErrorCode

CompanyKind = Literal["corporation", "sole_proprietor"]
KINDS: tuple[str, ...] = ("corporation", "sole_proprietor")
NAME_MAX = 120
PERSON_MAX = 60
ADDRESS_MAX = 500
_ISO2 = re.compile(r"^[A-Z]{2}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS company (
    id INTEGER PRIMARY KEY CHECK (id = 1), kind TEXT, name TEXT NOT NULL DEFAULT '',
    representative TEXT NOT NULL DEFAULT '', country TEXT, address TEXT NOT NULL DEFAULT '',
    controlled_by TEXT, updated REAL, updated_by TEXT)
"""


@dataclass(frozen=True)
class Company:
    kind: CompanyKind | None = None
    name: str = ""
    """법인명 (법인) or 상호 (개인 사업자)."""
    representative: str = ""
    """대표자."""
    country: str | None = None
    """소재지 country, ISO 3166-1 alpha-2 — the holder's country for decision 45."""
    address: str = ""
    """소재지 address lines, free text."""
    controlled_by: str | None = None
    """지배 회사 나라 (법인 only) — the controlling company's HQ country, when not `country`."""

    @property
    def complete(self) -> bool:
        return bool(self.kind and self.name and self.representative and self.country)

    def public(self) -> dict[str, Any]:
        return {**asdict(self), "complete": self.complete}

    def holder(self) -> Entity | None:
        """The account holder the provider rules judge; None while the country is unknown."""
        if not self.country:
            return None
        control = self.controlled_by if self.kind == "corporation" else None
        return Entity(name=self.name or "company", country=self.country, controlled_by=control)


def _text(data: dict[str, Any], key: str, limit: int) -> str:
    raw = data.get(key)
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise CodedError(ErrorCode.COMPANY_FIELD_INVALID, f"{key} must be text", field=key)
    value = raw.strip()
    if key != "address":
        value = " ".join(value.split())
    if len(value) > limit:
        raise CodedError(
            ErrorCode.COMPANY_FIELD_TOO_LONG, f"{key} is longer than {limit}", field=key, max=limit
        )
    return value


def _country(data: dict[str, Any], key: str) -> str | None:
    raw = data.get(key)
    if raw in (None, ""):
        return None
    value = str(raw).strip().upper()
    if not _ISO2.match(value):
        raise CodedError(
            ErrorCode.COMPANY_COUNTRY_INVALID,
            f"{key} must be a two-letter ISO country code (e.g. KR)",
            field=key,
        )
    return value


def validate_company(data: dict[str, Any]) -> Company:
    """The web's and the CLI's edit, checked. A partial company may be saved (it is filled
    in over time); `complete` says whether everything is there."""
    unknown = sorted(set(data) - {"kind", "name", "representative", "country", "address",
                                  "controlled_by", "complete"})  # fmt: skip
    if unknown:
        raise CodedError(
            ErrorCode.COMPANY_FIELD_INVALID, f"unknown company fields {unknown}", field=unknown[0]
        )
    kind = data.get("kind") or None
    if kind is not None and kind not in KINDS:
        raise CodedError(ErrorCode.COMPANY_KIND_INVALID, f"kind must be one of {list(KINDS)}")
    controlled_by = _country(data, "controlled_by")
    if controlled_by and kind != "corporation":
        raise CodedError(
            ErrorCode.COMPANY_CONTROL_CORPORATION_ONLY,
            "only a corporation (법인) records a controlling company's country",
        )
    return Company(
        kind=kind,
        name=_text(data, "name", NAME_MAX),
        representative=_text(data, "representative", PERSON_MAX),
        country=_country(data, "country"),
        address=_text(data, "address", ADDRESS_MAX),
        controlled_by=controlled_by,
    )


def read_company(db: sqlite3.Connection) -> Company | None:
    try:
        row = db.execute(
            "SELECT kind, name, representative, country, address, controlled_by FROM company"
            " WHERE id = 1"
        ).fetchone()
    except sqlite3.OperationalError:  # an older file without the table
        return None
    if row is None:
        return None
    return Company(row[0] if row[0] in KINDS else None, row[1], row[2], row[3], row[4], row[5])


def write_company(db: sqlite3.Connection, c: Company, by: str | None, ts: float) -> None:
    db.execute(
        "INSERT INTO company (id, kind, name, representative, country, address, controlled_by,"
        " updated, updated_by) VALUES (1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET"
        " kind = excluded.kind, name = excluded.name, representative = excluded.representative,"
        " country = excluded.country, address = excluded.address,"
        " controlled_by = excluded.controlled_by, updated = excluded.updated,"
        " updated_by = excluded.updated_by",
        (c.kind, c.name, c.representative, c.country, c.address, c.controlled_by, ts, by),
    )


def from_entity(entity: dict[str, Any]) -> Company:
    """The retired profile / connection entity (`name · country · controlled_by`) as the
    company — a legal entity, so a 법인. 대표자 and the address are left to fill in."""
    country = str(entity.get("country") or "").strip().upper() or None
    control = str(entity.get("controlled_by") or "").strip().upper() or None
    return Company(
        kind="corporation",
        name=str(entity.get("name") or "").strip()[:NAME_MAX],
        country=country if country and _ISO2.match(country) else None,
        controlled_by=control if control and _ISO2.match(control) and control != country else None,
    )


def read_company_at(path: Path) -> Company | None:
    """The company in a `core.db`, read-only (for `check` · `doctor`, which never migrate);
    None when the file or the row is not there."""
    if not path.is_file():
        return None
    try:
        db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        return read_company(db)
    finally:
        db.close()
