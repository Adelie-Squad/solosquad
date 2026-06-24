import test from "node:test";
import assert from "node:assert/strict";
import { validateGoalSpec } from "../src/bot/goal-validate.js";
import type { GoalSpec } from "../src/engine/goal-parser.js";

function baseSpec(over: Partial<GoalSpec> = {}): GoalSpec {
  return {
    schema_version: 1,
    goal_id: "lift-activation",
    org: "acme",
    target_repo: null,
    cycle_unit: "pipeline_pass",
    title: "Lift activation",
    preamble: "",
    metrics: [
      { name: "activation", formula: "a/b", source: "metrics/activation.tsv", threshold: 0.4, direction: "maximize" },
      { name: "retention", formula: "r", source: "metrics/retention.tsv", threshold: 0.3, direction: "maximize" },
    ],
    pipeline: [{ agent: "product/data-analyst", task: "measure" }],
    time_budget: { hours: 8 },
    cost_budget: { per_cycle_usd: 1, total_usd: 10 },
    termination_conditions: ["3 consecutive keeps"],
    signal_trigger: { auto: "false", match_keywords: [] },
    modifiable_paths_override: undefined,
    source_path: "/tmp/goal.md",
    ...over,
  } as GoalSpec;
}

test("validateGoalSpec — well-formed goal passes", () => {
  const r = validateGoalSpec(baseSpec(), { agentExists: () => true });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test("validateGoalSpec — empty metric source is an error", () => {
  const r = validateGoalSpec(
    baseSpec({ metrics: [{ name: "x", formula: "f", source: "  ", threshold: 1, direction: "maximize" }] }),
    { agentExists: () => true },
  );
  assert.ok(r.errors.some((e) => e.code === "GOAL_METRIC_SOURCE_EMPTY"));
});

test("validateGoalSpec — single metric warns (Goodhart guardrail)", () => {
  const r = validateGoalSpec(
    baseSpec({ metrics: [{ name: "x", formula: "f", source: "s.tsv", threshold: 1, direction: "maximize" }] }),
    { agentExists: () => true },
  );
  assert.ok(r.warnings.some((w) => w.code === "GOAL_SINGLE_METRIC"));
});

test("validateGoalSpec — malformed pipeline ref is an error", () => {
  const r = validateGoalSpec(baseSpec({ pipeline: [{ agent: "data-analyst", task: "x" }] }), { agentExists: () => true });
  assert.ok(r.errors.some((e) => e.code === "GOAL_PIPELINE_AGENT_FORMAT"));
});

test("validateGoalSpec — unknown pipeline agent is an error", () => {
  const r = validateGoalSpec(baseSpec(), { agentExists: () => false });
  assert.ok(r.errors.some((e) => e.code === "GOAL_PIPELINE_AGENT_MISSING"));
});

test("validateGoalSpec — missing termination is an error", () => {
  const r = validateGoalSpec(baseSpec({ termination_conditions: [] }), { agentExists: () => true });
  assert.ok(r.errors.some((e) => e.code === "GOAL_NO_TERMINATION"));
});
