import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractCommand,
  readHookEnv,
  classifySensitive,
  runHook,
  type HookDeps,
} from "../src/bot/dev-confirm-hook.js";
import type { PendingConfirmFile, PendingDecision } from "../src/bot/dev-confirm-paths.js";

test("extractCommand — parses tool_input.command, fails to null on bad JSON", () => {
  assert.equal(
    extractCommand(JSON.stringify({ tool_input: { command: "git push" } })),
    "git push",
  );
  assert.equal(extractCommand("not json"), null);
  assert.equal(extractCommand("{}"), null);
});

test("readHookEnv — defaults + parsing", () => {
  const e = readHookEnv({
    SOLOSQUAD_DEV_CONFIRM_DIR: "/tmp/pc",
    SOLOSQUAD_DEV_CONFIRM_ORG: "acme",
    SOLOSQUAD_DEV_CONFIRM_USER: "u1",
    SOLOSQUAD_DEV_CONFIRM_TIMEOUT_MS: "60000",
    SOLOSQUAD_DEV_CONFIRM_PROTECTED: "main, release",
  } as NodeJS.ProcessEnv);
  assert.equal(e.dir, "/tmp/pc");
  assert.equal(e.org, "acme");
  assert.equal(e.user, "u1");
  assert.equal(e.timeoutMs, 60000);
  assert.deepEqual(e.protectedBranches, ["main", "release"]);

  const d = readHookEnv({} as NodeJS.ProcessEnv);
  assert.equal(d.dir, undefined);
  assert.deepEqual(d.protectedBranches, ["main", "master", "develop"]);
  assert.ok(d.timeoutMs > 0);
});

test("classifySensitive — v1.3.10: feature push allowed, protected push confirms", () => {
  const protectedBranches = ["main", "master", "develop"];
  const resolveBranch = () => "feat/current";

  // non-sensitive → allow
  assert.equal(
    classifySensitive("npm run build", { protectedBranches, resolveBranch }).action,
    "allow",
  );
  // protected branch push → confirm (was a hard block pre-1.3.10)
  assert.equal(
    classifySensitive("git push origin main", { protectedBranches, resolveBranch }).action,
    "confirm",
  );
  // feature branch push → allow (was confirm pre-1.3.10; safe op, no card)
  assert.equal(
    classifySensitive("git push origin feat/x", { protectedBranches, resolveBranch }).action,
    "allow",
  );
  // no-target push resolves to current (feature) → allow
  assert.equal(
    classifySensitive("git push", { protectedBranches, resolveBranch }).action,
    "allow",
  );
  // no-target push that resolves to a protected branch → confirm
  assert.equal(
    classifySensitive("git push", {
      protectedBranches,
      resolveBranch: () => "main",
    }).action,
    "confirm",
  );
  // gh pr merge → confirm (mutates shared remote)
  assert.equal(
    classifySensitive("gh pr merge 5", { protectedBranches, resolveBranch }).action,
    "confirm",
  );
});

function baseDeps(overrides: Partial<HookDeps>): HookDeps {
  return {
    // v1.3.10: confirm only fires for protected-branch push now, so the default
    // command pushes to a protected branch to exercise the confirm flow.
    readStdin: async () => JSON.stringify({ tool_input: { command: "git push origin main" } }),
    env: {
      SOLOSQUAD_DEV_CONFIRM_DIR: "/tmp/pc",
      SOLOSQUAD_DEV_CONFIRM_ORG: "acme",
      SOLOSQUAD_DEV_CONFIRM_USER: "u1",
      SOLOSQUAD_DEV_CONFIRM_TIMEOUT_MS: "1000",
    } as NodeJS.ProcessEnv,
    cwd: "/work/acme/repositories/app",
    resolveBranch: () => "main",
    collectCommits: () => ["abc123 fix"],
    makeId: () => "id1",
    writePending: () => {},
    pollDecision: async () => "y",
    warn: () => {},
    now: () => new Date("2026-06-16T00:00:00Z"),
    ...overrides,
  };
}

test("runHook — approved push → exit 0, writes pending", async () => {
  let written: PendingConfirmFile | null = null;
  const code = await runHook(
    baseDeps({
      writePending: (_f, body) => {
        written = body;
      },
      pollDecision: async () => "y" as PendingDecision,
    }),
  );
  assert.equal(code, 0);
  assert.ok(written);
  assert.equal(written!.branch, "main");
  assert.equal(written!.repoSlug, "app");
  assert.deepEqual(written!.commits, ["abc123 fix"]);
});

test("runHook — rejected → exit 2", async () => {
  const code = await runHook(baseDeps({ pollDecision: async () => "n" }));
  assert.equal(code, 2);
});

test("runHook — timeout → exit 2 (fail-closed)", async () => {
  const code = await runHook(baseDeps({ pollDecision: async () => "timeout" }));
  assert.equal(code, 2);
});

test("runHook — v1.3.10: feature-branch push → exit 0 without writing pending (allowed)", async () => {
  let wrote = false;
  const code = await runHook(
    baseDeps({
      readStdin: async () =>
        JSON.stringify({ tool_input: { command: "git push origin feat/x" } }),
      resolveBranch: () => "feat/x",
      writePending: () => {
        wrote = true;
      },
    }),
  );
  assert.equal(code, 0); // allowed — no card, no interruption
  assert.equal(wrote, false);
});

test("runHook — non-sensitive command → exit 0", async () => {
  const code = await runHook(
    baseDeps({
      readStdin: async () =>
        JSON.stringify({ tool_input: { command: "npm test" } }),
    }),
  );
  assert.equal(code, 0);
});

test("runHook — bad stdin → exit 0 (fail-open)", async () => {
  const code = await runHook(baseDeps({ readStdin: async () => "garbage" }));
  assert.equal(code, 0);
});

test("runHook — no DIR configured → exit 0 (fail-open)", async () => {
  const code = await runHook(
    baseDeps({ env: { SOLOSQUAD_DEV_CONFIRM_USER: "u1" } as NodeJS.ProcessEnv }),
  );
  assert.equal(code, 0);
});

test("runHook — pending write error → exit 0 (fail-open)", async () => {
  const code = await runHook(
    baseDeps({
      writePending: () => {
        throw new Error("disk full");
      },
    }),
  );
  assert.equal(code, 0);
});
