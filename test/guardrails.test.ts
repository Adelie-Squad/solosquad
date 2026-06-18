import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GUARDRAIL_KEYS,
  hasAnyGuardrail,
  iterationCapReached,
  budgetStatus,
  LoopDetector,
} from "../src/util/guardrails.js";

test("hasAnyGuardrail: true only when a known key is present on an object", () => {
  assert.equal(hasAnyGuardrail({ max_iterations: 5 }), true);
  assert.equal(hasAnyGuardrail({ budget_usd: 1 }), true);
  assert.equal(hasAnyGuardrail({ loop_detection: true }), true);
  assert.equal(hasAnyGuardrail({ unrelated: 1 }), false);
  assert.equal(hasAnyGuardrail(null), false);
  assert.equal(hasAnyGuardrail([1, 2]), false);
  assert.equal(hasAnyGuardrail("max_iterations"), false);
});

test("GUARDRAIL_KEYS is the canonical set", () => {
  assert.deepEqual([...GUARDRAIL_KEYS], ["max_iterations", "budget_usd", "loop_detection"]);
});

test("iterationCapReached", () => {
  assert.equal(iterationCapReached(2, 3), false);
  assert.equal(iterationCapReached(3, 3), true);
  assert.equal(iterationCapReached(4, 3), true);
  assert.equal(iterationCapReached(99, Infinity), false); // no cap
});

test("budgetStatus: warning band then exceeded", () => {
  assert.deepEqual(budgetStatus(5, 10), { exceeded: false, warning: false });
  assert.deepEqual(budgetStatus(9, 10), { exceeded: false, warning: true }); // >=90%
  assert.deepEqual(budgetStatus(10, 10), { exceeded: true, warning: false });
  assert.deepEqual(budgetStatus(100, 0), { exceeded: false, warning: false }); // disabled
  assert.deepEqual(budgetStatus(8, 10, 0.5), { exceeded: false, warning: true }); // custom band
});

test("LoopDetector: trips when the window is all-identical (whitespace-insensitive)", () => {
  const d = new LoopDetector(3);
  assert.equal(d.record("step A"), false);
  assert.equal(d.record("step  A"), false); // collapses to same, but window not full
  assert.equal(d.record("step\tA"), true); // 3 identical (normalized) → loop
  assert.equal(d.record("step B"), false); // breaks the streak
  assert.equal(d.record("step B"), false);
  assert.equal(d.record("step B"), true); // new 3-streak
});

test("LoopDetector: distinct outputs never trip; reset clears", () => {
  const d = new LoopDetector(2);
  assert.equal(d.record("a"), false);
  assert.equal(d.record("b"), false);
  assert.equal(d.record("b"), true);
  d.reset();
  assert.equal(d.record("b"), false); // window cleared
});

test("LoopDetector: window < 2 is rejected", () => {
  assert.throws(() => new LoopDetector(1));
});
