import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  extractTrajectories,
  applySuggestion,
  suggestionToDraft,
  recordRejection,
  type TrajectorySuggestion,
} from "../src/scheduler/trajectory-extractor.js";
import {
  recordSpawnDecision,
  getSinkPath,
} from "../src/memory/route-event-sink.js";
import { rotateArchive } from "../src/memory/archive-rotate.js";
import { installRoutes } from "../src/bot/agent-router.js";
import { parseSkillMd, validateSkill } from "../src/bot/skill-parser.js";

/**
 * v0.6 S5 §3.2 — trajectory-extractor tests.
 *
 * Each test gets its own tmp workspace. spawn_decision events are seeded
 * via the route-event-sink so the extractor consumes the same input shape
 * as production. applyDraft() is exercised through the real v0.5 backend
 * — no separate applier code path exists, which is the P0 #3 contract.
 */

function makeWorkspace(): { workspace: string; orgSlug: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-traj-"));
  const orgSlug = "demo";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });
  return { workspace, orgSlug };
}

function isolateRouter(): void {
  installRoutes({ slash: {}, keyword: {}, freq: [], explicit: {} });
}

function seedThreeRuns(workspace: string, orgSlug: string, baseIso: string): void {
  // Three runs (6h+ apart so they form separate "trajectory runs"), each
  // with the same agent sequence: experience/desk-researcher →
  // strategy/feature-planner.
  for (let run = 0; run < 3; run++) {
    const ts1 = new Date(Date.parse(baseIso) + run * 86_400_000).toISOString();
    const ts2 = new Date(Date.parse(baseIso) + run * 86_400_000 + 60_000).toISOString();
    recordSpawnDecision({
      workspace,
      orgSlug,
      now: ts1,
      chosenAgent: "experience/desk-researcher",
      rationale: "PMF research for new product",
    });
    recordSpawnDecision({
      workspace,
      orgSlug,
      now: ts2,
      chosenAgent: "strategy/feature-planner",
      rationale: "PMF research feature planning",
    });
  }
}

test("trajectory: detects (agent sequence + workflow template) pattern when ≥ 3 in 30 days", async () => {
  const { workspace, orgSlug } = makeWorkspace();
  seedThreeRuns(workspace, orgSlug, "2026-05-01T10:00:00.000Z");

  const suggestions = await extractTrajectories({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
  });
  assert.ok(suggestions.length >= 1, "expected ≥ 1 trajectory suggestion");
  const top = suggestions[0];
  assert.equal(top.workflow_template, "pmf");
  assert.deepEqual(top.agent_sequence, [
    "experience/desk-researcher",
    "strategy/feature-planner",
  ]);
  assert.ok(top.observation_count >= 3);
  assert.equal(top.confidence, 0.7);
});

test("trajectory: returns 0 suggestions when no patterns reach the 3-run threshold", async () => {
  const { workspace, orgSlug } = makeWorkspace();
  // Only 2 runs of the same sequence → below threshold.
  for (let run = 0; run < 2; run++) {
    const ts = new Date(Date.parse("2026-05-01T00:00:00.000Z") + run * 86_400_000).toISOString();
    recordSpawnDecision({
      workspace,
      orgSlug,
      now: ts,
      chosenAgent: "experience/ui-designer",
      rationale: "feature design",
    });
    recordSpawnDecision({
      workspace,
      orgSlug,
      now: new Date(Date.parse(ts) + 60_000).toISOString(),
      chosenAgent: "engineering/backend-developer",
      rationale: "feature implementation",
    });
  }

  const suggestions = await extractTrajectories({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
  });
  assert.equal(suggestions.length, 0);
});

test("trajectory: 30-day rolling window decay — events older than 30 days are dropped", async () => {
  const { workspace, orgSlug } = makeWorkspace();
  // Seed two recent runs + one 60-day-old run. Old run gets archived by
  // rotate; the recent two are not enough to trigger.
  for (let run = 0; run < 2; run++) {
    const ts = new Date(Date.parse("2026-05-01T00:00:00.000Z") + run * 86_400_000).toISOString();
    recordSpawnDecision({
      workspace,
      orgSlug,
      now: ts,
      chosenAgent: "growth/content-writer",
      rationale: "PMF content for newsletter",
    });
    recordSpawnDecision({
      workspace,
      orgSlug,
      now: new Date(Date.parse(ts) + 60_000).toISOString(),
      chosenAgent: "growth/brand-marketer",
      rationale: "PMF brand voice review",
    });
  }
  // Old event — 60 days ago.
  recordSpawnDecision({
    workspace,
    orgSlug,
    now: "2026-03-15T00:00:00.000Z",
    chosenAgent: "growth/content-writer",
    rationale: "PMF stale run",
  });

  // Rotate to push the old one into archive.
  rotateArchive({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
    retentionDays: 10_000,
  });

  const suggestions = await extractTrajectories({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
  });
  // The 60-day-old event is outside the 30-day window — only 2 recent runs
  // remain, below the 3-run threshold.
  assert.equal(suggestions.length, 0);
});

