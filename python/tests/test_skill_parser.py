from __future__ import annotations

import pytest

from solosquad.assets.skill import SkillParseError, parse_skill_md
from solosquad.assets.text import load_yaml, match_frontmatter


def md(front: str, body: str = "body\n") -> str:
    return f"---\n{front}\n---\n{body}"


def test_minimal_skill() -> None:
    spec = parse_skill_md(md("name: a\ndescription: does a"))
    assert spec.name == "a"
    assert spec.description == "does a"
    assert spec.body == "body\n"
    assert spec.to_json_dict() == {
        "name": "a",
        "description": "does a",
        "raw_frontmatter": "name: a\ndescription: does a",
        "body": "body\n",
        "extra": {},
    }


def test_crlf_is_normalized() -> None:
    spec = parse_skill_md("---\r\nname: a\r\ndescription: d\r\n---\r\nx\r\n")
    assert spec.body == "x\n"


@pytest.mark.parametrize(
    "raw",
    [
        "no frontmatter",
        "---\nname: a\ndescription: d\n",
        md("description: d"),
        md("name: '  '\ndescription: d"),
        md("name: a"),
    ],
)
def test_rejects(raw: str) -> None:
    with pytest.raises(SkillParseError):
        parse_skill_md(raw)


def test_closing_fence_at_eof() -> None:
    fm = match_frontmatter("---\nname: a\n---")
    assert fm is not None
    assert fm.text == "name: a"
    assert fm.full_length == len("---\nname: a\n---")


def test_bool_is_not_a_number() -> None:
    spec = parse_skill_md(md("name: a\ndescription: d\nconfidence: true\nschema_version: 2"))
    assert spec.confidence is None
    assert spec.schema_version == 2


def test_string_arrays_drop_non_strings_and_empties() -> None:
    spec = parse_skill_md(md("name: a\ndescription: d\noutputs: [x, '', 3, y]\nhandoff_to: [1]"))
    assert spec.outputs == ["x", "y"]
    assert spec.handoff_to is None


def test_freq_defaults_and_unknown_fields() -> None:
    spec = parse_skill_md(
        md("name: a\ndescription: d\ntriggers:\n  freq:\n    keywords: [k]\ntier: leader")
    )
    assert spec.triggers == {"freq": {"keywords": ["k"], "window_turns": 10, "threshold": 3}}
    assert spec.extra == {"tier": "leader"}


def test_yaml_12_booleans() -> None:
    assert load_yaml("a: yes\nb: on\nc: true\nd: False") == {
        "a": "yes",
        "b": "on",
        "c": True,
        "d": False,
    }
