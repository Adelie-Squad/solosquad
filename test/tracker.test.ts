import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendResults,
  ensureResultsTsv,
  readResults,
  readBest,
  maybeUpdateBest,
  summarizeRun,
  resultsTsvPath,
  type CycleResult,
} from "../src/engine/tracker.js";
import type { MetricSpec } from "../src/engine/goal-parser.js";

function tempWs(orgSlug = "acme"): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-tracker-"));
  fs.mkdirSync(path.join(ws, orgSlug), { recursive: true });
  return ws;
}

function row(overrides: Partial<CycleResult> = {}): CycleResult {
  return {
    cycle: 1,
    timestamp: "2026-05-13T22:00:00Z",
    agent: "experience/desk-researcher",
    metric: "cvr",
    value: 0.8,
    status: "keep",
    commit: "abc1234",
    provenance: "formula=x;source=y",
    task_id: "tsk_1",
    description: "initial",
    ...overrides,
  };
}

test("ensureResultsTsv writes schema_version header on first call", () => {
  const ws = tempWs();
  ensureResultsTsv(ws, "acme", "g1");
  const body = fs.readFileSync(resultsTsvPath(ws, "acme", "g1"), "utf-8");
  assert.match(body, /# schema_version=1/);
  assert.match(body, /^cycle\ttimestamp\tagent/m);
});

test("appendResults round-trips rows through TSV", () => {
  const ws = tempWs();
  const rows = [row({ cycle: 1 }), row({ cycle: 2, status: "discard", value: 0.4, commit: "-" })];
  appendResults(ws, "acme", "g1", rows);
  const read = readResults(ws, "acme", "g1");
  assert.equal(read.length, 2);
  assert.equal(read[0].cycle, 1);
  assert.equal(read[1].status, "discard");
  assert.equal(read[1].commit, "-");
});

test("maybeUpdateBest only accepts cycles where ALL metrics pass threshold", () => {
  const ws = tempWs();
  const m1: MetricSpec = { name: "cvr", formula: "f", source: "s", threshold: 0.5, direction: "maximize" };
  const m2: MetricSpec = { name: "cost", formula: "f", source: "s", threshold: 1.0, direction: "minimize" };

  // Below threshold on m1: should NOT update
  const r1 = maybeUpdateBest(ws, "acme", "g1", {
    cycle: 1,
    commit: "aaa",
    timestamp: "2026-05-13T22:00:00Z",
    metrics: [
      { spec: m1, value: 0.3 },
      { spec: m2, value: 0.5 },
    ],
  });
  assert.equal(r1.updated, false);

  // Above threshold on both: should update
  const r2 = maybeUpdateBest(ws, "acme", "g1", {
    cycle: 2,
    commit: "bbb",
    timestamp: "2026-05-13T22:30:00Z",
    metrics: [
      { spec: m1, value: 0.8 },
      { spec: m2, value: 0.4 },
    ],
  });
  assert.equal(r2.updated, true);
  assert.equal(r2.best!.commit, "bbb");

  // Better composite: should update again
  const r3 = maybeUpdateBest(ws, "acme", "g1", {
    cycle: 3,
    commit: "ccc",
    timestamp: "2026-05-13T23:00:00Z",
    metrics: [
      { spec: m1, value: 0.95 }, // higher than cycle 2
      { spec: m2, value: 0.2 }, // lower than cycle 2 (minimize)
    ],
  });
  assert.equal(r3.updated, true);
  assert.equal(r3.best!.commit, "ccc");

  const best = readBest(ws, "acme", "g1");
  assert.equal(best!.cycle, 3);
});

test("summarizeRun counts distinct cycles + best + total cost", () => {
  const ws = tempWs();
  appendResults(ws, "acme", "g1", [
    row({ cycle: 1, status: "keep", metric: "a" }),
    row({ cycle: 1, status: "keep", metric: "b" }),
    row({ cycle: 2, status: "discard", commit: "-", metric: "a" }),
  ]);
  const s = summarizeRun(ws, "acme", "g1", { 1: 0.05, 2: 0.03 });
  assert.equal(s.cycleCount, 2);
  assert.equal(s.keepCount, 1);
  assert.equal(s.discardCount, 1);
  assert.equal(Math.abs(s.totalCostUsd - 0.08) < 1e-9, true);
});
