"""Cron prompt reader. Bundled crons are plain Markdown; schedules live in config."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from solosquad.assets.text import normalize_line


@dataclass(frozen=True)
class CronPrompt:
    name: str
    title: str | None
    body: str

    def to_json_dict(self) -> dict[str, Any]:
        return {"name": self.name, "title": self.title, "body": self.body}


def load_cron(path: Path) -> CronPrompt:
    body = normalize_line(path.read_text(encoding="utf-8"))
    first = body.split("\n", 1)[0]
    return CronPrompt(
        name=path.stem,
        title=first[2:].strip() if first.startswith("# ") else None,
        body=body,
    )
