import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createDevConfirm,
  detectSensitiveCommand,
  devConfirmAuditPath,
  DEV_CONFIRM_DEFAULT_TIMEOUT_MS,
  SENSITIVE_BASH_PREFIXES,
} from "../src/bot/dev-confirm.js";

/**
 * v0.8.2 §5.2 — dev-confirm gate.
 *
 * Coverage:
 *   1. detectSensitiveCommand identifies `git push`, `gh pr merge`, `gh pr close`.
 *   2. createDevConfirm resolves with "y" → audit entry written.
 *   3. 30-min timeout — controller resolves with "timeout" + audit row.
 *   4. abort() resolves with "pm-aborted".
 *   5. detectSensitiveCommand: false positives — `git status` etc. return null.
 */

test("detectSensitiveCommand picks up git push / gh pr merge / gh pr close", () => {
  for (const prefix of SENSITIVE_BASH_PREFIXES) {
    assert.equal(detectSensitiveCommand(`${prefix} origin main`), prefix);
  }
});

test("detectSensitiveCommand returns null for safe bash commands", () => {
  for (const cmd of ["git status", "gh pr view 12", "git log", "ls", "npm test"]) {
    assert.equal(detectSensitiveCommand(cmd), null);
  }
});

test("createDevConfirm resolves with `y` when user approves; audit row written", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-confirm-"));
  const orgSlug = "demo";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });

  const ctrl = createDevConfirm({
    id: "abc",
    user: "alice",
    skill: "backend-developer",
    cmd: "git push origin feat/x",
    ts: "2026-05-15T12:00:00Z",
    workspace,
    orgSlug,
    timeoutMs: 60_000, // doesn't matter — we resolve immediately
  });

  ctrl.resolve("y");
  const decision = await ctrl.promise;
  assert.equal(decision, "y");

  const auditPath = devConfirmAuditPath(workspace, orgSlug);
  const lines = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.user, "alice");
  assert.equal(row.skill, "backend-developer");
  assert.equal(row.cmd, "git push origin feat/x");
  assert.equal(row.decision, "y");
  assert.equal(typeof row.duration_ms, "number");
});

test("createDevConfirm resolves with `timeout` when no decision arrives in time", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-confirm-"));
  const orgSlug = "demo";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });

  // Inject a fake setTimeout so the test is deterministic (no wall-clock wait).
  let registered: { cb: () => void; ms: number } | null = null;
  const ctrl = createDevConfirm(
    {
      id: "abc",
      user: "bob",
      skill: "api-developer",
      cmd: "gh pr merge 42",
      ts: "2026-05-15T12:01:00Z",
      workspace,
      orgSlug,
    },
    {
      setTimeout: (cb, ms) => {
        registered = { cb, ms };
        return { _stub: true };
      },
      clearTimeout: () => {},
    },
  );

  assert.ok(registered, "setTimeout should be registered");
  assert.equal((registered as { ms: number }).ms, DEV_CONFIRM_DEFAULT_TIMEOUT_MS);
  // Fire the timer manually.
  (registered as { cb: () => void }).cb();

  const decision = await ctrl.promise;
  assert.equal(decision, "timeout");

  const auditPath = devConfirmAuditPath(workspace, orgSlug);
  const row = JSON.parse(fs.readFileSync(auditPath, "utf-8").trim().split("\n")[0]);
  assert.equal(row.decision, "timeout");
});

test("createDevConfirm.abort() resolves with `pm-aborted`", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-confirm-"));
  const orgSlug = "demo";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });

  const ctrl = createDevConfirm({
    id: "abc",
    user: "carol",
    skill: "fde",
    cmd: "git push origin main",
    ts: "2026-05-15T12:02:00Z",
    workspace,
    orgSlug,
    timeoutMs: 60_000,
  });

  ctrl.abort();
  const decision = await ctrl.promise;
  assert.equal(decision, "pm-aborted");

  const auditPath = devConfirmAuditPath(workspace, orgSlug);
  const row = JSON.parse(fs.readFileSync(auditPath, "utf-8").trim().split("\n")[0]);
  assert.equal(row.decision, "pm-aborted");
});

test("createDevConfirm.resolve called twice is a no-op (idempotent)", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ss-confirm-"));
  const orgSlug = "demo";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });

  const ctrl = createDevConfirm({
    id: "abc",
    user: "dave",
    skill: "qa-engineer",
    cmd: "git push origin feat/y",
    ts: "2026-05-15T12:03:00Z",
    workspace,
    orgSlug,
    timeoutMs: 60_000,
  });

  ctrl.resolve("y");
  ctrl.resolve("n"); // ignored
  const decision = await ctrl.promise;
  assert.equal(decision, "y");

  const auditPath = devConfirmAuditPath(workspace, orgSlug);
  const rows = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
  assert.equal(rows.length, 1, "only one audit row should be written");
});
