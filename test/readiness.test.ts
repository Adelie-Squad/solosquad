import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { scanWorkspace } from "../src/cli/readiness.js";

/**
 * v0.6 P1 #7 — readiness check unit tests.
 *
 * scanWorkspace() is the pure function powering the CLI. It enumerates
 * org dirs (by `.org.yaml` presence), reads v0.5 artefacts, and computes
 * pass/fail. We test the three scenarios called out in v0.6 plan §12 S1
 * #9 (빈/저데이터/충분) plus exit-code surfaces (pass/reason fields) and
 * message-format invariants.
 */

function mkWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-readiness-"));
}

function mkOrg(workspace: string, slug: string): string {
  const dir = path.join(workspace, slug);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  // .org.yaml required for org detection
  fs.writeFileSync(
    path.join(dir, ".org.yaml"),
    yaml.dump({ slug, name: slug, provider: "local" })
  );
  return dir;
}

function writeAuthorCostRow(
  orgDir: string,
  ts: string,
  usd: number,
  skillId = "skill-x"
): void {
  const file = path.join(orgDir, "memory", "author-costs.jsonl");
  fs.appendFileSync(
    file,
    JSON.stringify({ ts, skill_draft_id: skillId, step: "draft", usd, model: "haiku-4-5" }) +
      "\n"
  );
}

function writeWorkflow(orgDir: string, slug: string, type: string): void {
  const wfDir = path.join(orgDir, "workflows", slug);
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, "_status.yaml"),
    yaml.dump({
      project: { id: slug, type },
      workflow: [{ stage: "research", status: "completed" }],
    })
  );
}

test("empty workspace → fail with no template covered", () => {
  const ws = mkWorkspace();
  try {
    const r = scanWorkspace(ws);
    assert.equal(r.pass, false);
    assert.equal(r.authorCostRows, 0);
    assert.equal(r.ledgerEntries, 0);
    for (const k of ["pmf", "feature", "rebranding", "prototype"] as const) {
      assert.equal(r.workflowsByTemplate[k], 0);
    }
    assert.match(r.reason, /4종 워크플로/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("v0.5 data sufficient → pass", () => {
  const ws = mkWorkspace();
  try {
    const org = mkOrg(ws, "demo");
    // 12 author-cost rows
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const ts = new Date(now.getTime() - i * 60_000).toISOString();
      writeAuthorCostRow(org, ts, 0.1, `skill-${i % 3}`);
    }
    // 1 PMF workflow
    writeWorkflow(org, "wf-2026-05-01-launch", "pmf");
    const r = scanWorkspace(ws);
    assert.equal(r.pass, true);
    assert.equal(r.authorCostRows, 12);
    assert.equal(r.workflowsByTemplate.pmf, 1);
    assert.equal(r.reason, "임계 충족");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("workflow covered but author data short → fail with author-count reason", () => {
  const ws = mkWorkspace();
  try {
    const org = mkOrg(ws, "demo");
    writeWorkflow(org, "wf-1", "feature");
    // only 3 rows — below MIN_AUTHOR_COSTS=10
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      writeAuthorCostRow(org, new Date(now.getTime() - i * 1000).toISOString(), 0.1);
    }
    const r = scanWorkspace(ws);
    assert.equal(r.pass, false);
    assert.equal(r.workflowsByTemplate.feature, 1);
    assert.equal(r.authorCostRows, 3);
    assert.match(r.reason, /author 산출/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("classifies PRD-only workflow via heuristic (no project.type)", () => {
  const ws = mkWorkspace();
  try {
    const org = mkOrg(ws, "demo");
    const wfDir = path.join(org, "workflows", "wf-rebrand-2026");
    fs.mkdirSync(wfDir, { recursive: true });
    // No _status.yaml — only PRD.md mentioning "rebrand"
    fs.writeFileSync(
      path.join(wfDir, "PRD.md"),
      "# Acme Rebranding PRD\n\nRebrand the product."
    );
    const r = scanWorkspace(ws);
    assert.equal(r.workflowsByTemplate.rebranding, 1);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("multi-org aggregation: counts across all orgs", () => {
  const ws = mkWorkspace();
  try {
    const a = mkOrg(ws, "alpha");
    const b = mkOrg(ws, "beta");
    writeWorkflow(a, "wf-1", "pmf");
    writeWorkflow(b, "wf-2", "feature");
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      writeAuthorCostRow(a, new Date(now.getTime() - i * 1000).toISOString(), 0.1);
      writeAuthorCostRow(b, new Date(now.getTime() - i * 1000).toISOString(), 0.1);
    }
    const r = scanWorkspace(ws);
    assert.equal(r.authorCostRows, 10);
    assert.equal(r.workflowsByTemplate.pmf, 1);
    assert.equal(r.workflowsByTemplate.feature, 1);
    assert.equal(r.pass, true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
