"""`validate_skill` reports what v1.4.3 `validateSkill` reported (golden from
scripts/dump-validate-golden.ts), and the solution checks catch broken wiring."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from solosquad.assets.skill import parse_skill_md
from solosquad.assets.validate import validate_skill

GOLDEN = Path(__file__).parent / "golden" / "validate-v1.4.3.json"


@pytest.fixture(scope="module")
def golden() -> dict[str, Any]:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def _codes(report: Any) -> dict[str, list[str]]:
    return {
        "errors": [i.code for i in report.errors],
        "warnings": [i.code for i in report.warnings],
    }


def test_bundle_matches_v1_gate(golden: dict[str, Any], repo_root: Path) -> None:
    for rel, want in golden["bundle"].items():
        path = repo_root / rel
        spec = parse_skill_md(path.read_text(encoding="utf-8"), rel)
        got = validate_skill(spec, dir_name=path.parent.name, strict_name=True)
        assert _codes(got) == want, rel


def test_synthetic_cases_match_v1_gate(golden: dict[str, Any]) -> None:
    for key, case in golden["cases"].items():
        raw = f"---\n{case['front']}\n---\n{case.get('body', 'body\n')}"
        spec = parse_skill_md(raw, f"case/{key}")
        got = validate_skill(
            spec,
            dir_name=case.get("dir"),
            strict_name=case.get("strict", False),
            freq_skill_count=case.get("freq"),
        )
        assert _codes(got) == golden["synthetic"][key], key
