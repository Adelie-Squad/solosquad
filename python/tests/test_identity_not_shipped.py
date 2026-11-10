"""`identity/` (brand identity: character, motion, logo) is a design record, never a deliverable.

It must stay out of every distribution: the npm package (`package.json` `files`), the Python
wheel (everything under `python/src/solosquad/` plus what `pyproject.toml` adds), and the
`curl`/`irm` release archive (PRD v2.3.0 A5: core = engine package + web build, org package =
teams · agents · skills · workflows · crons · knowledge starter). The web build must not pick it
up either (Vite copies only `web/public/`).
"""

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IDENTITY = "identity"


def _mentions_identity(entry: str) -> bool:
    return re.match(r"^(\./|/)?identity(/|$)", entry.strip()) is not None


def test_identity_folder_exists_with_readme() -> None:
    assert (ROOT / IDENTITY / "README.md").is_file()


def test_npm_files_do_not_ship_identity() -> None:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    files = pkg.get("files")
    # without a `files` allow-list npm packs the whole repo, identity/ included
    assert isinstance(files, list) and files, "package.json must keep an explicit files list"
    assert not [f for f in files if _mentions_identity(f)]
    # a catch-all entry would pull identity/ back in
    assert not [f for f in files if f.strip() in {".", "./", "/", "*", "**", "**/*"}]


def test_python_package_does_not_ship_identity() -> None:
    src = ROOT / "python" / "src" / "solosquad"
    assert not [p for p in src.rglob("*") if p.name == IDENTITY]
    pyproject = tomllib.loads((ROOT / "python" / "pyproject.toml").read_text(encoding="utf-8"))
    assert IDENTITY not in json.dumps(pyproject.get("tool", {}).get("uv", {}))
    assert IDENTITY not in json.dumps(pyproject.get("project", {}))


def test_web_build_does_not_copy_identity() -> None:
    web = ROOT / "web"
    assert not (web / "public" / IDENTITY).exists()
    config = (web / "vite.config.ts").read_text(encoding="utf-8")
    assert not re.search(r"publicDir\s*:[^,\n]*identity", config)


def test_release_archive_list_excludes_identity() -> None:
    prd = (ROOT / "docs" / "prd" / "v2.3.0_agency-connection.md").read_text(encoding="utf-8")
    row = next(line for line in prd.splitlines() if line.startswith("| A5 "))
    assert "`identity/`" in row and "제외" in row
