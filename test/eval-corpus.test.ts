import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scoreTrigger,
  splitTrainVal,
  scoreOutputAB,
  type TriggerResult,
  type OutputCaseResult,
} from "../src/analyze/eval-corpus.js";

/** v1.3.6 §3.3 — eval scoring (deterministic bookkeeping) tests. */

function trig(should: boolean, triggered: boolean): TriggerResult {
  return { query: "q", should, triggered };
}

test("scoreTrigger: passes when should fires and should-NOT stays quiet", () => {
  const r = scoreTrigger([
    trig(true, true),
    trig(true, true),
    trig(true, false), // 2/3 should fired = 0.67 > 0.5
    trig(false, false),
    trig(false, false),
    trig(false, true), // 1/3 should-NOT fired = 0.33 < 0.5
  ]);
  assert.ok(r.passShould);
  assert.ok(r.passShouldNot);
  assert.ok(r.pass);
});

test("scoreTrigger: fails when should-NOT fires too often", () => {
  const r = scoreTrigger([
    trig(true, true),
    trig(false, true),
    trig(false, true), // 2/2 should-NOT fired = 1.0 ≥ 0.5
  ]);
  assert.equal(r.passShouldNot, false);
  assert.equal(r.pass, false);
});

test("splitTrainVal: deterministic for a given seed, ratio respected", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const a = splitTrainVal(items, 0.6, 42);
  const b = splitTrainVal(items, 0.6, 42);
  assert.deepEqual(a.train, b.train);
  assert.deepEqual(a.val, b.val);
  assert.equal(a.train.length, 12);
  assert.equal(a.val.length, 8);
  // every item appears exactly once across the split
  assert.deepEqual([...a.train, ...a.val].sort((x, y) => x - y), items);
});

test("splitTrainVal: different seeds give different orderings", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  assert.notDeepEqual(splitTrainVal(items, 0.6, 1).train, splitTrainVal(items, 0.6, 2).train);
});

test("scoreOutputAB: pass + cost deltas", () => {
  const results: OutputCaseResult[] = [
    { id: "a", withSkillPass: true, withoutSkillPass: false, tokensWith: 1200, tokensWithout: 1000, durationMsWith: 5000, durationMsWithout: 4000 },
    { id: "b", withSkillPass: true, withoutSkillPass: true, tokensWith: 800, tokensWithout: 600, durationMsWith: 3000, durationMsWithout: 2000 },
  ];
  const s = scoreOutputAB(results);
  assert.equal(s.passRateWith, 1);
  assert.equal(s.passRateWithout, 0.5);
  assert.equal(s.passDelta, 0.5);
  assert.equal(s.tokenDelta, 200);
  assert.equal(s.durationMsDelta, 1000);
  assert.equal(s.n, 2);
});

test("scoreOutputAB: empty input is safe", () => {
  const s = scoreOutputAB([]);
  assert.equal(s.n, 0);
  assert.equal(s.passDelta, 0);
});
