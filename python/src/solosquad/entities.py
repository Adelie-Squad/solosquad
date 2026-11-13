"""The customer's legal entities (법인, 2026-11-14) — several where there was one 회사.

User 2026-11-14, asked whether a customer with a Korean HQ (주식회사) and a Chinese sourcing
subsidiary is one company or two: "어 여러 개 등록할 수 있어". The 회사 tab becomes a list.

Where it lives: `core.db` table `entities` (migration 8; the rev7 `company` row became the
first one, the 대표 법인). Personal data (대표자, a 개인 사업자's address) stays out of git
(decision 54 ⑶); the customer's repository only names an entity by its id:

- `orgs/<org>/org.yaml` `entity_id` — the 사업's 소속 법인 (unset = 대표 법인);
- a connection's `entity_id` — its 보유 법인, the holder of the model account (unset = 대표).

Exactly one entity is the 대표 법인 while any exist (a partial unique index keeps it at most
one; the store keeps it at least one). Decision 45's rules then judge every connection on its
owner and on the 사업 that uses it (`routing.eligibility.judge_use`).

The registration number follows `marketing/scripts/lib/company-no.mjs` (the request form and
the marketing Worker) — the same kinds, lengths and check digits:

    business   KR 사업자등록번호 10 digits (개인 사업자) · NNN-NN-NNNNN
    corporate  KR 법인등록번호 13 digits (법인) · NNNNNN-NNNNNNN
    uscc       CN 统一社会信用代码 18, GB 32100 check character
    foreign    any other country, 4-20 letters and digits, no check
"""

from __future__ import annotations

import sqlite3
import time
import unicodedata
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from solosquad.company_info import (
    ADDRESS_MAX,
    NAME_MAX,
    PERSON_MAX,
    Company,
    _country,
    _text,
    read_company,
)
from solosquad.layout import LayoutError, Solution
from solosquad.routing.connections import Connection, load_connections, save_connections
from solosquad.routing.eligibility import Entity, Holders
from solosquad.web_api.errors import CodedError, ErrorCode

if TYPE_CHECKING:
    from solosquad.routing.router import Router

EntityKind = Literal["corporation", "sole_proprietor", "foreign"]
KINDS: tuple[str, ...] = ("corporation", "sole_proprietor", "foreign")
RegistrationKind = Literal["business", "corporate", "uscc", "foreign"]
LENGTH = {"business": 10, "corporate": 13, "uscc": 18}
FOREIGN_MIN = 4
MAX_CHARS = 20
HOME = "KR"

# ---------------------------------------------------------------------- registration number

_BUSINESS_WEIGHTS = (1, 3, 7, 1, 3, 7, 1, 3, 5)
USCC_ALPHABET = "0123456789ABCDEFGHJKLMNPQRTUWXY"
_USCC_WEIGHTS = (1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28)


def registration_kind(country: str | None, kind: str | None) -> RegistrationKind:
    """The number's kind for a country and an entity kind (company-no.mjs `kindForCountry`)."""
    if country == "KR":
        return "corporate" if kind == "corporation" else "business"
    if country == "CN":
        return "uscc"
    return "foreign"


def business_no_ok(digits: str) -> bool:
    if len(digits) != 10 or not digits.isascii() or not digits.isdigit():
        return False
    d = [int(c) for c in digits]
    total = sum(d[i] * _BUSINESS_WEIGHTS[i] for i in range(9)) + (d[8] * 5) // 10
    return (10 - total % 10) % 10 == d[9]


def corporate_no_ok(digits: str) -> bool:
    if len(digits) != 13 or not digits.isascii() or not digits.isdigit():
        return False
    d = [int(c) for c in digits]
    total = sum(d[i] * (1 if i % 2 == 0 else 2) for i in range(12))
    return (10 - total % 10) % 10 == d[12]


def uscc_check_char(first17: str) -> str | None:
    if len(first17) != 17:
        return None
    total = 0
    for i, ch in enumerate(first17):
        v = USCC_ALPHABET.find(ch)
        if v < 0:
            return None
        total += v * _USCC_WEIGHTS[i]
    return USCC_ALPHABET[(31 - total % 31) % 31]


def uscc_ok(code: str) -> bool:
    return len(code) == 18 and uscc_check_char(code[:17]) == code[17]


def _nfkc(raw: str) -> str:
    return unicodedata.normalize("NFKC", raw)


