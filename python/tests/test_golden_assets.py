"""PRD v2.0.0 [0] AC: the Python readers parse the v1.4.3 bundle exactly like the TS parsers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from solosquad.assets.bundle import load_bundle

GOLDEN = Path(__file__).parent / "golden" / "assets-v1.4.3.json"


def _roundtrip(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


@pytest.fixture(scope="module")
def golden() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(GOLDEN.read_text(encoding="utf-8"))
    return data


@pytest.fixture(scope="module")
def ours() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[2]
    bundle = load_bundle(root)
    assert bundle.errors == []
    result: dict[str, Any] = _roundtrip(bundle.to_json_dict())
    return result


@pytest.mark.parametrize("kind", ["agents", "skills", "teams", "crons"])
def test_same_files(kind: str, golden: dict[str, Any], ours: dict[str, Any]) -> None:
    assert sorted(ours[kind]) == sorted(golden[kind])


@pytest.mark.parametrize("kind", ["agents", "skills", "teams", "crons"])
def test_same_values(kind: str, golden: dict[str, Any], ours: dict[str, Any]) -> None:
    mismatched = [key for key in golden[kind] if ours[kind].get(key) != golden[kind][key]]
    assert mismatched == []
