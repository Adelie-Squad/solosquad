import { test } from "node:test";
import assert from "node:assert/strict";

import { usdFromUsage, supportedModels } from "../src/util/cost.js";

/**
 * v0.5 §5.6 — token usage → USD conversion.
 *
 * Anthropic 2026 list pricing:
 *   opus-4-7    input $15 / output $75
 *   sonnet-4-6  input  $3 / output $15
 *   haiku-4-5   input $0.80 / output $4
 * Cache: creation 1.25× base input, read 0.10× base input.
 *
 * All math is per 1M tokens.
 */

test("opus-4-7 pricing matches list rates", () => {
  // 1M input + 1M output = $15 + $75 = $90
  const usd = usdFromUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "opus-4-7");
  assert.equal(Math.round(usd * 100) / 100, 90);
});

test("sonnet-4-6 pricing matches list rates", () => {
  const usd = usdFromUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "sonnet-4-6");
  assert.equal(Math.round(usd * 100) / 100, 18);
});

test("haiku-4-5 pricing matches list rates", () => {
  const usd = usdFromUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "haiku-4-5");
  assert.equal(Math.round(usd * 100) / 100, 4.8);
});

test("zero usage produces zero cost (all three models)", () => {
  for (const m of supportedModels()) {
    assert.equal(usdFromUsage({ input_tokens: 0, output_tokens: 0 }, m), 0);
  }
});

test("cache_creation_input_tokens charged at 1.25× base input", () => {
  // Sonnet input $3/MTok → cache create 1.25× → $3.75/MTok.
  // 100k cache_creation → 100000 / 1M × $3.75 = $0.375.
  const usd = usdFromUsage(
    { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100_000 },
    "sonnet-4-6",
  );
  assert.ok(Math.abs(usd - 0.375) < 1e-9, `got ${usd}`);
});

test("cache_read_input_tokens charged at 0.1× base input", () => {
  // Opus input $15/MTok → cache read 0.10× → $1.50/MTok.
  // 200k cache_read → 200000 / 1M × $1.50 = $0.30.
  const usd = usdFromUsage(
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 200_000 },
    "opus-4-7",
  );
  assert.ok(Math.abs(usd - 0.3) < 1e-9, `got ${usd}`);
});

test("large usage with mixed components (opus) sums correctly", () => {
  // 500k input × $15/MTok = $7.50
  // 250k output × $75/MTok = $18.75
  // 100k cache create × ($15 × 1.25 / MTok) = 100000 × 0.00001875 = $1.875
  // 50k cache read × ($15 × 0.1 / MTok) = 50000 × 0.0000015 = $0.075
  // total = $28.20
  const usd = usdFromUsage(
    {
      input_tokens: 500_000,
      output_tokens: 250_000,
      cache_creation_input_tokens: 100_000,
      cache_read_input_tokens: 50_000,
    },
    "opus-4-7",
  );
  assert.ok(Math.abs(usd - 28.2) < 1e-6, `got ${usd}`);
});
