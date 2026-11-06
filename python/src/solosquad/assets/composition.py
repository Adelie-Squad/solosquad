"""Team composition reader — port of v1.4.3 `src/util/composition.ts`.

Team membership is data (`teams/<team>/composition.yaml`), not folder layout. A
malformed file reads as absent so the caller falls back to the next tier.

Decision 58: a team has no lead. A team is a grouping — org chart, team-tier approval,
an office island — and every agent in it is listed under `members`. An older file that
still names a `main:` agent keeps parsing: the agent stays in the team as a member, the
lead role is ignored, and `legacy_main` records it so `solosquad check` can warn.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from solosquad.assets.text import load_yaml

KNOWN_TEAMS = ("core", "product", "engineering", "business", "brand")


@dataclass(frozen=True)
class Composition:
    members: list[str]
    shared_skills: list[str]
    cross_team_members: list[str] | None = None
    legacy_main: str | None = None
    """The `main:` an old-format file named (decision 58: ignored, folded into members)."""

    @property
    def main(self) -> str | None:
        """Teams have no lead agent any more (decision 58); kept so older readers see null."""
        return None

    def to_json_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "members": self.members,
            "shared_skills": self.shared_skills,
        }
        if self.cross_team_members is not None:
            out["cross_team_members"] = self.cross_team_members
        return out


def read_composition(path: Path) -> Composition | None:
    if not path.is_file():
        return None
    try:
        parsed = load_yaml(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    members = parsed.get("members")
    if not isinstance(members, list):
        return None
    names = [m for m in members if isinstance(m, str)]
    main = parsed.get("main")
    if main is not None and not isinstance(main, str):
        return None  # same as v1 `composition.ts`: a non-string `main` is malformed
    legacy = main if isinstance(main, str) and main else None
    if legacy is not None and legacy not in names:
        names = [legacy, *names]
    shared = parsed.get("shared_skills")
    cross = parsed.get("cross_team_members")
    return Composition(
        members=names,
        shared_skills=[s for s in shared if isinstance(s, str)] if isinstance(shared, list) else [],
        cross_team_members=(
            [s for s in cross if isinstance(s, str)] if isinstance(cross, list) else None
        ),
        legacy_main=legacy,
    )


def load_composition(
    team: str, root: Path, override_root: Path | None = None
) -> Composition | None:
    """`override_root` (an org's team dir) beats the bundle at `root`."""
    if override_root is not None:
        found = read_composition(override_root / "teams" / team / "composition.yaml")
        if found is not None:
            return found
    return read_composition(root / "teams" / team / "composition.yaml")


def load_all_compositions(root: Path, override_root: Path | None = None) -> dict[str, Composition]:
    out: dict[str, Composition] = {}
    for team in KNOWN_TEAMS:
        found = load_composition(team, root, override_root)
        if found is not None:
            out[team] = found
    return out
