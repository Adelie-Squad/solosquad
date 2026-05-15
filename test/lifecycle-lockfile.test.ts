import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireLock,
  LockHeldError,
  readLock,
  isStaleLock,
  isProcessAlive,
  uninstallLockPath,
} from "../src/lifecycle/lockfile.js";

test("acquireLock creates lockfile with PID and timestamp", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-lock-"));
  const lockPath = uninstallLockPath(tmp);
  const handle = acquireLock(lockPath);
  assert.equal(fs.existsSync(lockPath), true);
  const info = readLock(lockPath);
  assert.ok(info);
  assert.equal(info!.pid, process.pid);
  assert.ok(info!.startTs);
  handle.release();
  assert.equal(fs.existsSync(lockPath), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("acquireLock throws LockHeldError when a live holder exists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-lock-"));
  const lockPath = uninstallLockPath(tmp);
  const a = acquireLock(lockPath);
  assert.throws(() => acquireLock(lockPath), LockHeldError);
  a.release();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("acquireLock clears a stale lock (dead PID) and re-acquires", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-lock-"));
  const lockPath = uninstallLockPath(tmp);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  // PID 999999 is overwhelmingly likely to be dead
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: 999999, startTs: "2020-01-01T00:00:00Z", hostname: os.hostname() }),
  );
  assert.equal(isStaleLock(lockPath), true);
  const h = acquireLock(lockPath);
  assert.ok(h);
  assert.equal(readLock(lockPath)!.pid, process.pid);
  h.release();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("isStaleLock returns false for live PID", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-lock-"));
  const lockPath = uninstallLockPath(tmp);
  const h = acquireLock(lockPath);
  assert.equal(isStaleLock(lockPath), false);
  h.release();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("isProcessAlive(0) is false; isProcessAlive(self pid) is true", () => {
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(-1), false);
  assert.equal(isProcessAlive(process.pid), true);
});

test("release is idempotent", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-lock-"));
  const lockPath = uninstallLockPath(tmp);
  const h = acquireLock(lockPath);
  h.release();
  h.release(); // does not throw
  fs.rmSync(tmp, { recursive: true, force: true });
});
