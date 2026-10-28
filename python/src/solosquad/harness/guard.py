"""Tool-use guard (§D4) — one rule set for every backend, matched on neutral events."""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Verdict(StrEnum):
    ALLOW = "allow"
    INTERRUPT = "interrupt"
    """Pause the thread and ask a human (graph `interrupt`)."""
    DENY = "deny"


@dataclass(frozen=True)
class GuardRule:
    tool: str = "*"
    """fnmatch pattern on the tool name (e.g. `Bash`, `mcp__browser__*`)."""
    command: str | None = None
    """Regex searched in the tool's command-ish input (`command`, `cmd`, `url`)."""
    action: Verdict = Verdict.INTERRUPT
    reason: str = ""

    def matches(self, name: str, tool_input: dict[str, Any]) -> bool:
        if not fnmatch.fnmatchcase(name, self.tool):
            return False
        if self.command is None:
            return True
        haystack = " ".join(
            str(tool_input[k]) for k in ("command", "cmd", "url") if k in tool_input
        )
        return re.search(self.command, haystack) is not None


DEFAULT_RULES: tuple[GuardRule, ...] = (
    GuardRule(
        "*",
        r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r",
        Verdict.INTERRUPT,
        "recursive delete",
    ),
    GuardRule("*", r"git\s+push\b.*(--force|-f\b)", Verdict.INTERRUPT, "force push"),
    GuardRule("*", r"git\s+reset\s+--hard", Verdict.INTERRUPT, "hard reset"),
)


@dataclass(frozen=True)
class GuardPolicy:
    rules: tuple[GuardRule, ...] = field(default_factory=lambda: DEFAULT_RULES)

    def verdict(self, name: str, tool_input: dict[str, Any]) -> Verdict:
        """First matching rule wins; no match means allow."""
        for rule in self.rules:
            if rule.matches(name, tool_input):
                return rule.action
        return Verdict.ALLOW

    def explain(self, name: str, tool_input: dict[str, Any]) -> str | None:
        for rule in self.rules:
            if rule.matches(name, tool_input):
                return rule.reason or f"{rule.action.value} by rule {rule.tool}"
        return None

    @staticmethod
    def from_dicts(items: list[dict[str, Any]], include_defaults: bool = True) -> GuardPolicy:
        rules = tuple(
            GuardRule(
                tool=str(i.get("tool", "*")),
                command=i.get("command"),
                action=Verdict(i.get("action", "interrupt")),
                reason=str(i.get("reason", "")),
            )
            for i in items
        )
        return GuardPolicy(rules + (DEFAULT_RULES if include_defaults else ()))
