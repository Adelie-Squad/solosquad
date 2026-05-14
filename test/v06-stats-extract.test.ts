import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { extractV06Stats } from "../src/scheduler/v06-stats-extract.js";
import { saveLedger, makeEntry, emptyLedger } from "../src/analyze/ledger.js";

/**
 * v0.6 §2.5 ETL — deterministic stats aggregation.
 *
 * Setup pattern mirrors author-budget tests: tmp workspace + <org>/memory.
 * Verifies the four input sources (workflows / handoffs / results.tsv /
 * author-costs.jsonl) are independently aggregated and rendered.
 */

function mkWorkspace(): { workspace: string; orgSlug: string; orgDir: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-v06stats-"));
  const orgSlug = "demo";
  const orgDir = path.join(workspace, orgSlug);
  fs.mkdirSync(path.join(orgDir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "workflows"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "goals"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(orgDir, ".org.yaml"),
    yaml.dump({ slug: orgSlug, name: orgSlug })
  );
  return { workspace, orgSlug, orgDir };
}

function writeAuthorCost(
  orgDir: string,
  skillId: string,
  step: string,
  usd: number
): void {
  fs.appendFileSync(
    path.join(orgDir, "memory", "author-costs.jsonl"),
    JSON.stringify({
      ts: new Date().toISOString(),
      skill_draft_id: skillId,
      step,
      usd,
      model: "haiku-4-5",
    }) + "\n"
  );
}

test("author-costs JSONL aggregated per skill + per step with USD totals", () => {
  const { workspace, orgSlug, orgDir } = mkWorkspace();
  try {
    writeAuthorCost(orgDir, "draft-a", "draft", 0.10);
    writeAuthorCost(orgDir, "draft-a", "clarify", 0.05);
    writeAuthorCost(orgDir, "draft-b", "draft", 0.20);
    writeAuthorCost(orgDir, "draft-a", "draft", 0.15);

    const result = extractV06Stats({
      workspace,
      orgSlug,
      todayIso: "2026-05-14",
    });
    assert.equal(result.summary.authorCostRows, 4);
    assert.match(result.markdown, /draft-a \| 3/);
    assert.match(result.markdown, /draft-b \| 1/);
    // USD totals per step (draft=0.10+0.20+0.15=0.45)
    assert.match(result.markdown, /\| draft \| 3 \| 0\.4500/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("ledger entries grouped by label", () => {
  const { workspace, orgSlug, orgDir } = mkWorkspace();
  try {
    const ledger = emptyLedger("test-fingerprint");
    ledger.analyzed.push(
      makeEntry(
        { path: ".claude/skills/a.md", hash: "h1", size_bytes: 10, mtime_iso: "2026-05-14T00:00:00Z" },
        "role",
        0.9,
        "<dest>"
      )
    );
    ledger.analyzed.push(
      makeEntry(
        { path: ".claude/skills/b.md", hash: "h2", size_bytes: 10, mtime_iso: "2026-05-14T00:00:00Z" },
        "domain",
        0.9,
        "<dest>"
      )
    );
    ledger.analyzed.push(
      makeEntry(
        { path: ".claude/skills/c.md", hash: "h3", size_bytes: 10, mtime_iso: "2026-05-14T00:00:00Z" },
        "workflow",
        0.5,
        "<dest>",
        { ambiguous: true }
      )
    );
    saveLedger(
      path.join(orgDir, ".solosquad", "analysis-ledger.yaml"),
      ledger
    );

    const result = extractV06Stats({
      workspace,
      orgSlug,
      todayIso: "2026-05-14",
    });
    assert.equal(result.summary.ledgerEntries, 3);
    assert.match(result.markdown, /\| role \| 1 \|/);
    assert.match(result.markdown, /\| domain \| 1 \|/);
    assert.match(result.markdown, /\| workflow \| 1 \|/);
    assert.match(result.markdown, /Ambiguous entries: 1/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("workflow stage stats from _status.yaml", () => {
  const { workspace, orgSlug, orgDir } = mkWorkspace();
  try {
    const wf1 = path.join(orgDir, "workflows", "wf-1");
    fs.mkdirSync(wf1, { recursive: true });
    fs.writeFileSync(
      path.join(wf1, "_status.yaml"),
      yaml.dump({
        project: { id: "wf-1", type: "pmf" },
        workflow: [
          { stage: "research", status: "completed" },
          { stage: "planning", status: "completed" },
          { stage: "design", status: "pending" },
        ],
      })
    );
    const wf2 = path.join(orgDir, "workflows", "wf-2");
    fs.mkdirSync(wf2, { recursive: true });
    fs.writeFileSync(
      path.join(wf2, "_status.yaml"),
      yaml.dump({
        project: { id: "wf-2" },
        workflow: [
          { stage: "research", status: "in_progress" },
          { stage: "planning", status: "pending" },
        ],
      })
    );

    const result = extractV06Stats({
      workspace,
      orgSlug,
      todayIso: "2026-05-14",
    });
    assert.equal(result.summary.workflowsScanned, 2);
    // 2 research rows total: 1 completed + 1 in_progress
    assert.match(result.markdown, /\| research \| 0 \| 1 \| 1 \| 0 \|/);
    // 2 planning rows: 1 pending + 1 completed
    assert.match(result.markdown, /\| planning \| 1 \| 0 \| 1 \| 0 \|/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("handoff section frequency captured per agent dir", () => {
  const { workspace, orgSlug, orgDir } = mkWorkspace();
  try {
    const stageDir = path.join(
      orgDir,
      "workflows",
      "wf-1",
      "stage-1-researcher"
    );
    fs.mkdirSync(stageDir, { recursive: true });
    fs.writeFileSync(
      path.join(stageDir, "_handoff.md"),
      [
        "# Handoff",
        "## Summary",
        "x",
        "## Artifacts",
        "y",
        "## Custom Note",
        "z",
      ].join("\n")
    );
    const stageDir2 = path.join(
      orgDir,
      "workflows",
      "wf-1",
      "stage-2-planner"
    );
    fs.mkdirSync(stageDir2, { recursive: true });
    fs.writeFileSync(
      path.join(stageDir2, "_handoff.md"),
      ["## Summary", "x", "## Open Questions", "?"].join("\n")
    );

    const result = extractV06Stats({
      workspace,
      orgSlug,
      todayIso: "2026-05-14",
    });
    assert.equal(result.summary.handoffsScanned, 2);
    assert.match(result.markdown, /\| Summary \| 2 \| ✓ \|/);
    assert.match(result.markdown, /\| Custom Note \| 1 \| · \|/);
    assert.match(result.markdown, /stage-1-researcher \| 1 \| 4\.0/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("results.tsv keep/discard counted per agent (comment lines skipped)", () => {
  const { workspace, orgSlug, orgDir } = mkWorkspace();
  try {
    const goalDir = path.join(orgDir, "goals", "goal-1");
    fs.mkdirSync(goalDir, { recursive: true });
    const tsv = [
      "# schema_version=1",
      "# v0.4 tracker",
      "cycle\ttimestamp\tagent\tmetric\tvalue\tstatus\tcommit\tprovenance\ttask_id\tdescription",
      "1\t2026-05-14T00:00:00Z\teng/fde\tlatency\t120\tkeep\tabc\t-\tt1\tok",
      "2\t2026-05-14T00:00:00Z\teng/fde\tlatency\t200\tdiscard\t-\t-\tt2\tslow",
      "3\t2026-05-14T00:00:00Z\teng/qa\tcoverage\t90\tkeep\tdef\t-\tt3\tok",
    ].join("\n");
    fs.writeFileSync(path.join(goalDir, "results.tsv"), tsv);

    const result = extractV06Stats({
      workspace,
      orgSlug,
      todayIso: "2026-05-14",
    });
    assert.equal(result.summary.resultsRows, 3);
    assert.match(result.markdown, /\| eng\/fde \| 1 \| 1 \| 50\.0%/);
    assert.match(result.markdown, /\| eng\/qa \| 1 \| 0 \| 100\.0%/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("output path is deterministic on todayIso + always writes file", () => {
  const { workspace, orgSlug } = mkWorkspace();
  try {
    const r1 = extractV06Stats({
      workspace,
      orgSlug,
      todayIso: "2026-05-14",
    });
    assert.ok(fs.existsSync(r1.outputPath));
    assert.match(r1.outputPath, /v0\.6-retrospective-stats-2026-05-14\.md$/);

    // Re-run same day → overwrite, same path (idempotent on date)
    const r2 = extractV06Stats({
      workspace,
      orgSlug,
      todayIso: "2026-05-14",
    });
    assert.equal(r1.outputPath, r2.outputPath);
    assert.match(r2.markdown, /회고 #5/);
    assert.match(r2.markdown, /회고 #6/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
