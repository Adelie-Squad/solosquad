"""Workflow execution (PRD v2.1.0 I26) — a workflow run is a graph run.

Each step is one execution of the `step` node of a small graph on the in-house engine,
so a workflow gets what the agent company already has: checkpoints after every step,
crash resume, per-thread ordering (v2.0.0 I28), and approval points as `interrupt`
with the W12 card — the same approval screen and audit trail as a guard approval.

- a `tool` step runs deterministic code (`workflows/tools.py`);
- an `approval` step pauses the run until the owner answers;
- an `agent` step hands a job to the agent company on its own thread and waits — the
  company's run is visible in the web like any other.

Runs live in their own `workflow-runs.sqlite`, next to the company's runs.sqlite.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, TypedDict

from solosquad.artifacts import ArtifactStore
from solosquad.company import approval_card
from solosquad.graph import END, START, SqliteSaver, StateGraph, interrupt
from solosquad.graph.pregel import CompiledStateGraph
from solosquad.messages import Message
from solosquad.runtime import CronSpec, RunManager
from solosquad.runtime.store import RunStore
from solosquad.workflows.definition import Step, WorkflowDef, load_workflows, render
from solosquad.workflows.tools import TOOLS

AskAgent = Callable[[str, str, str], Awaitable[str]]
"""(agent, prompt, workflow thread id) → the company's final answer."""

UPLOAD_LIMIT = 20 * 1024 * 1024
UPLOAD_TYPES = (".xlsx", ".csv")


class WorkflowState(TypedDict, total=False):
    workflow: str
    inputs: dict[str, Any]
    step: int
    current_step: str
    outputs: dict[str, Any]
    artifacts: list[str]
    status: str
    """running · done · declined"""


