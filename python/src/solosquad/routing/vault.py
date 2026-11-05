"""Secret store in the data folder — encrypted at rest (PRD v2.1.0 I35).

The file (`secrets.json`, mode 0600) sits under the workspace data folder, never in the
customer-solution repo (decision 37). Its contents are a Fernet token (AES-128-CBC +
HMAC-SHA256). The key is kept apart from the data it protects:

1. `SOLOSQUAD_SECRET_KEY` — set by the customer's cloud secret manager or a systemd
   credential; the key then never touches the disk, or
2. `<SOLOSQUAD_HOME>/keys/secrets.key` (0600, created on first use) — outside every data
   folder, so backups and snapshots (which copy the databases) never carry it.

A plaintext file from v2.0 is read once and rewritten encrypted.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from solosquad.layout import solosquad_home

KEY_ENV = "SOLOSQUAD_SECRET_KEY"
FORMAT = "fernet-v1"
_PRIVATE = stat.S_IRUSR | stat.S_IWUSR


class SecretKeyError(RuntimeError):
    """The secrets file cannot be opened with the key in hand."""


def default_key_path() -> Path:
    return solosquad_home() / "keys" / "secrets.key"


def _write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, _PRIVATE)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(path, _PRIVATE)


class SecretStore:
    def __init__(self, path: Path, key_path: Path | None = None) -> None:
        self.path = path
        self.key_path = key_path

    # ------------------------------------------------------------------ key

    def key_source(self) -> str:
        return f"${KEY_ENV}" if os.environ.get(KEY_ENV) else str(self._key_file())

    def _key_file(self) -> Path:
        return self.key_path or default_key_path()

    def _fernet(self, *, create: bool) -> Fernet | None:
        env = os.environ.get(KEY_ENV)
        if env:
            try:
                return Fernet(env.strip().encode())
            except ValueError as e:
                raise SecretKeyError(f"${KEY_ENV} is not a valid key: {e}") from e
        kf = self._key_file()
        if kf.is_file():
            return Fernet(kf.read_text(encoding="utf-8").strip().encode())
        if not create:
            return None
        kf.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(kf.parent, stat.S_IRWXU)
        _write_private(kf, Fernet.generate_key().decode() + "\n")
        return Fernet(kf.read_text(encoding="utf-8").strip().encode())

    # ------------------------------------------------------------------ file

    def is_plaintext(self) -> bool:
        if not self.path.is_file():
            return False
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return not (isinstance(data, dict) and data.get("format") == FORMAT)

    def _read(self) -> dict[str, str]:
        if not self.path.is_file():
            return {}
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("format") == FORMAT:
            f = self._fernet(create=False)
            if f is None:
                raise SecretKeyError(
                    f"{self.path} is encrypted but no key was found at {self._key_file()} "
                    f"or in ${KEY_ENV} — restore the key from where it was kept"
                )
            try:
                plain = f.decrypt(str(data["data"]).encode())
            except InvalidToken as e:
                raise SecretKeyError(
                    f"{self.path} was encrypted with a different key ({self.key_source()})"
                ) from e
            data = json.loads(plain)
        else:  # a v2.0 plaintext file — encrypt it now
            self._write({str(k): str(v) for k, v in data.items()})
        return {str(k): str(v) for k, v in data.items()}

    def _write(self, data: dict[str, str]) -> None:
        f = self._fernet(create=True)
        assert f is not None
        token = f.encrypt(json.dumps(data).encode()).decode()
        _write_private(self.path, json.dumps({"format": FORMAT, "data": token}))

    def migrate(self) -> bool:
        """Encrypt a plaintext file in place. → True if it was plaintext."""
        if not self.is_plaintext():
            return False
        self._read()
        return True

    # ------------------------------------------------------------------ api

    def get(self, ref: str) -> str | None:
        return self._read().get(ref)

    def set(self, ref: str, value: str) -> None:
        data = self._read()
        data[ref] = value
        self._write(data)

    def delete(self, ref: str) -> None:
        data = self._read()
        if data.pop(ref, None) is not None:
            self._write(data)
