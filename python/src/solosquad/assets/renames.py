"""Bundled agent ids that changed (decision 58, 2026-11-06) — the one table of old → new.

A customer repo can still name an old id in its own `team/agents/` overrides or
`teams/<team>/composition.yaml`. `solosquad check` reads this table to say the id changed
and which agent now holds that work, instead of a bare "unknown agent".
"""

from __future__ import annotations

RENAMED_AGENTS: dict[str, str] = {
    # renamed — same agent, new id
    "frontend": "frontend-engineer",
    "backend": "backend-engineer",
    "creative-designer": "creative",
    "qa": "quality-assurance",
    # merged — the work moved into another agent
    "system-architect": "backend-engineer",
    "security": "infra",
    "go-to-market": "business-strategy",
    "communication": "marketer",
    # removed — the team-lead role; Chief routes to every agent directly
    "engineer": "chief",
}


def renamed_hint(old: str) -> str | None:
    """`"qa"` → `"renamed to 'quality-assurance' (decision 58)"`; None when not renamed."""
    new = RENAMED_AGENTS.get(old)
    if new is None:
        return None
    if old == "engineer":
        return "removed — teams have no lead; Chief hands work to each engineer (decision 58)"
    return f"renamed to {new!r} (decision 58)"
