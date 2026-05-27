import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getActive,
  acquire,
  release,
  enqueue,
  listQueue,
  dequeue,
  remove,
  promoteNext,
} from "../src/util/goal-queue.js";

function mkOrgRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-goalqueue-"));
}

test("getActive returns null when no marker exists", () => {
  const orgRoot = mkOrgRoot();
  assert.equal(getActive({ orgRoot }), null);
});

test("acquire then getActive returns the goal id", () => {
  const orgRoot = mkOrgRoot();
  acquire({ orgRoot }, "goal-1");
  assert.equal(getActive({ orgRoot }), "goal-1");
});

test("acquire throws when another goal is active", () => {
  const orgRoot = mkOrgRoot();
  acquire({ orgRoot }, "goal-1");
  assert.throws(() => acquire({ orgRoot }, "goal-2"), /already active/);
});

test("release clears the active marker", () => {
  const orgRoot = mkOrgRoot();
  acquire({ orgRoot }, "goal-1");
  release({ orgRoot }, "goal-1");
  assert.equal(getActive({ orgRoot }), null);
});

test("release is a no-op when goal-id doesn't match active", () => {
  const orgRoot = mkOrgRoot();
  acquire({ orgRoot }, "goal-1");
  release({ orgRoot }, "different-goal");
  assert.equal(getActive({ orgRoot }), "goal-1");
});

test("enqueue then listQueue returns FIFO order", () => {
  const orgRoot = mkOrgRoot();
  enqueue({ orgRoot }, "g-a");
  enqueue({ orgRoot }, "g-b");
  enqueue({ orgRoot }, "g-c");
  const ids = listQueue({ orgRoot }).map((e) => e.goal_id);
  assert.deepEqual(ids, ["g-a", "g-b", "g-c"]);
});

test("enqueue is idempotent — duplicates dropped", () => {
  const orgRoot = mkOrgRoot();
  enqueue({ orgRoot }, "g-a");
  enqueue({ orgRoot }, "g-a");
  assert.equal(listQueue({ orgRoot }).length, 1);
});

test("dequeue removes head and returns it", () => {
  const orgRoot = mkOrgRoot();
  enqueue({ orgRoot }, "g-a");
  enqueue({ orgRoot }, "g-b");
  const head = dequeue({ orgRoot });
  assert.equal(head, "g-a");
  assert.equal(listQueue({ orgRoot }).length, 1);
});

test("dequeue returns null on empty queue", () => {
  const orgRoot = mkOrgRoot();
  assert.equal(dequeue({ orgRoot }), null);
});

test("remove deletes specific entry", () => {
  const orgRoot = mkOrgRoot();
  enqueue({ orgRoot }, "g-a");
  enqueue({ orgRoot }, "g-b");
  enqueue({ orgRoot }, "g-c");
  assert.equal(remove({ orgRoot }, "g-b"), true);
  const ids = listQueue({ orgRoot }).map((e) => e.goal_id);
  assert.deepEqual(ids, ["g-a", "g-c"]);
});

test("remove returns false when entry not in queue", () => {
  const orgRoot = mkOrgRoot();
  enqueue({ orgRoot }, "g-a");
  assert.equal(remove({ orgRoot }, "ghost"), false);
});

test("promoteNext activates head when slot is free", () => {
  const orgRoot = mkOrgRoot();
  enqueue({ orgRoot }, "g-a");
  enqueue({ orgRoot }, "g-b");
  const promoted = promoteNext({ orgRoot });
  assert.equal(promoted, "g-a");
  assert.equal(getActive({ orgRoot }), "g-a");
  assert.equal(listQueue({ orgRoot }).length, 1);
});

test("promoteNext is no-op when slot is occupied", () => {
  const orgRoot = mkOrgRoot();
  acquire({ orgRoot }, "active-x");
  enqueue({ orgRoot }, "g-a");
  const promoted = promoteNext({ orgRoot });
  assert.equal(promoted, null);
  assert.equal(getActive({ orgRoot }), "active-x");
  assert.equal(listQueue({ orgRoot }).length, 1);
});

test("promoteNext returns null on empty queue", () => {
  const orgRoot = mkOrgRoot();
  assert.equal(promoteNext({ orgRoot }), null);
});

test("end-to-end: full lifecycle", () => {
  const orgRoot = mkOrgRoot();
  enqueue({ orgRoot }, "g-1");
  enqueue({ orgRoot }, "g-2");
  enqueue({ orgRoot }, "g-3");

  // Start first
  assert.equal(promoteNext({ orgRoot }), "g-1");

  // Finish first, start second
  release({ orgRoot }, "g-1");
  assert.equal(promoteNext({ orgRoot }), "g-2");

  // User cancels g-3 while g-2 still running
  assert.equal(remove({ orgRoot }, "g-3"), true);
  assert.equal(listQueue({ orgRoot }).length, 0);

  // Release the last
  release({ orgRoot }, "g-2");
  assert.equal(getActive({ orgRoot }), null);
});
