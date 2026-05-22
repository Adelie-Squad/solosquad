import { test } from "node:test";
import assert from "node:assert/strict";
import { versionMatches } from "../src/migrations/detect.js";

/**
 * v1.0.3 — versionMatches slice-arithmetic regression catcher.
 *
 * Pre-v1.0.3 `versionMatches("X.Y.Z.x", "X.Y.Z")` returned false because
 * `spec.slice(0, -1)` produced "X.Y.Z." (with trailing dot) and the
 * detected "X.Y.Z" did not `startsWith` that prefix. This silently broke
 * patch-level migrations (1.0.0→1.0.1, 1.0.1→1.0.2, etc.) since their
 * `from` patterns use the `X.Y.Z.x` form.
 *
 * The fix also accepts the exact base (`spec.slice(0, -2)`), so both
 * "X.Y.Z" (exact) and "X.Y.Z.something" (legacy 4-segment) match.
 */

test("v1.0.3 — X.Y.Z.x pattern matches exact X.Y.Z (the v1.0.0 → 1.0.x bug)", () => {
  assert.equal(versionMatches("1.0.0.x", "1.0.0"), true);
  assert.equal(versionMatches("1.0.1.x", "1.0.1"), true);
  assert.equal(versionMatches("1.0.2.x", "1.0.2"), true);
});

test("v1.0.3 — X.Y.Z.x pattern still matches X.Y.Z.<extra> for legacy 4-segment", () => {
  assert.equal(versionMatches("1.0.0.x", "1.0.0.5"), true);
  assert.equal(versionMatches("0.8.2.x", "0.8.2.1"), true);
});

test("v1.0.3 — pre-existing X.Y.x minor-loose pattern still works (no regression)", () => {
  assert.equal(versionMatches("0.1.x", "0.1.0"), true);
  assert.equal(versionMatches("0.1.x", "0.1.5"), true);
  assert.equal(versionMatches("0.5.x", "0.5.0"), true);
});

test("v1.0.3 — X.Y.x also matches X.Y exact (consistent with the fix)", () => {
  assert.equal(versionMatches("0.1.x", "0.1"), true);
});

test("v1.0.3 — exact-only patterns still match strictly (no false positives)", () => {
  assert.equal(versionMatches("0.2.0", "0.2.0"), true);
  assert.equal(versionMatches("0.2.0", "0.2.1"), false);
  assert.equal(versionMatches("1.0.0", "1.0.1"), false);
});