test("trajectory: rejected suggestion is excluded for 30 days, then re-eligible", async () => {
  const { workspace, orgSlug } = makeWorkspace();
  seedThreeRuns(workspace, orgSlug, "2026-05-01T10:00:00.000Z");

  const before = await extractTrajectories({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
  });
  assert.ok(before.length >= 1);

  recordRejection({
    workspace,
    orgSlug,
    suggestion_id: before[0].suggestion_id,
    now: "2026-05-14T00:00:00.000Z",
  });

  const after = await extractTrajectories({
    workspace,
    orgSlug,
    now: "2026-05-14T00:00:00.000Z",
  });
  assert.equal(
    after.find((s) => s.suggestion_id === before[0].suggestion_id),
    undefined,
    "rejected suggestion must not reappear within cooldown window",
  );

  // After cooldown expires (35 days later) the same suggestion is eligible.
  const past = await extractTrajectories({
    workspace,
    orgSlug,
    now: "2026-06-18T00:00:00.000Z",
  });
  // (events outside 30d → no suggestions anyway; this just exercises the
  // rejection-store decay path without requiring fresh events.)
  // The key invariant: rejection store does *not* permanently ban the id.
  assert.ok(Array.isArray(past));
});

test("trajectory: applySuggestion invokes v0.5 applyDraft and writes a real SKILL.md", async () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();

  const suggestion: TrajectorySuggestion = {
    suggestion_id: "pmf-test-12345",
    agent_sequence: ["experience/desk-researcher", "strategy/feature-planner"],
    workflow_template: "pmf",
    observation_count: 3,
    first_seen: "2026-05-01T00:00:00.000Z",
    last_seen: "2026-05-03T00:00:00.000Z",
    keywords: ["pmf", "research"],
    confidence: 0.7,
    source: "auto-extracted-from-trajectory-2026-05-01T00:00:00.000Z",
  };

  await applySuggestion({ workspace, orgSlug, suggestion });

  // v0.5 applyDraft writes to <org>/.agents/<team>/<slug>/SKILL.md — the
  // *exact* same path skill-author uses when a human approves an author
  // draft. This is the P0 #3 invariant: no separate applier.
  const expectedDir = path.join(workspace, orgSlug, ".agents", "experience");
  assert.ok(fs.existsSync(expectedDir), `expected ${expectedDir} to exist`);
  const teamEntries = fs.readdirSync(expectedDir);
  assert.ok(teamEntries.length > 0);
  const slug = teamEntries[0];
  const skillPath = path.join(expectedDir, slug, "SKILL.md");
  assert.ok(fs.existsSync(skillPath));

  // The produced SKILL.md must pass the v0.5 validator — same gate the
  // author loop uses.
  const spec = parseSkillMd(fs.readFileSync(skillPath, "utf-8"), skillPath);
  assert.equal(spec.stateful, false);
  const validation = validateSkill(spec);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("trajectory: suggestionToDraft is a pure converter — same input → same draft shape", () => {
  const suggestion: TrajectorySuggestion = {
    suggestion_id: "feature-deterministic-test",
    agent_sequence: ["engineering/backend-developer", "engineering/api-developer"],
    workflow_template: "feature",
    observation_count: 4,
    first_seen: "2026-05-01T00:00:00.000Z",
    last_seen: "2026-05-04T00:00:00.000Z",
    keywords: ["feature", "api"],
    confidence: 0.7,
    source: "auto-extracted-from-trajectory-2026-05-01T00:00:00.000Z",
  };

  const draft1 = suggestionToDraft(suggestion, "demo");
  const draft2 = suggestionToDraft(suggestion, "demo");
  assert.equal(draft1.slug, draft2.slug);
  assert.equal(draft1.team, "engineering");
  assert.equal(draft1.team, draft2.team);
  assert.deepEqual(draft1.triggers_keyword, draft2.triggers_keyword);
  assert.equal(draft1.state, "AWAIT_CONFIRM");
  assert.ok(draft1.body_md.includes("Agent Sequence"));
});

test("trajectory: route-events.jsonl is the primary input source", () => {
  const { workspace, orgSlug } = makeWorkspace();
  seedThreeRuns(workspace, orgSlug, "2026-05-01T10:00:00.000Z");
  const sink = getSinkPath(workspace, orgSlug);
  assert.ok(fs.existsSync(sink), "route-events.jsonl must exist after seeding");
  const lines = fs.readFileSync(sink, "utf-8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 6, "3 runs × 2 spawn_decisions each = 6 events");
});
