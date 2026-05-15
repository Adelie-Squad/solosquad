import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveImportMode } from "../src/cli/import-mode.js";

/**
 * v0.8.4 §5 — `--mode` matrix for `solosquad import`.
 *
 * Mirrors the uninstall matrix: legacy boolean aliases keep working with a
 * deprecation warning for one minor window; the new `--mode` flag is the
 * canonical surface. `null` signals "user error — exit non-zero".
 */

test("default mode is merge when nothing is passed", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveImportMode({}), "merge");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("--mode replace is honored", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveImportMode({ mode: "replace" }), "replace");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("legacy --replace resolves to replace", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveImportMode({ replace: true }), "replace");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("legacy --merge resolves to merge", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveImportMode({ merge: true }), "merge");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("--merge + --replace returns null (mutually exclusive)", () => {
  // Suppress the stderr "error: ..." line.
  const originalErr = console.error;
  console.error = () => {};
  try {
    assert.equal(resolveImportMode({ merge: true, replace: true }), null);
  } finally {
    console.error = originalErr;
  }
});
