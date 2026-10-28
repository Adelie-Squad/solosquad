"""An org's agent company as one swarm graph (decisions 19 · 27 · 35 · 40).

Every agent in the org's team is a node; Chief is the default entry. Handoff edges come
from each agent's `handoffs:` frontmatter, or are derived from team composition when it is
absent (M22 default): Chief ↔ team leads, a lead ↔ its members, at most six per agent.
"""

from __future__ import annotations

import json
import operator
import re
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any

from solosquad.context.execution import ExecutionContext
from solosquad.context.ledger import Ledger, LedgerEntry
from solosquad.context.prompt import Candidate, PromptAssembler
from solosquad.context.resolve import Resolver
from solosquad.context.transcript import render_transcript
from solosquad.extensions import EngineCustomization
from solosquad.graph import (
    Command,
    CompiledStateGraph,
    SqliteSaver,
    SqliteStore,
    emit_message_chunk,
    interrupt,
)
from solosquad.harness.base import SpawnRequest
from solosquad.harness.events import End, Error, RateLimit, TextDelta, ToolResult, ToolUse, Usage
from solosquad.harness.guard_hook import MARKER
from solosquad.mcp import handoff as handoff_mcp
from solosquad.messages import Message, TextPart, ToolCallPart
from solosquad.routing.router import NoConnection, Router
from solosquad.swarm import SwarmState, create_handoff_tool, create_swarm, handoff_target

MAX_HANDOFFS = 6
DEFAULT_ENTRY = "chief"
APPROVAL = re.compile(rf"{MARKER}:([0-9a-f]+):(.*)")


class CompanyState(SwarmState, total=False):
    grants: Annotated[list[str], operator.add]
    """Guard signatures a human approved on this thread."""
    pending_approval: dict[str, Any] | None
    workdir: str | None
    tags: list[str]


class AgentError(RuntimeError):
    pass


@dataclass
class AgentRuntime:
    ctx: ExecutionContext
    resolver: Resolver
    router: Router
    ledger: Ledger
    customization: EngineCustomization = field(default_factory=EngineCustomization)
    timeout_s: float = 30 * 60
    max_attempts: int = 3
    dump_injections: bool = False

    @property
    def guard_dir(self) -> Path:
        return self.ctx.data_dir / "guard"


def _approved(decision: Any) -> bool:
    if isinstance(decision, dict):
        return bool(decision.get("approved"))
    if isinstance(decision, str):
        return decision.strip().lower() in {"y", "yes", "approve", "approved", "ok", "승인"}
    return decision is True


