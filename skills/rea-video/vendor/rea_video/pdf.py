"""report.pdf from report.html, printed by a local Chrome / Chromium / Edge (no extra Python dependency).

Folded sections are opened for print, so the PDF carries everything the HTML has."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

_CANDIDATES = [
    os.environ.get("REA_CHROME", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "msedge", "chrome",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def find_browser() -> str | None:
    for c in _CANDIDATES:
        if c and (Path(c).is_file() or shutil.which(c)):
            return shutil.which(c) or c
    return None


def write_pdf(out: Path, browser: str | None = None, timeout: int = 120) -> Path:
    """Print out/report.html to out/report.pdf. Raises RuntimeError when no browser is found or printing fails."""
    out = Path(out).resolve()
    src = out / "report.html"
    if not src.is_file():
        raise RuntimeError(f"{src} not found: run decompose first")
    browser = browser or find_browser()
    if not browser:
        raise RuntimeError("no Chrome / Chromium / Edge found: install one, or point REA_CHROME at its executable")
    # a print copy beside the original (so relative image paths still resolve) with every fold opened
    tmp = out / ".report_print.html"
    tmp.write_text(src.read_text(encoding="utf-8").replace("<details>", "<details open>"), encoding="utf-8")
    pdf = out / "report.pdf"
    try:
        r = subprocess.run([browser, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--allow-file-access-from-files",
                            f"--print-to-pdf={pdf}", tmp.as_uri()], capture_output=True, text=True, timeout=timeout)
    finally:
        tmp.unlink(missing_ok=True)
    if r.returncode != 0 or not pdf.is_file():
        raise RuntimeError(f"printing failed: {(r.stderr or r.stdout).strip()[-300:]}")
    return pdf
