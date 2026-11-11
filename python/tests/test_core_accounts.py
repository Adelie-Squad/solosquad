"""One account per person for the whole customer — `core.db` (decision 57 · PRD v2.1.0 I39).

C32: a rev6 data folder keeps each org's accounts in its `org.db`. The first rev7 start
snapshots, moves people · logins · sessions · audit into `core.db`, assigns each person to
their org with the same role and leaves their title and teams in `org.db`. A failure — or
the same username in two orgs — refuses the start and leaves the original file as it was.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from rev6_fixtures import PASSWORD, sha, tables, write_rev6_org_db
from typer.testing import CliRunner

from solosquad.cli import app
from solosquad.layout import Solution, scaffold_org, scaffold_solution, scaffold_workspace
from solosquad.storage import MigrationFailed
from solosquad.web_api import org_store, totp
from solosquad.web_api.accounts import AccountStore, Assignment, AuthError, Role
from solosquad.web_api.org_store import (
    OrgStore,
    core_path,
    open_accounts,
    open_org,
    org_path,
)


def _solution(tmp: Path, *orgs: str) -> Solution:
    sol = scaffold_solution(tmp / "elon", "2.1.0")
    for name in orgs:
        scaffold_workspace(scaffold_org(sol, name, "bundled", "2.1.0"), "hq")
    return sol


def test_rev6_accounts_move_to_core_with_their_org(tmp_path: Path) -> None:
    sol = _solution(tmp_path, "tesla")
    old = write_rev6_org_db(org_path(sol, "tesla"), passkey=("cred-1", b"public-key", 7))

    core = open_accounts(sol)
    assert core.path == core_path(sol) and core.path.name == "core.db"
    assert core.migrated_orgs() == {"tesla": 2}
    by_name = {u.username: u for u in core.users()}
    assert set(by_name) == {"boss", "kim"}
    assert by_name["boss"].id == old.owner_id and by_name["boss"].role is Role.OWNER
    assert by_name["kim"].role is Role.STAFF
    # the same password and one-time code still log in; an open session stays open
    code = totp.code_at(old.owner_secret, totp.current_step())
    core.login("boss", PASSWORD, code, require_second_factor=True)
    with pytest.raises(AuthError):
        core.login("boss", "wrong password!", code, require_second_factor=True)
    assert core.session(old.session_token) is not None
    assert core.passkey("cred-1") == (old.staff_id, b"public-key", 7)
    assert core.assignments(old.owner_id) == [Assignment("tesla", None, Role.OWNER)]
    assert core.assignments(old.staff_id) == [Assignment("tesla", None, Role.STAFF)]
    assert {e["action"] for e in core.audit_log()} >= {"login", "approval_policy.update"}

    # title and teams stay with the org; the account tables are gone from org.db
    org = open_org(sol, "tesla")
    assert org.member(old.staff_id) == ("MD", ("product",))
    assert not tables(old.path) & {"users", "sessions", "passkeys", "audit"}
    assert {"org_members", "org_audit"} <= tables(old.path)
    # a copy of the original was taken before anything was written
    assert list((old.path.parent / "snapshots").glob("org.pre-core-move.*.db"))

    # the move is done once — a restart finds nothing left to move
    assert org_store.migrate_org_accounts(core, "tesla", old.path) == 0
    assert len(open_accounts(sol).users()) == 2


def test_the_same_username_in_two_orgs_stops_the_move(tmp_path: Path) -> None:
    sol = _solution(tmp_path, "spacex", "tesla")
    a = write_rev6_org_db(org_path(sol, "spacex"), owner="elon", staff="kim")
    b = write_rev6_org_db(org_path(sol, "tesla"), owner="musk", staff="kim")
    before = (sha(a.path), sha(b.path))
    with pytest.raises(MigrationFailed, match="kim"):
        open_accounts(sol)
    assert (sha(a.path), sha(b.path)) == before  # checked first: neither org was touched
    assert not core_path(sol).exists()
    res = CliRunner().invoke(app, ["accounts", "list", "-s", str(sol.root)])
    assert res.exit_code == 1 and "kim" in res.output  # the CLI refuses as the server does


def test_a_failed_move_refuses_and_keeps_the_original(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sol = _solution(tmp_path, "tesla")
    old = write_rev6_org_db(org_path(sol, "tesla"))
    before = sha(old.path)
    real = org_store._copy_rows

    def broken(core: object, table: str, cols: list[str], rows: list[object]) -> None:
        if table == "passkeys":
            raise OSError("disk full")
        real(core, table, cols, rows)  # type: ignore[arg-type]

    monkeypatch.setattr(org_store, "_copy_rows", broken)
    with pytest.raises(MigrationFailed, match="disk full"):
        open_accounts(sol)
    assert sha(old.path) == before
    assert AccountStore(core_path(sol)).users() == []  # rolled back, nothing half-moved
    monkeypatch.setattr(org_store, "_copy_rows", real)
    assert len(open_accounts(sol).users()) == 2  # the next start finishes it


def test_roles_are_per_org_and_the_customer_owner_has_all(tmp_path: Path) -> None:
    sol = _solution(tmp_path, "spacex", "tesla")
    core = open_accounts(sol)
    boss = core.create_user("elon", PASSWORD, Role.OWNER)
    kim = core.create_user(
        "kim",
        PASSWORD,
        Role.STAFF,
        assignments=[Assignment("tesla", None, Role.OWNER), Assignment("spacex", "hq", Role.STAFF)],
    )
    assert core.role_in(boss, "spacex", "anything") is Role.OWNER
    assert core.role_in(kim, "tesla") is Role.OWNER
    assert core.role_in(kim, "tesla", "hq") is Role.OWNER
    assert core.role_in(kim, "spacex") is Role.STAFF  # only one workspace there
    assert core.role_in(kim, "spacex", "hq") is Role.STAFF
    assert core.role_in(kim, "spacex", "rocket") is None
    core.set_assignments(kim.id, [])
    assert core.role_in(core.user(kim.id), "tesla") is None
    with pytest.raises(ValueError, match="twice"):
        core.set_assignments(kim.id, [Assignment("tesla", None, Role.STAFF)] * 2)
    core.set_last_scope(kim.id, "tesla", "hq")
    assert core.last_scope(kim.id) == ("tesla", "hq")


def test_org_members_and_audit(tmp_path: Path) -> None:
    org = OrgStore(tmp_path / "org.db", "tesla")
    assert org.member("u-1") == ("", ())
    assert org.set_member("u-1", title="팀장", teams=["brand", "product", "brand"]) == (
        "팀장",
        ("brand", "product"),
    )
    assert org.set_member("u-1", teams=[]) == ("팀장", ())
    org.audit("u-1", "workflow.enable", "monthly-pnl", workspace="hq")
    assert org.audit_log()[0]["workspace"] == "hq"


# ---------------------------------------------------------------------- language (2026-11-11)


def _as_v5(path: Path, locales: dict[str, str]) -> None:
    from solosquad.storage import connect

    db = connect(path)
    for name, loc in locales.items():
        db.execute("UPDATE users SET locale = ? WHERE username = ?", (loc, name))
    db.execute("UPDATE schema_versions SET version = 5 WHERE component = 'core'")
    db.close()


def test_the_retired_customer_language_becomes_each_followers_own(tmp_path: Path) -> None:
    """Migration 6: people who followed the customer default (`locale` empty) keep the
    language they were seeing as their own, a person's own choice stays, and the default
    leaves `core/server.yaml`."""
    import yaml

    sol = _solution(tmp_path, "tesla")
    core = AccountStore(core_path(sol))
    for name in ("boss", "kim", "lee"):
        core.create_user(name, PASSWORD, Role.STAFF)
    _as_v5(core_path(sol), {"boss": "", "kim": "", "lee": "en"})
    sol.server_config_path.write_text("schema_version: 1\nweb: {locale: zh-CN}\n", "utf-8")
    assert sol.legacy_web_locale() == "zh-CN"

    moved = open_accounts(sol)
    assert {u.username: u.locale for u in moved.users()} == {
        "boss": "zh-CN", "kim": "zh-CN", "lee": "en",
    }  # fmt: skip
    raw = yaml.safe_load(sol.server_config_path.read_text(encoding="utf-8"))
    assert "web" not in raw and sol.legacy_web_locale() is None
    assert "locale" not in sol.server_config().web.model_dump()


def test_without_an_old_default_everyone_unset_gets_korean(tmp_path: Path) -> None:
    sol = _solution(tmp_path, "tesla")
    core = AccountStore(core_path(sol))
    core.create_user("boss", PASSWORD, Role.OWNER)
    core.create_user("kim", PASSWORD, Role.STAFF, locale="")
    _as_v5(core_path(sol), {"boss": "fr"})
    moved = open_accounts(sol)
    assert sorted(u.locale for u in moved.users()) == ["ko", "ko"]
    with pytest.raises(Exception, match="locale"):
        moved.set_locale(moved.users()[0].id, "")
