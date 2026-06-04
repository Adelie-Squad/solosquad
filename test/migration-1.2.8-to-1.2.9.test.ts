import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { migration } from "../src/migrations/scripts/1.2.8-to-1.2.9.js";
import {
  loadUserYaml,
  saveUserYaml,
  userYamlPath,
  type UserYaml,
} from "../src/bot/user-registry.js";

function tempWorkspace(version = "1.2.8", org = "alpha"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-mig129-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    yaml.dump({
      version,
      display_name: "test",
      created_at: "2026-06-01T00:00:00Z",
    }),
  );
  fs.mkdirSync(path.join(dir, org), { recursive: true });
  fs.writeFileSync(
    path.join(dir, org, ".org.yaml"),
    yaml.dump({
      name: org,
      slug: org,
      provider: "local",
      created_at: "2026-06-01T00:00:00Z",
    }),
  );
  return dir;
}

/** A pre-v1.2.9 user yaml: schema_version 1, no `channels.git`. */
function legacyUser(handle: string): UserYaml {
  return {
    schema_version: 1,
    handle,
    messenger: "discord",
    bot_user_id: `id-${handle}`,
    joined_at: "2026-05-15T10:00:00Z",
    channels: { command: `command-${handle}`, works: `works-${handle}` },
  };
}

test("detect matches a 1.2.8 workspace", async () => {
  const ws = tempWorkspace("1.2.8");
  assert.equal(await migration.detect(ws), true);
});

test("detect ignores a non-1.2.8 workspace", async () => {
  const ws = tempWorkspace("1.2.7");
  assert.equal(await migration.detect(ws), false);
});

test("apply bumps workspace version AND injects git channel + schema_version 2", async () => {
  const ws = tempWorkspace("1.2.8");
  saveUserYaml("alpha", legacyUser("alice"), ws);
  saveUserYaml("alpha", legacyUser("bob"), ws);

  await migration.apply(ws);

  // Workspace version (Part A).
  const wsDoc = yaml.load(
    fs.readFileSync(path.join(ws, ".solosquad", "workspace.yaml"), "utf-8"),
  ) as { version: string };
  assert.equal(wsDoc.version, "1.2.9");

  // User yamls (Part B).
  for (const handle of ["alice", "bob"]) {
    const u = loadUserYaml(userYamlPath("alpha", handle, ws));
    assert.ok(u);
    assert.equal(u!.channels.git, `git-${handle}`);
    assert.equal(u!.schema_version, 2);
    // command/works preserved.
    assert.equal(u!.channels.command, `command-${handle}`);
    assert.equal(u!.channels.works, `works-${handle}`);
  }
});

test("verify passes after apply", async () => {
  const ws = tempWorkspace("1.2.8");
  saveUserYaml("alpha", legacyUser("alice"), ws);
  await migration.apply(ws);
  const result = await migration.verify(ws);
  assert.equal(result.ok, true);
});

test("apply is idempotent — re-running leaves git channel intact", async () => {
  const ws = tempWorkspace("1.2.8");
  saveUserYaml("alpha", legacyUser("alice"), ws);
  await migration.apply(ws);
  // Second run (workspace is now 1.2.9; user already migrated).
  await migration.apply(ws);
  const u = loadUserYaml(userYamlPath("alpha", "alice", ws));
  assert.equal(u!.channels.git, "git-alice");
  assert.equal(u!.schema_version, 2);
});

test("plan lists the Part B user-yaml step when users are pending", async () => {
  const ws = tempWorkspace("1.2.8");
  saveUserYaml("alpha", legacyUser("alice"), ws);
  const plan = await migration.plan(ws);
  const hasPartB = plan.steps.some((s) => /channels\.git/.test(s.to));
  assert.equal(hasPartB, true);
});
