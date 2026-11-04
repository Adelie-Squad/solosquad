"""Chief's resource policy (decision 35) — tokens, limits, models for one org.

Lives in `orgs/<org>/policy.yaml`, which Chief edits; `core/custom/policies/routing.yaml`
provides owner-wide defaults underneath. The router executes it as rules — no LLM call
per selection — and only hands Chief the exceptions.

    budget:
      monthly_usd: 200
      warn_at: 0.8
    agents:
      chief:    {models: [sonnet, gpt-5]}
      engineer: {models: [opus, sonnet], connections: [claude-max]}
    tags:
      bulk-summary: {models: [haiku, gpt-5-mini]}
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from solosquad.assets.text import load_yaml


class AgentPreference(BaseModel):
    models: list[str] = Field(default_factory=list)
    connections: list[str] = Field(default_factory=list)


class Budget(BaseModel):
    monthly_usd: float | None = None
    warn_at: float = 0.8


class ChiefPolicy(BaseModel):
    budget: Budget = Field(default_factory=Budget)
    agents: dict[str, AgentPreference] = Field(default_factory=dict)
    tags: dict[str, AgentPreference] = Field(default_factory=dict)
    default: AgentPreference = Field(default_factory=AgentPreference)

    def preference(self, agent: str, tags: tuple[str, ...] = ()) -> AgentPreference:
        """Tag rules beat the agent's own preference; the policy default fills the gaps."""
        for tag in tags:
            if tag in self.tags:
                return self.tags[tag]
        return self.agents.get(agent, self.default)


def _merge(base: dict[str, Any], top: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in top.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load_policy(org_policy: Path, owner_defaults: dict[str, Any] | None = None) -> ChiefPolicy:
    data = load_yaml(org_policy.read_text(encoding="utf-8")) if org_policy.is_file() else None
    merged = _merge(owner_defaults or {}, data if isinstance(data, dict) else {})
    return ChiefPolicy.model_validate(merged)
