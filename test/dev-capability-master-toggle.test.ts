import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyDevPermissions,
  type DevCapabilitySkillView,
} from "../src/bot/spawn-assembler.js";
import { resolveDevCapabilityConfig } from "../src/util/config.js";

/**
 * v0.8.2 §3.3 — workspace master toggle.
 *
 * When `workspace.yaml.dev_capability.enabled: false`, every spawn is forced
 * into read-only mode even if the SKILL declares `dev_capability: true`.
 * This is the emergency-stop / client-confidential-repo switch.
 */

const trueSkill: DevCapabilitySkillView = {
  frontmatter: {
    dev_capability: true,
    dev_permissions: {
      bash: { allowed: ["git", "gh"] },
    },
  },
};

const falseSkill: DevCapabilitySkillView = {
  frontmatter: { dev_capability: false },
};

test("workspace.dev_capability.enabled=false forces dev_capability:true SKILL into read-only", () => {
  const policy = applyDevPermissions(trueSkill, {
    enabled: false,
    bash_denylist: ["sudo"],
  });
  assert.equal(policy.reason, "workspace-disabled");
  assert.ok(!policy.allowedTools.includes("Bash"));
  assert.ok(policy.disallowedTools.includes("Bash"));
  assert.equal(policy.bashAllowlist.length, 0);
});

test("workspace.dev_capability.enabled=false also forces dev_capability:false SKILL into read-only", () => {
  // The false SKILL would have been read-only anyway, but the *reason* changes
  // to workspace-disabled to make the audit log unambiguous.
  const policy = applyDevPermissions(falseSkill, { enabled: false });
  assert.equal(policy.reason, "workspace-disabled");
});

test("workspace.dev_capability omitted → defaults applied (enabled=true)", () => {
  const cfg = resolveDevCapabilityConfig(undefined);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.require_push_confirmation, true);
  assert.ok(cfg.bash_denylist.length > 0);
});

test("workspace.dev_capability.require_push_confirmation=false is normalized to true (§3.3 박제)", () => {
  const cfg = resolveDevCapabilityConfig({
    enabled: true,
    require_push_confirmation: false,
    bash_denylist: ["sudo"],
  });
  // false is rejected by the loader — always true.
  assert.equal(cfg.require_push_confirmation, true);
});

test("workspace.dev_capability.enabled=true + SKILL dev_capability:true → dev-enabled path", () => {
  const policy = applyDevPermissions(trueSkill, { enabled: true });
  assert.equal(policy.reason, "dev-enabled");
  assert.ok(policy.allowedTools.includes("Bash"));
});

test("WorkspaceYaml wrapper is unwrapped to DevCapabilityConfig automatically", () => {
  const wsYaml = {
    version: "0.8.2",
    display_name: "test",
    created_at: "2026-05-15T00:00:00Z",
    dev_capability: { enabled: false, bash_denylist: ["sudo"] },
  };
  // Type-coerced to match WorkspaceYaml without importing the full type.
  const policy = applyDevPermissions(trueSkill, wsYaml as never);
  assert.equal(policy.reason, "workspace-disabled");
});
