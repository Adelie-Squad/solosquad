import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareSemver,
  recommendForVersionMismatch,
} from "../src/cli/doctor.js";

/**
 * v0.8.3 §7.3 — doctor CLI ↔ workspace mismatch tests.
 *
 * The recommendation table:
 *   CLI > workspace  → "solosquad migrate --apply"
 *   CLI < workspace  → "npm install -g solosquad@latest" (or update)
 *   CLI == workspace → ok
 */

test("compareSemver basic ordering", () => {
  assert.equal(compareSemver("0.8.3", "0.8.3"), 0);
  assert.ok(compareSemver("0.8.3", "0.8.2") > 0);
  assert.ok(compareSemver("0.8.2", "0.8.3") < 0);
  assert.ok(compareSemver("1.0.0", "0.9.9") > 0);
});

test("compareSemver ignores pre-release labels", () => {
  // Both treated as 0.8.3 for the comparison
  assert.equal(compareSemver("0.8.3-rc.1", "0.8.3"), 0);
  assert.ok(compareSemver("0.9.0-beta", "0.8.9") > 0);
});

test("recommendForVersionMismatch: equal versions → ok", () => {
  const rec = recommendForVersionMismatch("0.8.3", "0.8.3");
  assert.equal(rec.kind, "ok");
});

test("recommendForVersionMismatch: CLI newer than workspace → migrate", () => {
  const rec = recommendForVersionMismatch("0.8.3", "0.7.0");
  assert.equal(rec.kind, "migrate");
  if (rec.kind === "migrate") {
    assert.equal(rec.cliVersion, "0.8.3");
    assert.equal(rec.workspaceVersion, "0.7.0");
  }
});

test("recommendForVersionMismatch: CLI older than workspace → update", () => {
  const rec = recommendForVersionMismatch("0.6.0", "0.7.0");
  assert.equal(rec.kind, "update");
  if (rec.kind === "update") {
    assert.equal(rec.cliVersion, "0.6.0");
    assert.equal(rec.workspaceVersion, "0.7.0");
  }
});

test("recommendForVersionMismatch: tied patch versions are ok", () => {
  const rec = recommendForVersionMismatch("0.8.3", "0.8.3");
  assert.equal(rec.kind, "ok");
});
