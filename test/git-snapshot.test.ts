import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureSnapshotRepo,
  commitSnapshot,
  listSnapshots,
  revertToSnapshot,
} from "../src/bot/git-snapshot.js";

function tempWorkspaceWithOrg(orgSlug = "test-org"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-snap-"));
  fs.mkdirSync(path.join(dir, orgSlug, "memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, orgSlug, "workflows"), { recursive: true });
  return dir;
}

test("ensureSnapshotRepo creates a bare repo under .solosquad/snapshot.git", () => {
  const ws = tempWorkspaceWithOrg();
  ensureSnapshotRepo(ws, "test-org");
  const gitDir = path.join(ws, "test-org", ".solosquad", "snapshot.git");
  assert.ok(fs.existsSync(gitDir));
  assert.ok(fs.existsSync(path.join(gitDir, "HEAD")));
});

test("ensureSnapshotRepo is idempotent", () => {
  const ws = tempWorkspaceWithOrg();
  ensureSnapshotRepo(ws, "test-org");
  // Add a stale marker, then call again — should not overwrite
  const marker = path.join(ws, "test-org", ".solosquad", "snapshot.git", "marker");
  fs.writeFileSync(marker, "x");
  ensureSnapshotRepo(ws, "test-org");
  assert.equal(fs.readFileSync(marker, "utf-8"), "x");
});

test("commitSnapshot returns null when nothing changed", () => {
  const ws = tempWorkspaceWithOrg();
  ensureSnapshotRepo(ws, "test-org");
  const sha = commitSnapshot(ws, "test-org", "no-op test");
  assert.equal(sha, null);
});

test("commitSnapshot records new files in memory/", () => {
  const ws = tempWorkspaceWithOrg();
  fs.writeFileSync(path.join(ws, "test-org", "memory", "signals.jsonl"), "{}\n");
  const sha1 = commitSnapshot(ws, "test-org", "first signal");
  assert.ok(sha1, "first commit should produce a SHA");
  assert.match(sha1!, /^[0-9a-f]{40}$/);

  // Subsequent commit with no changes returns null
  const sha2 = commitSnapshot(ws, "test-org", "noop");
  assert.equal(sha2, null);

  // Modify the file, commit again
  fs.appendFileSync(path.join(ws, "test-org", "memory", "signals.jsonl"), '{"x":1}\n');
  const sha3 = commitSnapshot(ws, "test-org", "second signal");
  assert.ok(sha3);
  assert.notEqual(sha3, sha1);
});

test("listSnapshots returns commits newest-first with subject", () => {
  const ws = tempWorkspaceWithOrg();
  fs.writeFileSync(path.join(ws, "test-org", "memory", "a.txt"), "1");
  commitSnapshot(ws, "test-org", "before-spawn: turn 1");
  fs.writeFileSync(path.join(ws, "test-org", "memory", "a.txt"), "2");
  commitSnapshot(ws, "test-org", "after-spawn: turn 1");
  fs.writeFileSync(path.join(ws, "test-org", "memory", "a.txt"), "3");
  commitSnapshot(ws, "test-org", "before-spawn: turn 2");

  const list = listSnapshots(ws, "test-org", 10);
  assert.equal(list[0].subject, "before-spawn: turn 2");
  assert.equal(list[1].subject, "after-spawn: turn 1");
  assert.equal(list[2].subject, "before-spawn: turn 1");
});

test("revertToSnapshot restores memory/ to an earlier commit", () => {
  const ws = tempWorkspaceWithOrg();
  fs.writeFileSync(path.join(ws, "test-org", "memory", "a.txt"), "v1");
  const sha1 = commitSnapshot(ws, "test-org", "before-spawn: t1")!;
  fs.writeFileSync(path.join(ws, "test-org", "memory", "a.txt"), "v2-bad");
  commitSnapshot(ws, "test-org", "after-spawn: t1");

  const result = revertToSnapshot(ws, "test-org", sha1, "test rollback");
  assert.equal(result.ok, true, result.error);
  const restored = fs.readFileSync(
    path.join(ws, "test-org", "memory", "a.txt"),
    "utf-8"
  );
  assert.equal(restored, "v1");
});

test("revertToSnapshot rejects an unknown SHA", () => {
  const ws = tempWorkspaceWithOrg();
  ensureSnapshotRepo(ws, "test-org");
  const result = revertToSnapshot(ws, "test-org", "0000000000000000000000000000000000000000");
  assert.equal(result.ok, false);
  assert.match(result.error!, /commit not found/);
});
