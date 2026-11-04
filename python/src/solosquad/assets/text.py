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


_BOOL = "tag:yaml.org,2002:bool"
_INT = "tag:yaml.org,2002:int"
_FLOAT = "tag:yaml.org,2002:float"
_MERGE = "tag:yaml.org,2002:merge"

# js-yaml 4 (DEFAULT_SCHEMA) scalar rules, probed against js-yaml 4.1 — not the
# YAML 1.1 rules PyYAML ships: no `_` separators, no sexagesimal, a leading 0 is
# still decimal, only lowercase 0b/0o/0x prefixes, `1e3` is a number.
_INT_RX = re.compile(r"^[-+]?(?:0b[01]+|0o[0-7]+|0x[0-9a-fA-F]+|[0-9]+)$")
_FLOAT_RX = re.compile(
    r"^(?:[-+]?[0-9]+(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?"
    r"|\.[0-9]+(?:[eE][-+]?[0-9]+)?"
    r"|[-+]?\.(?:inf|Inf|INF)"
    r"|\.(?:nan|NaN|NAN))$"
)


class DuplicateKeyError(yaml.constructor.ConstructorError):
    pass


class Yaml12Loader(yaml.SafeLoader):
    """SafeLoader that reads frontmatter the way the v1.4.3 parsers (js-yaml 4) did.

    PyYAML defaults to YAML 1.1, which would silently change what a SKILL.md means
    after the rewrite: `yes`/`on` become booleans, `012` becomes octal 10, `1e3` stays
    a string, `1_000` becomes 1000, and a repeated key quietly wins. js-yaml follows
    YAML 1.2 for all of these and rejects duplicate keys.
    """

    def construct_mapping(self, node: yaml.Node, deep: bool = False) -> dict[Any, Any]:
        if isinstance(node, yaml.MappingNode):
            seen: set[Any] = set()
            for key_node, _ in node.value:
                if key_node.tag == _MERGE:
                    continue
                key = self.construct_object(key_node, deep=True)
                try:
                    duplicate = key in seen
                except TypeError:
                    continue
                if duplicate:
                    raise DuplicateKeyError(
                        "while constructing a mapping",
                        node.start_mark,
                        f"duplicated mapping key {key!r}",
                        key_node.start_mark,
                    )
                seen.add(key)
        return super().construct_mapping(node, deep=deep)  # type: ignore[arg-type]


def _construct_int(loader: yaml.SafeLoader, node: yaml.Node) -> int:
    text = str(loader.construct_scalar(node))  # type: ignore[arg-type]
    sign = -1 if text.startswith("-") else 1
    body = text.lstrip("+-")
    for prefix, base in (("0b", 2), ("0o", 8), ("0x", 16)):
        if body.startswith(prefix):
            return sign * int(body[2:], base)
    return sign * int(body, 10)


def _construct_float(loader: yaml.SafeLoader, node: yaml.Node) -> float:
    text = str(loader.construct_scalar(node))  # type: ignore[arg-type]
    lowered = text.lower()
    if lowered.endswith(".inf"):
        return float("-inf") if lowered.startswith("-") else float("inf")
    if lowered == ".nan":
        return float("nan")
    return float(text)


def _construct_merge_scalar(loader: yaml.SafeLoader, node: yaml.Node) -> str:
    # `<<` outside a key position is just the string, as in js-yaml.
    return str(loader.construct_scalar(node))  # type: ignore[arg-type]


Yaml12Loader.yaml_implicit_resolvers = {
    first: [(tag, rx) for tag, rx in resolvers if tag not in (_BOOL, _INT, _FLOAT)]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
Yaml12Loader.add_implicit_resolver(
    _BOOL, re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF")
)
Yaml12Loader.add_implicit_resolver(_INT, _INT_RX, list("-+0123456789"))
Yaml12Loader.add_implicit_resolver(_FLOAT, _FLOAT_RX, list("-+0123456789."))
Yaml12Loader.add_constructor(_INT, _construct_int)
Yaml12Loader.add_constructor(_FLOAT, _construct_float)
Yaml12Loader.add_constructor(_MERGE, _construct_merge_scalar)


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
