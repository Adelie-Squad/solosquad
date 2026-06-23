import { test } from "node:test";
import assert from "node:assert/strict";

import {
  acceptEdit,
  editsRemaining,
  mayStopEarly,
  RejectedEditBuffer,
  runRefineGate,
  DEFAULT_EDIT_BUDGET,
} from "../src/analyze/refine-gate.js";

/** v1.3.6 §3.5① — self-improvement gate (deterministic) tests. */

test("acceptEdit: strict improvement only (ties + regressions reject)", () => {
  assert.equal(acceptEdit(0.7, 0.71), true);
  assert.equal(acceptEdit(0.7, 0.7), false);
  assert.equal(acceptEdit(0.7, 0.69), false);
});

test("edit budget: Lt=4 max, floor 2", () => {
  assert.equal(editsRemaining(3, DEFAULT_EDIT_BUDGET), true);
  assert.equal(editsRemaining(4, DEFAULT_EDIT_BUDGET), false);
  assert.equal(mayStopEarly(1, DEFAULT_EDIT_BUDGET), false);
  assert.equal(mayStopEarly(2, DEFAULT_EDIT_BUDGET), true);
});

test("RejectedEditBuffer: records worst drop, reports rejection", () => {
  const b = new RejectedEditBuffer();
  b.record("e1", 0.05);
  b.record("e1", 0.12); // keep the worse drop
  assert.ok(b.isRejected("e1"));
  assert.equal(b.dropFor("e1"), 0.12);
  assert.equal(b.isRejected("e2"), false);
  assert.equal(b.size, 1);
});

test("runRefineGate: accepts improving edits, rejects regressions, keeps best", () => {
  const out = runRefineGate(0.6, [
    { editId: "a", score: 0.65 }, // accept → best 0.65
    { editId: "b", score: 0.62 }, // reject (below best) → buffer
    { editId: "c", score: 0.7 }, // accept → best 0.70
  ]);
  assert.equal(out.bestScore, 0.7);
  assert.deepEqual(out.steps.map((s) => s.accepted), [true, false, true]);
  assert.ok(out.rejected.isRejected("b"));
});

test("runRefineGate: skips known-rejected edits and respects budget", () => {
  // 5 candidates but Lt=4 → at most 4 consume budget; a duplicate of a rejected
  // edit is skipped without consuming budget.
  const out = runRefineGate(0.5, [
    { editId: "x", score: 0.45 }, // reject
    { editId: "x", score: 0.45 }, // skipped (already rejected) — no budget used
    { editId: "p", score: 0.55 }, // accept
    { editId: "q", score: 0.56 }, // accept
    { editId: "r", score: 0.57 }, // accept
    { editId: "s", score: 0.58 }, // budget exhausted (4 used) → not reached
  ]);
  assert.equal(out.steps.length, 4);
  assert.ok(!out.steps.some((s) => s.editId === "s"));
  assert.equal(out.bestScore, 0.57);
});
