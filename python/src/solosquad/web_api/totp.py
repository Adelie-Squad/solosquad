"""RFC 6238 time-based one-time passwords — standard library only (PRD v2.1.0 I18 · I19).

SHA-1 · 6 digits · 30 s steps: the parameters every authenticator app (Google
Authenticator, 1Password, Authy, Microsoft Authenticator) reads from an `otpauth://` URI.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

DIGITS = 6
STEP_S = 30
DRIFT_STEPS = 1
"""Accept the previous and next step too — phone clocks drift."""


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    pad = "=" * (-len(secret) % 8)
    return base64.b32decode(secret.upper() + pad)


def code_at(secret: str, step: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP_S)


def verify(secret: str, code: str, now: float | None = None, last_step: int = -1) -> int | None:
    """→ the matched step (store it to refuse a replay), or None.

    `last_step` is the step a code was last accepted at; codes at or before it are
    rejected so one code cannot log in twice.
    """
    code = code.strip().replace(" ", "")
    if len(code) != DIGITS or not code.isdigit():
        return None
    base = current_step(now)
    for step in range(base - DRIFT_STEPS, base + DRIFT_STEPS + 1):
        if step > last_step and hmac.compare_digest(code_at(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, account: str, issuer: str = "SoloSquad") -> str:
    label = quote(f"{issuer}:{account}", safe=":@")
    return (
        f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}"
        f"&algorithm=SHA1&digits={DIGITS}&period={STEP_S}"
    )
