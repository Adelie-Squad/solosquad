"""The creative agent's logo-design skill (2026-11-25).

Adapted from kaankiziltug/logo-design-skill (MIT) at a pinned commit: the skill must pass the v1
gate, be wired both ways (creative `skills_used` + routing row, brand `shared_skills` for marketer),
carry its licence and commit, ship none of the upstream's trademarked logo library, and keep the
local safety changes (no network from renderers, no DTD, validated colours).
"""

from __future__ import annotations

import ast
import importlib.util
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from solosquad.assets.composition import read_composition
from solosquad.assets.skill import SkillSpec, parse_skill_md
from solosquad.assets.validate import validate_skill

LOGO = Path(__file__).resolve().parents[2] / "skills" / "logo-design"
LOGO_COMMIT = "e9eaddc07895575253d6663320354a708f53e955"
SECTIONS = ("## 언제 쓰나", "## 입력", "## 절차", "## 체크", "## 함정", "## 출처")
SCRIPTS = (
    "svglib.py",
    "svg_audit.py",
    "preview_sheet.py",
    "concept_sheet.py",
    "presentation_board.py",
    "render_png.py",
    "export_variants.py",
)
MARK = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>t</title>'
    '<path fill-rule="evenodd" d="M128 24a104 104 0 1 0 0 208a104 104 0 1 0 0-208z'
    'm0 40a64 64 0 1 1 0 128a64 64 0 1 1 0-128z"/></svg>'
)


def _spec(path: Path) -> SkillSpec:
    return parse_skill_md(path.read_text(encoding="utf-8"), str(path))


def _module(name: str) -> Any:
    scripts = str(LOGO / "scripts")
    sys.path.insert(0, scripts)  # the scripts import their sibling svglib
    try:
        spec = importlib.util.spec_from_file_location(
            f"logo_{name}", LOGO / "scripts" / f"{name}.py"
        )
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        sys.path.remove(scripts)


def _write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def test_skill_is_clean_and_wired(repo_root: Path) -> None:
    spec = _spec(LOGO / "SKILL.md")
    report = validate_skill(spec, dir_name="logo-design", strict_name=True)
    assert [i.code for i in report.issues] == []
    assert [s for s in SECTIONS if s not in spec.body] == []

    creative = _spec(repo_root / "agents" / "specialists" / "creative" / "SKILL.md")
    used = creative.extra.get("skills_used")
    assert isinstance(used, list) and "logo-design" in used
    assert "`logo-design`" in creative.body  # routing table row
    triggers = creative.triggers
    assert isinstance(triggers, dict)
    for word in ("로고", "wordmark", "标志"):  # ko / en / zh-CN
        assert word in triggers["keyword"], word

    users = spec.extra.get("used_by")
    assert isinstance(users, list) and {"creative", "marketer"} <= set(users)
    brand = read_composition(repo_root / "teams" / "brand" / "composition.yaml")
    assert brand is not None and "logo-design" in brand.shared_skills  # how marketer gets it


def test_pinned_with_its_licence() -> None:
    assert LOGO_COMMIT in (LOGO / "UPSTREAM.md").read_text(encoding="utf-8")
    assert LOGO_COMMIT in (LOGO / "NOTICE").read_text(encoding="utf-8")
    assert LOGO_COMMIT[:7] in (LOGO / "SKILL.md").read_text(encoding="utf-8")
    licence = (LOGO / "LICENSE").read_text(encoding="utf-8")
    assert "MIT License" in licence and "kaankiziltug" in licence
    for f in SCRIPTS:
        head = (LOGO / "scripts" / f).read_text(encoding="utf-8")[:400]
        assert "kaankiziltug/logo-design-skill @ e9eaddc" in head, f


