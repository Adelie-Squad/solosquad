"""Passkeys — the default sign-in of decision 46 W3 (PRD v2.1.0 I19 · C2)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from soft_authenticator import SoftAuthenticator
from test_web_api import PASSWORD, Office

from solosquad.web_api.accounts import Role
from solosquad.web_api.app import CSRF_HEADER

ORIGIN = "https://office.example"


@pytest.fixture
async def office(tmp_path: Path) -> AsyncIterator[Office]:
    o = Office(tmp_path)
    cfg = o.workspace.config()
    o.workspace.save_config(cfg.model_copy(update={"public_url": ORIGIN}))
    await o.manager.start()
    yield o
    await o.manager.stop()


async def _register(o: Office, phone: SoftAuthenticator, name: str = "kim") -> None:
    o.accounts.create_user(name, PASSWORD, Role.STAFF)
    async with o.client() as c:
        r = await c.post("/api/auth/login", json={"username": name, "password": PASSWORD})
        assert r.json()["stage"] == "enroll"  # first login: a strong factor is still missing
        h = {CSRF_HEADER: r.json()["csrf"]}
        begin = (await c.post("/api/auth/passkey/register/begin", headers=h)).json()
        assert begin["options"]["rp"]["id"] == "office.example"
        assert begin["options"]["authenticatorSelection"]["residentKey"] == "required"
        cred = phone.create(begin["options"], ORIGIN)
        r = await c.post(
            "/api/auth/passkey/register/finish",
            json={"challenge_id": begin["challenge_id"], "credential": cred, "name": "iPhone"},
            headers=h,
        )
        assert r.status_code == 200, r.text
        assert [p["name"] for p in r.json()["passkeys"]] == ["iPhone"]
        assert (await c.get("/api/threads")).status_code == 200  # enrolment done by the passkey


async def _passkey_login(o: Office, phone: SoftAuthenticator, origin: str = ORIGIN) -> int:
    async with o.client() as c:
        begin = (await c.post("/api/auth/passkey/login/begin", json={})).json()
        cred = phone.get(begin["options"], origin, rp_id="office.example")
        r = await c.post(
            "/api/auth/passkey/login/finish",
            json={"challenge_id": begin["challenge_id"], "credential": cred},
        )
        if r.status_code == 200:
            assert (await c.get("/api/threads")).status_code == 200
        return r.status_code


async def test_register_then_sign_in_without_a_password(office: Office) -> None:
    phone = SoftAuthenticator()
    await _register(office, phone)
    assert await _passkey_login(office, phone) == 200
    assert await _passkey_login(office, phone) == 200  # the signature counter moved on
    assert any(e["action"] == "login.passkey" for e in office.accounts.audit_log())


async def test_a_replayed_or_foreign_assertion_is_refused(office: Office) -> None:
    phone = SoftAuthenticator()
    await _register(office, phone)
    async with office.client() as c:
        begin = (await c.post("/api/auth/passkey/login/begin", json={})).json()
        cred = phone.get(begin["options"], ORIGIN, rp_id="office.example")
        body = {"challenge_id": begin["challenge_id"], "credential": cred}
        assert (await c.post("/api/auth/passkey/login/finish", json=body)).status_code == 200
        assert (await c.post("/api/auth/passkey/login/finish", json=body)).status_code == 401
    # a phishing page on another origin gets a signature that does not verify here
    assert await _passkey_login(office, phone, origin="https://office-example.evil") == 401
    stranger = SoftAuthenticator()  # never registered
    stranger.user_handle = b"x"
    assert await _passkey_login(office, stranger) == 401


async def test_owner_reset_and_disabled_accounts(office: Office) -> None:
    phone = SoftAuthenticator()
    await _register(office, phone)
    kim = next(u for u in office.accounts.users() if u.username == "kim")
    office.accounts.set_disabled(kim.id, True)
    assert await _passkey_login(office, phone) == 401
    office.accounts.set_disabled(kim.id, False)
    office.accounts.clear_passkeys(kim.id)  # lost phone: the owner resets
    assert await _passkey_login(office, phone) == 401


async def test_passkeys_need_the_public_url(office: Office) -> None:
    cfg = office.workspace.config()
    office.workspace.save_config(cfg.model_copy(update={"public_url": None}))
    async with office.client() as c:
        r = await c.post("/api/auth/passkey/login/begin", json={})
        assert r.status_code == 409 and "public_url" in r.json()["error"]
