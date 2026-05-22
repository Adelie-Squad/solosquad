import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * v1.0.3 — `solosquad update` post-install next-step regression catcher.
 *
 * Pre-v1.0.3 the update command only printed "✓ Updated successfully!"
 * + "Run `solosquad doctor` to verify." even when the workspace
 * `workspace.yaml.version` was behind the freshly-installed CLI. Users
 * had to make a second round-trip (`solosquad doctor`) to learn that
 * `solosquad migrate --apply` was the actual next step. v1.0.3 surfaces
 * that hint inline.
 *
 * Source-level catcher — exercising the interactive readline / execSync
 * branch in a unit test requires more harness than the fix justifies.
 */

const UPDATE_PATH = path.resolve(process.cwd(), "src/cli/update.ts");

test("v1.0.3 — update.ts checks workspace version lag after install", () => {
  const src = fs.readFileSync(UPDATE_PATH, "utf-8");
  // Must call detectWorkspaceVersion after the install completes (not just
  // the pre-install warn block at the top of updateCommand).
  const installIdx = src.indexOf("Updated successfully");
  assert.ok(installIdx > 0, "expected 'Updated successfully' marker in update.ts");
  const afterInstall = src.slice(installIdx);
  assert.match(
    afterInstall,
    /detectWorkspaceVersion/,
    "update.ts must call detectWorkspaceVersion AFTER install (not just before)",
  );
});

test("v1.0.3 — update.ts surfaces 'solosquad migrate --apply' as next-step when workspace lags", () => {
  const src = fs.readFileSync(UPDATE_PATH, "utf-8");
  const installIdx = src.indexOf("Updated successfully");
  const afterInstall = src.slice(installIdx);
  assert.match(
    afterInstall,
    /solosquad migrate --apply/,
    "update.ts post-install branch must mention 'solosquad migrate --apply' explicitly",
  );
  // The hint must be conditional on workspace lag (not always emitted)
  assert.match(
    afterInstall,
    /isNewer\s*\(\s*latest/,
    "post-install hint must be gated on isNewer(latest, workspaceVersionAfter)",
  );
});
