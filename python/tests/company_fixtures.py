"""A tiny three-agent company (chief → pm → engineer) driven by scripted fake harnesses."""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from solosquad.company import AgentRuntime
from solosquad.context import Ledger, Resolver, build_context
from solosquad.harness.base import Harness, SpawnRequest
from solosquad.harness.events import End, LlmStreamEvent, Start, TextDelta, ToolUse, Usage
from solosquad.harness.fake import FakeHarness
from solosquad.layout import ExecutionPolicy, scaffold_org, scaffold_solution, scaffold_workspace
from solosquad.routing import ChiefPolicy, Connection, ConnectionKind, Router, SecretStore
from solosquad.routing.router import Escalation

AGENT = "---\nname: {name}\ndescription: {desc}\n{extra}---\n{body}\n"
TEAMS = {
    "core": "main: chief\nmembers: []\n",
    "product": "main: pm\nmembers: [engineer]\n",
}


def make_bundle(root: Path) -> Path:
    for name, desc in (
        ("chief", "Talks to the owner"),
        ("pm", "Plans the work"),
        ("engineer", "Builds it"),
    ):
        d = (
            root / "agents" / "main" / name
            if name != "engineer"
            else root / "agents" / "specialists" / name
        )
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(
            AGENT.format(name=name, desc=desc, extra="", body=f"{name} instructions"),
            encoding="utf-8",
        )
    for team, comp in TEAMS.items():
        (root / "teams" / team).mkdir(parents=True)
        (root / "teams" / team / "composition.yaml").write_text(comp, encoding="utf-8")
        (root / "teams" / team / "KNOWLEDGE.md").write_text(f"{team} knowledge", encoding="utf-8")
    return root


def agent_of(req: SpawnRequest) -> str:
    m = re.search(r"## You are (\S+)", req.system_prompt)
    return m.group(1) if m else "?"


def reply(text: str, usage: Usage | None = None, cost: float = 0.01) -> list[LlmStreamEvent]:
    return [Start(), TextDelta(text), End("end_turn", usage or Usage(10, 5), cost)]


def handoff(to: str, task: str) -> list[LlmStreamEvent]:
    return [
        Start(),
        TextDelta(f"handing to {to}"),
        ToolUse("call-1", f"mcp__solosquad__transfer_to_{to}", {"task": task}),
        End("end_turn", Usage(8, 4), 0.01),
    ]


def default_script(req: SpawnRequest) -> Sequence[LlmStreamEvent]:
    who = agent_of(req)
    if who == "chief" and "transfer" not in req.prompt and "please plan" in req.prompt:
        return handoff("pm", "plan the launch")
    return reply(f"{who} done")


class Company:
    def __init__(self, tmp: Path, **router_kw: Any) -> None:
        self.bundle = make_bundle(tmp / "bundle")
        sol = scaffold_solution(tmp / "elon", "2.0.0")
        org = scaffold_org(sol, "tesla", "bundled", "2.0.0")
        scaffold_workspace(org, "hq")
        self.ctx = build_context(sol.root, "tesla", "hq", self.bundle)
        self.ledger = Ledger(self.ctx.data_dir / "ledger.sqlite")
        self.secrets = SecretStore(self.ctx.data_dir / "secrets.json")
        self.escalations: list[Escalation] = []
        self.harnesses: dict[str, FakeHarness] = {}
        self.scripts: dict[str, Callable[[SpawnRequest], Sequence[LlmStreamEvent]]] = {}
        self.connections = router_kw.pop(
            "connections",
            [
                Connection(
                    id="max",
                    kind=ConnectionKind.SUBSCRIPTION,
                    provider="anthropic",
                    harness="fake",
                    models=["sonnet", "opus"],
                ),
                Connection(
                    id="router",
                    kind=ConnectionKind.API_KEY,
                    provider="openrouter",
                    harness="fake",
                    models=["gpt-5"],
                ),
            ],
        )
        self.router = Router(
            self.connections,
            router_kw.pop("workspace_policy", ExecutionPolicy()),
            router_kw.pop("chief_policy", ChiefPolicy()),
            self.ledger,
            self.secrets,
            org="tesla",
            harness_factory=self._factory,
            on_escalation=self.escalations.append,
            **router_kw,
        )
        self.rt = AgentRuntime(self.ctx, Resolver(self.ctx), self.router, self.ledger)

    def _factory(self, conn: Connection, _secrets: SecretStore) -> Harness:
        if conn.id not in self.harnesses:
            script = self.scripts.get(conn.id, default_script)
            self.harnesses[conn.id] = FakeHarness(
                lambda req, cid=conn.id: self.scripts.get(cid, script)(req)
            )
        return self.harnesses[conn.id]
