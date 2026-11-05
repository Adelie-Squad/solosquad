"""Secrets encrypted at rest, the key kept apart from the data (PRD v2.1.0 I35)."""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from solosquad.routing.vault import KEY_ENV, SecretKeyError, SecretStore, default_key_path

posix_only = pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes")


def test_values_never_hit_the_disk_in_the_clear(tmp_path: Path, isolated_home: Path) -> None:
    store = SecretStore(tmp_path / "data" / "secrets.json")
    store.set("anthropic", "sk-ant-very-secret")
    raw = store.path.read_text(encoding="utf-8")
    assert "sk-ant-very-secret" not in raw
    assert json.loads(raw)["format"] == "fernet-v1"
    assert store.get("anthropic") == "sk-ant-very-secret"
    # the key lives under SOLOSQUAD_HOME/keys — outside the data folder a backup copies
    assert default_key_path().is_file()
    assert isolated_home in default_key_path().parents
    assert tmp_path / "data" not in default_key_path().parents
    store.delete("anthropic")
    assert store.get("anthropic") is None


@posix_only
def test_file_and_key_are_private(tmp_path: Path) -> None:
    store = SecretStore(tmp_path / "secrets.json")
    store.set("a", "b")
    for p in (store.path, default_key_path()):
        assert stat.S_IMODE(os.stat(p).st_mode) == 0o600


def test_a_v20_plaintext_file_is_encrypted_on_first_open(tmp_path: Path) -> None:
    path = tmp_path / "secrets.json"
    path.write_text(json.dumps({"openai": "sk-old"}), encoding="utf-8")
    store = SecretStore(path)
    assert store.is_plaintext()
    assert store.migrate() is True
    assert "sk-old" not in path.read_text(encoding="utf-8")
    assert store.get("openai") == "sk-old"
    assert store.migrate() is False


def test_key_from_the_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(KEY_ENV, Fernet.generate_key().decode())
    store = SecretStore(tmp_path / "secrets.json")
    store.set("a", "b")
    assert store.get("a") == "b"
    assert not default_key_path().exists()  # the key never touched the disk
    assert store.key_source() == f"${KEY_ENV}"


def test_a_missing_or_wrong_key_says_so(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = SecretStore(tmp_path / "secrets.json")
    store.set("a", "b")
    default_key_path().unlink()
    with pytest.raises(SecretKeyError, match="no key was found"):
        store.get("a")
    monkeypatch.setenv(KEY_ENV, Fernet.generate_key().decode())
    with pytest.raises(SecretKeyError, match="different key"):
        store.get("a")
    monkeypatch.setenv(KEY_ENV, "not-a-key")
    with pytest.raises(SecretKeyError, match="not a valid key"):
        store.get("a")
