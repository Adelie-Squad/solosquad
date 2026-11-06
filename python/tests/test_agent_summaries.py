"""Words people read about the bundled agents (DESIGN.md `## 문구` · 조직도 인포그래픽).

Every bundled agent carries a `display_name` and a `summary` in ko · en · zh-CN in its
SKILL.md. A summary is two or three complete sentences for the owner and staff of a small
retailer — no dashes, slashes, middle-dot lists, bracketed notes or decision numbers.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from solosquad.assets.skill import parse_skill_md

LOCALES = ("ko", "en", "zh-CN")
BANNED = ("\u2014", "\u2013", "/", "\u00b7", "(", ")", "\uff08", "\uff09", "결정 ", "decision ")
SENTENCE_END = re.compile(r"[.。]$")


def bundled(repo_root: Path) -> list[Path]:
    found = sorted((repo_root / "agents").glob("*/*/SKILL.md"))
    assert len(found) == 15, [str(p) for p in found]
    return found


def specs(repo_root: Path) -> dict[str, dict[str, object]]:
    out = {}
    for path in bundled(repo_root):
        spec = parse_skill_md(path.read_text(encoding="utf-8"), str(path))
        out[path.parent.name] = spec.extra
    return out


def test_every_agent_has_names_and_summaries_in_three_languages(repo_root: Path) -> None:
    for name, extra in specs(repo_root).items():
        for field in ("display_name", "summary"):
            words = extra.get(field)
            assert isinstance(words, dict), f"{name}: no {field}"
            assert sorted(words) == sorted(LOCALES), f"{name}: {field} languages"
            for locale in LOCALES:
                assert isinstance(words[locale], str) and words[locale].strip(), (
                    name,
                    field,
                    locale,
                )


@pytest.mark.parametrize("locale", LOCALES)
def test_summaries_are_plain_complete_sentences(repo_root: Path, locale: str) -> None:
    for name, extra in specs(repo_root).items():
        summary = extra["summary"]
        assert isinstance(summary, dict)
        text = summary[locale]
        for mark in BANNED:
            assert mark not in text, f"{name} {locale}: {mark!r} in {text!r}"
        assert SENTENCE_END.search(text), f"{name} {locale}: ends without a full stop"
        sentences = [s for s in re.split(r"(?<=[.。])\s*", text) if s.strip()]
        assert 2 <= len(sentences) <= 3, f"{name} {locale}: {len(sentences)} sentences"


def test_korean_summaries_speak_haeyo(repo_root: Path) -> None:
    for name, extra in specs(repo_root).items():
        summary = extra["summary"]
        assert isinstance(summary, dict)
        for sentence in re.split(r"(?<=\.)\s*", summary["ko"]):
            if sentence:
                assert re.search(r"(요|예요|이에요)\.$", sentence), f"{name}: {sentence!r}"


def test_display_names_carry_no_id_marks(repo_root: Path) -> None:
    for name, extra in specs(repo_root).items():
        names = extra["display_name"]
        assert isinstance(names, dict)
        for locale, shown in names.items():
            assert "-" not in shown and "_" not in shown, (name, locale, shown)
