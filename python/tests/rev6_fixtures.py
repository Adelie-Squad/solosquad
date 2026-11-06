"""A rev6 data folder: the accounts of an org in its `org.db` (component `accounts` v3)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from solosquad.web_api import totp
from solosquad.web_api.accounts import AccountStore, Role, SessionStage

PASSWORD = "correct horse battery"


@dataclass
class Rev6Org:
    path: Path
    owner_id: str
    staff_id: str
    owner_secret: str
    session_token: str


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_rev6_org_db(
    path: Path,
    *,
    owner: str = "boss",
    staff: str = "kim",
    passkey: tuple[str, bytes, int] | None = None,
) -> Rev6Org:
    """Accounts written the rev6 way, then the rev7 tables taken away again."""
    store = AccountStore(path)
    boss = store.create_user(owner, PASSWORD, Role.OWNER, display="대표")
    uri = store.begin_totp(boss.id)
    secret = parse_qs(urlsplit(uri).query)["secret"][0]
    assert store.confirm_totp(boss.id, totp.code_at(secret, totp.current_step() - 1))
    kim = store.create_user(staff, PASSWORD, Role.STAFF, display="김대리")
    if passkey is not None:
        cred_id, public_key, count = passkey
        store.add_passkey(kim.id, cred_id, public_key, count, ["internal"], "phone")
    token, _ = store.open_session(boss.id, SessionStage.FULL)
    store.audit(boss.id, "approval_policy.update", json.dumps({"changes": []}))
    store.audit(boss.id, "login", "203.0.113.5")
    db = store.connection()
    db.execute(  # rev6 kept the title and teams on the account itself (decision 55)
        "UPDATE users SET title = 'MD', teams = ? WHERE id = ?", (json.dumps(["product"]), kim.id)
    )
    for table in ("assignments", "last_scope", "migrated_orgs"):
        db.execute(f"DROP TABLE {table}")
    db.execute("UPDATE schema_versions SET component = 'accounts', version = 3")
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.close()
    for side in ("-wal", "-shm"):
        Path(f"{path}{side}").unlink(missing_ok=True)
    return Rev6Org(path, boss.id, kim.id, secret, token)


def tables(path: Path) -> set[str]:
    conn = sqlite3.connect(path)
    try:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()
