import { test } from "node:test";
import assert from "node:assert/strict";

import { warnDeprecated, warnDeprecatedOnce } from "../src/util/deprecation.js";

/**
 * v0.8.4 §10 — Deprecation warning helper behavior.
 *
 * Verifies that:
 *   1. `warnDeprecated` writes the new-flag suggestion to stderr.
 *   2. `SOLOSQUAD_NO_DEPRECATION_WARN=1` silences the helper entirely.
 *   3. `warnDeprecatedOnce` dedupes within a single process.
 *
 * The CLI deprecation paths themselves (uninstall, import, add repo, migrate)
 * are exercised in integration form by the existing per-command tests; this
 * suite is the focused unit check for the helper they share.
 */

/* Helper — capture stderr writes during a callback. */
function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let captured = "";
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (
    chunk: string,
  ) => {
    captured += chunk;
    return true;
  };
  try {
    fn();
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
  }
  return captured;
}

test("warnDeprecated emits old → new flag suggestion to stderr", () => {
  delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  const out = captureStderr(() => {
    warnDeprecated({ oldName: "--archive-only", newName: "--mode archive-only" });
  });
  assert.match(out, /\[deprecated\]/);
  assert.match(out, /--archive-only/);
  assert.match(out, /--mode archive-only/);
});

test("warnDeprecated honors SOLOSQUAD_NO_DEPRECATION_WARN", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    const out = captureStderr(() => {
      warnDeprecated({ oldName: "--keep-workspace", newName: "--mode keep" });
    });
    assert.equal(out, "");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("warnDeprecated includes removal version in the message", () => {
  delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  const out = captureStderr(() => {
    warnDeprecated({
      oldName: "--inspect",
      newName: "--dry-run",
      removalVersion: "v1.0",
    });
  });
  assert.match(out, /v1\.0/);
});

test("warnDeprecated emits the optional hint line on its own row", () => {
  delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  const out = captureStderr(() => {
    warnDeprecated({
      oldName: "--also-purge-backups",
      newName: "solosquad backup purge",
      hint: "Run separately for clearer ownership.",
    });
  });
  assert.match(out, /clearer ownership/);
});

test("warnDeprecatedOnce only fires the first time for a given oldName", () => {
  delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  // Reset is not exposed — use a unique oldName to keep this test isolated.
  const unique = `--test-flag-${Date.now()}`;
  const first = captureStderr(() => {
    warnDeprecatedOnce({ oldName: unique, newName: "--new" });
  });
  const second = captureStderr(() => {
    warnDeprecatedOnce({ oldName: unique, newName: "--new" });
  });
  assert.match(first, /\[deprecated\]/);
  assert.equal(second, "", "second call must not emit (dedupe)");
});