class AgentNode:
    def __init__(self, name: str, rt: AgentRuntime, handoffs: dict[str, str]) -> None:
        self.name = name
        self.__name__ = name
        self.rt = rt
        self.handoffs = handoffs
        self.handoff_tools = [
            create_handoff_tool(agent_name=d, description=desc) for d, desc in handoffs.items()
        ]

    # ------------------------------------------------------------------ prompt

    def _system_prompt(self, window: int) -> tuple[str, Any]:
        r = self.rt.resolver
        spec = r.agent(self.name).spec
        team = r.team_of(self.name)
        handoff_text = "\n".join(f"- {d}: {desc}" for d, desc in self.handoffs.items())
        candidates = [
            Candidate("Owner", r.owner_knowledge(), priority=6),
            Candidate("Business", r.org_knowledge(), priority=4),
            Candidate("Team", r.team_knowledge(team) if team else "", priority=5),
            Candidate(
                f"You are {self.name}",
                f"{spec.description}\n\n{spec.body}",
                priority=10,
                droppable=False,
            ),
            Candidate(
                "Colleagues you can hand work to",
                (
                    "Call the matching transfer_to_<name> tool with a complete task when someone "
                    "else should continue; otherwise finish the work yourself.\n" + handoff_text
                )
                if handoff_text
                else "",
                priority=9,
                droppable=False,
            ),
        ]
        layers, report = PromptAssembler(int(window * 0.4)).assemble(candidates)
        return "\n\n".join(f"## {layer.name}\n\n{layer.text.strip()}" for layer in layers), (
            layers,
            report,
        )

    def _prompt(self, messages: Sequence[Message], window: int) -> str:
        transcript, _ = render_transcript(messages, int(window * 0.5))
        return (
            f"{transcript}\n\n---\nYou are {self.name} in {self.rt.ctx.org}'s agent company. "
            "Continue from the conversation above."
        )

    # ------------------------------------------------------------------ run

    def _guard_files(self, thread_id: str, grants: list[str]) -> tuple[Path, Path]:
        d = self.rt.guard_dir
        d.mkdir(parents=True, exist_ok=True)
        policy = d / "policy.json"
        rules = [
            {"tool": r.tool, "command": r.command, "action": r.action.value, "reason": r.reason}
            for r in self.rt.customization.guard.rules
        ]
        policy.write_text(json.dumps({"rules": rules, "include_defaults": False}), encoding="utf-8")
        grants_file = d / f"{thread_id}.grants.json"
        grants_file.write_text(json.dumps(sorted(set(grants))), encoding="utf-8")
        return policy, grants_file

    async def __call__(self, state: dict[str, Any], config: dict[str, Any]) -> Any:
        thread_id = str((config.get("configurable") or {}).get("thread_id", "adhoc"))
        notes: list[Message] = []
        new_grants: list[str] = []
        pending = state.get("pending_approval")
        if pending and pending.get("agent") == self.name:
            decision = interrupt({"kind": "approval", **pending})
            if _approved(decision):
                new_grants.append(pending["signature"])
                notes.append(
                    Message("user", (TextPart(f"(approved by owner: {pending['reason']})"),))
                )
            else:
                notes.append(
                    Message(
                        "user",
                        (TextPart(f"(declined by owner: {pending['reason']}) — do not retry it"),),
                    )
                )
        grants = [*(state.get("grants") or []), *new_grants]
        messages = [*(state.get("messages") or []), *notes]

        for hook in self.rt.customization.before_activation:
            hook({"agent": self.name, "thread_id": thread_id, "org": self.rt.ctx.org})

        excluded: set[str] = set()
        last_error = ""
        for _attempt in range(self.rt.max_attempts):
            try:
                selection = self.rt.router.select(
                    self.name, tuple(state.get("tags") or ()), excluded
                )
            except NoConnection as e:
                raise AgentError(
                    f"{self.name}: {e}{' — last error: ' + last_error if last_error else ''}"
                ) from e
            window = selection.harness.capabilities.max_context_tokens
            system_prompt, (layers, report) = self._system_prompt(window)
            if self.rt.dump_injections:
                report.dump(
                    self.rt.ctx.data_dir
                    / "injections"
                    / thread_id
                    / f"{time.time_ns()}-{self.name}.json",
                    layers,
                )
            mcp = [handoff_mcp.server_spec(self.handoffs)] if self.handoffs else []
            request = SpawnRequest(
                prompt=self._prompt(messages, window),
                system_prompt=system_prompt,
                model=selection.model,
                cwd=Path(state.get("workdir") or self.rt.ctx.workspace_root),
                mcp_servers=(*mcp, *self.rt.customization.tools),
                env=selection.env,
                timeout_s=self.rt.timeout_s,
                guard_files=self._guard_files(thread_id, grants)
                if selection.harness.name == "claude-code"
                else None,
            )
            texts: list[str] = []
            handoff: tuple[str, str, str] | None = None
            approval: dict[str, Any] | None = None
            end: End | None = None
            limited = False
            retry_error: str | None = None
            started = time.time()
            async with self.rt.router.lease(selection):
                async for event in selection.harness.spawn(request):
                    if isinstance(event, TextDelta):
                        texts.append(event.text)
                        emit_message_chunk(event.text, {"agent": self.name})
                    elif isinstance(event, ToolUse):
                        target = handoff_target(event.name)
                        if target and target in self.handoffs and handoff is None:
                            handoff = (target, event.id, str(event.input.get("task") or ""))
                    elif isinstance(event, ToolResult):
                        m = APPROVAL.search(event.content)
                        if m and approval is None:
                            approval = {
                                "agent": self.name,
                                "signature": m.group(1),
                                "reason": m.group(2),
                            }
                    elif isinstance(event, RateLimit) and event.status == "exceeded":
                        self.rt.router.mark_limited(selection.connection.id, event.resets_at)
                        limited = True
                    elif isinstance(event, Error):
                        if event.retryable:
                            retry_error = event.message
                        else:
                            raise AgentError(f"{self.name}: {event.message}")
                    elif isinstance(event, End):
                        end = event
            usage = end.usage if end else Usage()
            cost = selection.harness.parse_cost(end) if end else None
            self.rt.ledger.record(
                LedgerEntry(
                    thread_id=thread_id,
                    org=self.rt.ctx.org,
                    workspace=self.rt.ctx.workspace,
                    agent=self.name,
                    connection_id=selection.connection.id,
                    harness=selection.harness.name,
                    model=selection.model,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cache_read_tokens=usage.cache_read_tokens,
                    cache_write_tokens=usage.cache_write_tokens,
                    cost_usd=cost.usd if cost else 0.0,
                    estimated=cost.estimated if cost else True,
                    duration_ms=int((time.time() - started) * 1000),
                    stop_reason=end.stop_reason if end else None,
                )
            )
            failed = end is None or end.stop_reason == "error"
            if (limited or retry_error) and failed and not texts and handoff is None:
                excluded.add(selection.connection.id)
                last_error = retry_error or "rate limited"
                continue
            if failed and not texts and handoff is None:
                raise AgentError(
                    f"{self.name}: activation ended without output ({retry_error or 'no result'})"
                )
            break
        else:
            raise AgentError(
                f"{self.name}: gave up after {self.rt.max_attempts} attempts — {last_error}"
            )

        for hook in self.rt.customization.after_activation:
            hook({"agent": self.name, "thread_id": thread_id}, {"text": "".join(texts)})

        text = "".join(texts).strip() or (end.result_text if end and end.result_text else "")
        parts: list[Any] = [TextPart(text)] if text else []
        if handoff:
            parts.append(
                ToolCallPart(handoff[1], f"transfer_to_{handoff[0]}", {"task": handoff[2]})
            )
        reply = Message("assistant", tuple(parts) or (TextPart(""),), name=self.name)
        update: dict[str, Any] = {"messages": [*notes, reply], "pending_approval": None}
        if new_grants:
            update["grants"] = new_grants
        if approval is not None and approval["signature"] not in grants:
            update["pending_approval"] = approval
            return Command(update=update, goto=self.name)
        if handoff is not None:
            tool = next(t for t in self.handoff_tools if t.agent_name == handoff[0])
            cmd = tool.command([], handoff[1], handoff[2])
            assert isinstance(cmd.update, dict)
            update["messages"] = [*update["messages"], *cmd.update["messages"]]
            update["active_agent"] = handoff[0]
            return Command(update=update, goto=handoff[0])
        return update


