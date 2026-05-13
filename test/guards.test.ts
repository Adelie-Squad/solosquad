import { test } from "node:test";
import assert from "node:assert/strict";

import {
  newCostTracker,
  recordCycleCost,
  resolvePaths,
  preflightInputGuard,
  runtimeGuard,
  outputGuard,
  isPathAllowed,
  pathMatches,
} from "../src/engine/guards.js";
import { DEFAULT_GUIDE, type PersistentGuide } from "../src/engine/agents-md-loader.js";
import type { GoalSpec } from "../src/engine/goal-parser.js";

function fakeGoal(overrides: Partial<GoalSpec> = {}): GoalSpec {
  return {
    schema_version: 1,
    goal_id: "g1",
    org: "acme",
    target_repo: null,
    cycle_unit: "pipeline_pass",
    title: "test goal",
    preamble: "",
    metrics: [],
    pipeline: [],
    time_budget: { hours: 8 },
    cost_budget: { per_cycle_usd: 0.5, total_usd: 5 },
    termination_conditions: [],
    signal_trigger: { auto: "false", match_keywords: [] },
    source_path: "/abs/<org>/<acme>/goals/g1/goal.md",
    ...overrides,
  };
}

function fakeGuide(overrides: Partial<PersistentGuide> = {}): PersistentGuide {
  return {
    exists: true,
    source_path: "/abs/AGENTS.md",
    raw_body: "",
    ...DEFAULT_GUIDE,
    ...overrides,
  };
}

test("pathMatches handles ** glob and direct prefix", () => {
  assert.equal(pathMatches("src/engine/foo.ts", "src/engine/**"), true);
  assert.equal(pathMatches("src/bot/index.ts", "src/engine/**"), false);
  assert.equal(pathMatches("src/engine", "src/engine/**"), true);
  assert.equal(pathMatches("AGENTS.md", "AGENTS.md"), true);
});

test("resolvePaths intersects override with guide modifiable", () => {
  const goal = fakeGoal({
    modifiable_paths_override: ["<org>/workflows/wf-x/", "<org>/memory/"],
  });
  const guide = fakeGuide();
  const { modifiable, immutable } = resolvePaths(goal, guide);
  assert.ok(modifiable.includes("<org>/workflows/wf-x/"));
  assert.ok(modifiable.includes("<org>/memory/"));
  // immutable always includes goal source_path + per-org results.tsv
  assert.ok(immutable.includes("/abs/<org>/<acme>/goals/g1/goal.md"));
  assert.ok(immutable.some((p) => p.includes("goals/g1/results.tsv")));
});

test("preflightInputGuard rejects override that conflicts with immutable", () => {
  const goal = fakeGoal({ modifiable_paths_override: ["src/engine/foo"] });
  const guide = fakeGuide();
  const resolved = resolvePaths(goal, guide);
  const r = preflightInputGuard(goal, guide, resolved);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /conflicts with AGENTS\.md immutable/);
});

test("preflightInputGuard rejects total_usd < per_cycle_usd", () => {
  const goal = fakeGoal({ cost_budget: { per_cycle_usd: 5, total_usd: 3 } });
  const guide = fakeGuide();
  const r = preflightInputGuard(goal, guide, resolvePaths(goal, guide));
  assert.equal(r.ok, false);
  assert.match(r.reason!, /cost_budget/);
});

test("isPathAllowed: immutable wins, modifiable allows", () => {
  const goal = fakeGoal();
  const guide = fakeGuide();
  const resolved = resolvePaths(goal, guide);
  assert.equal(isPathAllowed("src/engine/foo.ts", resolved), false);
  assert.equal(isPathAllowed("<org>/workflows/wf-x/note.md", resolved), true);
  assert.equal(isPathAllowed("random/elsewhere.md", resolved), false);
});

test("recordCycleCost accumulates total + per-cycle correctly", () => {
  const t = newCostTracker();
  recordCycleCost(t, 1, 0.12);
  recordCycleCost(t, 1, 0.08);
  recordCycleCost(t, 2, 0.20);
  assert.equal(t.total_usd, 0.4);
  assert.equal(t.per_cycle_usd[1], 0.2);
  assert.equal(t.per_cycle_usd[2], 0.2);
});

test("runtimeGuard signals stop on cost cap", () => {
  const goal = fakeGoal();
  const guide = fakeGuide();
  const t = newCostTracker();
  recordCycleCost(t, 1, 6); // exceeds 5 total
  const r = runtimeGuard(goal, guide, t, 1, 0, 0.1);
  assert.equal(r.shouldContinue, false);
  assert.match(r.reason!, /cost cap reached/);
});

test("runtimeGuard signals stop on consecutive discard limit", () => {
  const goal = fakeGoal();
  const guide = fakeGuide();
  const r = runtimeGuard(goal, guide, newCostTracker(), 1, 5, 0.1);
  assert.equal(r.shouldContinue, false);
  assert.match(r.reason!, /discard limit/);
});

test("runtimeGuard signals cost cap warning at >= 90%", () => {
  const goal = fakeGoal();
  const guide = fakeGuide();
  const t = newCostTracker();
  recordCycleCost(t, 1, 4.6); // 92% of $5
  const r = runtimeGuard(goal, guide, t, 1, 0, 0.1);
  assert.equal(r.shouldContinue, true);
  assert.equal(r.costCapWarning, true);
});

test("outputGuard detects forbidden side effects and blocks non-whitelisted HTTP", () => {
  const guide = fakeGuide({
    forbidden_side_effects: ["messenger direct send"],
    external_domain_whitelist: ["api.example.com"],
  });
  const r = outputGuard(guide, [
    "spawned bash that wrote to log",
    "messenger direct send via slack adapter",
    "GET https://evil.com/exfil",
    "GET https://api.example.com/track",
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 2);
  assert.ok(r.violations.some((v) => /messenger direct send/.test(v)));
  assert.ok(r.violations.some((v) => /evil.com/.test(v)));
});
