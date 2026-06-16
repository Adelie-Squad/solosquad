import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildStageNarration,
  formatStageEvent,
  narrationLinesAsStrings,
} from "../src/messenger/discord-narration.js";
import {
  emit,
  type ChiefStageEvent,
} from "../src/util/chief-stage-events.js";

function tempOrg(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-narration-"));
}

function appendEvents(
  orgRoot: string,
  events: Omit<ChiefStageEvent, "ts">[],
): void {
  for (const e of events) {
    emit({ orgRoot }, e);
  }
}

test("buildStageNarration — formats DISPATCH with sub-agent list + parallel hint", () => {
  const orgRoot = tempOrg();
  appendEvents(orgRoot, [
    { turn_id: "t1", stage: "TRIAGE", detail: "user_message_in" },
    {
      turn_id: "t1",
      stage: "DISPATCH",
      dispatched: ["pm", "engineer"],
    },
  ]);
  const lines = buildStageNarration(orgRoot, "t1");
  const strings = narrationLinesAsStrings(lines);
  assert.deepEqual(strings, ["📤 dispatch: pm, engineer (병렬 2)"]);
});

test("buildStageNarration — single dispatched agent → no parallel suffix", () => {
  const orgRoot = tempOrg();
  appendEvents(orgRoot, [
    { turn_id: "t1", stage: "DISPATCH", dispatched: ["pm"] },
  ]);
  assert.deepEqual(narrationLinesAsStrings(buildStageNarration(orgRoot, "t1")), [
    "📤 dispatch: pm",
  ]);
});

test("buildStageNarration — DECOMPOSE always projects a fixed line", () => {
  const orgRoot = tempOrg();
  appendEvents(orgRoot, [{ turn_id: "t1", stage: "DECOMPOSE" }]);
  assert.deepEqual(narrationLinesAsStrings(buildStageNarration(orgRoot, "t1")), [
    "🗂 작업 분해 중...",
  ]);
});

test("buildStageNarration — AWAIT projects only when detail mentions open_question", () => {
  const orgRoot = tempOrg();
  appendEvents(orgRoot, [
    {
      turn_id: "t1",
      stage: "AWAIT",
      detail: "open_questions=2",
    },
    {
      turn_id: "t1",
      stage: "AWAIT",
      detail: "child_spawn_running",
    },
  ]);
  assert.deepEqual(narrationLinesAsStrings(buildStageNarration(orgRoot, "t1")), [
    "❓ open_questions=2",
  ]);
});

test("buildStageNarration — TRIAGE/SYNTHESIZE/DECIDE/RETROSPECT are skipped (Chief reply covers them)", () => {
  const orgRoot = tempOrg();
  for (const stage of ["TRIAGE", "SYNTHESIZE", "DECIDE", "RETROSPECT"] as const) {
    appendEvents(orgRoot, [{ turn_id: "t-x", stage, detail: "ignored" }]);
  }
  assert.deepEqual(narrationLinesAsStrings(buildStageNarration(orgRoot, "t-x")), []);
});

test("buildStageNarration — skills_used appended as bullet follow-on under each stage", () => {
  const orgRoot = tempOrg();
  appendEvents(orgRoot, [
    {
      turn_id: "t1",
      stage: "DISPATCH",
      dispatched: ["pm"],
      skills_used: ["discovery-synthesis", "problem-definition"],
    },
  ]);
  assert.deepEqual(narrationLinesAsStrings(buildStageNarration(orgRoot, "t1")), [
    "📤 dispatch: pm",
    "  ↳ discovery-synthesis, problem-definition",
  ]);
});

test("buildStageNarration — filters by turn_id (other turns ignored)", () => {
  const orgRoot = tempOrg();
  appendEvents(orgRoot, [
    { turn_id: "t1", stage: "DISPATCH", dispatched: ["pm"] },
    { turn_id: "t2", stage: "DISPATCH", dispatched: ["engineer"] },
  ]);
  assert.deepEqual(narrationLinesAsStrings(buildStageNarration(orgRoot, "t2")), [
    "📤 dispatch: engineer",
  ]);
});

test("buildStageNarration — returns [] when the jsonl doesn't exist yet (no events emitted)", () => {
  const orgRoot = tempOrg();
  assert.deepEqual(buildStageNarration(orgRoot, "t-missing"), []);
});

// v1.3.0 Part C (P0) — the live path calls formatStageEvent per event directly
// (not via the file-reading buildStageNarration). Lock the single-event
// contract so live narration renders identically to the batch projection.
test("formatStageEvent — projects DISPATCH + skills_used follow-on, drops non-projected stages", () => {
  const dispatch: ChiefStageEvent = {
    ts: "2026-06-16T00:00:00Z",
    turn_id: "t1",
    stage: "DISPATCH",
    dispatched: ["pm", "engineer"],
    skills_used: ["discovery-synthesis"],
  };
  assert.deepEqual(
    formatStageEvent(dispatch).map((l) => l.text),
    ["📤 dispatch: pm, engineer (병렬 2)", "  ↳ discovery-synthesis"],
  );

  // Non-projected stages and a no-open-question AWAIT yield nothing.
  assert.deepEqual(
    formatStageEvent({ ts: "x", turn_id: "t1", stage: "SYNTHESIZE" }),
    [],
  );
  assert.deepEqual(
    formatStageEvent({ ts: "x", turn_id: "t1", stage: "AWAIT", detail: "spawn_count=2" }),
    [],
  );
});
