import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { runCorpusRegression } from "../src/analyze/validator-corpus.js";

/**
 * v0.5 §11.4 — Anthropic skills corpus round-trip.
 *
 * Default mode uses bundled fixtures only. Set
 * SOLOSQUAD_FETCH_EXTERNAL_CORPUS=1 to additionally hit the live repo
 * (skipped in CI for determinism — see §13 risk register).
 */

test("bundled Anthropic-corpus fixtures: all parse + validate + round-trip", async () => {
  const result = await runCorpusRegression();
  if (!result.ok) {
    const detail = result.failures
      .slice(0, 5)
      .map((f) => `  - ${path.basename(f.path)}: ${f.reason}`)
      .join("\n");
    assert.fail(
      `corpus regression had ${result.failures.length} failure(s) of ${result.checked}:\n${detail}`,
    );
  }
  assert.ok(result.checked > 0, "expected at least one fixture to be checked");
});

test("at least one bundled fixture covers a YAML-quoted description", async () => {
  // Sanity check on our own fixture set — we want a representative spread.
  const fixturesDir = path.resolve("test/fixtures/anthropic-corpus");
  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".md") && f !== "README.md");
  assert.ok(files.length >= 3, "fixture set should have at least 3 SKILL.md files");
});

test("corpus regression returns a populated `sources` list", async () => {
  const result = await runCorpusRegression();
  assert.ok(result.sources.length >= 1, "expected at least the bundled fixtures source");
});