class WorkflowEngine:
    def __init__(
        self,
        org_root: Path,
        data_dir: Path,
        artifacts: ArtifactStore,
        ask_agent: AskAgent | None = None,
        *,
        timezone: str = "Asia/Seoul",
    ) -> None:
        self.org_root = org_root
        self.data_dir = data_dir
        self.artifacts = artifacts
        self.ask_agent = ask_agent
        self.uploads = data_dir / "uploads"
        self.defs, self.errors = load_workflows(org_root / "workflows")
        self._state_path = data_dir / "workflow-state.json"
        self.graph = self._build()
        self.manager = RunManager(
            self.graph,
            RunStore(data_dir / "workflow-runs.sqlite"),
            timezone=timezone,
            max_concurrency=2,
        )

    # ------------------------------------------------------------------ switches

    def _switches(self) -> dict[str, bool]:
        if not self._state_path.is_file():
            return {}
        data = json.loads(self._state_path.read_text(encoding="utf-8"))
        return {str(k): bool(v) for k, v in data.items()} if isinstance(data, dict) else {}

    def enabled(self, name: str) -> bool:
        return self._switches().get(name, self.defs[name].enabled)

    def set_enabled(self, name: str, on: bool) -> None:
        if name not in self.defs:
            raise KeyError(f"no workflow {name}")
        switches = {**self._switches(), name: on}
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._state_path.write_text(json.dumps(switches, indent=1), encoding="utf-8")
        cron = self._cron(name)
        if on and cron is not None:
            self.manager.set_cron(cron)
        else:
            self.manager.remove_cron(f"wf:{name}")

    def _cron(self, name: str) -> CronSpec | None:
        wf = self.defs[name]
        if not wf.schedule or any(i.required and i.type == "upload" for i in wf.inputs):
            return None  # a scheduled run cannot wait for someone to upload a file
        return CronSpec(f"wf:{name}", wf.schedule, "", payload={"workflow": name, "inputs": {}})

    # ------------------------------------------------------------------ lifecycle

    async def start(self) -> list[str]:
        crons = [c for n in self.defs if self.enabled(n) and (c := self._cron(n))]
        return await self.manager.start(crons)

    async def stop(self) -> None:
        await self.manager.stop()

    async def run_now(
        self, name: str, inputs: dict[str, Any] | None = None, *, source: str = "user"
    ) -> tuple[str, str]:
        """→ (thread id, run id)."""
        wf = self.defs.get(name)
        if wf is None:
            raise KeyError(f"no workflow {name}")
        given = dict(inputs or {})
        for spec in wf.inputs:
            if spec.required and spec.name not in given:
                raise ValueError(f"workflow {name} needs input {spec.name!r}")
            if spec.type == "upload" and spec.name in given:
                self.upload_path(str(given[spec.name]))  # validates before queuing
        tid = self.manager.create_thread(
            f"{wf.title or name} {time.strftime('%Y-%m-%d %H:%M')}", {"workflow": name}
        )
        rid = await self.manager.submit_input(
            tid, {"workflow": name, "inputs": given}, source=source
        )
        return tid, rid

    def summaries(self) -> list[dict[str, Any]]:
        out = []
        for name, wf in sorted(self.defs.items()):
            last = next(
                (
                    r
                    for r in self.manager.store.runs(limit=200)
                    if (self.manager.store.thread(r["thread_id"]) or {})
                    .get("metadata", {})
                    .get("workflow")
                    == name
                ),
                None,
            )
            out.append(
                {
                    **wf.public(),
                    "enabled": self.enabled(name),
                    "last_run": {
                        "id": last["id"],
                        "status": last["status"],
                        "created": last["created"],
                    }
                    if last
                    else None,
                }
            )
        return out

    # ------------------------------------------------------------------ uploads

    def save_upload(self, filename: str, data: bytes) -> dict[str, Any]:
        name = Path(filename).name
        suffix = Path(name).suffix.lower()
        if suffix not in UPLOAD_TYPES:
            raise ValueError(f"only {', '.join(UPLOAD_TYPES)} files can be uploaded")
        if len(data) > UPLOAD_LIMIT:
            raise ValueError(f"file is larger than {UPLOAD_LIMIT // (1024 * 1024)} MB")
        if not data:
            raise ValueError("empty file")
        self.uploads.mkdir(parents=True, exist_ok=True)
        uid = f"up-{time.strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(4)}"
        path = self.uploads / f"{uid}{suffix}"
        path.write_bytes(data)
        path.chmod(0o600)
        meta = {"id": uid, "filename": name, "size": len(data), "created": time.time()}
        (self.uploads / f"{uid}.json").write_text(
            json.dumps(meta, ensure_ascii=False), encoding="utf-8"
        )
        return meta

    def upload_path(self, uid: str) -> Path:
        if not uid.startswith("up-") or "/" in uid or "\\" in uid or ".." in uid:
            raise ValueError(f"not an upload id: {uid!r}")
        for suffix in UPLOAD_TYPES:
            path = self.uploads / f"{uid}{suffix}"
            if path.is_file():
                return path
        raise KeyError(f"no upload {uid}")

    def uploads_list(self) -> list[dict[str, Any]]:
        if not self.uploads.is_dir():
            return []
        metas = [json.loads(p.read_text(encoding="utf-8")) for p in self.uploads.glob("up-*.json")]
        return sorted(metas, key=lambda m: -float(m["created"]))

    # ------------------------------------------------------------------ the graph

    def _build(self) -> CompiledStateGraph:
        builder = StateGraph(WorkflowState)
        builder.add_node("step", self._step)
        builder.add_edge(START, "step")
        builder.add_conditional_edges(
            "step", lambda s: END if s.get("status") in ("done", "declined") else "step"
        )
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return builder.compile(
            checkpointer=SqliteSaver(self.data_dir / "workflows.sqlite"), name="workflows"
        )

    async def _step(self, state: WorkflowState, config: dict[str, Any]) -> dict[str, Any]:
        name = state["workflow"]
        wf = self.defs.get(name)
        if wf is None:
            raise KeyError(f"no workflow {name} (removed while a run was waiting?)")
        index = int(state.get("step") or 0)
        if index >= len(wf.steps):
            return {"status": "done"}
        step = wf.steps[index]
        tid = str((config.get("configurable") or {}).get("thread_id", ""))
        outputs = dict(state.get("outputs") or {})
        scope = {"inputs": self._resolved_inputs(wf, state.get("inputs") or {}), "steps": outputs}
        update: dict[str, Any] = {"current_step": step.id}
        result = await self._run(step, scope, wf, tid)
        if step.approval is not None and result.get("decision") != "approved":
            outputs[step.id] = result
            return {**update, "outputs": outputs, "status": "declined", "step": index + 1}
        if step.save_as is not None:
            art = self.artifacts.save(
                step.save_as.kind,
                str(render(step.save_as.title, scope)) if step.save_as.title else "",
                result,
                thread_id=tid,
                workflow=name,
                needs_review=bool(result.get("needs_review")),
            )
            result = {**result, "artifact_id": art.id}
            update["artifacts"] = [*(state.get("artifacts") or []), art.id]
        outputs[step.id] = result
        done = index + 1 >= len(wf.steps)
        return {
            **update,
            "outputs": outputs,
            "step": index + 1,
            "status": "done" if done else "running",
        }

    def _resolved_inputs(self, wf: WorkflowDef, given: dict[str, Any]) -> dict[str, Any]:
        out = dict(given)
        for spec in wf.inputs:
            if spec.type == "upload" and spec.name in out:
                out[spec.name] = str(self.upload_path(str(out[spec.name])))
        return out

    async def _run(
        self, step: Step, scope: dict[str, Any], wf: WorkflowDef, tid: str
    ) -> dict[str, Any]:
        if step.tool is not None:
            tool = TOOLS.get(step.tool)
            if tool is None:
                raise KeyError(f"no tool {step.tool!r} (known: {sorted(TOOLS)})")
            args = render(step.with_, scope)
            return await asyncio.to_thread(tool, **args)
        if step.approval is not None:
            card = approval_card(
                {
                    "agent": f"workflow:{wf.name}",
                    "reason": str(render(step.approval.title, scope)),
                    "summary": str(render(step.approval.summary, scope)),
                    "risk": step.approval.risk,
                }
            )
            card["title"] = str(render(step.approval.title, scope))
            card["workflow"] = wf.name
            card["step"] = step.id
            decision = interrupt(card)
            approved = decision == "approved" or (
                isinstance(decision, dict) and decision.get("decision") == "approved"
            )
            return {"decision": "approved" if approved else "declined"}
        assert step.agent is not None and step.prompt is not None
        if self.ask_agent is None:
            raise RuntimeError("this office has no agent company to hand the step to")
        prompt = str(render(step.prompt, scope))
        text = await self.ask_agent(step.agent, prompt, tid)
        return {"text": text, "agent": step.agent}


def company_asker(company: RunManager, timeout_s: float = 30 * 60) -> AskAgent:
    """An agent step = a message to the company on a thread tied to the workflow run."""

    async def ask(agent: str, prompt: str, wf_thread: str) -> str:
        tid = f"{wf_thread}-agent"
        if company.store.thread(tid) is None:
            company.create_thread(f"workflow step ({agent})", {"workflow_thread": wf_thread}, tid)
        rid = await company.submit(tid, f"[workflow job for {agent}] {prompt}", source="workflow")
        run = await company.wait(rid, timeout_s)
        if run["status"] != "success":
            raise RuntimeError(f"agent step ended {run['status']}: {run.get('error')}")
        msgs = (await company.thread_state(tid))["values"].get("messages") or []
        replies = [m.text for m in msgs if isinstance(m, Message) and m.role == "assistant"]
        return replies[-1] if replies else ""

    return ask
