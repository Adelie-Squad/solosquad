import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v125ToV130 } from "../src/migrations/scripts/0.3.0-to-0.4.0.js";
import { loadWorkspaceYaml } from "../src/util/config.js";

function temp125Workspace(orgs: string[] = ["acme"]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-mig130-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    [
      "version: 0.3.0",
      "display_name: test-workspace",
      "timezone: Asia/Seoul",
      "briefings:",
      "  morning: { time: \"08:00\", enabled: true }",
      "  evening: { time: \"18:00\", enabled: true }",
      "background_routines:",
      "  signal_scan: { time: \"12:00\", enabled: true }",
      "  experiment_check: { time: \"16:00\", enabled: true }",
      "  weekly_review: { day: sunday, time: \"20:00\", enabled: true }",
      "pm:",
      "  max_budget_usd: 5",
      "  invoke_timeout_seconds: 300",
      "  compaction_time: \"23:00\"",
      "created_at: 2026-05-12T00:00:00Z",
      "",
    ].join("\n"),
    "utf-8"
  );
  for (const o of orgs) {
    fs.mkdirSync(path.join(dir, o, "repositories"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, o, ".org.yaml"),
      `slug: ${o}\nname: ${o}\nprovider: github\nrepos: []\ncreated_at: 2026-05-12T00:00:00Z\n`,
      "utf-8"
    );
  }
  return dir;
}

test("v0.3.0 → v0.4.0: detect() returns true on a fresh 0.3.0 workspace", async () => {
  const ws = temp125Workspace();
  assert.equal(await v125ToV130.detect(ws), true);
});

test("v0.3.0 → v0.4.0: apply() creates goals/, AGENTS.md, adds goal section, bumps version", async () => {
  const ws = temp125Workspace(["acme"]);
  const plan = await v125ToV130.plan(ws);
  await v125ToV130.apply(ws, plan);

  // goals/ exists per org
  assert.ok(fs.existsSync(path.join(ws, "acme", "goals")));

  // AGENTS.md exists with v0.4 section
  const agentsMd = path.join(ws, "AGENTS.md");
  assert.ok(fs.existsSync(agentsMd));
  const body = fs.readFileSync(agentsMd, "utf-8");
  assert.match(body, /SoloSquad v0\.4 — Autonomous Goal Conventions/);

  // workspace.yaml
  const ywsAfter = loadWorkspaceYaml(ws)!;
  assert.equal(ywsAfter.version, "0.4.0");
  assert.ok(ywsAfter.goal);
  assert.equal(ywsAfter.goal!.default_hours, 8);
  assert.equal(ywsAfter.goal!.default_budget_usd, 5);
});

test("v0.3.0 → v0.4.0: existing CLAUDE.md content is migrated into AGENTS.md but original is untouched", async () => {
  const ws = temp125Workspace(["acme"]);
  fs.writeFileSync(
    path.join(ws, "CLAUDE.md"),
    "# Some Workspace\n\nProject narrative blah blah.\n",
    "utf-8"
  );
  const plan = await v125ToV130.plan(ws);
  await v125ToV130.apply(ws, plan);

  // CLAUDE.md is left in place (byte-identical)
  const claude = fs.readFileSync(path.join(ws, "CLAUDE.md"), "utf-8");
  assert.equal(claude, "# Some Workspace\n\nProject narrative blah blah.\n");

  // AGENTS.md absorbs CLAUDE.md narrative + has v0.4 section
  const agents = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf-8");
  assert.match(agents, /Project narrative blah blah/);
  assert.match(agents, /SoloSquad v0\.4 — Autonomous Goal Conventions/);
});

test("v0.3.0 → v0.4.0: existing AGENTS.md gets v0.4 section appended only if missing", async () => {
  const ws = temp125Workspace(["acme"]);
  fs.writeFileSync(
    path.join(ws, "AGENTS.md"),
    "# AGENTS.md\n\n## Project\nAcme.\n",
    "utf-8"
  );
  const plan = await v125ToV130.plan(ws);
  await v125ToV130.apply(ws, plan);

  const agents = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf-8");
  // Original section kept
  assert.match(agents, /## Project\nAcme\./);
  // v0.4 section appended
  assert.match(agents, /SoloSquad v0\.4 — Autonomous Goal Conventions/);
});

test("v0.3.0 → v0.4.0: verify() passes on a freshly applied workspace", async () => {
  const ws = temp125Workspace(["acme"]);
  const plan = await v125ToV130.plan(ws);
  await v125ToV130.apply(ws, plan);
  const res = await v125ToV130.verify(ws);
  assert.equal(res.ok, true, res.error);
});

test("v0.3.0 → v0.4.0: apply() is idempotent", async () => {
  const ws = temp125Workspace(["acme"]);
  const plan = await v125ToV130.plan(ws);
  await v125ToV130.apply(ws, plan);
  await v125ToV130.apply(ws, plan);
  const res = await v125ToV130.verify(ws);
  assert.equal(res.ok, true);
});
