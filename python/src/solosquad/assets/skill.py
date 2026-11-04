"""SKILL.md parser — port of v1.4.3 `src/bot/skill-parser.ts` `parseSkillMd`.

Agents and skills share the format: Anthropic Agent Skills frontmatter (`name` and
`description` required) plus optional SoloSquad fields. The parser is tolerant on
purpose — malformed sub-fields are dropped, unknown fields land in `extra`, and the
frontmatter text is kept verbatim so files can be re-emitted byte-for-byte.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from solosquad.assets.text import (
    is_number,
    load_yaml,
    match_frontmatter,
    normalize_line,
    to_json_value,
)

SkillScope = Literal["agent", "workspace", "org", "repo"]
CollabPattern = Literal["hierarchical", "graph", "dynamic"]

KNOWN_FIELDS = frozenset(
    {
        "name",
        "description",
        "team",
        "stateful",
        "triggers",
        "inputs",
        "outputs",
        "handoff_to",
        "scope",
        "confidence",
        "source",
        "loop_mode",
        "budget",
        "collab_pattern",
        "category",
        "pm_conventions",
        "schema_version",
        "dev_capability",
        "dev_permissions",
    }
)


class SkillParseError(ValueError):
    def __init__(self, message: str, source_path: str | None = None) -> None:
        super().__init__(f"{source_path}: {message}" if source_path else message)
        self.source_path = source_path


@dataclass(frozen=True)
class SkillSpec:
    name: str
    description: str
    raw_frontmatter: str
    body: str
    extra: dict[str, Any] = field(default_factory=dict)
    team: str | None = None
    stateful: bool | None = None
    triggers: dict[str, Any] | None = None
    inputs: dict[str, list[str]] | None = None
    outputs: list[str] | None = None
    handoff_to: list[str] | None = None
    scope: SkillScope | None = None
    confidence: float | None = None
    source: str | None = None
    collab_pattern: CollabPattern | None = None
    loop_mode: dict[str, str] | None = None
    budget: dict[str, float] | None = None
    category: str | None = None
    pm_conventions: dict[str, Any] | None = None
    schema_version: float | None = None
    dev_capability: bool | None = None
    dev_permissions: dict[str, Any] | None = None

    def to_json_dict(self) -> dict[str, Any]:
        """Shape of `JSON.stringify(parseSkillMd(...))`: absent optional fields are omitted."""
        out: dict[str, Any] = {}
        for key, value in self.__dict__.items():
            if value is None:
                continue
            out[key] = to_json_value(value) if key == "extra" else value
        return out


def parse_skill_md(raw: str, source_path: str | None = None) -> SkillSpec:
    normalized = normalize_line(raw)
    fm = match_frontmatter(normalized)
    if fm is None:
        raise SkillParseError("missing YAML frontmatter (--- … ---)", source_path)
    try:
        loaded = load_yaml(fm.text)
    except Exception as e:  # yaml.YAMLError and constructor errors alike
        raise SkillParseError(f"invalid YAML frontmatter: {e}", source_path) from e
    parsed: dict[str, Any] = loaded if isinstance(loaded, dict) else {}

    name = parsed.get("name")
    if not isinstance(name, str) or not name.strip():
        raise SkillParseError("frontmatter is missing required `name` field", source_path)
    description = parsed.get("description")
    if not isinstance(description, str) or not description.strip():
        raise SkillParseError("frontmatter is missing required `description` field", source_path)

    return SkillSpec(
        name=name.strip(),
        description=description.strip(),
        team=_str(parsed.get("team")),
        stateful=_bool(parsed.get("stateful")),
        triggers=_triggers(parsed.get("triggers")),
        inputs=_inputs(parsed.get("inputs")),
        outputs=_string_array(parsed.get("outputs")),
        handoff_to=_string_array(parsed.get("handoff_to")),
        scope=_scope(parsed.get("scope")),
        confidence=_number(parsed.get("confidence")),
        source=_str(parsed.get("source")),
        collab_pattern=_collab(parsed.get("collab_pattern")),
        loop_mode=_loop_mode(parsed.get("loop_mode")),
        budget=_budget(parsed.get("budget")),
        category=_str(parsed.get("category")),
        pm_conventions=_pm_conventions(parsed.get("pm_conventions")),
        schema_version=_number(parsed.get("schema_version")),
        dev_capability=_bool(parsed.get("dev_capability")),
        dev_permissions=_dev_permissions(parsed.get("dev_permissions")),
        extra={k: v for k, v in parsed.items() if k not in KNOWN_FIELDS},
        raw_frontmatter=fm.text,
        body=normalized[fm.full_length :],
    )


def _str(raw: object) -> str | None:
    return raw if isinstance(raw, str) else None


def _bool(raw: object) -> bool | None:
    return raw if isinstance(raw, bool) else None


def _number(raw: object) -> float | None:
    return raw if is_number(raw) else None  # type: ignore[return-value]


def _string_array(raw: object) -> list[str] | None:
    if not isinstance(raw, list):
        return None
    out = [x for x in raw if isinstance(x, str) and x]
    return out or None


def _triggers(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    if (slash := _string_array(raw.get("slash"))) is not None:
        out["slash"] = slash
    if (keyword := _string_array(raw.get("keyword"))) is not None:
        out["keyword"] = keyword
    if isinstance(raw.get("explicit"), bool):
        out["explicit"] = raw["explicit"]
    if (freq := _freq(raw.get("freq"))) is not None:
        out["freq"] = freq
    return out or None


def _freq(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    keywords = _string_array(raw.get("keywords"))
    if not keywords:
        return None
    out: dict[str, Any] = {
        "keywords": keywords,
        "window_turns": raw["window_turns"] if is_number(raw.get("window_turns")) else 10,
        "threshold": raw["threshold"] if is_number(raw.get("threshold")) else 3,
    }
    if is_number(raw.get("cooldown_turns")):
        out["cooldown_turns"] = raw["cooldown_turns"]
    return out


def _inputs(raw: object) -> dict[str, list[str]] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, list[str]] = {}
    if (req := _string_array(raw.get("required"))) is not None:
        out["required"] = req
    if (opt := _string_array(raw.get("optional"))) is not None:
        out["optional"] = opt
    return out or None


def _scope(raw: object) -> SkillScope | None:
    if raw == "agent" or raw == "workspace" or raw == "org" or raw == "repo":
        return raw
    return None


def _collab(raw: object) -> CollabPattern | None:
    if raw == "hierarchical" or raw == "graph" or raw == "dynamic":
        return raw
    return None


def _loop_mode(raw: object) -> dict[str, str] | None:
    if not isinstance(raw, dict) or raw.get("kind") != "spec-gate":
        return None
    out = {"kind": "spec-gate"}
    for key in ("spec_path", "stop_when"):
        if isinstance(raw.get(key), str):
            out[key] = raw[key]
    return out


def _pm_conventions(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    for key in ("anti_sycophancy", "post_labeling", "hard_gate"):
        if isinstance(raw.get(key), bool):
            out[key] = raw[key]
    if is_number(raw.get("minimum_approaches")):
        out["minimum_approaches"] = raw["minimum_approaches"]
    return out or None


def _budget(raw: object) -> dict[str, float] | None:
    if not isinstance(raw, dict):
        return None
    out = {k: raw[k] for k in ("per_call_usd", "daily_usd") if is_number(raw.get(k))}
    return out or None


def _dev_permissions(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    bash_raw = raw.get("bash")
    if isinstance(bash_raw, dict):
        bash = {
            k: v for k in ("allowed", "denied") if (v := _string_array(bash_raw.get(k))) is not None
        }
        if bash:
            out["bash"] = bash
    if isinstance(raw.get("network"), bool):
        out["network"] = raw["network"]
    push = raw.get("push_targets")
    if isinstance(push, dict) and isinstance(push.get("requires_confirmation"), bool):
        out["push_targets"] = {"requires_confirmation": push["requires_confirmation"]}
    merge = raw.get("merge")
    if isinstance(merge, dict) and isinstance(merge.get("auto"), bool):
        out["merge"] = {"auto": merge["auto"]}
    return out or None
