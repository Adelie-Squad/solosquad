import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acquireSchedulerLock,
  readSchedulerPid,
  clearSchedulerPid,
} from "../src/util/scheduler-pidfile.js";

/**
 * v1.4.1 — scheduler singleton lock (double-fire guard for `bot --with-cron` /
 * `solosquad start` running alongside a separate scheduler).
 */

function tempWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-schedlock-"));
  fs.mkdirSync(path.join(ws, ".solosquad"), { recursive: true });
  return ws;
}

function lockFile(ws: string): string {
  return path.join(ws, ".solosquad", "scheduler.pid");
}

test("acquire writes our PID and is idempotent for the same process", () => {
  const ws = tempWs();
  const a = acquireSchedulerLock(ws);
  assert.equal(a.acquired, true);
  assert.equal(readSchedulerPid(ws), process.pid);
  // re-acquiring from the same process still succeeds (not a self-collision)
  assert.equal(acquireSchedulerLock(ws).acquired, true);
});

test("clear removes the lock only for the current process", () => {
  const ws = tempWs();
  acquireSchedulerLock(ws);
  clearSchedulerPid(ws);
  assert.equal(fs.existsSync(lockFile(ws)), false);
  assert.equal(readSchedulerPid(ws), null);
});

test("a stale (dead-PID) lock is reclaimed", () => {
  const ws = tempWs();
  // A PID that is essentially never alive.
  fs.writeFileSync(lockFile(ws), "2147483646");
  assert.equal(readSchedulerPid(ws), null, "dead PID is cleaned on read");
  assert.equal(acquireSchedulerLock(ws).acquired, true, "lock reclaimed after stale cleanup");
  assert.equal(readSchedulerPid(ws), process.pid);
});

// POSIX: PID 1 (init) is always alive and never our own → exercises the
// "held by another live scheduler" path deterministically.
test("a lock held by another live process is refused", { skip: process.platform === "win32" }, () => {
  const ws = tempWs();
  fs.writeFileSync(lockFile(ws), "1");
  const a = acquireSchedulerLock(ws);
  assert.equal(a.acquired, false);
  assert.equal(a.heldBy, 1);
});