def test_ships_no_trademarked_library() -> None:
    assert not (LOGO / "assets").exists()
    assert not list(LOGO.rglob("*.svg"))
    assert not list(LOGO.rglob("search_library.py"))
    assert not list(LOGO.rglob("build_catalog.py"))
    for py in (LOGO / "scripts").glob("*.py"):
        src = py.read_text(encoding="utf-8")
        assert "LIBRARY_SVG_DIR" not in src and "CATALOG_PATH" not in src, py.name


@pytest.mark.parametrize("name", SCRIPTS)
def test_scripts_have_no_network_shell_or_eval(name: str) -> None:
    src = (LOGO / "scripts" / name).read_text(encoding="utf-8")
    tree = ast.parse(src, filename=name)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id not in ("eval", "exec"), name
    assert not imported & {"urllib", "http", "socket", "requests", "httpx", "ftplib", "webbrowser"}
    assert "shell=True" not in src


def test_svgo_config_keeps_the_viewbox() -> None:
    cfg = (LOGO / "scripts" / "svgo.config.mjs").read_text(encoding="utf-8")
    code = "\n".join(line.split("//")[0] for line in cfg.splitlines())
    assert "removeViewBox" not in code
    assert "preset-default" in code and "removeDimensions" in code
    assert "svgo@4.0.0" in (LOGO / "references" / "production.md").read_text(encoding="utf-8")


def test_references_cover_fonts_rights_and_export() -> None:
    fonts = (LOGO / "references" / "fonts-korean.md").read_text(encoding="utf-8")
    for f in ("Pretendard", "Wanted Sans", "SUIT", "Inter", "Noto Sans KR", "Noto Sans SC", "OFL"):
        assert f in fonts, f
    rights = (LOGO / "references" / "rights.md").read_text(encoding="utf-8")
    for w in ("KIPRIS", "USPTO", "9류", "35류", "42류", "사람이 다듬은 벡터"):
        assert w in rights, w
    prod = (LOGO / "references" / "production.md").read_text(encoding="utf-8")
    assert "--export-text-to-path" in prod and "--export-type=pdf" in prod


def test_audit_flags_live_text_and_passes_a_clean_mark(tmp_path: Path) -> None:
    audit = _module("svg_audit")
    clean = _write(tmp_path / "clean.svg", MARK)
    assert [f for f in audit.audit(str(clean))["findings"] if f["level"] == "FAIL"] == []
    texty = _write(tmp_path / "text.svg", MARK.replace("</svg>", "<text>JESL</text></svg>"))
    assert "live-text" in {f["code"] for f in audit.audit(str(texty))["findings"]}


def test_tools_refuse_entities_and_external_refs(tmp_path: Path) -> None:
    svglib = _module("svglib")
    bomb = _write(tmp_path / "bomb.svg", '<!DOCTYPE svg [<!ENTITY a "x">]>' + MARK)
    with pytest.raises(ValueError):
        svglib.load_svg(str(bomb))
    render = _module("render_png")
    remote = _write(
        tmp_path / "remote.svg",
        MARK.replace("</svg>", '<image href="https://example.com/a.png"/></svg>'),
    )
    with pytest.raises(ValueError):
        render.wrap_svg(str(remote), 64, 64)
    assert "<svg" in render.wrap_svg(str(_write(tmp_path / "ok.svg", MARK)), 64, 64)
    assert "--host-resolver-rules=MAP * ~NOTFOUND" in render.CHROME_OFFLINE


def test_preview_sheet_shelf_uses_generic_marks(tmp_path: Path) -> None:
    mark = _write(tmp_path / "m.svg", MARK)
    out = tmp_path / "p.html"
    subprocess.run(
        [
            sys.executable,
            str(LOGO / "scripts" / "preview_sheet.py"),
            str(mark),
            "--refs-generic",
            "6",
            "--brand-color",
            "red;}</style><script>alert(1)</script>",
            "-o",
            str(out),
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    html = out.read_text(encoding="utf-8")
    assert "generic circle" in html and "Shelf test" in html
    assert "alert(1)" not in html
