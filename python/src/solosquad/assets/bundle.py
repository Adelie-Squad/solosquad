"""Load a whole primitive bundle (agents · skills · teams · crons) from one root.

In v2 this layout is what an org package ships (ideation decision 40); today the
repository root is the only bundle.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from solosquad.assets.composition import Composition, load_all_compositions
from solosquad.assets.cron import CronPrompt, load_cron
from solosquad.assets.skill import SkillParseError, SkillSpec, parse_skill_md

AGENT_DIRS = ("agents/main", "agents/specialists")
SKILL_DIR = "skills"
CRON_DIR = "crons"


@dataclass
class Bundle:
    root: Path
    agents: dict[str, SkillSpec] = field(default_factory=dict)
    skills: dict[str, SkillSpec] = field(default_factory=dict)
    teams: dict[str, Composition] = field(default_factory=dict)
    crons: dict[str, CronPrompt] = field(default_factory=dict)
    errors: list[SkillParseError] = field(default_factory=list)

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "agents": {k: v.to_json_dict() for k, v in self.agents.items()},
            "skills": {k: v.to_json_dict() for k, v in self.skills.items()},
            "teams": {k: v.to_json_dict() for k, v in self.teams.items()},
            "crons": {k: v.to_json_dict() for k, v in self.crons.items()},
        }


def _skill_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(p / "SKILL.md" for p in directory.iterdir() if (p / "SKILL.md").is_file())


def load_bundle(root: Path) -> Bundle:
    """Keys are POSIX paths relative to `root`, matching the v1.4.3 golden snapshot."""
    bundle = Bundle(root=root)

    def parse_into(target: dict[str, SkillSpec], files: list[Path]) -> None:
        for path in files:
            rel = path.relative_to(root).as_posix()
            try:
                target[rel] = parse_skill_md(path.read_text(encoding="utf-8"), rel)
            except SkillParseError as e:
                bundle.errors.append(e)

    parse_into(bundle.agents, [f for d in AGENT_DIRS for f in _skill_files(root / d)])
    parse_into(bundle.skills, _skill_files(root / SKILL_DIR))
    bundle.teams = load_all_compositions(root)
    cron_dir = root / CRON_DIR
    if cron_dir.is_dir():
        for path in sorted(cron_dir.glob("*.md")):
            bundle.crons[path.relative_to(root).as_posix()] = load_cron(path)
    return bundle


def find_bundle_root(start: Path) -> Path | None:
    """Nearest ancestor that looks like a bundle (has `agents/` and `teams/`)."""
    for candidate in (start, *start.parents):
        if (candidate / "agents").is_dir() and (candidate / "teams").is_dir():
            return candidate
    return None
