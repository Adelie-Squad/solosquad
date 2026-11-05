"""A software WebAuthn authenticator for tests — what a phone or laptop does, in code.

Produces `navigator.credentials.create()` / `.get()` responses: `none` attestation, a P-256
key, user presence + verification flags, an incrementing signature counter.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import struct
from typing import Any

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class SoftAuthenticator:
    def __init__(self) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = secrets.token_bytes(32)
        self.counter = 0
        self.user_handle = b""

    def _cose_key(self) -> bytes:
        nums = self.key.public_key().public_numbers()
        return cbor2.dumps(
            {1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")}
        )

    @staticmethod
    def _client_data(kind: str, challenge: str, origin: str) -> bytes:
        return json.dumps(
            {"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": False}
        ).encode()

    def create(self, options: dict[str, Any], origin: str) -> dict[str, Any]:
        rp_id = options["rp"]["id"]
        self.user_handle = unb64u(options["user"]["id"])
        client = self._client_data("webauthn.create", options["challenge"], origin)
        attested = (
            bytes(16)  # aaguid
            + struct.pack(">H", len(self.credential_id))
            + self.credential_id
            + self._cose_key()
        )
        auth_data = (
            hashlib.sha256(rp_id.encode()).digest()
            + bytes([0x45])
            + struct.pack(">I", 0)
            + attested
        )
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        cid = b64u(self.credential_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": b64u(client),
                "attestationObject": b64u(att),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }

    def get(self, options: dict[str, Any], origin: str, rp_id: str | None = None) -> dict[str, Any]:
        rp = rp_id or options["rpId"]
        self.counter += 1
        client = self._client_data("webauthn.get", options["challenge"], origin)
        auth_data = (
            hashlib.sha256(rp.encode()).digest() + bytes([0x05]) + struct.pack(">I", self.counter)
        )
        sig = self.key.sign(auth_data + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
        cid = b64u(self.credential_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": b64u(client),
                "authenticatorData": b64u(auth_data),
                "signature": b64u(sig),
                "userHandle": b64u(self.user_handle),
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }
