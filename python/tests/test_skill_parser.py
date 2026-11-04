from __future__ import annotations

import pytest
import yaml

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


# Expected values probed from js-yaml 4.1 (the v1.4.3 parser) — PyYAML's YAML 1.1
# defaults disagree on every one of these.
JS_YAML_SCALARS: dict[str, object] = {
    "012": 12,
    "-012": -12,
    "09": 9,
    "0o17": 15,
    "-0o17": -15,
    "0O17": "0O17",
    "0x1F": 31,
    "0X1f": "0X1f",
    "0b101": 5,
    "1_000": "1_000",
    "1:20": "1:20",
    "0o8": "0o8",
    "1e3": 1000,
    "1E3": 1000,
    "1.": 1,
    ".5": 0.5,
    "-.5": "-.5",
    "1_000.5": "1_000.5",
    "012.5": 12.5,
    "6.8523015e+5": 685230.15,
    "<<": "<<",
}


@pytest.mark.parametrize(("raw", "want"), list(JS_YAML_SCALARS.items()))
def test_scalars_match_js_yaml(raw: str, want: object) -> None:
    got = load_yaml(f"a: {raw}")["a"]
    assert got == want
    assert isinstance(got, str) == isinstance(want, str)


def test_special_floats() -> None:
    got = load_yaml("a: .inf\nb: -.Inf\nc: .nan")
    assert got["a"] == float("inf")
    assert got["b"] == float("-inf")
    assert got["c"] != got["c"]


def test_duplicate_key_is_an_error() -> None:
    with pytest.raises(yaml.YAMLError, match="duplicated mapping key"):
        load_yaml("a: 1\na: 2")
    with pytest.raises(SkillParseError):
        parse_skill_md(md("name: a\nname: b\ndescription: d"))


def test_merge_keys_still_work() -> None:
    assert load_yaml("base: &b {x: 1}\nm:\n  <<: *b\n  y: 2")["m"] == {"x": 1, "y": 2}
