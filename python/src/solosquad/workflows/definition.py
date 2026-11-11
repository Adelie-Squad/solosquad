"""Workflow definition files — `orgs/<org>/workflows/<name>.yaml` (PRD v2.1.0 I12 · I26).

    name: monthly-pnl
    title: 월 손익표
    schedule: "0 9 1 * *"         # optional five-field cron, office timezone
    enabled: true                 # the web can switch it; the switch lives in the data folder
    inputs:
      - {name: ledger, type: upload, accept: [xlsx, csv], label: 거래 원장}
    steps:
      - id: compute               # a tool — deterministic code, no LLM (numbers stay exact)
        tool: finance.pnl
        with: {file: "{{ inputs.ledger }}"}
        save_as: {kind: finance.pnl, title: "손익표"}
      - id: review                # an approval point — a W12 card, the run waits
        approval: {title: 손익표 확인, summary: "순이익 {{ steps.compute.net_income }}"}
      - id: brief                 # an agent — the company gets the job on its own thread
        agent: chief
        prompt: "다음 손익표를 대표에게 3줄로 요약해줘: {{ steps.compute.summary }}"
        save_as: {kind: brief}

A step is exactly one of `tool`, `approval`, `agent`. `{{ … }}` reads `inputs.<name>` or
`steps.<id>.<field>`; a value that is only a placeholder keeps its type.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from solosquad.assets.text import load_yaml

StepType = Literal["tool", "approval", "agent"]


class SaveAs(BaseModel):
    kind: str
    title: str | None = None


class Approval(BaseModel):
    title: str
    summary: str = ""
    risk: str = "medium"
    category: str = "review"
    """Decision 51: `review` is team-tier by default; purchase · payment · transfer ·
    delete are owner-tier. The owner can change tiers in the web."""
    on_decline: str | None = None
    """A step id to go on with when the answer is no (a branch); unset = the run ends
    declined."""


class Step(BaseModel):
    id: str
    tool: str | None = None
    with_: dict[str, Any] = Field(default_factory=dict, alias="with")
    approval: Approval | None = None
    agent: str | None = None
    prompt: str | None = None
    save_as: SaveAs | None = None
    end: bool = False
    """The run is done after this step — the steps after it are only reached by a branch
    (`approval.on_decline`)."""

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _one_kind(self) -> Step:
        kinds = [k for k in ("tool", "approval", "agent") if getattr(self, k)]
        if len(kinds) != 1:
            raise ValueError(f"step {self.id!r} must be exactly one of tool · approval · agent")
        if self.agent and not self.prompt:
            raise ValueError(f"agent step {self.id!r} needs a prompt")
        return self

    @property
    def type(self) -> StepType:
        if self.tool:
            return "tool"
        return "approval" if self.approval else "agent"


class Input(BaseModel):
    name: str
    type: Literal["upload", "text", "number"] = "text"
    label: str = ""
    accept: list[str] = Field(default_factory=list)
    required: bool = True


class WorkflowDef(BaseModel):
    name: str
    title: str = ""
    description: str = ""
    schedule: str | None = None
    enabled: bool = True
    team: str | None = None
    """Team that owns this workflow — its members may approve team-tier steps."""
    inputs: list[Input] = Field(default_factory=list)
    steps: list[Step]

    @model_validator(mode="after")
    def _unique_steps(self) -> WorkflowDef:
        ids = [s.id for s in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError(f"workflow {self.name!r} has duplicate step ids")
        if not self.steps:
            raise ValueError(f"workflow {self.name!r} has no steps")
        for s in self.steps:
            target = s.approval.on_decline if s.approval else None
            if target is not None and target not in ids:
                raise ValueError(f"step {s.id!r}: on_decline {target!r} is not a step id")
        return self

    def public(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title or self.name,
            "description": self.description,
            "schedule": self.schedule,
            "team": self.team,
            "inputs": [i.model_dump() for i in self.inputs],
            "steps": [{"id": s.id, "type": s.type, "title": _step_title(s)} for s in self.steps],
        }


def _step_title(s: Step) -> str:
    if s.approval:
        # a title that reads a run's value (`… {{ steps.pay.total }}`) has none before a run
        return " ".join(_PLACEHOLDER.sub("", s.approval.title).split()) or s.id
    if s.agent:
        return f"{s.agent}: {s.id}"
    return s.id


def load_workflows(folder: Path) -> tuple[dict[str, WorkflowDef], list[str]]:
    """→ (definitions by name, errors). A broken file is reported, never fatal."""
    defs: dict[str, WorkflowDef] = {}
    errors: list[str] = []
    if not folder.is_dir():
        return defs, errors
    for path in sorted(folder.glob("*.yaml")):
        try:
            data = load_yaml(path.read_text(encoding="utf-8"))
            wf = WorkflowDef.model_validate(data)
        except Exception as e:  # yaml and validation errors alike
            errors.append(f"{path.name}: {str(e).splitlines()[0]}")
            continue
        if wf.name != path.stem:
            errors.append(f"{path.name}: name {wf.name!r} must match the file name")
            continue
        defs[wf.name] = wf
    return defs, errors


_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}")


def _lookup(path: str, scope: dict[str, Any]) -> Any:
    cur: Any = scope
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            raise KeyError(f"no value for {{{{ {path} }}}}")
    return cur


def render(value: Any, scope: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {k: render(v, scope) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, scope) for v in value]
    if not isinstance(value, str):
        return value
    whole = _PLACEHOLDER.fullmatch(value.strip())
    if whole:
        return _lookup(whole.group(1), scope)
    return _PLACEHOLDER.sub(lambda m: str(_lookup(m.group(1), scope)), value)