def check_registration(raw: str, kind: RegistrationKind) -> str:
    """The normalised number (digits for the Korean kinds, upper-case code otherwise), or a
    `CodedError` whose `reason` is invalid · length · check (company-no.mjs `checkCompanyNo`)."""

    def bad(reason: str) -> CodedError:
        return CodedError(
            ErrorCode.ENTITY_REGISTRATION_INVALID,
            f"registration number ({kind}): {reason}",
            field="registration_no",
            reason=reason,
            kind=kind,
        )

    text = _nfkc(raw).strip()
    if kind in ("business", "corporate"):
        if any(not (c.isdigit() or c.isspace() or c == "-") for c in text):
            raise bad("invalid")
        digits = "".join(c for c in text if c.isdigit())
        if len(digits) != LENGTH[kind]:
            raise bad("length")
        right = business_no_ok(digits) if kind == "business" else corporate_no_ok(digits)
        if not right:
            raise bad("check")
        return digits
    if any(not (c.isascii() and (c.isalnum() or c.isspace() or c == "-")) for c in text):
        raise bad("invalid")
    code = "".join(c for c in text.upper() if c.isalnum())
    if kind == "uscc":
        if len(code) != LENGTH["uscc"]:
            raise bad("length")
        if not uscc_ok(code):
            raise bad("check")
        return code
    if not FOREIGN_MIN <= len(code) <= MAX_CHARS:
        raise bad("length")
    return code


# ---------------------------------------------------------------------- the entity


@dataclass(frozen=True)
class LegalEntity:
    id: int
    kind: EntityKind | None
    name: str = ""
    """법인명 (법인 · 해외) or 상호 (개인 사업자)."""
    registration_no: str = ""
    registration_kind: RegistrationKind | None = None
    representative: str = ""
    country: str | None = None
    """소재지 country, ISO 3166-1 alpha-2."""
    address: str = ""
    controlled_by: str | None = None
    """지배 회사 나라 — the controlling company's HQ country (법인 · 해외 only)."""
    is_primary: bool = False
    created: float = 0.0
    updated: float = 0.0

    @property
    def complete(self) -> bool:
        return bool(self.kind and self.name and self.representative and self.country)

    def holder(self) -> Entity | None:
        """The entity the provider rules judge; None while its country is unknown."""
        if not self.country:
            return None
        control = self.controlled_by if self.kind != "sole_proprietor" else None
        return Entity(name=self.name or f"entity {self.id}", country=self.country,
                      controlled_by=control)  # fmt: skip

    def public(self) -> dict[str, Any]:
        return {**asdict(self), "complete": self.complete}

    def company(self) -> Company:
        """The rev7 single-company shape (`/api/company`, `solosquad company`)."""
        kind = self.kind if self.kind in ("corporation", "sole_proprietor") else "corporation"
        return Company(
            kind=kind if self.kind else None,
            name=self.name,
            representative=self.representative,
            country=self.country,
            address=self.address,
            controlled_by=self.controlled_by,
        )


FIELDS = ("kind", "name", "registration_no", "representative", "country", "address",
          "controlled_by")  # fmt: skip


def validate_entity(data: dict[str, Any], *, base: LegalEntity | None = None) -> dict[str, Any]:
    """The web's add or edit, checked → the columns to store. `base` = the entity being
    edited (fields left out keep their value). The country decides the kind of number and,
    outside Korea, the kind of entity (해외)."""
    unknown = sorted(set(data) - {*FIELDS, "id", "is_primary", "complete", "registration_kind",
                                  "created", "updated"})  # fmt: skip
    if unknown:
        raise CodedError(
            ErrorCode.COMPANY_FIELD_INVALID, f"unknown entity fields {unknown}", field=unknown[0]
        )
    merged: dict[str, Any] = {k: getattr(base, k) for k in FIELDS} if base else {}
    merged.update({k: data[k] for k in FIELDS if k in data})
    country = _country(merged, "country")
    if country is None:
        raise CodedError(
            ErrorCode.COMPANY_COUNTRY_INVALID, "country is required (e.g. KR)", field="country"
        )
    kind = merged.get("kind") or None
    if country == HOME:
        if kind not in ("corporation", "sole_proprietor"):
            raise CodedError(
                ErrorCode.COMPANY_KIND_INVALID,
                "a Korean entity is a corporation (법인) or a sole proprietor (개인 사업자)",
                field="kind",
            )
    else:
        kind = "foreign"  # 해외 — the country says it
    controlled_by = _country(merged, "controlled_by")
    if controlled_by and kind == "sole_proprietor":
        raise CodedError(
            ErrorCode.COMPANY_CONTROL_CORPORATION_ONLY,
            "only a corporation records a controlling company's country",
            field="controlled_by",
        )
    if controlled_by == country:
        controlled_by = None
    name = _text(merged, "name", NAME_MAX)
    if not name:
        raise CodedError(ErrorCode.ENTITY_NAME_REQUIRED, "name is required", field="name")
    reg_kind = registration_kind(country, kind)
    raw_no = merged.get("registration_no") or ""
    if not isinstance(raw_no, str):
        raise CodedError(
            ErrorCode.COMPANY_FIELD_INVALID, "registration_no must be text", field="registration_no"
        )
    number = check_registration(raw_no, reg_kind) if raw_no.strip() else ""
    return {
        "kind": kind,
        "name": name,
        "registration_no": number,
        "registration_kind": reg_kind if number else None,
        "representative": _text(merged, "representative", PERSON_MAX),
        "country": country,
        "address": _text(merged, "address", ADDRESS_MAX),
        "controlled_by": controlled_by,
    }


