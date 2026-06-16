import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import {
  resolveChiefGitConfig,
  loadChiefGitConfig,
  DEFAULT_PROTECTED_BRANCHES,
} from "../src/util/config.js";

test("resolveChiefGitConfig — defaults when unset", () => {
  const c = resolveChiefGitConfig(undefined);
  assert.deepEqual(c.protected_branches, [...DEFAULT_PROTECTED_BRANCHES]);
  assert.equal(c.require_feature_branch, true);
  assert.equal(c.approval_timeout_minutes, 30);
});

test("resolveChiefGitConfig — honours overrides, ignores invalid timeout", () => {
  const c = resolveChiefGitConfig({
    protected_branches: ["main", "release"],
    require_feature_branch: false,
    approval_timeout_minutes: 10,
  });
  assert.deepEqual(c.protected_branches, ["main", "release"]);
  assert.equal(c.require_feature_branch, false);
  assert.equal(c.approval_timeout_minutes, 10);

  // empty list / non-positive timeout fall back to defaults
  const d = resolveChiefGitConfig({
    protected_branches: [],
    approval_timeout_minutes: 0,
  });
  assert.deepEqual(d.protected_branches, [...DEFAULT_PROTECTED_BRANCHES]);
  assert.equal(d.approval_timeout_minutes, 30);
});

test("loadChiefGitConfig — reads pm.git from workspace.yaml", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ss-gitcfg-"));
  fs.mkdirSync(path.join(ws, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".solosquad", "workspace.yaml"),
    yaml.dump({
      version: "1.3.0",
      display_name: "t",
      created_at: "2026-06-16T00:00:00Z",
      pm: { git: { protected_branches: ["trunk"], approval_timeout_minutes: 5 } },
    }),
  );
  const c = loadChiefGitConfig(ws);
  assert.deepEqual(c.protected_branches, ["trunk"]);
  assert.equal(c.approval_timeout_minutes, 5);
});
