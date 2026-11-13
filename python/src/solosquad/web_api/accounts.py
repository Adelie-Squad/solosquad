"""People, logins, sessions, assignments and the login audit — `core.db` of the customer.

PRD v2.1.0 rev7: one customer account per person (decision 57 · I15 · I39) in the
customer's data folder (`data/<solution-id>/core.db`), scrypt from the standard library
(I18), server-side sessions with a 256-bit id (I20). The session id never touches disk in
clear: only its SHA-256.

Who may enter what is the **assignment table** — person x org x workspace (none = the
whole org) x role (I39 · I25 rev7). A customer owner (`users.role = owner`) is the owner
of every org and needs no rows. Everyone else sees only what they are assigned; the role
is per org, so the same person can lead one org and be staff in another. A person's
title and teams are per org too and live in that org's `org.db` (`org_store`).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

from solosquad.company_info import SCHEMA as COMPANY_SCHEMA
from solosquad.company_info import Company
from solosquad.entities import LegalEntity, insert_entity, read_entities, update_entity
from solosquad.entities import migrate as migrate_entities
from solosquad.entities import set_primary as store_primary
from solosquad.storage import Migration, columns, connect, migrate
from solosquad.web_api import totp
from solosquad.web_api.errors import CodedError, ErrorCode

SESSION_TTL_S = 14 * 24 * 3600
FAIL_WINDOW_S = 15 * 60
FAIL_LIMIT = 10
"""Failed logins per username (or per address) inside the window before refusing."""

# scrypt cost — 2^15 · 8 · 1 needs 32 MiB per hash: the OWASP-recommended floor for
# interactive logins. Stored with every hash, so raising it later re-hashes on login.
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAXMEM = 64 * 1024 * 1024
MIN_PASSWORD = 10


class Role(StrEnum):
    OWNER = "owner"
    STAFF = "staff"


class SessionStage(StrEnum):
    FULL = "full"
    ENROLL = "enroll"
    """Password ok, but the second factor still has to be set up — only enrolment works."""


class AuthError(Exception):
    """A sign-in refusal — the sentence stays generic on purpose; `code` is what the web shows."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


def _check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise CodedError(
            ErrorCode.PASSWORD_TOO_SHORT,
            f"password must be at least {MIN_PASSWORD} characters",
            min=MIN_PASSWORD,
        )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, maxmem=SCRYPT_MAXMEM
    )
    b64 = base64.b64encode
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${b64(salt).decode()}${b64(digest).decode()}"


def check_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    got = hashlib.scrypt(
        password.encode(),
        salt=base64.b64decode(salt),
        n=int(n),
        r=int(r),
        p=int(p),
        maxmem=SCRYPT_MAXMEM,
    )
    return hmac.compare_digest(got, base64.b64decode(digest))


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class User:
    id: str
    username: str
    display: str
    role: Role
    locale: str
    has_totp: bool
    disabled: bool
    """`role` is the customer-level role; a title and teams are per org (`org_store`)."""

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "display": self.display,
            "role": self.role.value,
            "locale": self.locale,
            "two_factor": self.has_totp,
            "disabled": self.disabled,
        }


@dataclass(frozen=True)
class Session:
    user: User
    csrf: str
    stage: SessionStage
    expires: float


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display TEXT NOT NULL,
    role TEXT NOT NULL, pw_hash TEXT NOT NULL, totp_secret TEXT, totp_last_step INTEGER,
    pending_totp TEXT, locale TEXT NOT NULL DEFAULT 'ko', disabled INTEGER NOT NULL DEFAULT 0,
    created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, stage TEXT NOT NULL,
    created REAL NOT NULL, expires REAL NOT NULL, ip TEXT, ua TEXT);