def derive_handoffs(resolver: Resolver, agents: list[str]) -> dict[str, dict[str, str]]:
    specs = {a: resolver.agent(a).spec for a in agents}
    teams = resolver.teams()
    leads = {c.main for c in teams.values() if c.main in specs}
    out: dict[str, dict[str, str]] = {}
    for a, spec in specs.items():
        declared = spec.extra.get("handoffs")
        if isinstance(declared, list):
            targets = [t for t in declared if isinstance(t, str) and t in specs and t != a]
        elif a == DEFAULT_ENTRY:
            targets = sorted(leads)
        elif a in leads:
            team = next(c for c in teams.values() if c.main == a)
            targets = [DEFAULT_ENTRY, *[m for m in team.members if m in specs]]
        else:
            lead = next((c.main for c in teams.values() if a in c.members), None)
            targets = [t for t in (lead, DEFAULT_ENTRY) if t]
        targets = [t for t in dict.fromkeys(targets) if t in specs and t != a][:MAX_HANDOFFS]
        out[a] = {t: specs[t].description for t in targets}
    return out


def build_company(rt: AgentRuntime, agents: list[str] | None = None) -> CompiledStateGraph:
    names = agents or sorted(rt.resolver.available("agents"))
    if DEFAULT_ENTRY not in names:
        raise ValueError(f"an agent company needs a {DEFAULT_ENTRY!r} agent")
    handoffs = derive_handoffs(rt.resolver, names)
    nodes = [AgentNode(n, rt, handoffs[n]) for n in names]
    builder = create_swarm(nodes, default_active_agent=DEFAULT_ENTRY, state_schema=CompanyState)
    return builder.compile(
        checkpointer=SqliteSaver(rt.ctx.db_path),
        store=SqliteStore(rt.ctx.data_dir / "store.sqlite"),
        name=f"{rt.ctx.org}-company",
    )
