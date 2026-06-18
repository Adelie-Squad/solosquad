import { test } from "node:test";
import assert from "node:assert/strict";

import { validateWorkflow } from "../src/bot/workflow-validate.js";

const codes = (fs: { code: string }[]): string[] => fs.map((f) => f.code);

test("clean handoff chain passes", () => {
  const doc = {
    schema_version: 2,
    id: "autoplan-pm",
    stages: [
      { id: "a", agent: "product/pmf-planner", handoff_to: "b" },
      { id: "b", agent: "product/data-analyst", handoff_to: null },
    ],
  };
  const r = validateWorkflow(doc);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("stage cycle is an error (workflow must be a DAG)", () => {
  const doc = {
    schema_version: 2,
    id: "loopy",
    stages: [
      { id: "a", agent: "x/y", handoff_to: "b" },
      { id: "b", agent: "x/y", handoff_to: "a" },
    ],
  };
  const r = validateWorkflow(doc);
  assert.equal(r.ok, false);
  assert.ok(codes(r.errors).includes("WF_CYCLE"));
});

test("depends_on cycle is an error", () => {
  const doc = {
    schema_version: 2,
    id: "dep-loop",
    stages: [
      { id: "a", agent: "x/y", depends_on: ["b"] },
      { id: "b", agent: "x/y", depends_on: ["a"] },
    ],
  };
  const r = validateWorkflow(doc);
  assert.ok(codes(r.errors).includes("WF_CYCLE"));
});

test("duplicate stage id is an error", () => {
  const doc = {
    schema_version: 2,
    id: "dup",
    stages: [
      { id: "a", agent: "x/y" },
      { id: "a", agent: "x/z" },
    ],
  };
  const r = validateWorkflow(doc);
  assert.ok(codes(r.errors).includes("WF_STAGE_ID_DUP"));
});

test("unresolved handoff_to is an error", () => {
  const doc = {
    schema_version: 2,
    id: "h",
    stages: [{ id: "a", agent: "x/y", handoff_to: "ghost" }],
  };
  const r = validateWorkflow(doc);
  assert.ok(codes(r.errors).includes("WF_HANDOFF_UNRESOLVED"));
});

test("agent existence checked against knownAgents", () => {
  const doc = {
    schema_version: 2,
    id: "a",
    stages: [{ id: "s", agent: "product/ghost", handoff_to: null }],
  };
  const r = validateWorkflow(doc, { knownAgents: new Set(["product/pmf-planner"]) });
  assert.ok(codes(r.errors).includes("WF_AGENT_UNRESOLVED"));
});

test("vague exit_criteria warns; measurable passes", () => {
  const doc = {
    schema_version: 2,
    id: "ec",
    stages: [
      {
        id: "s",
        agent: "x/y",
        handoff_to: null,
        exit_criteria: ["score >= 60", "all evidence is actual demand"],
      },
    ],
  };
  const r = validateWorkflow(doc);
  const vague = r.warnings.filter((w) => w.code === "WF_EXIT_CRITERIA_NOT_MEASURABLE");
  assert.equal(vague.length, 1);
  assert.match(vague[0].message, /actual demand/);
});

test("missing id and empty stages are errors", () => {
  assert.ok(codes(validateWorkflow({ stages: [] }).errors).includes("WF_NO_STAGES"));
  assert.ok(codes(validateWorkflow({ id: "x", stages: [] }).errors).includes("WF_NO_STAGES"));
  assert.ok(codes(validateWorkflow({ stages: [{ id: "a", agent: "x/y" }] }).errors).includes("WF_ID_MISSING"));
});

test("non-object input is rejected", () => {
  assert.equal(validateWorkflow(null).ok, false);
  assert.ok(codes(validateWorkflow("nope").errors).includes("WF_NOT_AN_OBJECT"));
});

test("mode:agentic without guardrails warns; with guardrails passes", () => {
  const bad = validateWorkflow({
    schema_version: 2,
    id: "m",
    stages: [{ id: "s", agent: "x/y", handoff_to: null, mode: "agentic" }],
  });
  assert.ok(codes(bad.warnings).includes("WF_AGENTIC_NO_GUARDRAILS"));

  const good = validateWorkflow({
    schema_version: 2,
    id: "m",
    stages: [{ id: "s", agent: "x/y", handoff_to: null, mode: "agentic", guardrails: { max_iterations: 8 } }],
  });
  assert.ok(!codes(good.warnings).includes("WF_AGENTIC_NO_GUARDRAILS"));
});

test("unknown mode warns; fixed mode is fine", () => {
  assert.ok(codes(validateWorkflow({ id: "m", stages: [{ id: "s", agent: "x/y", mode: "weird" }] }).warnings).includes("WF_MODE_UNKNOWN"));
  assert.ok(!codes(validateWorkflow({ id: "m", stages: [{ id: "s", agent: "x/y", mode: "fixed" }] }).warnings).includes("WF_AGENTIC_NO_GUARDRAILS"));
});
