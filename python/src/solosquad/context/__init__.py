"""What an activation knows about where it runs and what it may read (§B4 · §D1 · M20 · M26)."""

from solosquad.context.execution import ExecutionContext, build_context
from solosquad.context.ledger import Ledger, LedgerEntry
from solosquad.context.prompt import AssemblyReport, Candidate, PromptAssembler, estimate_tokens
from solosquad.context.resolve import Resolved, Resolver
from solosquad.context.transcript import render_transcript

__all__ = [
    "AssemblyReport",
    "Candidate",
    "ExecutionContext",
    "Ledger",
    "LedgerEntry",
    "PromptAssembler",
    "Resolved",
    "Resolver",
    "build_context",
    "estimate_tokens",
    "render_transcript",
]
