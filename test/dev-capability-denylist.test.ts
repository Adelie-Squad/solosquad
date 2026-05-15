import { test } from "node:test";
import assert from "node:assert/strict";

import { checkBashCommand } from "../src/bot/claude-process.js";
import { applyDevPermissions, type DevCapabilitySkillView } from "../src/bot/spawn-assembler.js";

/**
 * v0.8.2 §4.2 — bash allowlist / denylist enforcement.
 *
 * Coverage:
 *   1. Workspace denylist wins even when the SKILL allowlist includes the
 *      command (defense-in-depth — SKILL can't override).
 *   2. Allowlist match: leading-token prefix passes (e.g. allowed `git` →
 *      `git push origin main` passes).
 *   3. Allowlist miss → reject.
 *   4. Empty allowlist → no allow check (PM session retains full bash).
 *   5. Denylist substring match.
 */

test("denylist substring match rejects the command", () => {
  const result = checkBashCommand("sudo rm -rf /tmp/cache", [], ["sudo", "rm -rf /"]);
  assert.equal(result.ok, false);
});

test("workspace denylist wins over SKILL allowlist", () => {
  const skill: DevCapabilitySkillView = {
    frontmatter: {
      dev_capability: true,
      dev_permissions: {
        bash: { allowed: ["sudo"] }, // SKILL tries to allow it
      },
    },
  };
  const policy = applyDevPermissions(skill, {
    enabled: true,
    bash_denylist: ["sudo"], // workspace forbids it
  });
  // Resolved policy still has sudo in denylist
  assert.ok(policy.bashDenylist.includes("sudo"));
  // And the pre-check rejects "sudo something"
  const result = checkBashCommand(
    "sudo apt install foo",
    policy.bashAllowlist,
    policy.bashDenylist,
  );
  assert.equal(result.ok, false);
});

test("allowlist passes leading-token prefix matches", () => {
  const allow = ["git", "gh pr create", "npm test"];
  assert.equal(checkBashCommand("git push origin main", allow, []).ok, true);
  assert.equal(checkBashCommand("git", allow, []).ok, true);
  assert.equal(checkBashCommand("gh pr create --title x", allow, []).ok, true);
  assert.equal(checkBashCommand("npm test", allow, []).ok, true);
});

test("allowlist rejects commands not matching any prefix", () => {
  const allow = ["git", "gh"];
  const r1 = checkBashCommand("curl https://example.com", allow, []);
  assert.equal(r1.ok, false);
  const r2 = checkBashCommand("python script.py", allow, []);
  assert.equal(r2.ok, false);
});

test("empty allowlist → no allow check (back-compat for PM session)", () => {
  // No allowlist = any non-denied command passes.
  const r = checkBashCommand("ls -la", [], ["sudo"]);
  assert.equal(r.ok, true);
});

test("allowlist exact match works (command equals entry, no args)", () => {
  const allow = ["pwd"];
  assert.equal(checkBashCommand("pwd", allow, []).ok, true);
});

test("denylist takes precedence over allowlist (matched on substring)", () => {
  const allow = ["chmod"];
  const deny = ["chmod 777"];
  const r = checkBashCommand("chmod 777 /tmp/file", allow, deny);
  assert.equal(r.ok, false);
});

test("empty bash command is rejected", () => {
  const r = checkBashCommand("   ", ["git"], []);
  assert.equal(r.ok, false);
});