# ---------------------------------------------------------------------- storage

SCHEMA = """
CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, name TEXT NOT NULL DEFAULT '',
    registration_no TEXT NOT NULL DEFAULT '', registration_kind TEXT,
    representative TEXT NOT NULL DEFAULT '', country TEXT, address TEXT NOT NULL DEFAULT '',
    controlled_by TEXT, is_primary INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL,
    updated REAL NOT NULL, updated_by TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS entities_one_primary ON entities (is_primary)
    WHERE is_primary = 1
"""

_COLUMNS = ("id, kind, name, registration_no, registration_kind, representative, country,"
            " address, controlled_by, is_primary, created, updated")  # fmt: skip


def migrate(db: sqlite3.Connection) -> None:
    """core.db step 8: the `entities` table, and the rev7 company as its 대표 법인."""
    for statement in SCHEMA.split(";"):  # inside the migration's transaction
        db.execute(statement)
    if db.execute("SELECT 1 FROM entities LIMIT 1").fetchone():
        return
    try:
        row = db.execute(
            "SELECT kind, name, representative, country, address, controlled_by, updated,"
            " updated_by FROM company WHERE id = 1"
        ).fetchone()
    except sqlite3.OperationalError:
        return
    if row is None:
        return
    kind, name, rep, country, address, control, updated, by = row
    if country and country != HOME:
        kind = "foreign"
    ts = updated or time.time()
    db.execute(
        "INSERT INTO entities (id, kind, name, representative, country, address, controlled_by,"
        " is_primary, created, updated, updated_by) VALUES (1,?,?,?,?,?,?,1,?,?,?)",
        (kind if kind in KINDS else None, name or "", rep or "", country, address or "",
         control, ts, ts, by),
    )  # fmt: skip


def _row(r: Any) -> LegalEntity:
    return LegalEntity(
        id=r[0], kind=r[1] if r[1] in KINDS else None, name=r[2], registration_no=r[3],
        registration_kind=r[4], representative=r[5], country=r[6], address=r[7],
        controlled_by=r[8], is_primary=bool(r[9]), created=r[10], updated=r[11],
    )  # fmt: skip


def read_entities(db: sqlite3.Connection) -> list[LegalEntity] | None:
    """Every entity, the 대표 first; None when the table is not there (an older file)."""
    try:
        rows = db.execute(
            f"SELECT {_COLUMNS} FROM entities ORDER BY is_primary DESC, id"
        ).fetchall()
    except sqlite3.OperationalError:
        return None
    return [_row(r) for r in rows]


def insert_entity(db: sqlite3.Connection, fields: dict[str, Any], by: str | None, ts: float) -> int:
    first = db.execute("SELECT 1 FROM entities WHERE is_primary = 1").fetchone() is None
    cur = db.execute(
        "INSERT INTO entities (kind, name, registration_no, registration_kind, representative,"
        " country, address, controlled_by, is_primary, created, updated, updated_by)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (fields["kind"], fields["name"], fields["registration_no"], fields["registration_kind"],
         fields["representative"], fields["country"], fields["address"],
         fields["controlled_by"], int(first), ts, ts, by),
    )  # fmt: skip
    assert cur.lastrowid is not None
    return cur.lastrowid


