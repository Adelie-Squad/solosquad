import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendEntry,
  readEntries,
  latestEntry,
  type LeadingIndicatorEntry,
  type IndicatorSnapshot,
} from "../src/util/leading-indicators.js";

function mkOrgRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-leading-"));
}

function snap(seed: number): IndicatorSnapshot {
  return {
    conversion_to_task_rate: 0.4 + seed * 0.01,
    auto_pr_success_rate: 0.7 + seed * 0.01,
    autonomous_goal_cycles: seed,
    shipping_streak_days: seed,
    avg_confidence_score: 60 + seed,
  };
}

function entry(seed: number, daysOffset: number = 0): LeadingIndicatorEntry {
  return {
    ts: new Date(Date.UTC(2026, 4, 27) + daysOffset * 86_400_000).toISOString(),
    window_1d: snap(seed),
    window_7d: snap(seed),
    evidence_refs: [`ref-${seed}`],
  };
}

test("appendEntry creates the file and parent dirs", () => {
  const orgRoot = mkOrgRoot();
  appendEntry({ orgRoot }, entry(1));
  const file = path.join(orgRoot, "memory", "leading-indicators.jsonl");
  assert.ok(fs.existsSync(file));
});

test("readEntries returns entries in append order", () => {
  const orgRoot = mkOrgRoot();
  appendEntry({ orgRoot }, entry(1, 0));
  appendEntry({ orgRoot }, entry(2, 1));
  appendEntry({ orgRoot }, entry(3, 2));
  const all = readEntries({ orgRoot });
  assert.equal(all.length, 3);
  assert.equal(all[0]?.window_1d.autonomous_goal_cycles, 1);
  assert.equal(all[2]?.window_1d.autonomous_goal_cycles, 3);
});

test("readEntries with sinceIso filters older entries", () => {
  const orgRoot = mkOrgRoot();
  appendEntry({ orgRoot }, entry(1, 0));
  appendEntry({ orgRoot }, entry(2, 7));
  const cutoff = new Date(Date.UTC(2026, 4, 30)).toISOString();
  const recent = readEntries({ orgRoot }, cutoff);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.window_1d.autonomous_goal_cycles, 2);
});

test("readEntries skips malformed lines", () => {
  const orgRoot = mkOrgRoot();
  appendEntry({ orgRoot }, entry(1));
  const file = path.join(orgRoot, "memory", "leading-indicators.jsonl");
  fs.appendFileSync(file, "{not valid json}\n", "utf8");
  fs.appendFileSync(file, "\n", "utf8");
  appendEntry({ orgRoot }, entry(2, 1));
  const all = readEntries({ orgRoot });
  assert.equal(all.length, 2);
});

test("latestEntry returns null when no file", () => {
  const orgRoot = mkOrgRoot();
  assert.equal(latestEntry({ orgRoot }), null);
});

test("latestEntry returns the last appended entry", () => {
  const orgRoot = mkOrgRoot();
  appendEntry({ orgRoot }, entry(1, 0));
  appendEntry({ orgRoot }, entry(7, 1));
  const latest = latestEntry({ orgRoot });
  assert.ok(latest);
  assert.equal(latest.window_1d.autonomous_goal_cycles, 7);
});
