import { test } from "node:test";
import assert from "node:assert/strict";

import { MIGRATIONS, findRegistryGaps, resolveChain } from "../src/migrations/index.js";
import { SOLOSQUAD_VERSION } from "../src/util/version.js";

/**
 * Registry-continuity guard — the systemic catcher for the v1.3.x footgun.
 *
 * Background: the 1.3.0/1.3.1/1.3.2 line shipped without a migration whose
 * `from` matched `1.2.9`, so `resolveChain("1.2.9", <latest>)` threw
 * "No migration found for source version 1.2.9" and every upgraded workspace
 * was stuck. The per-version unit tests didn't catch it because each migration
 * passed in isolation — the gap was *between* them.
 *
 * This test asserts the chain is continuous as a whole: every version a
 * workspace can be stamped with (= every migration's `to`) must walk all the
 * way to the current CLI version. If a future release adds a migration but
 * forgets the entry that consumes its `to`, this fails in CI instead of in a
 * user's `solosquad migrate`.
 */

test("migration registry has no dead-end versions (continuity)", () => {
  const gaps = findRegistryGaps(SOLOSQUAD_VERSION);
  assert.deepEqual(
    gaps,
    [],
    `Migration chain dead-ends at: ${gaps.join(", ")}. ` +
      `Each version listed is a migration \`to\` with no successor whose \`from\` ` +
      `matches it (and it is not the latest version ${SOLOSQUAD_VERSION}). ` +
      `Add a migration \`from\` that version — see src/migrations/scripts/1.2.9-to-1.3.2.ts ` +
      `for the pattern.`,
  );
});

test("every landing version resolves a chain to the current CLI version", () => {
  for (const m of MIGRATIONS) {
    // m.to is always a concrete version (never an ".x" spec).
    assert.doesNotThrow(
      () => resolveChain(m.to, SOLOSQUAD_VERSION),
      `resolveChain("${m.to}", "${SOLOSQUAD_VERSION}") threw — ` +
        `the chain cannot reach the current CLI version from ${m.to}.`,
    );
  }
});

test("regression: 1.2.9 reaches both 1.3.2 and 1.3.3", () => {
  // The exact bug report: `solosquad migrate` from a 1.2.9 workspace.
  assert.doesNotThrow(() => resolveChain("1.2.9", "1.3.2"));
  assert.doesNotThrow(() => resolveChain("1.2.9", "1.3.3"));

  const chainTo132 = resolveChain("1.2.9", "1.3.2").map((m) => `${m.from} → ${m.to}`);
  assert.deepEqual(chainTo132, ["1.2.9 → 1.3.2"]);

  const chainTo133 = resolveChain("1.2.9", "1.3.3").map((m) => `${m.from} → ${m.to}`);
  assert.deepEqual(chainTo133, ["1.2.9 → 1.3.2", "1.3.2 → 1.3.3"]);
});
