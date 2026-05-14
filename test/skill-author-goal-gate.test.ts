import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyDraft, type AuthorDraft } from "../src/bot/skill-author.js";
import { installRoutes } from "../src/bot/agent-router.js";
import { parseGoalFile } from "../src/engine/goal-parser.js";

/**
 * v0.5 §3 — when an author-loop draft is `loop_mode.kind: spec-gate`, the
 * apply step also emits `<org>/goals/<goal-id>/goal.md` from the
 * `assets/templates/goal-from-skill.md` template. The emitted goal.md must
 * parse cleanly via `src/engine/goal-parser.ts` so that a subsequent
 * `solosquad goal run` can execute it.
 */

function makeWorkspace(): { workspace: string; orgSlug: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-goal-gate-"));
  const orgSlug = "demo-org";
  fs.mkdirSync(path.join(workspace, orgSlug), { recursive: true });
  return { workspace, orgSlug };
}

function specGateDraft(orgSlug: string): AuthorDraft {
  return {
    skill_draft_id: "draft-spec-gate-1",
    user_id: "alice",
    org_slug: orgSlug,
    intent: "Monitor competitor releases weekly and report deltas",
    team: "strategy",
    slug: "competitor-monitor",
    display_name: "competitor-monitor",
    description: "Weekly competitor monitor with spec-gate stop rule",
    triggers_keyword: ["competitor monitor"],
    inputs: { required: ["competitor_list"], optional: [] },
    outputs: ["report.md"],
    body_md: "# competitor-monitor\n\n> Weekly competitor monitor\n",
    spec_gate: {
      spec_path: "spec/competitor.md",
      stop_when: "all competitor entries reviewed and report shipped",
    },
    state: "AWAIT_CONFIRM",
    history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function isolateRouter(): void {
  installRoutes({ slash: {}, keyword: {}, freq: [], explicit: {} });
}

test("applyDraft emits goal.md when draft has spec_gate (placed under <org>/goals/<goal-id>/)", () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const draft = specGateDraft(orgSlug);

  const result = applyDraft({ workspace, orgSlug, draft });

  assert.ok(result.goal_path, "goal_path should be returned");
  assert.ok(fs.existsSync(result.goal_path!), "goal.md should exist on disk");

  const expectedDir = path.join(
    workspace,
    orgSlug,
    "goals",
    draft.slug,
  );
  assert.equal(path.dirname(result.goal_path!), expectedDir);
});

test("emitted goal.md parses via the v0.4 goal-parser", () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const draft = specGateDraft(orgSlug);

  const result = applyDraft({ workspace, orgSlug, draft });
  assert.ok(result.goal_path);

  const spec = parseGoalFile(result.goal_path!);
  assert.equal(spec.goal_id, draft.slug);
  assert.equal(spec.org, orgSlug);
  assert.equal(spec.target_repo, null);
  assert.equal(spec.cycle_unit, "pipeline_pass");
  assert.match(spec.title, /competitor-monitor/);

  // Metrics — spec-gate template seeds a single `spec_gate_pass` metric.
  assert.equal(spec.metrics.length, 1);
  assert.equal(spec.metrics[0].name, "spec_gate_pass");
  assert.equal(spec.metrics[0].direction, "maximize");
  assert.equal(spec.metrics[0].threshold, 1.0);
  assert.equal(spec.metrics[0].source, draft.spec_gate!.spec_path);

  // Pipeline — single step referencing the new SKILL by team/slug.
  assert.equal(spec.pipeline.length, 1);
  assert.equal(spec.pipeline[0].agent, `${draft.team}/${draft.slug}`);
  assert.match(spec.pipeline[0].task, /Monitor competitor/);

  // Termination — must include the stop_when line.
  const joinedTermination = spec.termination_conditions.join(" | ");
  assert.match(joinedTermination, /all competitor entries reviewed/);

  // Budget — defaults from template.
  assert.equal(spec.time_budget.hours, 8);
  assert.equal(spec.cost_budget.per_cycle_usd, 0.5);
  assert.equal(spec.cost_budget.total_usd, 5.0);
});

test("applyDraft does NOT emit goal.md for non-spec-gate drafts", () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const draft = specGateDraft(orgSlug);
  delete (draft as { spec_gate?: unknown }).spec_gate;

  const result = applyDraft({ workspace, orgSlug, draft });
  assert.equal(result.goal_path, undefined);

  const expectedGoalsDir = path.join(workspace, orgSlug, "goals", draft.slug);
  assert.equal(
    fs.existsSync(expectedGoalsDir),
    false,
    "goals/<id>/ should not be created when spec_gate is absent",
  );
});

test("explicit draft.goal_md overrides the template (caller-supplied content wins)", () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const draft = specGateDraft(orgSlug);
  const customGoal = [
    "---",
    "schema_version: 1",
    'goal_id: "custom-goal"',
    `org: "${orgSlug}"`,
    "target_repo: null",
    "cycle_unit: pipeline_pass",
    "---",
    "",
    "# Goal: custom-goal",
    "",
    "Custom preamble.",
    "",
    "## Metrics",
    "",
    "metrics:",
    '  - name: "custom_metric"',
    '    formula: "0 if missing else 1"',
    '    source: "spec/custom.md"',
    "    threshold: 1.0",
    "    direction: maximize",
    "",
    "## Pipeline",
    "",
    "1. strategy/competitor-monitor: run it",
    "",
    "## Budget",
    "",
    "time:",
    "  hours: 4",
    "cost:",
    "  per_cycle_usd: 0.25",
    "  total_usd: 2.00",
    "",
    "## Termination",
    "",
    "- custom condition reached",
    "",
  ].join("\n");
  draft.goal_md = customGoal;

  const result = applyDraft({ workspace, orgSlug, draft });
  assert.ok(result.goal_path);
  const onDisk = fs.readFileSync(result.goal_path!, "utf-8");
  assert.equal(onDisk, customGoal, "caller-provided goal_md should be written verbatim");

  // And it still parses.
  const spec = parseGoalFile(result.goal_path!);
  assert.equal(spec.goal_id, "custom-goal");
  assert.equal(spec.metrics[0].name, "custom_metric");
});

test("SKILL.md emitted alongside goal.md still carries loop_mode.kind: spec-gate", () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const draft = specGateDraft(orgSlug);

  const result = applyDraft({ workspace, orgSlug, draft });
  const skill = result.spec;
  assert.equal(skill.loop_mode?.kind, "spec-gate");
  assert.equal(skill.loop_mode?.spec_path, "spec/competitor.md");
  assert.equal(skill.stateful, false);
});
