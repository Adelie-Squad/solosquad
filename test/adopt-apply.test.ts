import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildAdoptionReport } from "../src/analyze/adoption-report.js";
import { applyAdoption, type ApplyTargets } from "../src/analyze/adopt-apply.js";

function tempSourceRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-apply-src-"));
  const w = (rel: string, body: string): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  w(".claude/skills/my-skill/SKILL.md", "---\nname: my-skill\ndescription: does a thing\nschema_version: 1\n---\n# x");
  w("crons/digest.yaml", "id: digest\nname: Digest\nkind: background\ncron: '0 9 * * 1'\n");
  w("crons/digest.md", "# digest prompt");
  // a valid workflow (real bundled agent refs) → should be written
  w("flows/good/workflow.yaml", "id: good\nschema_version: 2\nstages:\n  - id: a\n    agent: product/product-manager\n    handoff_to: null\n");
  // a cyclic workflow → error → must be skipped by apply
  w("flows/loopy/workflow.yaml", "id: loopy\nschema_version: 2\nstages:\n  - id: a\n    agent: product/product-manager\n    handoff_to: b\n  - id: b\n    agent: product/data-analyst\n    handoff_to: a\n");
  return dir;
}

function tempTargets(): { dir: string; targets: ApplyTargets } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-apply-dst-"));
  return {
    dir,
    targets: {
      agentsDir: path.join(dir, "agents"),
      skillsDir: path.join(dir, "skills"),
      schedulesDir: path.join(dir, "crons"),
      workflowsDir: path.join(dir, "workflows"),
    },
  };
}

test("applyAdoption copies valid assets, skips errored ones", () => {
  const repo = tempSourceRepo();
  const { targets } = tempTargets();
  const report = buildAdoptionReport(repo);
  const result = applyAdoption(repo, report, targets);

  // skill written
  assert.ok(fs.existsSync(path.join(targets.skillsDir, "my-skill", "SKILL.md")));
  // cron yaml + prompt written
  assert.ok(fs.existsSync(path.join(targets.schedulesDir, "digest.yaml")));
  assert.ok(fs.existsSync(path.join(targets.schedulesDir, "digest.md")));
  // cyclic workflow skipped (error)
  const wf = result.outcomes.find((o) => o.kind === "workflow" && o.id === "loopy");
  assert.equal(wf?.action, "skipped");
  // valid workflow written
  assert.ok(fs.existsSync(path.join(targets.workflowsDir, "good", "workflow.yaml")));
  const good = result.outcomes.find((o) => o.kind === "workflow" && o.id === "good");
  assert.notEqual(good?.action, "skipped");
});

test("re-apply is idempotent (identical content → skipped)", () => {
  const repo = tempSourceRepo();
  const { targets } = tempTargets();
  const report = buildAdoptionReport(repo);
  applyAdoption(repo, report, targets);
  const second = applyAdoption(repo, report, targets);
  const skill = second.outcomes.find((o) => o.kind === "skill");
  assert.equal(skill?.action, "skipped");
  assert.match(skill?.reason ?? "", /already adopted/);
});

test("id collision is namespaced, never clobbers", () => {
  const repo = tempSourceRepo();
  const { targets } = tempTargets();
  // pre-existing skill with same id but different content
  fs.mkdirSync(path.join(targets.skillsDir, "my-skill"), { recursive: true });
  fs.writeFileSync(path.join(targets.skillsDir, "my-skill", "SKILL.md"), "PRE-EXISTING");

  const report = buildAdoptionReport(repo);
  const result = applyAdoption(repo, report, targets);

  // original untouched
  assert.equal(fs.readFileSync(path.join(targets.skillsDir, "my-skill", "SKILL.md"), "utf-8"), "PRE-EXISTING");
  // adopted copy landed under a namespaced id
  const skill = result.outcomes.find((o) => o.kind === "skill");
  assert.equal(skill?.action, "namespaced");
  assert.ok(fs.existsSync(path.join(targets.skillsDir, skill!.finalId, "SKILL.md")));
});
