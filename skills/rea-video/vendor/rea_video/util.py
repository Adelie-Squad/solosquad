"""Small shared helpers: logging, JSON IO, env loading, time formatting."""
from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Iterable

LOG = logging.getLogger("rea_video")
OCR_LANGS = ("zh", "ja")  # subtitle/huazi OCR languages; zh is the bundled recognizer, others are in overlay._REC_MODELS
ASR_LANGS = ("auto", "bn")  # speech recognition: auto is SenseVoice (zh/en/ja/ko/yue, detected per line); bn is speech.BN_MODEL_DIR


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S", stream=sys.stderr)


def write_json(path: Path, data: Any, compact: bool = False) -> Path:
    """compact=True: no indentation (about half the size; for large machine-read files like breakdown.json)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=_json_default) if compact
            else json.dumps(data, ensure_ascii=False, indent=2, default=_json_default))
    path.write_text(text + "\n", encoding="utf-8")
    return path


def dumps_rows(data: dict) -> str:
    """JSON with one top-level key per line and every list item on its own line.

    For files an agent reads or edits (review tasks / answers): one shot per line keeps them
    grep-able and editable by id without the token cost of full indentation."""
    def one(v):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=_json_default)

    lines = []
    for k, v in data.items():
        if isinstance(v, list) and v:
            body = ",\n".join("  " + one(x) for x in v)
            lines.append(f"{one(k)}:[\n{body}\n]")
        elif isinstance(v, dict) and any(isinstance(x, list) and x for x in v.values()):
            lines.append(f"{one(k)}:{{\n" + ",\n".join(
                f" {one(kk)}:[\n" + ",\n".join("  " + one(x) for x in vv) + "\n ]" if isinstance(vv, list) and vv else f" {one(kk)}:{one(vv)}"
                for kk, vv in v.items()) + "\n}")
        else:
            lines.append(f"{one(k)}:{one(v)}")
    return "{\n" + ",\n".join(lines) + "\n}\n"


def read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _json_default(value: Any) -> Any:
    try:
        import numpy as np

        if isinstance(value, np.generic):
            return value.item()
        if isinstance(value, np.ndarray):
            return value.tolist()
    except ImportError:  # pragma: no cover
        pass
    if isinstance(value, Path):
        return str(value)
    return str(value)


def read_image(path):
    """cv2.imread that also opens paths with non-ASCII characters on Windows (imread goes through the ANSI
    file API there and returns None for a Chinese folder name). None when the file is missing or unreadable."""
    import cv2
    import numpy as np

    try:
        data = np.fromfile(str(path), dtype=np.uint8)
    except OSError:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None


def write_image(path, img, params: list[int] | None = None) -> bool:
    """cv2.imwrite counterpart of read_image; the format follows the file extension."""
    import cv2

    ok, buf = cv2.imencode(Path(path).suffix or ".jpg", img, params or [])
    if ok:
        buf.tofile(str(path))
    return bool(ok)


def fetch(url: str, dest: Path, timeout: float = 60.0) -> None:
    """Download url to dest. The timeout is per read, so a stalled connection raises instead of hanging the run."""
    import shutil
    import urllib.request

    with urllib.request.urlopen(url, timeout=timeout) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f, 1 << 20)


def sha256_file(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


_ENV_NEVER_FROM_FILE = frozenset({"REA_CHROME"})


def load_env_files(paths: Iterable[str | Path]) -> list[str]:
    """Minimal .env loader (KEY=VALUE lines). Existing env vars win. Returns loaded files."""
    loaded: list[str] = []
    for raw in paths:
        if not raw:
            continue
        p = Path(raw).expanduser()
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):]
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # SoloSquad vendored copy: a .env must not choose a program to execute
            if key in _ENV_NEVER_FROM_FILE or key.startswith("CAPSULE_CINEMA_"):
                continue
            if key and key not in os.environ:
                os.environ[key] = value
        loaded.append(str(p))
    return loaded


def fmt_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    m, s = divmod(seconds, 60)
    return f"{int(m):02d}:{s:06.3f}"


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def round_floats(obj: Any, nd: int = 4) -> Any:
    if isinstance(obj, float):
        return round(obj, nd)
    if isinstance(obj, dict):
        return {k: round_floats(v, nd) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [round_floats(v, nd) for v in obj]
    try:
        import numpy as np

        if isinstance(obj, np.floating):
            return round(float(obj), nd)
        if isinstance(obj, np.integer):
            return int(obj)
    except ImportError:  # pragma: no cover
        pass
    return obj
