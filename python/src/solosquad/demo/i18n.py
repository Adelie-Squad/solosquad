"""The demo's three languages — every scripted line follows the visitor's screen language
(`demo issue --locale`, kept as the account's `users.locale`). Korean is the source; English
and Chinese sit next to it (`L(ko, en, zh)`). Words follow DESIGN.md `## 문구` (용어집).

Where each kind of text lives:

    harness.py      agent replies to scenario steps · Chief's chat answers · suggested requests
    scenario.py     the tools' work products (summaries, product, account, delivery …)
    seed.py         the copy's people, calendar entries, the example conversation
    template/       ko files; `template/locales/<lang>/` holds the same files in that language
                    (workflows · artifact kinds · knowledge · sample files) and replaces them
                    in an account of that language

The copy's language is fixed when it is seeded (issue · 처음 상태로 · the nightly reset) and
kept in the org (`LOCALE_FILE`), so the scripted harness answers in it.
"""

from __future__ import annotations

from pathlib import Path

Lang = str
"""`ko` · `en` · `zh-CN`."""

LOCALES: tuple[Lang, ...] = ("ko", "en", "zh-CN")
SOURCE: Lang = "ko"
LOCALE_FILE = Path(".solosquad") / "demo-locale"
"""Inside the visitor's org: the language the copy was seeded in."""


def L(ko: str, en: str, zh: str) -> dict[Lang, str]:
    return {"ko": ko, "en": en, "zh-CN": zh}


def known(lang: str | None) -> Lang:
    return lang if lang in LOCALES else SOURCE


def pick(text: dict[Lang, str], lang: str | None) -> str:
    return text.get(known(lang)) or text[SOURCE]


def read_locale(org_root: Path) -> Lang:
    try:
        return known((org_root / LOCALE_FILE).read_text(encoding="utf-8").strip())
    except OSError:
        return SOURCE


def write_locale(org_root: Path, lang: str | None) -> None:
    path = org_root / LOCALE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(known(lang) + "\n", encoding="utf-8")
