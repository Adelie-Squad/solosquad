import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listMetaSkills } from "../src/bot/meta-skill-scanner.js";

/**
 * v0.5 §7 meta-skill-scanner tests.
 *
 * Layout under each tmp dir:
 *   <tmp>/_meta/<name>/SKILL.md   — scanned
 *   <tmp>/strategy/...            — must be ignored
 */

function mkAgentsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-skill-scanner-"));
}

function writeSkill(
  agentsDir: string,
  name: string,
  frontmatter: string,
  body = "\n# Title\n\nBody.\n",
): string {
  const dir = path.join(agentsDir, "_meta", name);
  fs.mkdirSync(dir, { recursive: true });
  const skillPath = path.join(dir, "SKILL.md");
  fs.writeFileSync(skillPath, `---\n${frontmatter}\n---${body}`);
  return skillPath;
}

test("returns empty result when _meta/ is empty", () => {
  const dir = mkAgentsDir();
  fs.mkdirSync(path.join(dir, "_meta"), { recursive: true });
  const result = listMetaSkills(dir);
  assert.deepEqual(result.ok, []);
  assert.deepEqual(result.rejected, []);
});

test("accepts meta-skill with only triggers.explicit: true", () => {
  const dir = mkAgentsDir();
  writeSkill(
    dir,
    "workflow-manager",
    `name: "workflow-manager"\ndescription: "compose multi-stage workflows"\ntriggers:\n  explicit: true`,
  );
  const result = listMetaSkills(dir);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.ok.length, 1);
  assert.equal(result.ok[0].name, "workflow-manager");
  assert.equal(result.ok[0].spec.triggers?.explicit, true);
  assert.ok(result.ok[0].source_path.endsWith("SKILL.md"));
});

test("rejects meta-skill with no triggers at all (missing explicit)", () => {
  const dir = mkAgentsDir();
  const skillPath = writeSkill(
    dir,
    "untriggered",
    `name: "untriggered"\ndescription: "no triggers block"`,
  );
  const result = listMetaSkills(dir);
  assert.equal(result.ok.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].path, skillPath);
  assert.match(result.rejected[0].reason, /explicit/i);
});

test("rejects meta-skill that registers triggers.slash", () => {
  const dir = mkAgentsDir();
  writeSkill(
    dir,
    "slashy",
    `name: "slashy"\ndescription: "should not exist"\ntriggers:\n  slash: ["/workflow-make"]\n  explicit: true`,
  );
  const result = listMetaSkills(dir);
  assert.equal(result.ok.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /slash/);
});

test("rejects meta-skill that registers triggers.keyword", () => {
  const dir = mkAgentsDir();
  writeSkill(
    dir,
    "keywordy",
    `name: "keywordy"\ndescription: "should not exist"\ntriggers:\n  keyword: ["compose"]\n  explicit: true`,
  );
  const result = listMetaSkills(dir);
  assert.equal(result.ok.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /keyword/);
});

test("rejects meta-skill that registers triggers.freq", () => {
  const dir = mkAgentsDir();
  writeSkill(
    dir,
    "freqy",
    `name: "freqy"\ndescription: "should not exist"\ntriggers:\n  freq:\n    keywords: ["loop"]\n    window_turns: 10\n    threshold: 3\n  explicit: true`,
  );
  const result = listMetaSkills(dir);
  assert.equal(result.ok.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /freq/);
});

test("rejects meta-skill with explicit: true AND another channel (any ambient = reject)", () => {
  const dir = mkAgentsDir();
  writeSkill(
    dir,
    "mixed",
    `name: "mixed"\ndescription: "explicit plus keyword"\ntriggers:\n  explicit: true\n  keyword: ["foo"]`,
  );
  const result = listMetaSkills(dir);
  assert.equal(result.ok.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /keyword/);
});

test("rejects meta-skill with malformed frontmatter (missing name)", () => {
  const dir = mkAgentsDir();
  const skillPath = writeSkill(
    dir,
    "broken",
    `description: "no name field"\ntriggers:\n  explicit: true`,
  );
  const result = listMetaSkills(dir);
  assert.equal(result.ok.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].path, skillPath);
  assert.match(result.rejected[0].reason, /name/i);
});

test("returns empty result when agentsDir does not exist (no throw)", () => {
  const ghost = path.join(os.tmpdir(), `meta-skill-scanner-ghost-${Date.now()}`);
  const result = listMetaSkills(ghost);
  assert.deepEqual(result.ok, []);
  assert.deepEqual(result.rejected, []);
});

test("ignores non-_meta sibling team directories like strategy/", () => {
  const dir = mkAgentsDir();
  // valid meta-skill
  writeSkill(
    dir,
    "workflow-manager",
    `name: "workflow-manager"\ndescription: "valid"\ntriggers:\n  explicit: true`,
  );
  // sibling team that scanner must not even look at
  const stratAgent = path.join(dir, "strategy", "pmf-planner");
  fs.mkdirSync(stratAgent, { recursive: true });
  fs.writeFileSync(
    path.join(stratAgent, "SKILL.md"),
    `---\nname: "pmf-planner"\ndescription: "should be ignored"\ntriggers:\n  keyword: ["pmf"]\n---\n\n# PMF\n`,
  );
  const result = listMetaSkills(dir);
  assert.equal(result.ok.length, 1);
  assert.equal(result.ok[0].name, "workflow-manager");
  assert.equal(result.rejected.length, 0);
});
