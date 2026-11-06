"""The CSP allows the web's one inline script — the first-paint theme pick — by its hash."""

from __future__ import annotations

import base64
import hashlib
import re
from pathlib import Path

from solosquad.web_api.app import CSP, THEME_SCRIPT_HASH


def _inline_scripts(html: str) -> list[str]:
    return re.findall(r"<script>(.*?)</script>", html, re.S)


def test_the_csp_hash_matches_the_inline_theme_script(repo_root: Path) -> None:
    html = (repo_root / "web" / "index.html").read_text(encoding="utf-8")
    scripts = _inline_scripts(html)
    assert len(scripts) == 1, "index.html should keep exactly one inline script (the theme)"
    digest = base64.b64encode(hashlib.sha256(scripts[0].encode()).digest()).decode()
    assert f"sha256-{digest}" == THEME_SCRIPT_HASH, (
        "the theme script in web/index.html changed — update THEME_SCRIPT_HASH in web_api/app.py"
    )
    built = repo_root / "web" / "dist" / "index.html"
    if built.is_file():  # the build must not rewrite it either
        assert _inline_scripts(built.read_text(encoding="utf-8")) == scripts


def _directives(policy: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in policy.split(";"):
        name, *values = part.split()
        out[name] = values
    return out


def test_the_csp_opens_only_what_the_office_glbs_need() -> None:
    d = _directives(CSP)
    assert d["default-src"] == ["'self'"]
    # meshopt decoder: WebAssembly compile, never plain eval or inline script
    assert d["script-src"] == ["'self'", f"'{THEME_SCRIPT_HASH}'", "'wasm-unsafe-eval'"]
    assert "'unsafe-eval'" not in CSP and "'unsafe-inline'" not in CSP
    # embedded WebP textures arrive as blob: URLs (img element or fetch); the loader's WebP
    # support probe is a data: image
    assert d["img-src"] == ["'self'", "blob:", "data:"]
    assert d["connect-src"] == ["'self'", "blob:"]
    assert not {"blob:", "data:"} & set(d["script-src"] + d["default-src"] + d["connect-src"][2:])
    assert d["frame-ancestors"] == ["'none'"]
    assert d["object-src"] == ["'none'"]
    assert d["base-uri"] == ["'self'"]
