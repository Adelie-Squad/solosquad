"""Report language.

Chinese is the source language of every user-facing string; English sits next to it. Two helpers:

  T("中文", "English")          pick the string for the current report language (optional .format kwargs)
  LangDict(zh={...}, en={...})  a code -> text mapping that resolves per language, so existing `X_ZH[code]`
                                lookups (and the `*_zh` fields they fill in breakdown.json) follow the language

The language is set once per run (`set_lang`), from `--lang` / prefs, and stored in breakdown["lang"] so
`finalize` / `summary` / `apply-review` render later in the same language. Default: zh.
"""
from __future__ import annotations

import contextvars
import re
from collections.abc import Mapping
from typing import Iterator

LANGS = ("zh", "en")
LANG_NAMES = {"zh": "中文", "en": "English"}
_lang: contextvars.ContextVar[str] = contextvars.ContextVar("rea_video_lang", default="zh")


def set_lang(lang: str | None) -> str:
    lang = (lang or "zh").lower()
    if lang not in LANGS:
        raise ValueError(f"unsupported report language {lang!r} (choose from {', '.join(LANGS)})")
    _lang.set(lang)
    return lang


def lang() -> str:
    return _lang.get()


def T(zh: str, en: str | None = None, **kw) -> str:
    """Text for the current language; `en` missing falls back to zh. kwargs are applied with str.format."""
    s = en if (en is not None and _lang.get() == "en") else zh
    return s.format(**kw) if kw else s


def model_name(name: str | None) -> str | None:
    if not name or _lang.get() == "zh":
        return name
    return re.sub(r"\s*（([^）]*)）", lambda m: "" if re.search(r"[\u3400-\u9fff]", m[1]) else f" ({m[1]})", name)


def sep() -> str:
    """List separator: 、 in Chinese, ", " in English."""
    return "、" if _lang.get() == "zh" else ", "


def join(items) -> str:
    return sep().join(str(x) for x in items)


def shot_ids(ids) -> str:
    """Shot numbers as a short list: runs of three or more become a range, "#5、#8–#24"."""
    ids = sorted({int(i) for i in ids or []})
    if not ids:
        return "—"
    runs, out = [[ids[0], ids[0]]], []
    for i in ids[1:]:
        if i == runs[-1][1] + 1:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    for a, z in runs:
        out += [f"#{a}–#{z}"] if z - a >= 2 else [f"#{i}" for i in range(a, z + 1)]
    return join(out)


def semi() -> str:
    """Clause separator: ； in Chinese, "; " in English."""
    return "；" if _lang.get() == "zh" else "; "


class LangDict(Mapping):
    """code -> display text, resolved per language. Keys and iteration follow the zh table."""

    def __init__(self, zh: dict, en: dict | None = None):
        self._zh = dict(zh)
        self._en = dict(en or {})

    def __getitem__(self, key):
        if _lang.get() == "en" and key in self._en:
            return self._en[key]
        return self._zh[key]

    def __iter__(self) -> Iterator:
        return iter(self._zh)

    def __len__(self) -> int:
        return len(self._zh)

    def __contains__(self, key) -> bool:
        return key in self._zh

    def __repr__(self) -> str:
        return f"LangDict({dict(self.items())!r})"
