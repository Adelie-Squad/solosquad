import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateWorkflow,
  subworkflowRefs,
  detectSubworkflowCycles,
  subworkflowDepths,
} from "../src/bot/workflow-validate.js";

/** v1.3.5 §3.3 — `_workflow/<id>` sub-workflow composition validation. */

const known = new Set(["product/pmf-planner"]);

function wf(id: string, stages: { id: string; agent: string; handoff_to?: string | null }[]) {
  return { schema_version: 2, id, name: id, stages };
}

test("_workflow/<known> sub-workflow ref validates OK", () => {
  const doc = wf("main", [{ id: "stage-1", agent: "_workflow/sub-a", handoff_to: null }]);
  const r = validateWorkflow(doc, { knownAgents: known, knownWorkflows: new Set(["sub-a"]), selfId: "main" });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("_workflow/<unknown> ref → WF_SUBWORKFLOW_UNRESOLVED", () => {
  const doc = wf("main", [{ id: "stage-1", agent: "_workflow/ghost", handoff_to: null }]);
  const r = validateWorkflow(doc, { knownAgents: known, knownWorkflows: new Set(["sub-a"]), selfId: "main" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === "WF_SUBWORKFLOW_UNRESOLVED"));
});

test("a workflow calling its own id → WF_SUBWORKFLOW_SELF", () => {
  const doc = wf("loop", [{ id: "stage-1", agent: "_workflow/loop", handoff_to: null }]);
  const r = validateWorkflow(doc, { knownAgents: known, knownWorkflows: new Set(["loop"]), selfId: "loop" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === "WF_SUBWORKFLOW_SELF"));
});

test("subworkflowRefs extracts _workflow ids from stages", () => {
  const doc = wf("m", [
    { id: "s1", agent: "_workflow/a", handoff_to: "s2" },
    { id: "s2", agent: "product/pmf-planner", handoff_to: "s3" },
    { id: "s3", agent: "_workflow/b", handoff_to: null },
  ]);
  assert.deepEqual(subworkflowRefs(doc).sort(), ["a", "b"]);
});

test("detectSubworkflowCycles finds an A→B→A cycle", () => {
  const cycles = detectSubworkflowCycles([
    { id: "a", subworkflows: ["b"] },
    { id: "b", subworkflows: ["a"] },
  ]);
  assert.equal(cycles.length, 1);
});

test("detectSubworkflowCycles is empty for a DAG", () => {
  const cycles = detectSubworkflowCycles([
    { id: "main", subworkflows: ["sub"] },
    { id: "sub", subworkflows: [] },
  ]);
  assert.equal(cycles.length, 0);
});

test("subworkflowDepths computes nesting depth", () => {
  const depths = subworkflowDepths([
    { id: "main", subworkflows: ["sub"] },
    { id: "sub", subworkflows: ["leaf"] },
    { id: "leaf", subworkflows: [] },
  ]);
  assert.equal(depths.get("main"), 2);
  assert.equal(depths.get("sub"), 1);
  assert.equal(depths.get("leaf"), 0);
});
