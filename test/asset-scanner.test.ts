import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyAssetPath, scanRepoAssets } from "../src/analyze/asset-scanner.js";

test("classifyAssetPath: each asset kind by convention", () => {
  assert.deepEqual(classifyAssetPath(".claude/skills/deploy/SKILL.md"), { kind: "skill", id: "deploy" });
  assert.deepEqual(classifyAssetPath(".claude/agents/reviewer.md"), { kind: "agent", id: "reviewer" });
  assert.deepEqual(classifyAssetPath("agents/specialists/architect/SKILL.md"), { kind: "agent", id: "architect" });
  assert.deepEqual(classifyAssetPath("flows/my-flow/workflow.yaml"), { kind: "workflow", id: "my-flow" });
  assert.deepEqual(classifyAssetPath("schedules/digest.yaml"), { kind: "schedule", id: "digest" });
  assert.equal(classifyAssetPath("README.md"), null);
  assert.equal(classifyAssetPath("src/index.ts"), null);
});

test("scanRepoAssets walks a repo and hashes assets, skipping node_modules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-scan-"));
  const w = (rel: string, body: string): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  w(".claude/skills/foo/SKILL.md", "---\nname: foo\ndescription: d\n---\nbody");
  w(".claude/agents/rev.md", "---\nname: rev\n---\nb");
  w("flows/a/workflow.yaml", "id: a\nstages: []");
  w("schedules/d.yaml", "id: d\ncron: '0 9 * * *'");
  w("node_modules/pkg/.claude/skills/ghost/SKILL.md", "should be ignored");
  w("README.md", "ignored");

  const assets = scanRepoAssets(dir);
  const byKind = (k: string): string[] => assets.filter((a) => a.kind === k).map((a) => a.id);
  assert.deepEqual(byKind("skill"), ["foo"]);
  assert.deepEqual(byKind("agent"), ["rev"]);
  assert.deepEqual(byKind("workflow"), ["a"]);
  assert.deepEqual(byKind("schedule"), ["d"]);
  assert.ok(assets.every((a) => /^[a-f0-9]{12}$/.test(a.hash)));
});
