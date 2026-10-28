"""Text and YAML helpers shared by the asset readers."""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from typing import Any

import yaml


def normalize_line(content: str) -> str:
    return content.replace("\r\n", "\n")


@dataclass(frozen=True)
class Frontmatter:
    text: str
    full_length: int


def match_frontmatter(text: str) -> Frontmatter | None:
    """`---\\n … \\n---` at the very start; the closing fence may end the file."""
    if not text.startswith("---\n"):
        return None
    close = text.find("\n---", 4)
    if close == -1:
        return None
    after = close + 4
    tail = 1 if text[after : after + 1] == "\n" else 0
    return Frontmatter(text=text[4:close], full_length=after + tail)


class Yaml12Loader(yaml.SafeLoader):
    """SafeLoader with YAML 1.2 booleans.

    The v1.4.3 parsers use js-yaml 4, which follows YAML 1.2: `yes`/`no`/`on`/`off`
    stay strings. PyYAML defaults to YAML 1.1 and would turn them into booleans,
    silently changing what a SKILL.md means after the rewrite.
    """


Yaml12Loader.yaml_implicit_resolvers = {
    first: [(tag, rx) for tag, rx in resolvers if tag != "tag:yaml.org,2002:bool"]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
Yaml12Loader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"),
    list("tTfF"),
)


def load_yaml(text: str) -> Any:
    return yaml.load(text, Loader=Yaml12Loader)


def to_json_value(value: Any) -> Any:
    """Coerce YAML-native values to what JSON.stringify would emit for js-yaml output."""
    if isinstance(value, dict):
        return {str(k): to_json_value(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_json_value(v) for v in value]
    if isinstance(value, dt.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt.UTC)
        return value.astimezone(dt.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, dt.date):
        return f"{value.isoformat()}T00:00:00.000Z"
    return value


def is_number(value: object) -> bool:
    """JS `typeof value === "number"` — Python's bool is an int, JS's is not."""
    return isinstance(value, int | float) and not isinstance(value, bool)
