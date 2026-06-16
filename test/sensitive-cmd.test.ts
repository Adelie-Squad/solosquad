import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSensitiveGitCommand,
  parsePushBranch,
  isProtectedBranch,
} from "../src/bot/sensitive-cmd.js";

test("blocks git push / gh pr merge|close — incl. compound commands + flags", () => {
  for (const c of [
    "git push",
    "git push origin main",
    "git push --force",
    "cd repo && git push",
    "cd /a/b && git push origin feat/x", // the dogfood case CLI deny missed
    "gh pr merge 5",
    "gh pr close 5",
    "git status; git push",
    "git add . && git commit -m x && git push",
  ]) {
    assert.equal(isSensitiveGitCommand(c), true, c);
  }
});

test("allows safe git + other commands", () => {
  for (const c of [
    "git commit -m x",
    "git checkout -b feat/y",
    "git status",
    "git add .",
    "git fetch",
    "npm run build",
    "echo git push", // 'git push' not at start / after a separator
    "git pushx", // word boundary — not 'git push'
    "cd repo && git status",
  ]) {
    assert.equal(isSensitiveGitCommand(c), false, c);
  }
});

test("parsePushBranch — explicit destinations", () => {
  const cases: Array<[string, string | null]> = [
    ["git push origin feat/x", "feat/x"],
    ["git push -u origin main", "main"],
    ["git push --set-upstream origin develop", "develop"],
    ["git push origin HEAD:feat/x", "feat/x"], // refspec dst
    ["git push origin feat/a:feat/b", "feat/b"], // src:dst → dst written
    ["git push origin refs/heads/release", "release"],
    ["cd /a/b && git push origin feat/y", "feat/y"], // compound
  ];
  for (const [cmd, expected] of cases) {
    assert.equal(parsePushBranch(cmd), expected, cmd);
  }
});

test("parsePushBranch — guard cannot be bypassed (whitespace / force refspec)", () => {
  // double-space / tab between git and push must still resolve the branch
  assert.equal(parsePushBranch("git  push origin main"), "main");
  assert.equal(parsePushBranch("git\tpush origin main"), "main");
  // force-push refspec markers must not hide a protected branch
  assert.equal(parsePushBranch("git push origin +main"), "main");
  assert.equal(parsePushBranch("git push origin HEAD:+main"), "main");
  assert.equal(parsePushBranch("git push --force origin main"), "main");
});

test("parsePushBranch — no explicit target → null (hook resolves current)", () => {
  for (const cmd of [
    "git push",
    "git push origin",
    "git push -u origin",
    "git push origin HEAD",
    "git status", // not a push at all
  ]) {
    assert.equal(parsePushBranch(cmd), null, cmd);
  }
});

test("isProtectedBranch — case-insensitive, null is unprotected here", () => {
  const protectedBranches = ["main", "master", "develop"];
  assert.equal(isProtectedBranch("main", protectedBranches), true);
  assert.equal(isProtectedBranch("MAIN", protectedBranches), true);
  assert.equal(isProtectedBranch("feat/x", protectedBranches), false);
  // null = current-branch push the hook re-checks after resolving the ref.
  assert.equal(isProtectedBranch(null, protectedBranches), false);
});