def update_entity(
    db: sqlite3.Connection, eid: int, fields: dict[str, Any], by: str | None, ts: float
) -> None:
    cols = ", ".join(f"{k} = ?" for k in fields)
    db.execute(
        f"UPDATE entities SET {cols}, updated = ?, updated_by = ? WHERE id = ?",
        (*fields.values(), ts, by, eid),
    )


def set_primary(db: sqlite3.Connection, eid: int) -> None:
    db.execute("UPDATE entities SET is_primary = 0 WHERE is_primary = 1 AND id != ?", (eid,))
    db.execute("UPDATE entities SET is_primary = 1 WHERE id = ?", (eid,))


def holders(entities: list[LegalEntity]) -> Holders:
    primary = next((e.id for e in entities if e.is_primary), None)
    return Holders({e.id: e.holder() for e in entities}, primary)


def set_entities(routers: Iterable[Router | None], book: Holders, sol: Solution) -> None:
    """Every router judges its connections on their 보유 법인 and its 사업's 소속 법인."""
    org_entity: dict[str, int | None] = {}
    for router in routers:
        if router is None:
            continue
        if router.org not in org_entity:
            try:
                org_entity[router.org] = sol.org(router.org).config().entity_id
            except LayoutError:
                org_entity[router.org] = None
        router.holders = book
        router.org_entity = org_entity[router.org]


# ---------------------------------------------------------------------- references


@dataclass(frozen=True)
class References:
    """What in the customer's repository names an entity — `org.yaml` and connection files.
    `None` = unset (the 대표 법인)."""

    businesses: list[tuple[str, int | None]]
    """(org, entity_id)"""
    connections: list[tuple[str, Path, Connection]]
    """(`core` or the org, its file, the connection)"""

    def using(self, book: Holders, eid: int) -> tuple[list[str], list[str]]:
        """→ (orgs, `scope/connection`) that run under or are held by `eid`, unset ones
        counted for the 대표 법인."""
        orgs = [o for o, ref in self.businesses if book.resolve(ref) == eid]
        conns = [f"{s}/{c.id}" for s, _p, c in self.connections if book.resolve(c.entity_id) == eid]
        return orgs, conns


def references(sol: Solution) -> References:
    businesses: list[tuple[str, int | None]] = []
    conns: list[tuple[str, Path, Connection]] = []
    for c in _load(sol.connections_path):
        conns.append(("core", sol.connections_path, c))
    for org in sol.orgs():
        try:
            businesses.append((org.name, org.config().entity_id))
        except LayoutError:
            continue
        path = org.root / "connections.yaml"
        conns.extend((org.name, path, c) for c in _load(path))
    return References(businesses, conns)


def _load(path: Path) -> list[Connection]:
    try:
        return load_connections(path)
    except Exception:  # a broken file is `validate`'s to report, not a reason to fail here
        return []


def pin_unset(sol: Solution, refs: References, eid: int) -> dict[str, int]:
    """Before another entity becomes 대표: everything that followed the 대표 (no id) is
    written down as `eid`, so no 사업 and no connection changes owner silently."""
    orgs = [o for o, ref in refs.businesses if ref is None]
    for org in orgs:
        sol.org(org).set_entity(eid)
    files: dict[Path, list[Connection]] = {}
    for _s, path, _c in refs.connections:
        files.setdefault(path, load_connections(path))
    pinned = 0
    for path, conns in files.items():
        unset = [c for c in conns if c.entity_id is None]
        if not unset:
            continue
        save_connections(
            path, [c.model_copy(update={"entity_id": eid}) if c.entity_id is None else c
                   for c in conns],
        )  # fmt: skip
        pinned += len(unset)
    return {"businesses": len(orgs), "connections": pinned}


def read_entities_at(path: Path) -> list[LegalEntity]:
    """The entities in a `core.db`, read-only (for `check` · `doctor`, which never migrate).
    A file from before migration 8 gives its one `company` row as the 대표 법인."""
    if not path.is_file():
        return []
    try:
        db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        return []
    try:
        found = read_entities(db)
        if found is not None:
            return found
        company = read_company(db)
        if company is None:
            return []
        return [LegalEntity(id=1, kind=company.kind, name=company.name,
                            representative=company.representative, country=company.country,
                            address=company.address, controlled_by=company.controlled_by,
                            is_primary=True)]  # fmt: skip
    finally:
        db.close()
