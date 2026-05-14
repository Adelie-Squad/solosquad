import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  recordAgentCost,
  readAgentCosts,
  checkAgentBudget,
  agentCostsPath,
} from "../src/bot/agent-budget.js";
import type { AgentProfileMerged } from "../src/util/agent-profile.js";
import { AGENT_PROFILE_SCHEMA_VERSION } from "../src/util/agent-profile.js";

/**
 * v0.6 §2.2 P0 #1 — agent spawn budget envelope.
 *
 * Generalization of v0.5 author-budget; namespace-separated JSONL
 * (`agent-costs.jsonl`) so an author-loop cap and a spawn cap can coexist
 * without one consuming the other.
 */

function mkWorkspace(): { workspace: string; orgSlug: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-agentbudget-"));
  const orgSlug = "demo-org";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });
  return { workspace, orgSlug };
}

function writeRow(
  workspace: string,
  orgSlug: string,
  agentName: string,
  ts: Date,
  usd: number,
): void {
  const file = agentCostsPath(workspace, orgSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    ts: ts.toISOString(),
    agent_name: agentName,
    step: "spawn",
    usd,
    model: "sonnet-4-6",
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
}

function profileWith(daily?: number, weekly?: number, action?: "pause" | "warn"): AgentProfileMerged {
  return {
    defaults: {
      budget: {
        daily_usd: daily,
        weekly_usd: weekly,
        on_cap_action: action,
      },
    },
    agents: {},
    warnings: [],
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
  };
}

test("recordAgentCost appends one JSONL row", () => {
  const { workspace, orgSlug } = mkWorkspace();
  recordAgentCost({
    workspace,
    orgSlug,
    agentName: "business-strategist",
    step: "spawn",
    usd: 0.42,
    model: "sonnet-4-6",
  });
  const rows = readAgentCosts(workspace, orgSlug);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent_name, "business-strategist");
  assert.equal(rows[0].usd, 0.42);
});

test("checkAgentBudget returns fresh budget when JSONL is missing", () => {
  const { workspace, orgSlug } = mkWorkspace();
  const result = checkAgentBudget({
    workspace,
    orgSlug,
    agentName: "business-strategist",
    agentProfile: profileWith(5, 25),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceeded, false);
  assert.equal(result.remaining.today, 5);
  assert.equal(result.remaining.week, 25);
});

test("daily cap reached → refused under pause action", () => {
  const { workspace, orgSlug } = mkWorkspace();
  const now = new Date();
  writeRow(workspace, orgSlug, "business-strategist", now, 3);
  writeRow(workspace, orgSlug, "business-strategist", now, 2.5);

  const result = checkAgentBudget({
    workspace,
    orgSlug,
    agentName: "business-strategist",
    agentProfile: profileWith(5, 25, "pause"),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.exceeded, true);
  assert.match(result.reason ?? "", /daily/i);
});

test("on_cap_action=warn allows the spawn even when exceeded", () => {
  const { workspace, orgSlug } = mkWorkspace();
  writeRow(workspace, orgSlug, "business-strategist", new Date(), 10);
  const result = checkAgentBudget({
    workspace,
    orgSlug,
    agentName: "business-strategist",
    agentProfile: profileWith(5, 25, "warn"),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceeded, true);
  assert.equal(result.action, "warn");
});

test("agent cost is scoped per agent_name (other agents do not consume budget)", () => {
  const { workspace, orgSlug } = mkWorkspace();
  // Two rows from a different agent.
  writeRow(workspace, orgSlug, "content-writer", new Date(), 99);

  const result = checkAgentBudget({
    workspace,
    orgSlug,
    agentName: "business-strategist",
    agentProfile: profileWith(5, 25),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceeded, false);
  assert.equal(result.remaining.today, 5);
});

test("weekly cap counts spend across rolling 7d UTC", () => {
  const { workspace, orgSlug } = mkWorkspace();
  const now = new Date();
  for (let i = 0; i < 5; i++) {
    writeRow(
      workspace,
      orgSlug,
      "business-strategist",
      new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      5,
    );
  }
  // 9-day-old row should not count.
  writeRow(
    workspace,
    orgSlug,
    "business-strategist",
    new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000),
    999,
  );

  const result = checkAgentBudget({
    workspace,
    orgSlug,
    agentName: "business-strategist",
    agentProfile: profileWith(undefined, 20),
  });
  assert.equal(result.exceeded, true);
  assert.match(result.reason ?? "", /weekly/i);
});

test("no cap defined → always allowed (Infinity remaining)", () => {
  const { workspace, orgSlug } = mkWorkspace();
  writeRow(workspace, orgSlug, "business-strategist", new Date(), 100);
  const result = checkAgentBudget({
    workspace,
    orgSlug,
    agentName: "business-strategist",
    agentProfile: profileWith(undefined, undefined),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.exceeded, false);
  assert.equal(result.remaining.today, Number.POSITIVE_INFINITY);
});
