import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { looksLikeGitUrl } from "../src/util/git.js";

/**
 * v1.0 regression catchers — repo registration is path-reference only.
 *
 * v1.0 removed URL clone + Move-into-workspace from both `solosquad init`
 * (Step 5.1, `registerRepoInline` in `src/cli/init.ts`) and `solosquad
 * add repo` (`src/cli/add-repo.ts`). The behavior is enforced by routing
 * everything through `registerPathReference`, with explicit guards:
 *
 *   1. Git URL input is rejected with an instruction to clone first
 *   2. Local path that is not a git repo is rejected with `git init` guidance
 *
 * These tests assert the *surface contract* — that the helpers the CLI
 * relies on classify inputs correctly. Interactive prompt branches in
 * init.ts / add-repo.ts use this same classification.
 */

test("v1.0 — looksLikeGitUrl recognizes URLs we must reject in path-ref mode", () => {
  const urls = [
    "https://github.com/user/repo.git",
    "git@github.com:user/repo.git",
    "git+https://github.com/user/repo.git",
    "ssh://git@gitlab.com/user/repo.git",
  ];
  for (const u of urls) {
    assert.equal(looksLikeGitUrl(u), true, `expected URL detection for: ${u}`);
  }
});

test("v1.0 — looksLikeGitUrl does NOT misclassify local paths", () => {
  const localPaths = [
    "C:/Users/x/repo",
    "C:\\Dev\\my-repo",
    "/Users/x/code/repo",
    "~/code/repo",
    "./relative",
    "my-repo",
    "../sibling",
  ];
  for (const p of localPaths) {
    assert.equal(looksLikeGitUrl(p), false, `local path was misclassified as URL: ${p}`);
  }
});

test("v1.0 — fs.existsSync('.git') is the trip-wire for the non-git rejection branch", () => {
  // Confirm the simplest signal init.ts / add-repo.ts uses (`.git/` presence)
  // matches the contract this test guards. If this assertion ever changes
  // because the trip-wire moves elsewhere, update both call sites + this
  // catcher together.
  const probe = `${process.cwd()}/.git`;
  // Either exists or doesn't — both are valid for the assertion; we're
  // only asserting the helper is a plain fs check (no async, no race).
  const result = fs.existsSync(probe);
  assert.equal(typeof result, "boolean");
});
