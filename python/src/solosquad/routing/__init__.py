"""Connections → pool → routing (decisions 22 · 35 · 40)."""

from solosquad.routing.connections import (
    Connection,
    ConnectionKind,
    load_connections,
    save_connections,
)
from solosquad.routing.policy import ChiefPolicy, load_policy
from solosquad.routing.router import Escalation, NoConnection, Router, Selection
from solosquad.routing.vault import SecretStore

__all__ = [
    "ChiefPolicy",
    "Connection",
    "ConnectionKind",
    "Escalation",
    "NoConnection",
    "Router",
    "SecretStore",
    "Selection",
    "load_connections",
    "load_policy",
    "save_connections",
]
