import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { agentReloadCommand } from "../src/cli/agent.js";
import { installRoutes, getCurrentRoutes } from "../src/bot/agent-router.js";

/**
 * v0.6 §10.5 — manual mode requires a working `solosquad agent reload`
 * subcommand. These tests cover (a) basic rebuild + reporting and (b)
 * org-scoped rebuild path.
 *
 * We isolate via process.chdir() to a tmp workspace so getAgentsDir() picks
 * up `.solosquad/agents/`.
 */

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-agent-reload-"));
  fs.mkdirSync(path.join(ws, ".solosquad", "agents"), { recursive: true });
  // workspace.yaml present so findWorkspaceRoot picks this dir.
  fs.writeFileSync(
    path.join(ws, ".solosquad", "workspace.yaml"),
    "version: 0.6.0\ndisplay_name: T\ncreated_at: 2026-05-14\n",
    "utf-8",
  );
  return ws;
}

function writeSkill(
  root: string,
  team: string,
  name: string,
  frontmatter: string,
): void {
  const dir = path.join(root, team, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\n# ${name}\n`,
    "utf-8",
  );
}

test("agent reload — rebuilds workspace router and reports counts", async () => {
  const ws = makeWorkspace();
  writeSkill(
    path.join(ws, ".solosquad", "agents"),
    "strategy",
    "pmf-planner",
    `name: "pmf-planner"
description: "PMF Planner"
team: "strategy"
triggers:
  slash: ["/pmf"]
  keyword: ["pmf"]
  explicit: true`,
  );

  const prevCwd = process.cwd();
  process.chdir(ws);
  try {
    // Clear previous router state so the count we get is from this fixture.
    installRoutes({ slash: {}, keyword: {}, freq: [], explicit: {} });
    const result = await agentReloadCommand({});
    assert.ok(result.triggerCount >= 3, `expected ≥3 triggers, got ${result.triggerCount}`);
    assert.ok(result.slashCount >= 1);
    assert.ok(result.keywordCount >= 1);
    assert.ok(result.explicitCount >= 1);
    // The router-level state must now reflect the rebuild.
    const idx = getCurrentRoutes();
    assert.ok(idx && idx.slash["/pmf"], "router-level state not updated");
  } finally {
    process.chdir(prevCwd);
  }
});

test("agent reload --org rebuilds with org-local .agents/ tier on top", async () => {
  const ws = makeWorkspace();
  // workspace-tier SKILL
  writeSkill(
    path.join(ws, ".solosquad", "agents"),
    "strategy",
    "base",
    `name: "base"
description: "base"
team: "strategy"
triggers:
  explicit: true
  keyword: ["base"]`,
  );

  // Org-tier with .org.yaml so the tier is real.
  const orgDir = path.join(ws, "acme");
  fs.mkdirSync(orgDir, { recursive: true });
  fs.writeFileSync(
    path.join(orgDir, ".org.yaml"),
    "name: Acme\nslug: acme\nprovider: local\ncreated_at: 2026-05-14\n",
    "utf-8",
  );
  writeSkill(
    path.join(orgDir, ".agents"),
    "growth",
    "marketer",
    `name: "marketer"
description: "Org-scoped marketer"
team: "growth"
triggers:
  explicit: true
  slash: ["/mark"]`,
  );

  const prevCwd = process.cwd();
  process.chdir(ws);
  try {
    installRoutes({ slash: {}, keyword: {}, freq: [], explicit: {} });
    const result = await agentReloadCommand({ org: "acme", workspace: ws });
    // Both workspace AND org tier should be in the index.
    assert.ok(result.slashCount >= 1, "expected org slash trigger");
    assert.ok(result.keywordCount >= 1, "expected workspace keyword");
    const idx = getCurrentRoutes();
    assert.ok(idx && idx.slash["/mark"], "org agent /mark missing");
    assert.ok(idx && idx.keyword["base"], "workspace agent keyword missing");
  } finally {
    process.chdir(prevCwd);
  }
});
