import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOLOSQUAD_VERSION } from "../src/util/version.js";

/**
 * v0.8.7 §2 — regression catcher for the v0.8.6 hotfix class.
 *
 * Background: v0.8.6 fixed `src/cli/migrate.ts:8`'s `CLI_VERSION_TARGET =
 * "0.4.0"` hardcode, which had silently made `solosquad migrate` (without
 * `--to`) a no-op for ~1 year. The fix replaced the literal with
 * `SOLOSQUAD_VERSION` imported from `src/util/version.ts`. This test guards
 * against the same class of regression returning — if anyone hardcodes a
 * version literal as the default again, this fails immediately.
 *
 * Scope is intentionally narrow: just `migrate.ts`. If the same pattern
 * shows up elsewhere later, add a sibling test for that file rather than
 * generalizing into a lint rule (per v0.8.7 plan §0 — no infrastructure).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrateTsPath = path.resolve(__dirname, "..", "src", "cli", "migrate.ts");

test("migrate.ts default target equals current CLI version (no stale constant)", () => {
  const migrateTs = fs.readFileSync(migrateTsPath, "utf-8");

  // (1) Must NOT contain a hardcoded version literal as the default target.
  assert.ok(
    !/CLI_VERSION_TARGET\s*=\s*"\d+\.\d+\.\d+"/.test(migrateTs),
    "migrate.ts must not hardcode CLI_VERSION_TARGET to a version literal — " +
      "use the SOLOSQUAD_VERSION import from ../util/version.js instead. " +
      "Background: docs/plan/v0.8.6-migrate-hotfix-pr-workflow.md §1.",
  );

  // (2) Must import SOLOSQUAD_VERSION from version.ts.
  assert.ok(
    /import\s*\{\s*SOLOSQUAD_VERSION\s*\}\s*from\s*["']\.\.\/util\/version\.js["']/.test(
      migrateTs,
    ),
    "migrate.ts must import SOLOSQUAD_VERSION from ../util/version.js so the " +
      "migrate default tracks the published CLI version.",
  );

  // (3) Resolved SOLOSQUAD_VERSION must be a non-empty semver string.
  assert.match(
    SOLOSQUAD_VERSION,
    /^\d+\.\d+\.\d+/,
    `SOLOSQUAD_VERSION must be semver (got ${JSON.stringify(SOLOSQUAD_VERSION)})`,
  );
});
