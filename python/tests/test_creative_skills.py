"""The creative agent's 3D · motion · video skills (2026-11-13).

The four bundled skills must exist, pass the v1 gate with no finding, be wired both ways
(skill `used_by` ↔ agent `skills_used` / team `shared_skills`), carry the sections an agent
follows (when · inputs · steps · checks · pitfalls · sources), and ship Blender scripts that
at least compile — CI has no Blender, the scripts were run by hand against Blender 5.2.
"""

from __future__ import annotations

import ast
import csv
import importlib.util
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

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


# --- clearance_check: unsigned clearance, penetration only from the BVH overlap (2026-11-14) ---

CLEARANCE = Path(__file__).resolve().parents[2] / "skills/rig-motion-clearance/scripts"


def _clearance_module() -> Any:
    spec = importlib.util.spec_from_file_location(
        "clearance_check", CLEARANCE / "clearance_check.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # bpy is optional at import; main() only runs as __main__
    return mod


def _flat_shell(z: float, normal_z: float) -> Any:
    """A horizontal open shell at height z whose stored normal may point the 'wrong' way."""

    def find_nearest(v: tuple[float, float, float]) -> tuple[Any, Any, int, float]:
        loc = (v[0], v[1], z)
        return loc, (0.0, 0.0, normal_z), 0, abs(v[2] - z)

    return find_nearest


def test_open_shell_pair_is_not_negative() -> None:
    """Head and body split from one mesh by vertex group are open shells: a flipped normal
    must not turn a 0.3 m gap into -0.3 m (the standing-pose false failure)."""
    cc = _clearance_module()
    wing = [(0.0, 0.0, 0.2), (0.1, 0.0, 0.25)]
    head = [(0.0, 0.0, 0.5), (0.2, 0.0, 0.5)]
    wing_nearest = _flat_shell(0.2, -1.0)
    head_nearest = _flat_shell(0.5, 1.0)  # wing sits "behind" the head shell's normal
    gap, at = cc.pair_clearance(wing, wing_nearest, head, head_nearest, False)
    assert gap == pytest.approx(0.25)
    assert at == (0.1, 0.0, 0.25)


def test_crossing_reports_zero_clearance() -> None:
    cc = _clearance_module()
    near = _flat_shell(0.0, 1.0)
    gap, _ = cc.pair_clearance([(0.0, 0.0, 0.4)], near, [(0.0, 0.0, 0.3)], near, True)
    assert gap == 0.0


def _blender() -> str | None:
    for cand in (
        os.environ.get("BLENDER"),
        shutil.which("blender"),
        "/Applications/Blender.app/Contents/MacOS/Blender",
    ):
        if cand and Path(cand).is_file():
            return cand
    return None


OPEN_SHELL_SCENE = """
import bpy, bmesh
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0, 0))
ob = bpy.context.object
ob.name = "Penguin"
bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context="VERTS")
bmesh.ops.create_cube(bm, size=0.2, matrix=__import__("mathutils").Matrix.Translation((0, 0, 0.2)))
bm.to_mesh(ob.data); bm.free()
head = ob.vertex_groups.new(name="head"); wing = ob.vertex_groups.new(name="wing")
for v in ob.data.vertices:
    (wing if v.co.z < 0.31 and abs(v.co.x) < 0.11 and abs(v.co.y) < 0.11 else head).add([v.index], 1.0, "REPLACE")
bpy.ops.wm.save_as_mainfile(filepath=OUT)
"""


@pytest.mark.skipif(_blender() is None, reason="Blender not installed (CI)")
def test_open_shell_vertex_groups_in_blender(tmp_path: Path) -> None:
    """Upper hemisphere (open shell, group head) over a small cube (group wing) inside its
    cavity: 0.7 m apart, so the check must pass; the old normal-signed gap failed it."""
    blender = _blender()
    assert blender is not None
    blend = tmp_path / "shell.blend"
    build = tmp_path / "build.py"
    build.write_text(f"OUT = {str(blend)!r}\n" + OPEN_SHELL_SCENE, encoding="utf-8")
    subprocess.run(
        [blender, "-b", "--factory-startup", "--python", str(build)],
        check=True,
        capture_output=True,
        timeout=120,
    )
    out = tmp_path / "c.csv"
    run = subprocess.run(
        [
            blender,
            "-b",
            str(blend),
            "--python",
            str(CLEARANCE / "clearance_check.py"),
            "--",
            "--moving",
            "Penguin:wing",
            "--against",
            "Penguin:head",
            "--frames",
            "1-1",
            "--min-clearance",
            "0.05",
            "--out",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert run.returncode == 0, run.stdout[-2000:]
    rows = list(csv.DictReader(out.open(encoding="utf-8")))
    assert rows[0]["crossing"] == "False"
    assert float(rows[0]["clearance"]) == pytest.approx(0.7, abs=0.05)


# --- rea-video: vendored at a pinned commit with local safety changes (2026-11-14) ---

REA = Path(__file__).resolve().parents[2] / "skills" / "rea-video"
REA_COMMIT = "6b6b3df9f6592d51040e0faf74b666332bb7c404"


def test_rea_video_skill_is_wired_and_clean(repo_root: Path) -> None:
    spec = _spec(REA / "SKILL.md")
    assert [
        i.code for i in validate_skill(spec, dir_name="rea-video", strict_name=True).issues
    ] == []
    assert "rea-video" in _skills_used(_agent(repo_root, "creative"))
    assert "`rea-video`" in _agent(repo_root, "creative").body
    brand = read_composition(repo_root / "teams" / "brand" / "composition.yaml")
    assert brand is not None and "rea-video" in brand.shared_skills  # marketer is in used_by


def test_rea_video_is_pinned_with_its_licence() -> None:
    assert REA_COMMIT in (REA / "UPSTREAM.md").read_text(encoding="utf-8")
    assert REA_COMMIT[:7] in (REA / "SKILL.md").read_text(encoding="utf-8")
    assert "Apache License" in (REA / "vendor" / "LICENSE").read_text(encoding="utf-8")
    assert "JuneYaooo" in (REA / "vendor" / "NOTICE").read_text(encoding="utf-8")


def test_rea_video_unsafe_parts_are_not_vendored() -> None:
    assert not (REA / "vendor" / "rea_video" / "integrations").exists()
    assert not (REA / "references" / "remake-tools.md").exists()
    assert not list(REA.rglob("install_skill.sh"))
    for md in REA.rglob("*.md"):
        if md.name == "UPSTREAM.md":  # the change log names what was removed
            continue
        text = md.read_text(encoding="utf-8").lower()
        assert "chatcut" not in text, md
        assert "@ git+https" not in text or md.name == "SKILL.md", md
    cli = (REA / "vendor" / "rea_video" / "cli.py").read_text(encoding="utf-8")
    assert "integrations" not in cli.replace("`integrations/`", "")
    assert "subprocess.call" not in cli


def test_rea_video_env_file_cannot_choose_a_program(tmp_path: Path, monkeypatch: Any) -> None:
    spec = importlib.util.spec_from_file_location(
        "rea_util", REA / "vendor" / "rea_video" / "util.py"
    )
    assert spec is not None and spec.loader is not None
    util = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(util)  # stdlib only
    for key in ("REA_CHROME", "CAPSULE_CINEMA_PYTHON", "REA_VLM_MODEL"):
        monkeypatch.delenv(key, raising=False)
    env = tmp_path / ".env"
    env.write_text(
        "REA_CHROME=/bin/x\nCAPSULE_CINEMA_PYTHON=/bin/x\nREA_VLM_MODEL=m\n", encoding="utf-8"
    )
    util.load_env_files([env])
    assert os.environ.get("REA_CHROME") is None
    assert os.environ.get("CAPSULE_CINEMA_PYTHON") is None
    assert os.environ.get("REA_VLM_MODEL") == "m"


def test_rea_video_report_keeps_remote_images_as_links() -> None:
    report = (REA / "vendor" / "rea_video" / "report.py").read_text(encoding="utf-8")
    assert "m.group(0) if _remote(m.group(2))" in report


def test_previz_assembly_uses_one_pinned_video_tool(repo_root: Path) -> None:
    text = (repo_root / "skills" / "previz-assembly" / "SKILL.md").read_text(encoding="utf-8")
    assert "hyperframes@0.9.41" in text
    assert "HYPERFRAMES_NO_TELEMETRY=1" in text
    # the other tools appear only in the paragraph that says why they were not chosen
    for para in text.split("\n\n"):
        if any(o in para for o in ("Remotion", "Motion Canvas", "Revideo", "MoviePy")):
            assert "제외" in para or "remotion-to-hyperframes" in para, para[:120]
