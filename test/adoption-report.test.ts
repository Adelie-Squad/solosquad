import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildAdoptionReport } from "../src/analyze/adoption-report.js";

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-adopt-"));
  const w = (rel: string, body: string): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  // valid skill
  w(".claude/skills/my-skill/SKILL.md", "---\nname: my-skill\ndescription: does a thing\nschema_version: 1\n---\n# x");
  // valid workflow (acyclic, refs real bundled agents so they resolve)
  w("flows/good/workflow.yaml", "id: good\nschema_version: 2\nstages:\n  - id: a\n    agent: product/pmf-planner\n    handoff_to: b\n  - id: b\n    agent: product/data-analyst\n    handoff_to: null\n");
  // bad workflow (cycle → error)
  w("flows/loopy/workflow.yaml", "id: loopy\nschema_version: 2\nstages:\n  - id: a\n    agent: x/y\n    handoff_to: b\n  - id: b\n    agent: x/y\n    handoff_to: a\n");
  // valid schedule + prompt
  w("schedules/digest.yaml", "id: digest\nname: Digest\nkind: background\ncron: '0 9 * * 1'\n");
  w("schedules/digest.md", "# digest prompt");
  return dir;
}

test("buildAdoptionReport: validates each asset (validate-then-adopt)", () => {
  const repo = tempRepo();
  const report = buildAdoptionReport(repo);

  assert.equal(report.counts.skill, 1);
  assert.equal(report.counts.workflow, 2);
  assert.equal(report.counts.schedule, 1);

  const byId = (id: string) => report.items.find((i) => i.id === id);
  assert.equal(byId("my-skill")!.status === "error", false);
  assert.equal(byId("good")!.status === "error", false);
  assert.equal(byId("loopy")!.status, "error"); // cycle
  assert.ok(byId("loopy")!.findings.some((f) => f.code === "WF_CYCLE"));
  assert.equal(byId("digest")!.status === "error", false);

  assert.ok(report.errorCount >= 1, "the cyclic workflow contributes a blocking error");
});

test("buildAdoptionReport: empty repo yields no items", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-adopt-empty-"));
  const report = buildAdoptionReport(dir);
  assert.equal(report.items.length, 0);
  assert.equal(report.errorCount, 0);
});
