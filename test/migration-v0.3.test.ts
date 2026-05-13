import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migration as v124ToV125 } from "../src/migrations/scripts/1.2.4-to-1.2.5.js";
import { loadWorkspaceYaml } from "../src/util/config.js";

function tempV124Workspace(orgs: string[] = ["bv-ai-native-po"]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-mig130-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    [
      "version: 1.2.4",
      "display_name: test-workspace",
      "timezone: Asia/Seoul",
      "briefings:",
      "  morning:",
      "    time: \"08:00\"",
      "    enabled: true",
      "  evening:",
      "    time: \"18:00\"",
      "    enabled: true",
      "background_routines:",
      "  signal_scan: { time: \"12:00\", enabled: true }",
      "  experiment_check: { time: \"16:00\", enabled: true }",
      "  weekly_review: { day: sunday, time: \"20:00\", enabled: true }",
      "created_at: 2026-04-23T00:00:00Z",
      "",
    ].join("\n"),
    "utf-8"
  );
  for (const o of orgs) {
    fs.mkdirSync(path.join(dir, o, "repositories"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, o, ".org.yaml"),
      `slug: ${o}\nname: ${o}\nrepos: []\nprovider: github\ncreated_at: 2026-04-23T00:00:00Z\n`,
      "utf-8"
    );
  }
  return dir;
}

test("v1.2.4 → v1.2.5: detect() returns true on a fresh 1.2.4 workspace", async () => {
  const ws = tempV124Workspace();
  assert.equal(await v124ToV125.detect(ws), true);
});

test("v1.2.4 → v1.2.5: plan() produces steps for sessions/, agents sync, pm section, version bump", async () => {
  const ws = tempV124Workspace(["bv-ai-native-po"]);
  const plan = await v124ToV125.plan(ws);
  const descriptions = plan.steps.map((s) => s.description);
  assert.ok(
    descriptions.some((d) => d.includes("PM session-id store dir for bv-ai-native-po")),
    "should include sessions/ create step"
  );
  assert.ok(
    descriptions.some((d) => d.includes(".claude/agents/")),
    "should include agents sync step"
  );
  assert.ok(
    descriptions.some((d) => d.includes("Bump version: 1.2.4 → 1.2.5")),
    "should include version bump"
  );
  assert.ok(plan.warnings.length > 0);
});

test("v1.2.4 → v1.2.5: apply() creates sessions/, .claude/agents/, adds pm section, bumps version", async () => {
  const ws = tempV124Workspace(["bv-ai-native-po"]);
  const plan = await v124ToV125.plan(ws);
  await v124ToV125.apply(ws, plan);

  const sessionsDir = path.join(ws, "bv-ai-native-po", ".solosquad", "sessions");
  assert.ok(fs.existsSync(sessionsDir));

  const agentsDir = path.join(ws, "bv-ai-native-po", ".claude", "agents");
  assert.ok(fs.existsSync(agentsDir));
  const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  assert.ok(
    agentFiles.length >= 20,
    `expected ≥20 specialist agent files, got ${agentFiles.length}`
  );

  const yamlAfter = loadWorkspaceYaml(ws)!;
  assert.equal(yamlAfter.version, "1.2.5");
  assert.equal(yamlAfter.last_migrated_to, "1.2.5");
  assert.ok(yamlAfter.pm);
  assert.equal(yamlAfter.pm!.max_budget_usd, 5);
});

test("v1.2.4 → v1.2.5: verify() passes on a freshly applied workspace", async () => {
  const ws = tempV124Workspace(["bv-ai-native-po"]);
  const plan = await v124ToV125.plan(ws);
  await v124ToV125.apply(ws, plan);
  const res = await v124ToV125.verify(ws);
  assert.equal(res.ok, true, res.error);
});

test("v1.2.4 → v1.2.5: apply() is idempotent (re-running doesn't break anything)", async () => {
  const ws = tempV124Workspace(["bv-ai-native-po"]);
  const plan = await v124ToV125.plan(ws);
  await v124ToV125.apply(ws, plan);
  await v124ToV125.apply(ws, plan);
  const res = await v124ToV125.verify(ws);
  assert.equal(res.ok, true);
});
