"""The creative agent's 3D · motion · video skills (2026-11-13).

The four bundled skills must exist, pass the v1 gate with no finding, be wired both ways
(skill `used_by` ↔ agent `skills_used` / team `shared_skills`), carry the sections an agent
follows (when · inputs · steps · checks · pitfalls · sources), and ship Blender scripts that
at least compile — CI has no Blender, the scripts were run by hand against Blender 5.2.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from solosquad.assets.composition import read_composition
from solosquad.assets.skill import SkillSpec, parse_skill_md
from solosquad.assets.validate import validate_skill

SKILLS = ("3d-previz-edit", "rig-motion-clearance", "reference-video-analysis", "previz-assembly")
SCRIPTS = {
    "3d-previz-edit": ("qa_render.py", "render_compare.py"),
    "rig-motion-clearance": ("clearance_check.py", "motion_path.py"),
}
SECTIONS = ("## 언제 쓰나", "## 입력", "## 절차", "## 체크", "## 함정", "## 출처")


def _spec(path: Path) -> SkillSpec:
    return parse_skill_md(path.read_text(encoding="utf-8"), str(path))


def _agent(repo_root: Path, name: str) -> SkillSpec:
    return _spec(repo_root / "agents" / "specialists" / name / "SKILL.md")


def _skills_used(spec: SkillSpec) -> list[str]:
    used = spec.extra.get("skills_used")
    assert isinstance(used, list)
    return [s for s in used if isinstance(s, str)]


@pytest.mark.parametrize("name", SKILLS)
def test_skill_passes_the_gate_clean(repo_root: Path, name: str) -> None:
    path = repo_root / "skills" / name / "SKILL.md"
    report = validate_skill(_spec(path), dir_name=name, strict_name=True)
    assert [i.code for i in report.issues] == []


@pytest.mark.parametrize("name", SKILLS)
def test_skill_body_has_every_section(repo_root: Path, name: str) -> None:
    body = _spec(repo_root / "skills" / name / "SKILL.md").body
    missing = [s for s in SECTIONS if s not in body]
    assert missing == [], (name, missing)


def test_creative_uses_all_four(repo_root: Path) -> None:
    creative = _agent(repo_root, "creative")
    assert set(SKILLS) <= set(_skills_used(creative))
    for name in SKILLS:
        assert f"`{name}`" in creative.body, f"creative body does not route to {name}"


@pytest.mark.parametrize("name", SKILLS)
def test_used_by_matches_who_loads_it(repo_root: Path, name: str) -> None:
    skill = _spec(repo_root / "skills" / name / "SKILL.md")
    users = skill.extra.get("used_by")
    assert isinstance(users, list) and "creative" in users
    brand = read_composition(repo_root / "teams" / "brand" / "composition.yaml")
    assert brand is not None
    for user in users:
        agent = _agent(repo_root, user)
        via_team = user in brand.members and name in brand.shared_skills
        assert name in _skills_used(agent) or via_team, (name, user)


@pytest.mark.parametrize(("skill", "files"), SCRIPTS.items())
def test_blender_scripts_compile(repo_root: Path, skill: str, files: tuple[str, ...]) -> None:
    for f in files:
        path = repo_root / "skills" / skill / "scripts" / f
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        assert f"scripts/{f}" in (repo_root / "skills" / skill / "SKILL.md").read_text(
            encoding="utf-8"
        )
