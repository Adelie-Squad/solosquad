"""System-prompt assembly with a token budget and an injection report (§D1).

Layers in priority order; when the budget is exceeded the lowest-priority droppable layer
goes first. The agent's own identity is never dropped. Every assembly can be dumped so a
human (or the FDE) can see exactly what an agent was told.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from solosquad.harness.base import PromptLayer


def estimate_tokens(text: str) -> int:
    """Pre-send estimate only (M4: provider-reported usage is the truth after the call).
    ~3 chars/token sits between English (~4) and Korean (~1.5 to 2)."""
    return max(1, len(text) // 3) if text else 0


@dataclass(frozen=True)
class Candidate:
    name: str
    text: str
    priority: int
    """Higher survives longer."""
    droppable: bool = True


@dataclass
class AssemblyReport:
    included: list[str] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    tokens: int = 0
    budget: int = 0

    def dump(self, path: Path, layers: list[PromptLayer]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            **asdict(self),
            "layers": [{"name": layer.name, "text": layer.text} for layer in layers],
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class PromptAssembler:
    def __init__(self, budget_tokens: int) -> None:
        self.budget = budget_tokens

    def assemble(self, candidates: list[Candidate]) -> tuple[list[PromptLayer], AssemblyReport]:
        kept = [c for c in candidates if c.text.strip()]
        report = AssemblyReport(budget=self.budget)
        while sum(estimate_tokens(c.text) for c in kept) > self.budget:
            droppable = [c for c in kept if c.droppable]
            if not droppable:
                break
            victim = min(droppable, key=lambda c: c.priority)
            kept.remove(victim)
            report.dropped.append(victim.name)
        order = {c.name: i for i, c in enumerate(candidates)}
        kept.sort(key=lambda c: order[c.name])
        report.included = [c.name for c in kept]
        report.tokens = sum(estimate_tokens(c.text) for c in kept)
        return [PromptLayer(c.name, c.text) for c in kept], report
