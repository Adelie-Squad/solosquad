import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decideFileConflict,
  detectIdConflicts,
  mergeAgentProfile,
  mergeJsonlBuffers,
} from "../src/lifecycle/merge-strategy.js";

/**
 * v0.8.1 — `merge-strategy.ts` unit tests.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §4.3. Each helper is
 * exercised in isolation so the orchestrator's behaviour can be inferred
 * from these primitives + the import.test.ts e2e cases.
 */

test("mergeJsonlBuffers dedups identical rows, preserves order", () => {
  const existing = Buffer.from('{"id":1}\n{"id":2}\n');
  const incoming = Buffer.from('{"id":2}\n{"id":3}\n');
  const out = mergeJsonlBuffers(existing, incoming).toString("utf-8");
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => JSON.parse(l).id), [1, 2, 3]);
});

test("mergeJsonlBuffers handles unsorted keys identically", () => {
  // Both rows are semantically equal but byte-different.
  const existing = Buffer.from('{"a":1,"b":2}\n');
  const incoming = Buffer.from('{"b":2,"a":1}\n');
  const out = mergeJsonlBuffers(existing, incoming).toString("utf-8");
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 1, "semantically-equal rows must dedup");
});

test("mergeJsonlBuffers falls back to raw SHA for malformed JSON", () => {
  const existing = Buffer.from("not-json-1\nnot-json-2\n");
  const incoming = Buffer.from("not-json-2\nnot-json-3\n");
  const out = mergeJsonlBuffers(existing, incoming).toString("utf-8");
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.deepEqual(lines, ["not-json-1", "not-json-2", "not-json-3"]);
});

test("decideFileConflict writes when target absent", () => {
  const decision = decideFileConflict({
    relPath: "foo/bar.txt",
    incomingBytes: Buffer.from("hi"),
    existingBytes: null,
    absPath: "/tmp/foo/bar.txt",
    mode: "merge",
  });
  assert.equal(decision.kind, "write");
});

test("decideFileConflict skips identical files", () => {
  const decision = decideFileConflict({
    relPath: "foo/bar.txt",
    incomingBytes: Buffer.from("hi"),
    existingBytes: Buffer.from("hi"),
    absPath: "/tmp/foo/bar.txt",
    mode: "merge",
  });
  assert.equal(decision.kind, "skip");
});

test("decideFileConflict appends jsonl in merge mode", () => {
  const decision = decideFileConflict({
    relPath: "myorg/memory/signals.jsonl",
    incomingBytes: Buffer.from('{"id":2}\n'),
    existingBytes: Buffer.from('{"id":1}\n'),
    absPath: "/tmp/x.jsonl",
    mode: "merge",
  });
  assert.equal(decision.kind, "append-dedup");
  assert.ok(decision.bytes);
  const lines = decision.bytes!.toString("utf-8").trim().split("\n");
  assert.equal(lines.length, 2);
});

test("decideFileConflict renames AGENTS.md to .imported.md on conflict", () => {
  const decision = decideFileConflict({
    relPath: "AGENTS.md",
    incomingBytes: Buffer.from("# archive"),
    existingBytes: Buffer.from("# existing"),
    absPath: "/tmp/AGENTS.md",
    mode: "merge",
  });
  assert.equal(decision.kind, "rename-sibling");
  assert.ok(decision.targetPath?.endsWith("AGENTS.imported.md"));
});

test("decideFileConflict overwrites in replace mode", () => {
  const decision = decideFileConflict({
    relPath: "AGENTS.md",
    incomingBytes: Buffer.from("# archive"),
    existingBytes: Buffer.from("# existing"),
    absPath: "/tmp/AGENTS.md",
    mode: "replace",
  });
  assert.equal(decision.kind, "write");
  assert.equal(decision.bytes!.toString("utf-8"), "# archive");
});

test("detectIdConflicts finds existing workflow ids", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-merge-conflicts-"));
  fs.mkdirSync(path.join(dir, "workflows", "wf-A"), { recursive: true });
  fs.mkdirSync(path.join(dir, "workflows", "wf-B"), { recursive: true });
  fs.mkdirSync(path.join(dir, "goals", "goal-X"), { recursive: true });
  try {
    const report = detectIdConflicts({
      orgDir: dir,
      incomingWorkflowIds: new Set(["wf-A", "wf-NEW"]),
      incomingGoalIds: new Set(["goal-X", "goal-NEW"]),
    });
    assert.deepEqual(report.workflowConflicts.sort(), ["wf-A"]);
    assert.deepEqual(report.goalConflicts.sort(), ["goal-X"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mergeAgentProfile accepts narrowing", () => {
  const result = mergeAgentProfile(
    { budget: { per_call_usd: 1.0 }, freq_enabled: true },
    { budget: { per_call_usd: 0.5 }, freq_enabled: true },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      (result.merged.budget as Record<string, number>).per_call_usd,
      0.5,
    );
  }
});

test("mergeAgentProfile rejects widening", () => {
  const result = mergeAgentProfile(
    { budget: { per_call_usd: 0.5 } },
    { budget: { per_call_usd: 1.0 } },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.violations.some((v) => v.includes("per_call_usd")));
  }
});

test("mergeAgentProfile rejects new keys", () => {
  const result = mergeAgentProfile(
    { existing_key: 1 },
    { existing_key: 1, brand_new_key: 2 },
  );
  assert.equal(result.ok, false);
});
