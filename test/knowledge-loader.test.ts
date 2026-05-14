import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getKnowledgeDir, getAssetsDir } from "../src/util/paths.js";
import { assembleSpawnContext } from "../src/bot/spawn-assembler.js";

/**
 * v0.6 §2.3 — Workspace Knowledge Layer.
 *
 * getKnowledgeDir() walks: `.solosquad/knowledge/` → `knowledge/` → bundled
 * assets/knowledge/. The spawn assembler keyword-matches the loaded files
 * against the user query and drops zero-hit ones at gather time.
 */

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("getKnowledgeDir picks .solosquad/knowledge/ when present", () => {
  const ws = mkTempDir("ss-knowledge-");
  const dir = path.join(ws, ".solosquad", "knowledge");
  fs.mkdirSync(dir, { recursive: true });

  const resolved = getKnowledgeDir(ws);
  assert.equal(resolved, dir);
});

test("getKnowledgeDir falls back to legacy /knowledge/ then to bundled assets", () => {
  const ws = mkTempDir("ss-knowledge-");
  // Neither .solosquad/knowledge nor /knowledge — should land in assets.
  const resolved = getKnowledgeDir(ws);
  assert.equal(resolved, path.join(getAssetsDir(), "knowledge"));

  // Now create /knowledge legacy folder.
  const legacy = path.join(ws, "knowledge");
  fs.mkdirSync(legacy);
  const resolved2 = getKnowledgeDir(ws);
  assert.equal(resolved2, legacy);
});

test("workspace knowledge is keyword-filtered at spawn time (zero-hit dropped)", () => {
  const ws = mkTempDir("ss-knowledge-");
  const orgSlug = "demo";
  fs.mkdirSync(path.join(ws, orgSlug, "memory"), { recursive: true });

  // Two knowledge files: one matches the query, one is irrelevant.
  const kdir = path.join(ws, ".solosquad", "knowledge");
  fs.mkdirSync(kdir, { recursive: true });
  fs.writeFileSync(path.join(kdir, "lean-canvas.md"), "Lean canvas frameworks for startups.");
  fs.writeFileSync(
    path.join(kdir, "porter-five-forces.md"),
    "Porter five forces competition model.",
  );

  // Minimal agents/{team}/{name}/SKILL.md so [3] resolves to something.
  const agentDir = path.join(ws, ".solosquad", "agents", "strategy", "business-strategist");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "SKILL.md"), "# business-strategist\n");

  const result = assembleSpawnContext({
    workspace: ws,
    orgSlug,
    agentRef: { team: "strategy", name: "business-strategist" },
    query: "lean canvas analysis",
    dryRun: true,
  });

  const knowledgeLayer = result.layers.find((l) => l.kind === "workspace-knowledge");
  assert.ok(knowledgeLayer);
  assert.equal(knowledgeLayer.sources.length, 1);
  assert.match(knowledgeLayer.sources[0], /lean-canvas\.md$/);
});
