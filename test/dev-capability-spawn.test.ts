import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyDevPermissions,
  READ_ONLY_ALLOWED_TOOLS,
  READ_ONLY_DISALLOWED_TOOLS,
  DEV_ENABLED_ALLOWED_TOOLS,
  type DevCapabilitySkillView,
} from "../src/bot/spawn-assembler.js";
import { DEFAULT_DEV_CAPABILITY_DENYLIST } from "../src/util/config.js";

/**
 * v0.8.2 §4 — applyDevPermissions resolves the SpawnDevPolicy.
 *
 * Coverage:
 *   - dev_capability: false (or missing) → read-only tools
 *   - dev_capability: true → Bash + Edit + Write enabled, allowlist passed
 *     through from SKILL frontmatter, workspace denylist merged on top
 *   - reason field marks the path taken (for log inspection)
 */

const skillFalse: DevCapabilitySkillView = {
  frontmatter: { dev_capability: false },
};

const skillTrue: DevCapabilitySkillView = {
  frontmatter: {
    dev_capability: true,
    dev_permissions: {
      bash: {
        allowed: ["git", "gh", "npm"],
        denied: ["pip install"],
      },
      network: false,
      push_targets: { requires_confirmation: true },
      merge: { auto: false },
    },
  },
};

test("dev_capability: false SKILL falls back to read-only tools", () => {
  const policy = applyDevPermissions(skillFalse, null);
  assert.deepEqual(policy.allowedTools, [...READ_ONLY_ALLOWED_TOOLS]);
  assert.deepEqual(policy.disallowedTools, [...READ_ONLY_DISALLOWED_TOOLS]);
  assert.equal(policy.bashAllowlist.length, 0);
  assert.equal(policy.reason, "read-only");
  // workspace default denylist still applies even in read-only mode (defense-in-depth)
  assert.ok(policy.bashDenylist.length > 0, "denylist should not be empty");
});

test("dev_capability: true SKILL gets Bash + allowlist passed through", () => {
  const policy = applyDevPermissions(skillTrue, null);
  assert.deepEqual(policy.allowedTools, [...DEV_ENABLED_ALLOWED_TOOLS]);
  assert.deepEqual(policy.disallowedTools, []);
  assert.deepEqual(policy.bashAllowlist, ["git", "gh", "npm"]);
  assert.equal(policy.reason, "dev-enabled");
  assert.equal(policy.requirePushConfirmation, true);
  assert.equal(policy.networkAllowed, false);
});

test("dev_capability: true SKILL — workspace denylist merged on top of SKILL denied", () => {
  const policy = applyDevPermissions(skillTrue, null);
  // workspace defaults must be present
  for (const required of DEFAULT_DEV_CAPABILITY_DENYLIST) {
    assert.ok(
      policy.bashDenylist.includes(required),
      `workspace denylist entry "${required}" should be in resolved denylist`,
    );
  }
  // SKILL's own denied list also present
  assert.ok(policy.bashDenylist.includes("pip install"));
});

test("missing dev_capability field treated as false (read-only default)", () => {
  const policy = applyDevPermissions({ frontmatter: {} }, null);
  assert.equal(policy.reason, "read-only");
  assert.ok(policy.disallowedTools.includes("Bash"));
});

test("workspace.dev_capability config can be passed directly (not via WorkspaceYaml)", () => {
  const policy = applyDevPermissions(skillTrue, {
    enabled: true,
    bash_denylist: ["custom-blocked-cmd"],
  });
  assert.equal(policy.reason, "dev-enabled");
  assert.ok(policy.bashDenylist.includes("custom-blocked-cmd"));
});
