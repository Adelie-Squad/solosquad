import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyBatch,
  pickWinner,
  type ClassifierCaller,
  type ClassifierInput,
  type RawScore,
} from "../src/analyze/classifier.js";

/**
 * v0.5 §6.2 — classifier priority, ambiguity gate, batching.
 */

function mockCaller(plan: RawScore[][]): ClassifierCaller {
  let cursor = 0;
  const caller: ClassifierCaller = {
    call_count: 0,
    async classify(batch: ClassifierInput[]): Promise<RawScore[][]> {
      caller.call_count = (caller.call_count ?? 0) + 1;
      const out: RawScore[][] = [];
      for (let i = 0; i < batch.length; i++) {
        out.push(plan[cursor++] ?? [{ label: "role", confidence: 0.5 }]);
      }
      return out;
    },
  };
  return caller;
}

test("pickWinner: highest confidence wins outright", () => {
  const winner = pickWinner([
    { label: "role", confidence: 0.4 },
    { label: "workflow", confidence: 0.9 },
    { label: "domain", confidence: 0.5 },
  ]);
  assert.equal(winner.label, "workflow");
});

test("pickWinner: priority order codebase-fact > domain > workflow > role on equal confidence", () => {
  const winner = pickWinner([
    { label: "role", confidence: 0.5 },
    { label: "workflow", confidence: 0.5 },
    { label: "domain", confidence: 0.5 },
    { label: "codebase-fact", confidence: 0.5 },
  ]);
  assert.equal(winner.label, "codebase-fact");

  const winner2 = pickWinner([
    { label: "role", confidence: 0.3 },
    { label: "domain", confidence: 0.3 },
    { label: "workflow", confidence: 0.3 },
  ]);
  assert.equal(winner2.label, "domain");
});

test("classifier marks ambiguous when winner < 0.7", async () => {
  const caller = mockCaller([
    [
      { label: "role", confidence: 0.55 },
      { label: "workflow", confidence: 0.45 },
    ],
  ]);
  const out = await classifyBatch(
    [{ path: "x.md", body: "..." }],
    { caller }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "role");
  assert.equal(out[0].ambiguous, true);
  assert.equal(out[0].confidence, 0.55);
});

test("classifier does NOT mark ambiguous when winner >= 0.7", async () => {
  const caller = mockCaller([
    [
      { label: "codebase-fact", confidence: 0.88 },
      { label: "domain", confidence: 0.12 },
    ],
  ]);
  const out = await classifyBatch(
    [{ path: "x.md", body: "..." }],
    { caller }
  );
  assert.equal(out[0].label, "codebase-fact");
  assert.equal(out[0].ambiguous, false);
});

test("classifier batches inputs — one caller invocation per ≤N items", async () => {
  const caller = mockCaller(
    Array.from({ length: 20 }, () => [
      { label: "role" as const, confidence: 0.8 },
    ])
  );
  const inputs: ClassifierInput[] = Array.from({ length: 20 }, (_, i) => ({
    path: `f${i}.md`,
    body: "act as a strategist",
  }));
  await classifyBatch(inputs, { caller, batch_size: 5 });
  // 20 / 5 = 4 calls
  assert.equal(caller.call_count, 4);
});
