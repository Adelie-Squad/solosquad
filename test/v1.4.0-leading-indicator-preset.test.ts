import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CRON_PRESETS, type CronDef } from "../src/cron/cron-def.js";
import { validateCronDef } from "../src/cron/cron-validate.js";

// Repo-root bundled crons/ dir, located relative to this test file (the dev
// workspace resolver is cwd-sensitive and unreliable in CI, so anchor here).
const REPO_CRONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "crons");

/**
 * v1.4.0 (§5.5) — leading-indicator cron preset (opt-in wiring).
 *
 * Guards the key invariants the `cron preset` command relies on:
 *  1. the preset registry contains leading-indicator with a schedulable shape;
 *  2. a def built from the preset passes the pure cron validator (so enabling
 *     it never writes an invalid def);
 *  3. the bundled prompt exists (the enable command copies it into the org dir)
 *     and carries the v1.4.0 S-2a usage indicator (avg_context_tokens).
 */

function defFromPreset(id: string): CronDef {
  const p = CRON_PRESETS[id];
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    cron: p.cron,
    channel: "",
    emoji: p.emoji,
    memoryTargets: p.memoryTargets,
    enabled: true,
  };
}

test("§5.5 — leading-indicator preset is registered and schedulable", () => {
  const p = CRON_PRESETS["leading-indicator"];
  assert.ok(p, "leading-indicator preset must exist");
  assert.equal(p.kind, "background");
  assert.ok(p.cron.length > 0, "preset must carry a default schedule");
});

test("§5.5 — a def built from the preset passes validation", () => {
  const def = defFromPreset("leading-indicator");
  const result = validateCronDef(def, {
    reservedIds: new Set<string>(),
    promptExists: () => true, // the enable command copies the prompt in
  });
  assert.equal(result.ok, true, `preset def must validate cleanly: ${JSON.stringify(result.errors)}`);
});

test("§5.5/B1 — bundled prompt exists and carries the S-2a usage indicator", () => {
  const promptPath = path.join(REPO_CRONS_DIR, "leading-indicator.md");
  assert.ok(fs.existsSync(promptPath), `bundled prompt must exist at ${promptPath}`);
  const body = fs.readFileSync(promptPath, "utf-8");
  assert.match(body, /avg_context_tokens/, "prompt must include the S-2a avg_context_tokens indicator");
  assert.match(body, /chief\.usage/, "prompt must reference the chief.usage event as the data source");
});