CREATE TABLE IF NOT EXISTS audit (
    ts REAL NOT NULL, user_id TEXT, action TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS login_failures (ts REAL NOT NULL, key TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS failures_key ON login_failures (key, ts);
"""

_USER_COLS = "id, username, display, role, locale, totp_secret IS NOT NULL, disabled"


LOCALES = ("ko", "en", "zh-CN")
"""The web's languages (decision 53)."""
DEFAULT_LOCALE = "ko"
"""The fixed default (2026-11-11): there is no customer default any more — each person
chooses their own screen language, and anyone who has not is shown Korean."""


def known_locale(locale: str | None) -> str:
    """A person's language as the engine uses it: their choice, else ko."""
    return locale if locale in LOCALES else DEFAULT_LOCALE


def _user(row: Any) -> User:
    return User(
        row[0], row[1], row[2], Role(row[3]), known_locale(row[4]), bool(row[5]), bool(row[6])
    )


def _add_people_columns(db: sqlite3.Connection) -> None:
    """v2: title and team memberships (decision 55). A file that already got them from the
    in-place step of PR #19 is left as it is."""
    have = columns(db, "users")
    for column in ("title", "teams"):
        if column not in have:
            db.execute(f"ALTER TABLE users ADD COLUMN {column} TEXT")


PASSKEYS_SCHEMA = """
CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key BLOB NOT NULL,
    sign_count INTEGER NOT NULL, transports TEXT, name TEXT, created REAL NOT NULL,
    last_used REAL);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys (user_id);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY, challenge BLOB NOT NULL, user_id TEXT, kind TEXT NOT NULL,
    expires REAL NOT NULL)
"""

LEGACY_MIGRATIONS = (
    Migration(1, SCHEMA),
    Migration(2, _add_people_columns),
    Migration(3, PASSKEYS_SCHEMA),  # passkeys — the default sign-in of decision 46 W3
)
"""The account tables as rev6 kept them in each `org.db` (component `accounts`)."""
LEGACY_COMPONENT = "accounts"

SCOPES_SCHEMA = """
CREATE TABLE IF NOT EXISTS assignments (
    user_id TEXT NOT NULL, org TEXT NOT NULL, workspace TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL, created REAL NOT NULL, PRIMARY KEY (user_id, org, workspace));
CREATE TABLE IF NOT EXISTS last_scope (
    user_id TEXT PRIMARY KEY, org TEXT NOT NULL, workspace TEXT NOT NULL, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS migrated_orgs (
    org TEXT PRIMARY KEY, users INTEGER NOT NULL, ts REAL NOT NULL)
"""


def _add_presence(db: sqlite3.Connection) -> None:
    """v5: when each person was last here (the dashboard's 자리를 비운 동안). People who were
    already here start from their newest audited action (a login at the least), so their
    first digest covers the time since then instead of greeting them as new."""
    db.execute(
        "CREATE TABLE IF NOT EXISTS presence (user_id TEXT PRIMARY KEY,"
        " last_active REAL NOT NULL, seen_until REAL, basis TEXT NOT NULL,"
        " visit_start REAL NOT NULL)"
    )
    db.execute(
        "INSERT OR IGNORE INTO presence (user_id, last_active, seen_until, basis, visit_start)"
        " SELECT a.user_id, MAX(a.ts), MAX(a.ts), 'away', MAX(a.ts) FROM audit a"
        " JOIN users u ON u.id = a.user_id GROUP BY a.user_id"
    )


def _settle_locales(fill: str) -> Callable[[sqlite3.Connection], None]:
    """v6 (2026-11-11): the customer default language is gone. Everyone who followed it
    (`locale` empty) keeps the language they were seeing — the old default, `fill` — as
    their own choice; anything unknown becomes ko."""

    def step(db: sqlite3.Connection) -> None:
        settle_locales(db, fill)

    return step


def settle_locales(db: sqlite3.Connection, fill: str) -> int:
    """Give every person without a known language `fill` (ko when `fill` is unknown)."""
    marks = ",".join("?" * len(LOCALES))
    cur = db.execute(
        f"UPDATE users SET locale = ? WHERE locale IS NULL OR locale NOT IN ({marks})",
        (known_locale(fill), *LOCALES),
    )
    return cur.rowcount


def migrations(fill_locale: str = DEFAULT_LOCALE) -> tuple[Migration, ...]:
    """The `core.db` steps. `fill_locale` = the retired customer default, for step 6."""
    return (
        *LEGACY_MIGRATIONS,
        Migration(4, SCOPES_SCHEMA),  # decision 57 — assignments · last scope (I39)
        Migration(5, _add_presence),  # 2026-11-10 — last seen, for the dashboard digest
        Migration(6, _settle_locales(fill_locale)),  # 2026-11-11 — a language per person
        Migration(7, COMPANY_SCHEMA),  # 2026-11-11 — the customer company (회사)
        Migration(8, migrate_entities),  # 2026-11-14 — several legal entities (법인)
    )


MIGRATIONS = migrations()
COMPONENT = "core"
"""The component name of these tables in `core.db`."""
CHALLENGE_TTL_S = 5 * 60

AWAY_GAP_S = 30 * 60
"""A person who has not been here for this long is away: their next presence starts a new
visit, and the digest then covers the time since they were last here."""

PresenceBasis = str  # "first" · "away" · "acknowledged"


@dataclass(frozen=True)
class Presence:
    """When a person was last here (PRD v2.1.0 · DESIGN.md `### 대시보드` 자리를 비운 동안).

    `last_active` — their newest request that a person made (not a background refresh).
    `seen_until` — where the digest starts: the end of their previous visit, or the moment
    they said 확인했어요. None = they have never been here before (`basis` "first").
    `visit_start` — when this visit began."""

    last_active: float
    seen_until: float | None
    basis: PresenceBasis
    visit_start: float


@dataclass(frozen=True)
class Assignment:
    """One row of the assignment table: `workspace` None = the whole org."""

    org: str
    workspace: str | None
    role: Role

    def public(self) -> dict[str, Any]:
        return {"org": self.org, "workspace": self.workspace, "role": self.role.value}


class AccountStore:
    def __init__(self, path: Path, *, fill_locale: str = DEFAULT_LOCALE) -> None:
        self.path = path
        self._db = connect(path)
        migrate(self._db, COMPONENT, migrations(fill_locale), path=path)
        self._lock = threading.Lock()
        path.chmod(0o600)

    def connection(self) -> sqlite3.Connection:
        """The raw connection — for the one-time move of rev6 accounts (`org_store`)."""
        return self._db

    @property
    def lock(self) -> threading.Lock:
        return self._lock

    def _q(self, sql: str, args: tuple[Any, ...] = ()) -> list[Any]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    # ------------------------------------------------------------------ users

    def create_user(
        self,
        username: str,
        password: str,
        role: Role,
        display: str = "",
        locale: str = DEFAULT_LOCALE,
        *,
        assignments: list[Assignment] | None = None,
    ) -> User:
        """`role` = the customer-level role: owner = every org; staff = only `assignments`."""
        username = username.strip().lower()
        if not username or len(username) > 64:
            raise CodedError(
                ErrorCode.USERNAME_INVALID, "username must be 1 to 64 characters", max=64
            )
        _check_password(password)
        uid = f"u-{secrets.token_hex(6)}"
        try:
            self._q(
                "INSERT INTO users (id, username, display, role, pw_hash, locale, created)"
                " VALUES (?,?,?,?,?,?,?)",
                (uid, username, display or username, role.value, hash_password(password),
                 known_locale(locale), time.time()),
            )  # fmt: skip
        except sqlite3.IntegrityError as e:
            raise CodedError(
                ErrorCode.USERNAME_TAKEN, f"username {username!r} is taken", username=username
            ) from e
        if assignments:
            self.set_assignments(uid, assignments)
        return self.user(uid)

    # ------------------------------------------------------------------ assignments (I39)

    def assignments(self, uid: str) -> list[Assignment]:
        rows = self._q(
            "SELECT org, workspace, role FROM assignments WHERE user_id = ?"
            " ORDER BY org, workspace",
            (uid,),
        )
        return [Assignment(r[0], r[1] or None, Role(r[2])) for r in rows]

    def set_assignments(self, uid: str, items: list[Assignment]) -> None:
        """Replace the person's rows. Takes effect on their next request (C30)."""
        self.user(uid)
        seen: set[tuple[str, str]] = set()
        for a in items:
            if not a.org.strip():
                raise CodedError(ErrorCode.ASSIGNMENT_INVALID, "an assignment needs an org")
            key = (a.org, a.workspace or "")
            if key in seen:
                where = f"{a.org}/{a.workspace or '*'}"
                raise CodedError(
                    ErrorCode.ASSIGNMENT_DUPLICATE, f"assigned twice to {where}", scope=where
                )
            seen.add(key)
        now = time.time()
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("DELETE FROM assignments WHERE user_id = ?", (uid,))
                for a in items:
                    self._db.execute(
                        "INSERT INTO assignments (user_id, org, workspace, role, created)"
                        " VALUES (?,?,?,?,?)",
                        (uid, a.org, a.workspace or "", a.role.value, now),
                    )
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    def assign(
        self, uid: str, org: str, workspace: str | None = None, role: Role = Role.STAFF
    ) -> None:
        rest = [
            a for a in self.assignments(uid) if (a.org, a.workspace) != (org, workspace or None)
        ]
        self.set_assignments(uid, [*rest, Assignment(org, workspace or None, role)])

    def role_in(self, user: User, org: str, workspace: str | None = None) -> Role | None:
        """The person's role in a scope — None when it is not theirs (→ 404, I22 rev7).

        Org scope (`workspace` None): an org row gives its role; rows for single
        workspaces only make the person staff of the org (they see its definitions).
        Workspace scope: the org row or that workspace's row; owner if either says so.
        """
        if user.disabled:
            return None
        if user.role is Role.OWNER:
            return Role.OWNER  # the customer's owner leads every org (decision 57 ⑵)
        rows = [a for a in self.assignments(user.id) if a.org == org]
        whole = [a.role for a in rows if a.workspace is None]
        if workspace is None:
            if whole:
                return whole[0]
            return Role.STAFF if rows else None
        mine = whole + [a.role for a in rows if a.workspace == workspace]
        if not mine:
            return None
        return Role.OWNER if Role.OWNER in mine else Role.STAFF

    def last_scope(self, uid: str) -> tuple[str, str] | None:
        rows = self._q("SELECT org, workspace FROM last_scope WHERE user_id = ?", (uid,))
        return (rows[0][0], rows[0][1]) if rows else None

    def set_last_scope(self, uid: str, org: str, workspace: str) -> None:
        self._q(
            "INSERT INTO last_scope (user_id, org, workspace, ts) VALUES (?,?,?,?)"
            " ON CONFLICT(user_id) DO UPDATE SET org = excluded.org,"
            " workspace = excluded.workspace, ts = excluded.ts",
            (uid, org, workspace, time.time()),
        )

    # ------------------------------------------------------------------ presence

    def presence(self, uid: str) -> Presence | None:
        rows = self._q(
            "SELECT last_active, seen_until, basis, visit_start FROM presence WHERE user_id = ?",
            (uid,),
        )
        return Presence(rows[0][0], rows[0][1], rows[0][2], rows[0][3]) if rows else None

    def touch(self, uid: str, now: float | None = None, *, new_visit: bool = False) -> Presence:
        """The person is here. A sign-in (`new_visit`) or the first presence after
        `AWAY_GAP_S` starts a new visit: the digest moves to start where the previous visit
        ended. Inside a visit nothing but `last_active` changes — a reload keeps the digest."""
        t = time.time() if now is None else now
        with self._lock:
            row = self._db.execute(
                "SELECT last_active, seen_until, basis, visit_start FROM presence"
                " WHERE user_id = ?",
                (uid,),
            ).fetchone()
            if row is None:
                found = Presence(t, None, "first", t)
            elif new_visit or t - row[0] > AWAY_GAP_S:
                found = Presence(t, max(row[1] or 0.0, row[0]), "away", t)
            else:
                found = Presence(max(row[0], t), row[1], row[2], row[3])
            self._db.execute(
                "INSERT INTO presence (user_id, last_active, seen_until, basis, visit_start)"
                " VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET"
                " last_active = excluded.last_active, seen_until = excluded.seen_until,"
                " basis = excluded.basis, visit_start = excluded.visit_start",
                (uid, found.last_active, found.seen_until, found.basis, found.visit_start),
            )
        return found

    def acknowledge(self, uid: str, until: float, now: float | None = None) -> Presence:
        """확인했어요 — the digest now starts at `until` (never later than now, never earlier
        than it already did)."""
        t = time.time() if now is None else now
        self.touch(uid, t)
        with self._lock:
            row = self._db.execute(
                "SELECT last_active, seen_until, visit_start FROM presence WHERE user_id = ?",
                (uid,),
            ).fetchone()
            seen = max(row[1] or 0.0, min(until, t))
            self._db.execute(
                "UPDATE presence SET seen_until = ?, basis = 'acknowledged' WHERE user_id = ?",
                (seen, uid),
            )
        return Presence(row[0], seen, "acknowledged", row[2])

    def migrated_orgs(self) -> dict[str, int]:
        return {r[0]: int(r[1]) for r in self._q("SELECT org, users FROM migrated_orgs")}

    def user(self, uid: str) -> User:
        rows = self._q(f"SELECT {_USER_COLS} FROM users WHERE id = ?", (uid,))
        if not rows:
            raise KeyError(f"no user {uid}")
        return _user(rows[0])

    def users(self) -> list[User]:
        return [_user(r) for r in self._q(f"SELECT {_USER_COLS} FROM users ORDER BY created")]

    def owners(self) -> list[User]:
        return [u for u in self.users() if u.role is Role.OWNER and not u.disabled]

    def set_role(self, uid: str, role: Role) -> None:
        if role is not Role.OWNER and self.user(uid).role is Role.OWNER and len(self.owners()) <= 1:
            raise CodedError(ErrorCode.LAST_OWNER, "the last owner cannot be demoted")
        self._q("UPDATE users SET role = ? WHERE id = ?", (role.value, uid))

    def set_disabled(self, uid: str, disabled: bool) -> None:
        if disabled and self.user(uid).role is Role.OWNER and len(self.owners()) <= 1:
            raise CodedError(ErrorCode.LAST_OWNER, "the last owner cannot be disabled")
        self._q("UPDATE users SET disabled = ? WHERE id = ?", (int(disabled), uid))
        if disabled:
            self.revoke_user_sessions(uid)

    def set_password(self, uid: str, password: str) -> None:
        _check_password(password)
        self._q("UPDATE users SET pw_hash = ? WHERE id = ?", (hash_password(password), uid))
        self.revoke_user_sessions(uid)

    def set_locale(self, uid: str, locale: str) -> None:
        if locale not in LOCALES:
            raise CodedError(ErrorCode.LOCALE_INVALID, f"locale must be one of {list(LOCALES)}")
        self._q("UPDATE users SET locale = ? WHERE id = ?", (locale, uid))

    # ------------------------------------------------------------------ entities (법인)

    def entities(self) -> list[LegalEntity]:
        """Every legal entity, the 대표 법인 first (2026-11-14)."""
        with self._lock:
            return read_entities(self._db) or []

    def entity(self, eid: int) -> LegalEntity:
        found = next((e for e in self.entities() if e.id == eid), None)
        if found is None:
            raise KeyError(f"no entity {eid}")
        return found

    def primary_entity(self) -> LegalEntity | None:
        return next((e for e in self.entities() if e.is_primary), None)

    def add_entity(self, fields: dict[str, Any], by: str | None = None) -> LegalEntity:
        """A new entity (`entities.validate_entity` fields); the first one becomes 대표."""
        with self._lock:
            eid = insert_entity(self._db, fields, by, time.time())
        return self.entity(eid)

    def edit_entity(self, eid: int, fields: dict[str, Any], by: str | None = None) -> LegalEntity:
        self.entity(eid)
        with self._lock:
            update_entity(self._db, eid, fields, by, time.time())
        return self.entity(eid)

    def remove_entity(self, eid: int) -> None:
        with self._lock:
            self._db.execute("DELETE FROM entities WHERE id = ? AND is_primary = 0", (eid,))

    def make_primary(self, eid: int) -> None:
        self.entity(eid)
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                store_primary(self._db, eid)
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    # ------------------------------------------------------------------ company (회사)

    def company(self) -> Company:
        """The rev7 single company = the 대표 법인; empty until the owner fills it in."""
        primary = self.primary_entity()
        return primary.company() if primary else Company()

    def set_company(self, company: Company, by: str | None = None) -> Company:
        """Write the rev7 shape into the 대표 법인 (`/api/company`, `solosquad company set`) —
        creating it when there is none. The registration number is left as it is."""
        kind = company.kind
        if company.country and company.country != "KR":
            kind = "foreign"  # type: ignore[assignment]
        fields = {
            "kind": kind, "name": company.name, "representative": company.representative,
            "country": company.country, "address": company.address,
            "controlled_by": None if kind == "sole_proprietor" else company.controlled_by,
        }  # fmt: skip
        primary = self.primary_entity()
        if primary is None:
            self.add_entity({**fields, "registration_no": "", "registration_kind": None}, by)
        else:
            self.edit_entity(primary.id, fields, by)
        return self.company()

    def has_company(self) -> bool:
        return self.primary_entity() is not None

    def settle_locales(self, fill: str) -> int:
        """`settle_locales` for accounts moved in after the migration (rev6 org.db)."""
        with self._lock:
            return settle_locales(self._db, fill)

    # ------------------------------------------------------------------ second factor

    def begin_totp(self, uid: str) -> str:
        """New pending secret → `otpauth://` URI. Active only after `confirm_totp`."""
        secret = totp.new_secret()
        self._q("UPDATE users SET pending_totp = ? WHERE id = ?", (secret, uid))
        return totp.provisioning_uri(secret, self.user(uid).username)

    def confirm_totp(self, uid: str, code: str) -> bool:
        rows = self._q("SELECT pending_totp FROM users WHERE id = ?", (uid,))
        secret = rows[0][0] if rows else None
        step = totp.verify(secret, code) if secret else None
        if step is None:
            return False
        self._q(
            "UPDATE users SET totp_secret = ?, totp_last_step = ?, pending_totp = NULL"
            " WHERE id = ?",
            (secret, step, uid),
        )
        return True

    def reset_totp(self, uid: str) -> None:
        """Lost phone: clear the factor; the next login has to enrol again."""
        self._q(
            "UPDATE users SET totp_secret = NULL, totp_last_step = NULL, pending_totp = NULL"
            " WHERE id = ?",
            (uid,),
        )
        self.revoke_user_sessions(uid)

    def check_current_totp(self, uid: str, code: str) -> bool:
        """The code from the factor already in use — asked before it can be replaced."""
        return self._check_totp(uid, code)

    def _check_totp(self, uid: str, code: str) -> bool:
        rows = self._q("SELECT totp_secret, totp_last_step FROM users WHERE id = ?", (uid,))
        if not rows or rows[0][0] is None:
            return False
        step = totp.verify(rows[0][0], code, last_step=rows[0][1] or -1)
        if step is None:
            return False
        self._q("UPDATE users SET totp_last_step = ? WHERE id = ?", (step, uid))
        return True

    # ------------------------------------------------------------------ login · sessions

    def _throttled(self, *keys: str) -> bool:
        since = time.time() - FAIL_WINDOW_S
        for key in keys:
            n = self._q(
                "SELECT COUNT(*) FROM login_failures WHERE key = ? AND ts > ?", (key, since)
            )
            if n[0][0] >= FAIL_LIMIT:
                return True
        return False

    def _fail(self, *keys: str) -> None:
        for key in keys:
            self._q("INSERT INTO login_failures (ts, key) VALUES (?, ?)", (time.time(), key))

    def login(
        self,
        username: str,
        password: str,
        otp: str | None,
        *,
        require_second_factor: bool,
        ip: str = "",
        ua: str = "",
    ) -> tuple[str, Session]:
        """→ (session token for the cookie, session). Raises AuthError with a generic reason."""
        username = username.strip().lower()
        keys = (f"user:{username}", f"ip:{ip}")
        if self._throttled(*keys):
            raise AuthError(ErrorCode.LOGIN_THROTTLED, "too many attempts — try again later")
        rows = self._q(
            "SELECT id, pw_hash, disabled, totp_secret IS NOT NULL FROM users WHERE username = ?",
            (username,),
        )
        if not rows or rows[0][2] or not check_password(password, rows[0][1]):
            self._fail(*keys)
            raise AuthError(ErrorCode.LOGIN_FAILED, "wrong username or password")
        uid, has_totp = rows[0][0], bool(rows[0][3])
        stage = SessionStage.FULL
        if has_totp:
            if not otp or not self._check_totp(uid, otp):
                self._fail(*keys)
                if not otp:
                    raise AuthError(ErrorCode.OTP_REQUIRED, "one-time code required")
                raise AuthError(ErrorCode.OTP_INVALID, "wrong one-time code")
        elif require_second_factor:
            stage = SessionStage.ENROLL
        self._q("DELETE FROM login_failures WHERE key IN (?, ?)", keys)
        return self.open_session(uid, stage, ip=ip, ua=ua)

    def open_session(
        self, uid: str, stage: SessionStage, *, ip: str = "", ua: str = ""
    ) -> tuple[str, Session]:
        token = secrets.token_urlsafe(32)
        now = time.time()
        self._q(
            "INSERT INTO sessions (token_hash, user_id, csrf, stage, created, expires, ip, ua)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (_sha(token), uid, secrets.token_urlsafe(24), stage.value, now, now + SESSION_TTL_S,
             ip, ua[:200]),
        )  # fmt: skip
        session = self.session(token)
        assert session is not None
        return token, session

    def throttled(self, *keys: str) -> bool:
        return self._throttled(*keys)

    def record_failure(self, *keys: str) -> None:
        self._fail(*keys)

    # ------------------------------------------------------------------ passkeys

    def add_passkey(
        self, uid: str, cred_id: str, public_key: bytes, sign_count: int,
        transports: list[str], name: str,
    ) -> None:  # fmt: skip
        self._q(
            "INSERT INTO passkeys (id, user_id, public_key, sign_count, transports, name, created)"
            " VALUES (?,?,?,?,?,?,?)",
            (cred_id, uid, public_key, sign_count, json.dumps(transports), name[:60], time.time()),
        )

    def passkeys(self, uid: str) -> list[dict[str, Any]]:
        rows = self._q(
            "SELECT id, name, transports, created, last_used FROM passkeys WHERE user_id = ?"
            " ORDER BY created",
            (uid,),
        )
        return [
            {"id": r[0], "name": r[1], "transports": json.loads(r[2] or "[]"), "created": r[3],
             "last_used": r[4]}
            for r in rows
        ]  # fmt: skip

    def passkey(self, cred_id: str) -> tuple[str, bytes, int] | None:
        """→ (user id, public key, sign count) for a credential id."""
        rows = self._q(
            "SELECT user_id, public_key, sign_count FROM passkeys WHERE id = ?", (cred_id,)
        )
        return (rows[0][0], bytes(rows[0][1]), int(rows[0][2])) if rows else None

    def touch_passkey(self, cred_id: str, sign_count: int) -> None:
        self._q(
            "UPDATE passkeys SET sign_count = ?, last_used = ? WHERE id = ?",
            (sign_count, time.time(), cred_id),
        )

    def delete_passkey(self, uid: str, cred_id: str) -> bool:
        with self._lock:
            n = self._db.execute(
                "DELETE FROM passkeys WHERE id = ? AND user_id = ?", (cred_id, uid)
            ).rowcount
        return bool(n)

    def clear_passkeys(self, uid: str) -> None:
        self._q("DELETE FROM passkeys WHERE user_id = ?", (uid,))
        self.revoke_user_sessions(uid)

    def new_challenge(self, kind: str, challenge: bytes, uid: str | None) -> str:
        cid = secrets.token_urlsafe(18)
        now = time.time()
        self._q("DELETE FROM webauthn_challenges WHERE expires < ?", (now,))
        self._q(
            "INSERT INTO webauthn_challenges (id, challenge, user_id, kind, expires)"
            " VALUES (?,?,?,?,?)",
            (cid, challenge, uid, kind, now + CHALLENGE_TTL_S),
        )
        return cid

    def take_challenge(self, cid: str, kind: str) -> tuple[bytes, str | None] | None:
        """One use only — a challenge is deleted as it is read."""
        rows = self._q(
            "SELECT challenge, user_id, expires FROM webauthn_challenges WHERE id = ? AND kind = ?",
            (cid, kind),
        )
        self._q("DELETE FROM webauthn_challenges WHERE id = ?", (cid,))
        if not rows or rows[0][2] < time.time():
            return None
        return bytes(rows[0][0]), rows[0][1]

    def session(self, token: str | None) -> Session | None:
        if not token:
            return None
        rows = self._q(
            "SELECT user_id, csrf, stage, expires FROM sessions WHERE token_hash = ?",
            (_sha(token),),
        )
        if not rows or rows[0][3] < time.time():
            return None
        user = self.user(rows[0][0])
        if user.disabled:
            return None
        return Session(user, rows[0][1], SessionStage(rows[0][2]), rows[0][3])

    def promote_session(self, token: str) -> None:
        self._q(
            "UPDATE sessions SET stage = ? WHERE token_hash = ?",
            (SessionStage.FULL.value, _sha(token)),
        )

    def logout(self, token: str) -> None:
        self._q("DELETE FROM sessions WHERE token_hash = ?", (_sha(token),))

    def revoke_user_sessions(self, uid: str) -> None:
        self._q("DELETE FROM sessions WHERE user_id = ?", (uid,))

    def purge(self, *, audit_days: int, now: float | None = None) -> dict[str, int]:
        """Expired sessions, stale login failures, audit older than `audit_days`."""
        t = time.time() if now is None else now
        with self._lock:
            out = {
                "sessions": self._db.execute(
                    "DELETE FROM sessions WHERE expires < ?", (t,)
                ).rowcount,
                "login_failures": self._db.execute(
                    "DELETE FROM login_failures WHERE ts < ?", (t - FAIL_WINDOW_S,)
                ).rowcount,
                "audit": self._db.execute(
                    "DELETE FROM audit WHERE ts < ?", (t - audit_days * 86400,)
                ).rowcount,
            }
        return out

    # ------------------------------------------------------------------ audit

    def audit(self, user_id: str | None, action: str, detail: str = "") -> None:
        self._q(
            "INSERT INTO audit (ts, user_id, action, detail) VALUES (?,?,?,?)",
            (time.time(), user_id, action, detail),
        )

    def audit_log(self, limit: int = 200) -> list[dict[str, Any]]:
        rows = self._q(
            "SELECT ts, user_id, action, detail FROM audit ORDER BY ts DESC LIMIT ?", (limit,)
        )
        return [{"ts": r[0], "user_id": r[1], "action": r[2], "detail": r[3]} for r in rows]
