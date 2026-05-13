import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseGoal,
  parseGoalFile,
  GoalParseError,
  GOAL_SCHEMA_VERSION,
} from "../src/engine/goal-parser.js";

function validBody(overrides: Partial<{ goal_id: string; title: string; pipelineLine: string }> = {}): string {
  const goal_id = overrides.goal_id ?? "landing-cvr-optim";
  const title = overrides.title ?? "Lift landing CVR to 10%+";
  const pipelineLine = overrides.pipelineLine ?? "1. experience/desk-researcher: collect 5 competitor heroes";
  return `---
schema_version: 1
goal_id: "${goal_id}"
org: "acme"
target_repo: null
cycle_unit: pipeline_pass
---

# Goal: ${title}

Acceptance: 7-day rolling CVR ≥ 0.10. Stop after 8h or 20 cycles.

## Metrics
metrics:
  - name: "cvr_7day"
    formula: "conversions / visitors over rolling 7 days"
    source: "data/analytics-snapshot.tsv"
    threshold: 0.1
    direction: maximize

## Pipeline
${pipelineLine}
2. growth/content-writer: 3 hero copy variants

## Budget
time:
  hours: 8
cost:
  per_cycle_usd: 0.50
  total_usd: 5.00

## Termination
- All metrics reach threshold 3 consecutive cycles
- Time budget exhausted
`;
}

test("parseGoal accepts a minimal valid goal.md", () => {
  const spec = parseGoal(validBody(), "/tmp/goal.md");
  assert.equal(spec.schema_version, GOAL_SCHEMA_VERSION);
  assert.equal(spec.goal_id, "landing-cvr-optim");
  assert.equal(spec.org, "acme");
  assert.equal(spec.target_repo, null);
  assert.equal(spec.cycle_unit, "pipeline_pass");
  assert.equal(spec.title, "Lift landing CVR to 10%+");
  assert.match(spec.preamble, /Acceptance:/);

  assert.equal(spec.metrics.length, 1);
  assert.equal(spec.metrics[0].name, "cvr_7day");
  assert.equal(spec.metrics[0].threshold, 0.1);
  assert.equal(spec.metrics[0].direction, "maximize");

  assert.equal(spec.pipeline.length, 2);
  assert.equal(spec.pipeline[0].agent, "experience/desk-researcher");

  assert.equal(spec.time_budget.hours, 8);
  assert.equal(spec.cost_budget.total_usd, 5);
  assert.equal(spec.termination_conditions.length, 2);
  assert.equal(spec.signal_trigger.auto, "false");
  assert.equal(spec.modifiable_paths_override, undefined);
});

test("parseGoal rejects missing frontmatter", () => {
  assert.throws(
    () => parseGoal("# Goal: no frontmatter", "/tmp/x.md"),
    GoalParseError
  );
});

test("parseGoal rejects non-kebab goal_id", () => {
  const body = validBody({ goal_id: "Bad_Id" });
  assert.throws(() => parseGoal(body, "/tmp/x.md"), /kebab-case/);
});

test("parseGoal rejects non-team/agent pipeline ref", () => {
  const body = validBody({ pipelineLine: "1. just-an-agent: foo" });
  assert.throws(() => parseGoal(body, "/tmp/x.md"), /team\/agent/);
});

test("parseGoal rejects missing Metrics section", () => {
  const body = validBody().replace(/## Metrics[\s\S]*?(?=\n## Pipeline)/, "");
  assert.throws(() => parseGoal(body, "/tmp/x.md"), /missing required `## Metrics`/);
});

test("parseGoal rejects Budget without hours or cycles", () => {
  const body = validBody().replace(
    /## Budget\n[\s\S]*?(?=\n## Termination)/,
    "## Budget\ntime: {}\ncost:\n  per_cycle_usd: 0.5\n  total_usd: 5\n"
  );
  assert.throws(() => parseGoal(body, "/tmp/x.md"), /hours.*cycles/);
});

test("parseGoal rejects future schema_version", () => {
  const body = validBody().replace("schema_version: 1", "schema_version: 99");
  assert.throws(() => parseGoal(body, "/tmp/x.md"), /newer than supported/);
});

test("parseGoal parses Signal Trigger section when present", () => {
  const body = validBody() +
    "\n## Signal Trigger\nauto: prompt\nmatch_keywords:\n  - 'cvr drop'\n  - 'conversion'\n";
  const spec = parseGoal(body, "/tmp/x.md");
  assert.equal(spec.signal_trigger.auto, "prompt");
  assert.deepEqual(spec.signal_trigger.match_keywords, ["cvr drop", "conversion"]);
});

test("parseGoal parses Modifiable Paths Override when present", () => {
  const body = validBody() +
    "\n## Modifiable Paths Override\n- <org>/workflows/wf-cvr-cycle-*/\n";
  const spec = parseGoal(body, "/tmp/x.md");
  assert.deepEqual(spec.modifiable_paths_override, ["<org>/workflows/wf-cvr-cycle-*/"]);
});

test("parseGoalFile reads and parses an on-disk goal.md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-goalparser-"));
  const p = path.join(dir, "goal.md");
  fs.writeFileSync(p, validBody(), "utf-8");
  const spec = parseGoalFile(p);
  assert.equal(spec.source_path, p);
  assert.equal(spec.goal_id, "landing-cvr-optim");
});
