"""Shot size, camera angle and camera move words in both report languages.

Measurements are stored as words in the language of the run that took them, and image readers answer with the
option words they were shown. A report in the other language shows them through show(); code that compares them
(ordering, grouping) goes through canon() so "中景" and "medium shot" are the same thing.
"""
from __future__ import annotations

import re

from ..i18n import lang

PAIRS = [
    # shot size
    ("大特写", "extreme close-up"), ("特写", "close-up"), ("近景", "medium close-up"), ("中景", "medium shot"),
    ("全景", "full shot"), ("远景", "wide shot"),
    # camera angle
    ("平视", "eye level"), ("略俯拍", "slightly high angle"), ("俯拍", "high angle"), ("顶拍", "top-down"),
    ("略仰拍", "slightly low angle"), ("仰拍", "low angle"),
    # camera move
    ("推", "push-in"), ("拉", "pull-out"), ("摇/移", "pan / track"), ("摇", "pan"), ("移", "track"), ("跟", "follow"),
    ("环绕", "orbit"), ("手持", "handheld"), ("固定", "static"),
]
ZH2EN = dict(PAIRS)
EN2ZH = {en: zh for zh, en in PAIRS}


def _head(x: str) -> str:
    """"顶拍（正上方俯拍桌面）" -> "顶拍"; "Close-up" -> "close-up"."""
    return re.split(r"[（(，,]", x)[0].strip()


def canon(x: str | None) -> str | None:
    """The Chinese word for a known value in either language, else the value unchanged."""
    if not x:
        return x
    h = _head(str(x))
    return h if h in ZH2EN else EN2ZH.get(h.lower(), x)


def show(x: str | None) -> str | None:
    """A known value in the report's language. Moves joined with "/" ("拉/摇/移") are shown part by part."""
    if not x:
        return x
    s = str(x)
    if "/" in s and _head(s) not in ZH2EN and _head(s).lower() not in EN2ZH:
        parts = [show(p.strip()) or p for p in s.split("/")]
        return " / ".join(parts) if lang() == "en" else "/".join(parts)
    c = canon(s)
    if c not in ZH2EN:
        return s
    if lang() == "en":
        return ZH2EN[c]
    return s if _head(s) == c else c  # Chinese: keep the reader's fuller wording ("顶拍（正上方俯拍桌面）")
