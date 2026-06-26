import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOrgCwd } from "../src/bot/workflow-resolver.js";
import { listOrgRepoSlugs } from "../src/bot/repo-registry.js";

/**
 * v1.0.1 — role-removal regression catchers.
 *
 * v1.0.1 dropped:
 *   1. The interactive `Role:` prompt from `solosquad init` and `solosquad
 *      add repo` — new registrations default to "main" silently.
 *   2. The `role=main` lookup in `workflow-resolver.resolveOrgCwd` —
 *      scheduler-driven cwd now picks the first registered repo as a
 *      tie-breaker (not as a routing decision; user-driven routing uses
 *      the @<slug> mention parser at PM level).
 *
 * Schema-level: `RepoYaml.role` stays in the type for backward compat
 * (hard removal scheduled for v2.0 per api-stability schema read-window).
 *
 * These tests guard the *behavioral* removal — that resolver no longer
 * prefers a "main" repo over the first-listed one, and that the repo
 * registry helper sees both legacy directory trees and v0.9.1+ path-ref
 * yamls.
 */

function makeTmpOrg(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-v101-"));
  fs.mkdirSync(path.join(dir, "repositories"), { recursive: true });
  return dir;
}

test("v1.0.1 — resolveOrgCwd picks first registered repo, no role lookup", () => {
  const orgDir = makeTmpOrg();
  // Two legacy-directory repos. (Since v1.4.0/S-1 the scheduler-cwd
  // helper also resolves v0.9.1+ path-reference yamls via resolveRepoCwd;
  // here we keep the legacy-directory case to guard the no-role-lookup
  // behaviour.) Filesystem readdirSync order is not guaranteed
  // cross-platform, but the
  // resolver MUST pick *one* and report reason="first-repo" — never
  // the removed "main-repo".
  fs.mkdirSync(path.join(orgDir, "repositories", "app-a"));
  fs.mkdirSync(path.join(orgDir, "repositories", "app-b"));

  const r = resolveOrgCwd(orgDir);
  assert.equal(r.reason, "first-repo", "scheduler-cwd reason must be 'first-repo', not the removed 'main-repo'");
  assert.ok(["app-a", "app-b"].includes(r.repoSlug ?? ""));
});

test("v1.0.1 — resolveOrgCwd falls back to legacy-root when no repos registered", () => {
  const orgDir = makeTmpOrg();
  const r = resolveOrgCwd(orgDir);
  assert.equal(r.reason, "legacy-root");
  assert.equal(r.cwd, orgDir);
});

test("v1.0.1 — listOrgRepoSlugs sees both v0.9.1 path-ref yamls and legacy directories", () => {
  const orgDir = makeTmpOrg();
  fs.writeFileSync(
    path.join(orgDir, "repositories", "path-ref-repo.yaml"),
    "slug: path-ref-repo\nname: path-ref-repo\nrole: main\nlinked_org: x\nregistered_at: 2026-05-22T00:00:00Z\n",
  );
  fs.mkdirSync(path.join(orgDir, "repositories", "legacy-repo"));

  const slugs = listOrgRepoSlugs(orgDir);
  assert.deepEqual(slugs.sort(), ["legacy-repo", "path-ref-repo"]);
});

test("v1.0.1 — listOrgRepoSlugs returns empty array when no repositories dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-v101-empty-"));
  assert.deepEqual(listOrgRepoSlugs(dir), []);
});
