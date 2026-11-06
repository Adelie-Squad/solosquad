"""A one-time code in use is replaced only with that code; guessing codes is limited."""

from __future__ import annotations

import time

import pytest
from test_web_api import PASSWORD, Office, _owner, _secret, office  # noqa: F401

from solosquad.web_api import totp
from solosquad.web_api.accounts import FAIL_LIMIT, Role
from solosquad.web_api.app import CSRF_HEADER


async def test_replacing_the_code_needs_the_code_in_use(
    office: Office,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with office.client() as c:
        csrf, secret = await _owner(office, c)
        # the login spent the next step's code; half a minute later a fresh one is valid
        real = time.time
        monkeypatch.setattr(totp.time, "time", lambda: real() + totp.STEP_S)
        h = {CSRF_HEADER: csrf}
        # a taken-over session alone cannot swap the factor
        r = await c.post("/api/auth/totp/begin", json={}, headers=h)
        assert r.status_code == 400 and r.json()["code"] == "otp_current_required"
        r = await c.post("/api/auth/totp/begin", json={"current_code": "000000"}, headers=h)
        assert r.status_code == 400 and r.json()["code"] == "otp_invalid"
        # with the code from the app in use (a step the login did not spend) it goes on
        current = totp.code_at(secret, totp.current_step() + 1)
        r = await c.post("/api/auth/totp/begin", json={"current_code": current}, headers=h)
        assert r.status_code == 200, r.text
        new = _secret(r.json()["uri"])
        assert new != secret
        code = totp.code_at(new, totp.current_step())
        r = await c.post("/api/auth/totp/confirm", json={"code": code}, headers=h)
        assert r.status_code == 200
    actions = [e["action"] for e in office.accounts.audit_log()]
    assert "totp.replace.begin" in actions


async def test_guessing_codes_is_limited(office: Office) -> None:  # noqa: F811
    office.accounts.create_user("kim", PASSWORD, Role.STAFF)
    async with office.client() as c:
        r = await c.post("/api/auth/login", json={"username": "kim", "password": PASSWORD})
        h = {CSRF_HEADER: r.json()["csrf"]}
        uri = (await c.post("/api/auth/totp/begin", headers=h)).json()["uri"]  # first enrolment
        for _ in range(FAIL_LIMIT):
            r = await c.post("/api/auth/totp/confirm", json={"code": "000000"}, headers=h)
            assert r.json()["code"] == "otp_invalid"
        # even the right code is refused once the limit is reached
        good = totp.code_at(_secret(uri), totp.current_step())
        r = await c.post("/api/auth/totp/confirm", json={"code": good}, headers=h)
        assert r.status_code == 429 and r.json()["code"] == "login_throttled"


async def test_guessing_the_current_code_is_limited_too(office: Office) -> None:  # noqa: F811
    async with office.client() as c:
        csrf, _secret_in_use = await _owner(office, c)
        h = {CSRF_HEADER: csrf}
        for _ in range(FAIL_LIMIT):
            r = await c.post("/api/auth/totp/begin", json={"current_code": "000000"}, headers=h)
            assert r.json()["code"] == "otp_invalid"
        r = await c.post("/api/auth/totp/begin", json={"current_code": "000000"}, headers=h)
        assert r.status_code == 429 and r.json()["code"] == "login_throttled"
