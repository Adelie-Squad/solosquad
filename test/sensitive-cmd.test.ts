import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveGitCommand } from "../src/bot/sensitive-cmd.js";

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
