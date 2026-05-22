import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { npmGlobalInstallCmd } from "../src/util/platform.js";

/**
 * v1.0.3 — npmGlobalInstallCmd prefix-permission-check regression catcher.
 *
 * Pre-v1.0.3 prepended `sudo` whenever `process.getuid() !== 0`, which was
 * wrong for nvm / Homebrew / fnm / asdf users whose npm prefix is inside
 * their home dir (user-writable, no sudo needed). The fix runs
 * `npm config get prefix` and tests `fs.accessSync(prefix, W_OK)` — when
 * the user owns the prefix, no sudo is prepended.
 *
 * These tests exercise the function as a black box against the actual npm
 * installed in the test environment. CI (and dev machines) typically have
 * a user-owned prefix (nvm / setup-node action) so the expected output is
 * the no-sudo form. If a test environment has root-owned npm prefix the
 * fallback branch fires and we assert that too.
 */

test("v1.0.3 — Windows always returns no-sudo form regardless of prefix", () => {
  if (os.platform() !== "win32") {
    // Skip on non-Windows — the function checks IS_WINDOWS at runtime.
    return;
  }
  const cmd = npmGlobalInstallCmd("solosquad@latest");
  assert.equal(cmd, "npm install -g solosquad@latest");
});

function probePrefixWritable(): boolean {
  try {
    const prefix = execSync("npm config get prefix", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!prefix) return false;
    fs.accessSync(prefix, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

test("v1.0.3 — Unix: chooses sudo vs no-sudo based on actual npm prefix write access", () => {
  if (os.platform() === "win32") return; // covered above
  const cmd = npmGlobalInstallCmd("solosquad@latest");

  // Output shape must be one of the two valid forms.
  const valid =
    cmd === "npm install -g solosquad@latest" ||
    cmd === "sudo npm install -g solosquad@latest";
  assert.equal(valid, true, `unexpected command shape: ${cmd}`);

  // Detection (probe outside the SUT) and assertion are decoupled so a
  // false assertion can't be silently swallowed by the probe's catch.
  const writable = probePrefixWritable();
  if (writable) {
    assert.equal(
      cmd,
      "npm install -g solosquad@latest",
      "npm prefix is user-writable in this env; npmGlobalInstallCmd must NOT prepend sudo",
    );
  } else {
    assert.equal(
      cmd,
      "sudo npm install -g solosquad@latest",
      "npm prefix not user-writable (or npm unreachable); fallback should prepend sudo",
    );
  }
});

test("v1.0.3 — output is shell-safe and references the requested package", () => {
  const cmd = npmGlobalInstallCmd("solosquad@1.0.3");
  assert.match(cmd, /solosquad@1\.0\.3/);
  assert.match(cmd, /^(sudo )?npm install -g /);
});
