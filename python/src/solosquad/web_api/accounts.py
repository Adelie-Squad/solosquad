"""Accounts, sessions and the audit log — `accounts.sqlite` in the org data folder.

PRD v2.1.0: one login per org (I15 · W6), SQLite like runs.sqlite (I16), scrypt from the
standard library (I18), server-side sessions with a 256-bit id (I20), two roles — owner
and staff (I25 · W7). The session id never touches disk in clear: only its SHA-256.
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
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

from solosquad.web_api import totp

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
    pass


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
    title: str = ""
    teams: tuple[str, ...] = ()
    """Teams this person belongs to (decision 55) — the basis of team-tier approval."""

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "display": self.display,
            "role": self.role.value,
            "locale": self.locale,
            "two_factor": self.has_totp,
            "disabled": self.disabled,
            "title": self.title,
            "teams": list(self.teams),
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

_USER_COLS = "id, username, display, role, locale, totp_secret IS NOT NULL, disabled, title, teams"


def _user(row: Any) -> User:
    teams = tuple(json.loads(row[8])) if row[8] else ()
    return User(
        row[0],
        row[1],
        row[2],
        Role(row[3]),
        row[4],
        bool(row[5]),
        bool(row[6]),
        row[7] or "",
        teams,
    )


# Columns added after the first release of the table — applied to existing files in place.
LATER_COLUMNS = (("users", "title", "TEXT"), ("users", "teams", "TEXT"))


class AccountStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        for table, column, kind in LATER_COLUMNS:
            have = {r[1] for r in self._db.execute(f"PRAGMA table_info({table})")}
            if column not in have:
                self._db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")
        self._lock = threading.Lock()
        path.chmod(0o600)

    def _q(self, sql: str, args: tuple[Any, ...] = ()) -> list[Any]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    # ------------------------------------------------------------------ users

    def create_user(
        self, username: str, password: str, role: Role, display: str = "", locale: str = "ko"
    ) -> User:
        username = username.strip().lower()
        if not username or len(username) > 64:
            raise ValueError("username must be 1 to 64 characters")
        if len(password) < MIN_PASSWORD:
            raise ValueError(f"password must be at least {MIN_PASSWORD} characters")
        uid = f"u-{secrets.token_hex(6)}"
        try:
            self._q(
                "INSERT INTO users (id, username, display, role, pw_hash, locale, created)"
                " VALUES (?,?,?,?,?,?,?)",
                (uid, username, display or username, role.value, hash_password(password), locale,
                 time.time()),
            )  # fmt: skip
        except sqlite3.IntegrityError as e:
            raise ValueError(f"username {username!r} is taken") from e
        return self.user(uid)

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
            raise ValueError("the last owner cannot be demoted")
        self._q("UPDATE users SET role = ? WHERE id = ?", (role.value, uid))

    def set_disabled(self, uid: str, disabled: bool) -> None:
        if disabled and self.user(uid).role is Role.OWNER and len(self.owners()) <= 1:
            raise ValueError("the last owner cannot be disabled")
        self._q("UPDATE users SET disabled = ? WHERE id = ?", (int(disabled), uid))
        if disabled:
            self.revoke_user_sessions(uid)

    def set_password(self, uid: str, password: str) -> None:
        if len(password) < MIN_PASSWORD:
            raise ValueError(f"password must be at least {MIN_PASSWORD} characters")
        self._q("UPDATE users SET pw_hash = ? WHERE id = ?", (hash_password(password), uid))
        self.revoke_user_sessions(uid)

    def set_profile(
        self, uid: str, *, title: str | None = None, teams: list[str] | None = None
    ) -> User:
        self.user(uid)
        if title is not None:
            self._q("UPDATE users SET title = ? WHERE id = ?", (title.strip()[:80], uid))
        if teams is not None:
            clean = sorted({t.strip() for t in teams if t.strip()})
            self._q("UPDATE users SET teams = ? WHERE id = ?", (json.dumps(clean), uid))
        return self.user(uid)

    def set_locale(self, uid: str, locale: str) -> None:
        self._q("UPDATE users SET locale = ? WHERE id = ?", (locale, uid))

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
            raise AuthError("too many attempts — try again later")
        rows = self._q(
            "SELECT id, pw_hash, disabled, totp_secret IS NOT NULL FROM users WHERE username = ?",
            (username,),
        )
        if not rows or rows[0][2] or not check_password(password, rows[0][1]):
            self._fail(*keys)
            raise AuthError("wrong username or password")
        uid, has_totp = rows[0][0], bool(rows[0][3])
        stage = SessionStage.FULL
        if has_totp:
            if not otp or not self._check_totp(uid, otp):
                self._fail(*keys)
                raise AuthError("one-time code required" if not otp else "wrong one-time code")
        elif require_second_factor:
            stage = SessionStage.ENROLL
        self._q("DELETE FROM login_failures WHERE key IN (?, ?)", keys)
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
