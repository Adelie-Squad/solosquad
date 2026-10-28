"""LLM connections (decision 22): subscription logins and API keys, as many as the owner likes.

Kept in `core/connections.yaml` (the owner's) and optionally `orgs/<org>/connections.yaml`
(an org that is billed separately). Secrets never live here — `secret_ref` names an entry
in the data folder's secret store.
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from solosquad.assets.text import load_yaml


class ConnectionKind(StrEnum):
    SUBSCRIPTION = "subscription"
    """A logged-in CLI account (Claude Code, Codex) — runs through that CLI."""
    API_KEY = "api_key"
    """Provider key (Anthropic, OpenAI, OpenRouter, …) — runs through a CLI harness or lite."""
    LOCAL_LLM = "local_llm"
    """An OpenAI-compatible server inside the office or on the machine."""


class Connection(BaseModel):
    id: str
    kind: ConnectionKind
    provider: str
    harness: str
    """claude-code · codex · opencode · lite"""
    models: list[str] = Field(default_factory=list)
    active: bool = True
    base_url: str | None = None
    secret_ref: str | None = None
    secret_env: str | None = None
    """Env var the harness reads the secret from (e.g. ANTHROPIC_API_KEY, OPENROUTER_API_KEY)."""
    slots: int = 2
    """Concurrent activations this connection may carry."""
    monthly_budget_usd: float | None = None
    network: str = "external"
    """external · internal · local — matched against the workspace execution policy."""


class ConnectionsFile(BaseModel):
    schema_version: int = 1
    connections: list[Connection] = Field(default_factory=list)


def load_connections(path: Path) -> list[Connection]:
    if not path.is_file():
        return []
    data = load_yaml(path.read_text(encoding="utf-8")) or {}
    return ConnectionsFile.model_validate(data).connections


def save_connections(path: Path, connections: list[Connection]) -> None:
    doc = ConnectionsFile(connections=connections).model_dump(mode="json", exclude_none=True)
    path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")
