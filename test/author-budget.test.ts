import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  recordAuthorCost,
  checkBudget,
  readAuthorCosts,
  authorCostsPath,
} from "../src/bot/author-budget.js";

/**
 * v0.5 §5.6 — author budget envelope.
 *
 * checkBudget reads `<org>/memory/author-costs.jsonl`, applies UTC-day +
 * rolling-7-day windows, and refuses (or warns) per `on_cap_action`.
 */

function makeWorkspace(): { workspace: string; orgSlug: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-budget-"));
  const orgSlug = "demo-org";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });
  return { workspace, orgSlug };
}

// Helpers to fabricate cost rows with arbitrary timestamps. We bypass
// recordAuthorCost() (which forces `new Date()`) to test windowing.
function writeRow(
  workspace: string,
  orgSlug: string,
  ts: Date,
  usd: number,
): void {
  const file = authorCostsPath(workspace, orgSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    ts: ts.toISOString(),
    skill_draft_id: "draft-test",
    step: "draft",
    usd,
    model: "sonnet-4-6",
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
}

test("recordAuthorCost appends a single JSONL row", () => {
  const { workspace, orgSlug } = makeWorkspace();
  recordAuthorCost({
    workspace,
    orgSlug,
    skillDraftId: "draft-abc",
    step: "clarify",
    usd: 0.12,
    model: "haiku-4-5",
  });
  const rows = readAuthorCosts(workspace, orgSlug);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].skill_draft_id, "draft-abc");
  assert.equal(rows[0].step, "clarify");
  assert.equal(rows[0].usd, 0.12);
  assert.equal(rows[0].model, "haiku-4-5");
  // ISO 8601
  assert.match(rows[0].ts, /^\d{4}-\d{2}-\d{2}T/);
});

test("checkBudget returns fresh budget when JSONL is missing (no crash)", () => {
  const { workspace, orgSlug } = makeWorkspace();
  const result = checkBudget({
    workspace,
    orgSlug,
    dailyUsd: 10,
    weeklyUsd: 50,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceeded, false);
  assert.equal(result.remaining.today, 10);
  assert.equal(result.remaining.week, 50);
});

test("daily cap reached → refused under pause action", () => {
  const { workspace, orgSlug } = makeWorkspace();
  // Two rows today summing to $10.
  const now = new Date();
  writeRow(workspace, orgSlug, now, 6);
  writeRow(workspace, orgSlug, now, 4);
  const result = checkBudget({
    workspace,
    orgSlug,
    dailyUsd: 10,
    onCapAction: "pause",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.exceeded, true);
  assert.match(result.reason ?? "", /daily/i);
});

test("daily cap reached → allowed under warn action (flagged exceeded)", () => {
  const { workspace, orgSlug } = makeWorkspace();
  const now = new Date();
  writeRow(workspace, orgSlug, now, 15);
  const result = checkBudget({
    workspace,
    orgSlug,
    dailyUsd: 10,
    onCapAction: "warn",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceeded, true);
});

test("daily cap resets at UTC midnight (yesterday's spend doesn't count)", () => {
  const { workspace, orgSlug } = makeWorkspace();
  // Write a row 36h in the past — clearly outside today (UTC).
  const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
  writeRow(workspace, orgSlug, yesterday, 25);
  const result = checkBudget({
    workspace,
    orgSlug,
    dailyUsd: 10,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceeded, false);
  assert.equal(result.remaining.today, 10);
});

test("weekly cap counts spend across rolling 7d UTC", () => {
  const { workspace, orgSlug } = makeWorkspace();
  const now = new Date();
  // Spread spend across 5 days, $12 each = $60 total
  for (let i = 0; i < 5; i++) {
    const t = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    writeRow(workspace, orgSlug, t, 12);
  }
  // One row 9 days ago — outside the rolling window.
  writeRow(workspace, orgSlug, new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000), 999);

  const result = checkBudget({
    workspace,
    orgSlug,
    weeklyUsd: 50,
  });
  assert.equal(result.exceeded, true);
  assert.match(result.reason ?? "", /weekly/i);
});

test("partial spend with cap intact → allowed and remaining computed", () => {
  const { workspace, orgSlug } = makeWorkspace();
  const now = new Date();
  writeRow(workspace, orgSlug, now, 3);
  const result = checkBudget({
    workspace,
    orgSlug,
    dailyUsd: 10,
    weeklyUsd: 50,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceeded, false);
  assert.equal(result.remaining.today, 7);
  assert.equal(result.remaining.week, 47);
});
