"""Static checks for agents, skills, teams and crons.

`validate_skill` is a port of v1.4.3 `validateSkill` (src/bot/skill-parser.ts) — same
codes, same severity — so a definition that passed the v1 gate still passes. The
solution-level checks below replace v1's agent-graph pass (collaborators · used_by),
which described a supervisor topology v2 no longer has (decision 19): here the graph
is the swarm — handoff targets, team membership, the Chief entry point.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from solosquad.assets.skill import SkillSpec
from solosquad.assets.text import normalize_line

Severity = Literal["error", "warn"]

FREQ_SKILL_CAP = 20
SKILL_NAME_MAX = 64
SKILL_DESCRIPTION_MAX = 1024
RESERVED_SLASHES = ("/think", "/plan", "/build", "/review", "/ship", "/help")
RESERVED_WORDS = ("anthropic", "claude")
_KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_FIRST_PERSON = re.compile(r"\bI\s+(?:will|can|am|have|need|do|use)\b")
_VAGUE_EN = re.compile(r"\bhelps?\s+with\b", re.IGNORECASE)
_VAGUE_KO = re.compile(r"도와줍?니다|돕는다|돕습니다")
_TRIGGER = re.compile(
    r"use\s+(?:this\s+)?(?:skill\s+)?when|when\s+to\s+use|when\s+you|사용\s*시점|사용할\s*때|쓸\s*때|할\s*때",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Issue:
    code: str
    message: str
    field: str | None = None
    severity: Severity = "error"
    path: str | None = None


@dataclass
class Report:
    issues: list[Issue] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "warn"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def add(
        self,
        code: str,
        message: str,
        field: str | None = None,
        severity: Severity = "error",
        path: str | None = None,
    ) -> None:
        self.issues.append(Issue(code, message, field, severity, path))


def is_kebab(s: str) -> bool:
    return bool(_KEBAB.match(s))


def _num(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def validate_skill(
    spec: SkillSpec,
    *,
    dir_name: str | None = None,
    strict_name: bool = False,
    freq_skill_count: int | None = None,
    reserved_names: frozenset[str] = frozenset(),
) -> Report:
    r = Report()
    path = spec.source

    def err(code: str, msg: str, fld: str | None = None) -> None:
        r.add(code, msg, fld, "error", path)

    def warn(code: str, msg: str, fld: str | None = None) -> None:
        r.add(code, msg, fld, "warn", path)

    if spec.stateful is True:
        err("STATEFUL_NOT_ALLOWED", "stateful: true is out of scope — set false", "stateful")

    triggers = spec.triggers or {}
    for s in triggers.get("slash") or []:
        if not isinstance(s, str) or not s.startswith("/"):
            err("SLASH_MALFORMED", f'slash trigger "{s}" must start with "/"', "triggers.slash")
            continue
        for reserved in RESERVED_SLASHES:
            if s == reserved:
                err(
                    "SLASH_RESERVED",
                    f'"{s}" collides with the reserved slash "{reserved}"',
                    "triggers.slash",
                )
            elif s.startswith(reserved) or reserved.startswith(s):
                err(
                    "SLASH_PREFIX_CONFLICT",
                    f'"{s}" has a prefix conflict with reserved "{reserved}"',
                    "triggers.slash",
                )

    freq = triggers.get("freq")
    if isinstance(freq, dict):
        window, threshold = _num(freq.get("window_turns")), _num(freq.get("threshold"))
        cooldown = _num(freq.get("cooldown_turns"))
        if window is not None and window < 1:
            err("FREQ_WINDOW_TOO_SMALL", "window_turns must be ≥ 1", "triggers.freq.window_turns")
        if threshold is not None and threshold < 1:
            err("FREQ_THRESHOLD_TOO_SMALL", "threshold must be ≥ 1", "triggers.freq.threshold")
        if cooldown is not None and cooldown < 0:
            err(
                "FREQ_COOLDOWN_NEGATIVE",
                "cooldown_turns must be ≥ 0",
                "triggers.freq.cooldown_turns",
            )
        if freq_skill_count is not None and freq_skill_count >= FREQ_SKILL_CAP:
            err(
                "FREQ_CAP_EXCEEDED",
                f"already {freq_skill_count} freq-enabled skills (cap {FREQ_SKILL_CAP})",
                "triggers.freq",
            )

    if spec.loop_mode:
        if spec.loop_mode.get("kind") != "spec-gate":
            err(
                "LOOP_MODE_UNKNOWN",
                f'loop_mode.kind "{spec.loop_mode.get("kind")}" is not supported'
                ' (only "spec-gate")',
                "loop_mode.kind",
            )
        elif not spec.loop_mode.get("stop_when"):
            warn(
                "LOOP_MODE_NO_STOP",
                "spec-gate without stop_when — set stop_when for clarity",
                "loop_mode.stop_when",
            )

    for key in ("per_call_usd", "daily_usd"):
        v = _num((spec.budget or {}).get(key))
        if v is not None and v < 0:
            err("BUDGET_NEGATIVE", f"{key} must be ≥ 0", f"budget.{key}")

    if spec.confidence is not None and not 0 <= spec.confidence <= 1:
        err("CONFIDENCE_OUT_OF_RANGE", "confidence must be in [0, 1]", "confidence")

    conv = spec.pm_conventions or {}
    if "minimum_approaches" in conv:
        n = conv["minimum_approaches"]
        if (
            not (
                (isinstance(n, int) and not isinstance(n, bool))
                or (isinstance(n, float) and n.is_integer())
            )
            or n < 1
        ):
            err(
                "MIN_APPROACHES_INVALID",
                f"minimum_approaches must be an integer ≥ 1 (got {n})",
                "pm_conventions.minimum_approaches",
            )

    if spec.category is not None and not is_kebab(spec.category):
        warn("CATEGORY_MALFORMED", f'category "{spec.category}" should be kebab-case', "category")

    if spec.schema_version is None:
        warn(
            "SCHEMA_VERSION_MISSING",
            "schema_version missing — add `schema_version: 1`",
            "schema_version",
        )
    elif spec.schema_version < 1:
        err(
            "SCHEMA_VERSION_INVALID",
            f"schema_version={spec.schema_version} is invalid (must be ≥ 1)",
            "schema_version",
        )

    perms = spec.dev_permissions
    merge = perms.get("merge") if isinstance(perms, dict) else None
    if isinstance(merge, dict) and merge.get("auto") is True:
        err(
            "MERGE_AUTO_FORBIDDEN",
            "merge.auto: true is permanently forbidden",
            "dev_permissions.merge.auto",
        )
    if perms and spec.dev_capability is not True:
        warn(
            "DEV_PERMS_WITHOUT_CAPABILITY",
            "dev_permissions declared but dev_capability is not true",
            "dev_permissions",
        )

    name = spec.name
    if strict_name:
        if len(name) > SKILL_NAME_MAX:
            err("NAME_TOO_LONG", f"name is {len(name)} chars (max {SKILL_NAME_MAX})", "name")
        if not is_kebab(name):
            err("NAME_MALFORMED", f'name "{name}" must be kebab-case', "name")
        if name in reserved_names:
            err("NAME_RESERVED", f'name "{name}" is reserved', "name")
        if any(w in name.lower() for w in RESERVED_WORDS):
            err(
                "NAME_RESERVED_WORD",
                f'name "{name}" contains a reserved word (anthropic/claude)',
                "name",
            )
    if dir_name is not None and name != dir_name:
        err("NAME_DIR_MISMATCH", f'name "{name}" does not match directory "{dir_name}"', "name")

    desc = spec.description
    if len(desc) > SKILL_DESCRIPTION_MAX:
        err(
            "DESCRIPTION_TOO_LONG",
            f"description is {len(desc)} chars (max {SKILL_DESCRIPTION_MAX})",
            "description",
        )
    if _FIRST_PERSON.search(desc):
        warn(
            "DESCRIPTION_FIRST_PERSON",
            "description reads first-person — prefer third-person",
            "description",
        )
    if _VAGUE_EN.search(desc) or _VAGUE_KO.search(desc):
        warn(
            "DESCRIPTION_VAGUE",
            'description uses a vague phrase ("helps with" / "도와줍니다")',
            "description",
        )
    if not _TRIGGER.search(desc):
        warn(
            "DESCRIPTION_NO_TRIGGER",
            'description has no "use when…" / "사용 시점 —" trigger clause',
            "description",
        )

    if spec.body and len(normalize_line(spec.body).split("\n")) > 500:
        warn("BODY_TOO_LONG", "SKILL.md body is >500 lines — move detail into references/", "body")
    return r
