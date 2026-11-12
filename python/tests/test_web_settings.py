"""v2.1.0 slice 4b — passkeys and snapshots through the web API.

PRD v2.1.0: decision 46 W3 (passkeys) · decision 54 /
I36 (snapshots). Reads are open to everyone; every change is the owner's and audited.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from soft_authenticator import SoftAuthenticator
from test_passkeys import ORIGIN
from test_web_api import PASSWORD, Office, _next_code, _secret

from solosquad.routing.vault import SecretStore
from solosquad.web_api import schemas as S
from solosquad.web_api import totp
from solosquad.web_api.accounts import Assignment, Role
from solosquad.web_api.app import CSRF_HEADER


class Settings(Office):
    def __init__(self, tmp: Path) -> None:
        super().__init__(tmp)
        self.secrets = SecretStore(tmp / "secrets.json")
        self.runs: list[str] = []

        def run_now() -> dict[str, Any]:
            target = self.workspace.org.solution.server_config().snapshot
            self.runs.append(str(target.type))
            if target.type is None:
                return {"target": None, "skipped": "no snapshot target configured"}
            return {"target": target.type, "location": "x", "files": 3, "pruned": []}

        self.web.rebuild(secrets=self.secrets, run_snapshot=run_now)
        self.app = self.web.app

    async def login(self, c: httpx.AsyncClient, name: str, role: Role) -> dict[str, str]:
        user = self.accounts.create_user(
            name, PASSWORD, role, assignments=[Assignment("tesla", None, role)]
        )
        secret = _secret(self.accounts.begin_totp(user.id))
        assert self.accounts.confirm_totp(user.id, totp.code_at(secret, totp.current_step()))
        r = await c.post(
            "/api/auth/login",
            json={"username": name, "password": PASSWORD, "otp": _next_code(secret)},
        )
        assert r.status_code == 200, r.text
        return {CSRF_HEADER: r.json()["csrf"]}


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Settings]:
    o = Settings(tmp_path)
    await o.manager.start()
    yield o
    await o.manager.stop()


def _actions(o: Office) -> list[str]:
    return [e["action"] for e in o.accounts.audit_log()]


# ---------------------------------------------------------------------- passkeys


async def test_passkey_flow_through_the_contract(office: Settings) -> None:
    async with office.client() as c:
        assert (await c.get("/api/health")).json() == {
            "ok": True,
            "passkeys": False,
        }
        office.workspace.org.solution.update_server_config(public_url=ORIGIN)
        assert (await c.get("/api/health")).json() == {
            "ok": True,
            "passkeys": True,
        }

    phone = SoftAuthenticator()
    office.accounts.create_user("kim", PASSWORD, Role.STAFF)
    async with office.client() as c:
        r = await c.post("/api/auth/login", json={"username": "kim", "password": PASSWORD})
        assert r.json()["stage"] == "enroll"
        h = {CSRF_HEADER: r.json()["csrf"]}
        begin = (await c.post("/api/auth/passkey/register/begin", headers=h)).json()
        S.PasskeyOptions.model_validate(begin)
        cred = phone.create(begin["options"], ORIGIN)
        added = await c.post(
            "/api/auth/passkey/register/finish",
            json={"challenge_id": begin["challenge_id"], "credential": cred, "name": "Pixel"},
            headers=h,
        )
        S.PasskeyAdded.model_validate(added.json())
        mine = (await c.get("/api/me/passkeys")).json()
        assert [p["name"] for p in mine] == ["Pixel"] and mine[0]["last_used"] is None
        assert (await c.get("/api/me")).json()["stage"] == "full"

    async with office.client() as c:  # discoverable: no username
        begin = (await c.post("/api/auth/passkey/login/begin", json={})).json()
        assert begin["options"].get("allowCredentials", []) == []
        cred = phone.get(begin["options"], ORIGIN, rp_id="office.example")
        r = await c.post(
            "/api/auth/passkey/login/finish",
            json={"challenge_id": begin["challenge_id"], "credential": cred},
        )
        me = S.Me.model_validate(r.json())
        assert me.user is not None and me.user.username == "kim" and me.stage == "full"
        h = {CSRF_HEADER: str(me.csrf)}
        pid = (await c.get("/api/me/passkeys")).json()[0]["id"]
        assert (await c.delete(f"/api/me/passkeys/{pid}", headers=h)).json() == {"ok": True}
        assert (await c.get("/api/me/passkeys")).json() == []
    assert {"passkey.add", "login.passkey", "passkey.remove"} <= set(_actions(office))


async def test_owner_resets_someone_elses_passkeys(office: Settings) -> None:
    office.workspace.org.solution.update_server_config(public_url=ORIGIN)
    kim = office.accounts.create_user("kim", PASSWORD, Role.STAFF)
    office.accounts.add_passkey(kim.id, "cred-1", b"pk", 0, [], "old phone")
    async with office.client() as boss:
        hb = await office.login(boss, "boss", Role.OWNER)
        r = await boss.patch(f"/api/users/{kim.id}", json={"reset_passkeys": True}, headers=hb)
        assert r.status_code == 200
    assert office.accounts.passkeys(kim.id) == []
    assert "user.passkeys.reset" in _actions(office)


# ---------------------------------------------------------------------- the retired profile


async def test_the_profile_endpoint_is_gone(office: Settings) -> None:
    """2026-11-11: 회사 프로필 → 서버 (detected, read-only) + 회사 (core.db)."""
    async with office.client() as boss:
        hb = await office.login(boss, "boss", Role.OWNER)
        assert (await boss.get("/api/profile")).status_code == 404
        assert (await boss.put("/api/profile", json={}, headers=hb)).status_code in (404, 405)
        assert (await boss.get("/api/server")).status_code == 200
        assert (await boss.get("/api/company")).status_code == 200


# ---------------------------------------------------------------------- snapshots


async def test_snapshot_settings_keep_the_keys_out_of_every_response(
    office: Settings, tmp_path: Path
) -> None:
    async with office.client() as boss, office.client("203.0.113.9") as kim:
        hb = await office.login(boss, "boss", Role.OWNER)
        hk = await office.login(kim, "kim", Role.STAFF)
        first = (await kim.get("/api/snapshot")).json()
        assert first["type"] is None and first["has_secret"] is False
        s3 = {"type": "s3", "endpoint": "https://s3.example", "bucket": "bk", "region": "kr"}
        assert (await kim.put("/api/snapshot", json=s3, headers=hk)).status_code == 403
        # the same checks as `snapshot set`: s3 needs endpoint, bucket — and keys
        for bad in ({"type": "s3", "bucket": "bk"}, {"type": "dir"}, s3, {"type": "ftp"}):
            r = await boss.put("/api/snapshot", json=bad, headers=hb)
            assert r.status_code == 400, (bad, r.text)
            want = "snapshot_keys_required" if bad is s3 else "snapshot_invalid"
            assert r.json()["code"] == want, (bad, r.text)
        keys = {"access_key": "AKIAEXAMPLE", "secret_key": "very-secret-value"}
        r = await boss.put("/api/snapshot", json={**s3, **keys}, headers=hb)
        assert r.status_code == 200, r.text
        assert r.json()["has_secret"] is True and r.json()["bucket"] == "bk"
        assert office.secrets.get("snapshot-s3") == "AKIAEXAMPLE:very-secret-value"
        r = await boss.put("/api/snapshot", json={**s3, "keep_days": 7}, headers=hb)
        assert r.json()["keep_days"] == 7 and r.json()["has_secret"] is True  # keys kept
        for resp in (r, await kim.get("/api/snapshot")):
            text = json.dumps(resp.json())
            assert "very-secret" not in text and "AKIA" not in text
            assert "secret_ref" not in resp.json()
        assert (await kim.post("/api/snapshot/run", headers=hk)).status_code == 403
        ran = await boss.post("/api/snapshot/run", headers=hb)
        assert ran.status_code == 200 and ran.json()["target"] == "s3"
        folder = tmp_path / "vault"
        r = await boss.put("/api/snapshot", json={"type": "dir", "path": str(folder)}, headers=hb)
        assert r.json()["type"] == "dir" and r.json()["has_secret"] is False
        assert (await boss.post("/api/snapshot/run", headers=hb)).json()["target"] == "dir"
        r = await boss.put("/api/snapshot", json={"type": None}, headers=hb)
        assert r.json()["type"] is None
    assert office.runs == ["s3", "dir"]
    log = office.accounts.audit_log()
    assert {"snapshot.update", "snapshot.run"} <= {e["action"] for e in log}
    assert not any("very-secret" in str(e["detail"]) for e in log)
