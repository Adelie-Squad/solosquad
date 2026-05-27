import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CHIEF_STAGES,
  emit,
  readEvents,
  latestStageForTurn,
  type ChiefStage,
} from "../src/util/chief-stage-events.js";

function mkOrgRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-chief-stage-"));
}

test("CHIEF_STAGES enumerates the 6+1 stages in order", () => {
  assert.deepEqual([...CHIEF_STAGES], [
    "TRIAGE",
    "DECOMPOSE",
    "DISPATCH",
    "AWAIT",
    "SYNTHESIZE",
    "DECIDE",
    "RETROSPECT",
  ]);
});

test("emit creates the file + dir on first write", () => {
  const orgRoot = mkOrgRoot();
  emit({ orgRoot }, { turn_id: "t1", stage: "TRIAGE", detail: "first turn" });
  const file = path.join(orgRoot, "memory", "chief-stage-events.jsonl");
  assert.ok(fs.existsSync(file));
});

test("emit + readEvents round-trips all fields", () => {
  const orgRoot = mkOrgRoot();
  emit(
    { orgRoot },
    {
      turn_id: "t1",
      stage: "DISPATCH",
      task_id: "task-001",
      detail: "PM + engineer",
      dispatched: ["pm", "engineer"],
      skills_used: ["triage"],
    }
  );
  const events = readEvents({ orgRoot });
  assert.equal(events.length, 1);
  const e = events[0];
  assert.ok(e);
  assert.equal(e.turn_id, "t1");
  assert.equal(e.stage, "DISPATCH");
  assert.equal(e.task_id, "task-001");
  assert.deepEqual(e.dispatched, ["pm", "engineer"]);
  assert.deepEqual(e.skills_used, ["triage"]);
});

test("readEvents filters by turn_id", () => {
  const orgRoot = mkOrgRoot();
  emit({ orgRoot }, { turn_id: "t1", stage: "TRIAGE" });
  emit({ orgRoot }, { turn_id: "t2", stage: "TRIAGE" });
  emit({ orgRoot }, { turn_id: "t1", stage: "DECOMPOSE" });
  const t1 = readEvents({ orgRoot }, { turn_id: "t1" });
  assert.equal(t1.length, 2);
  assert.equal(t1.every((e) => e.turn_id === "t1"), true);
});

test("readEvents filters by stage", () => {
  const orgRoot = mkOrgRoot();
  emit({ orgRoot }, { turn_id: "t1", stage: "TRIAGE" });
  emit({ orgRoot }, { turn_id: "t1", stage: "DECOMPOSE" });
  emit({ orgRoot }, { turn_id: "t2", stage: "TRIAGE" });
  const triages = readEvents({ orgRoot }, { stage: "TRIAGE" });
  assert.equal(triages.length, 2);
});

test("readEvents skips malformed lines", () => {
  const orgRoot = mkOrgRoot();
  emit({ orgRoot }, { turn_id: "t1", stage: "TRIAGE" });
  const file = path.join(orgRoot, "memory", "chief-stage-events.jsonl");
  fs.appendFileSync(file, "{not valid}\n\n", "utf8");
  emit({ orgRoot }, { turn_id: "t1", stage: "DECOMPOSE" });
  const events = readEvents({ orgRoot });
  assert.equal(events.length, 2);
});

test("readEvents skips entries with unknown stage", () => {
  const orgRoot = mkOrgRoot();
  emit({ orgRoot }, { turn_id: "t1", stage: "TRIAGE" });
  const file = path.join(orgRoot, "memory", "chief-stage-events.jsonl");
  fs.appendFileSync(
    file,
    JSON.stringify({ ts: "2026-05-27T00:00:00Z", turn_id: "x", stage: "BOGUS" }) +
      "\n",
    "utf8"
  );
  const events = readEvents({ orgRoot });
  assert.equal(events.length, 1);
});

test("latestStageForTurn returns null for unknown turn", () => {
  const orgRoot = mkOrgRoot();
  assert.equal(latestStageForTurn({ orgRoot }, "ghost"), null);
});

test("latestStageForTurn returns the most recent stage in order", () => {
  const orgRoot = mkOrgRoot();
  const stages: ChiefStage[] = ["TRIAGE", "DECOMPOSE", "DISPATCH", "AWAIT"];
  for (const stage of stages) {
    emit({ orgRoot }, { turn_id: "t1", stage });
  }
  // Another turn in between shouldn't affect t1's resume point.
  emit({ orgRoot }, { turn_id: "t-other", stage: "SYNTHESIZE" });
  assert.equal(latestStageForTurn({ orgRoot }, "t1"), "AWAIT");
});
