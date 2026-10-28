"""Readers for the bundled primitives: agents, skills, teams, crons."""

from solosquad.assets.bundle import Bundle, load_bundle
from solosquad.assets.composition import KNOWN_TEAMS, Composition, load_all_compositions
from solosquad.assets.cron import CronPrompt, load_cron
from solosquad.assets.skill import SkillParseError, SkillSpec, parse_skill_md

__all__ = [
    "KNOWN_TEAMS",
    "Bundle",
    "Composition",
    "CronPrompt",
    "SkillParseError",
    "SkillSpec",
    "load_all_compositions",
    "load_bundle",
    "load_cron",
    "parse_skill_md",
]
