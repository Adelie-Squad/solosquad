import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOrgCwd } from "../src/bot/workflow-resolver.js";

/**
 * v1.4.0 (S-1) — resolveOrgCwd must resolve v1.0+ external-path repos.
 *
 * Before S-1, resolveOrgCwd only checked `repositories/<slug>/` directories,
 * so a path-reference workspace (`repositories/<slug>.yaml` with a `path:`
 * field pointing to a repo OUTSIDE the workspace — the v1.0+ default) fell
 * through to org-root. Scheduler-driven crons then ran "repo-blind". S-1
 * routes resolveOrgCwd through resolveRepoCwd, which reads the `path:` field.
 *
 * Layout under a temp workspace:
 *   <ws>/<org>/repositories/<slug>.yaml   (path: -> external repo dir)
 *   <ext>/                                 (the real repo, outside the org)
 */
function makeWorkspaceWithExternalRepo(slug: string): {
  orgDir: string;
  extRepo: string;
} {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-s1-ws-"));
  const orgDir = path.join(ws, "acme");
  fs.mkdirSync(path.join(orgDir, "repositories"), { recursive: true });

  // The external repo lives OUTSIDE the org tree.
  const extRepo = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-s1-ext-"));

  fs.writeFileSync(
    path.join(orgDir, "repositories", `${slug}.yaml`),
    `slug: ${slug}\nname: ${slug}\nrole: main\nlinked_org: acme\nregistered_at: 2026-06-27T00:00:00Z\npath: ${extRepo}\n`,
  );
  return { orgDir, extRepo };
}

test("v1.4.0 S-1 — resolveOrgCwd resolves external-path repo to its real path", () => {
  const { orgDir, extRepo } = makeWorkspaceWithExternalRepo("svc");

  const r = resolveOrgCwd(orgDir);
  assert.equal(r.reason, "first-repo", "external-path repo must resolve, not fall to legacy-root");
  assert.equal(r.repoSlug, "svc");
  assert.equal(
    fs.realpathSync(r.cwd),
    fs.realpathSync(extRepo),
    "cwd must be the external repo path from the yaml `path:` field",
  );
});

test("v1.4.0 S-1 — workflow target_repo resolves via external path", () => {
  const { orgDir, extRepo } = makeWorkspaceWithExternalRepo("svc");

  // An active workflow whose stage targets the external-path repo.
  const wfDir = path.join(orgDir, "workflows", "wf-1");
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, "_status.yaml"),
    "workflow_id: wf-1\nstages:\n  - id: build\n    target_repo: svc\n    status: in_progress\n",
  );

  const r = resolveOrgCwd(orgDir);
  assert.equal(r.reason, "workflow");
  assert.equal(r.workflowId, "wf-1");
  assert.equal(r.repoSlug, "svc");
  assert.equal(fs.realpathSync(r.cwd), fs.realpathSync(extRepo));
});

test("v1.4.0 S-1 — external-path yaml with missing target falls back to org-root", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-s1-miss-"));
  const orgDir = path.join(ws, "acme");
  fs.mkdirSync(path.join(orgDir, "repositories"), { recursive: true });
  // path: points somewhere that does not exist → resolveRepoCwd falls back.
  fs.writeFileSync(
    path.join(orgDir, "repositories", "ghost.yaml"),
    `slug: ghost\nname: ghost\nlinked_org: acme\nregistered_at: 2026-06-27T00:00:00Z\npath: ${path.join(ws, "does-not-exist")}\n`,
  );

  const r = resolveOrgCwd(orgDir);
  assert.equal(r.reason, "legacy-root");
  assert.equal(r.cwd, orgDir);
});
