import { test } from "node:test";
import assert from "node:assert/strict";

import { validateProfileYaml } from "../scripts/skill-pr-review/profile-validator.js";

/**
 * v0.6 S6.B §11.5 — agent-profile.yaml PR validation.
 *
 * Reuses the production merger but promotes the budget-narrowing warning
 * to an error so a looser agent override is blocked at PR time (not just
 * snapped to the parent at runtime).
 */

test("schema_version=1 + clean defaults passes", () => {
  const yaml = `
schema_version: 1
defaults:
  tone: conservative
  budget:
    daily_usd: 5
business-strategist:
  emphasis: "한국 SMB"
  budget:
    daily_usd: 3
`;
  const r = validateProfileYaml(yaml);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("missing schema_version is a warning (not blocking)", () => {
  const yaml = `defaults:\n  tone: friendly\n`;
  const r = validateProfileYaml(yaml);
  assert.equal(r.ok, true);
  assert.ok(
    r.issues.some(
      (i) => i.severity === "warning" && /schema_version/.test(i.message),
    ),
    "schema_version warning emitted",
  );
});

test("schema_version=2 is a hard error", () => {
  const yaml = `schema_version: 2\ndefaults:\n  tone: x\n`;
  const r = validateProfileYaml(yaml);
  assert.equal(r.ok, false);
  assert.ok(
    r.issues.some(
      (i) => i.severity === "error" && /schema_version=2/.test(i.message),
    ),
  );
});

test("agent budget wider than defaults is a hard error (narrower-only invariant)", () => {
  const yaml = `
schema_version: 1
defaults:
  budget:
    daily_usd: 5
paid-marketer:
  budget:
    daily_usd: 10
`;
  const r = validateProfileYaml(yaml);
  assert.equal(r.ok, false, "wider override must fail");
  assert.ok(
    r.issues.some(
      (i) => i.severity === "error" && /exceeds parent cap/.test(i.message),
    ),
  );
});
