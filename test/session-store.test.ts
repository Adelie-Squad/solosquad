import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionStore } from "../src/bot/session-store.js";

function tempWorkspace(orgSlug = "test-org"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-sessstore-"));
  fs.mkdirSync(path.join(dir, orgSlug), { recursive: true });
  return dir;
}

test("ensure() creates a new session record with a UUID on first call", () => {
  const ws = tempWorkspace();
  const store = new SessionStore(ws);
  const { record, fresh } = store.ensure("test-org", "U1");
  assert.equal(fresh, true);
  assert.equal(record.userId, "U1");
  assert.equal(record.orgSlug, "test-org");
  assert.match(record.sessionId, /^[a-f0-9-]{36}$/);
  assert.equal(record.totalCostUsd, 0);
});

test("ensure() returns existing record on second call", () => {
  const ws = tempWorkspace();
  const store = new SessionStore(ws);
  const first = store.ensure("test-org", "U1");
  const second = store.ensure("test-org", "U1");
  assert.equal(second.fresh, false);
  assert.equal(second.record.sessionId, first.record.sessionId);
});

test("rotate() archives the old session and mints a new one", () => {
  const ws = tempWorkspace();
  const store = new SessionStore(ws);
  const { record: orig } = store.ensure("test-org", "U1");
  const { previous, next } = store.rotate("test-org", "U1", "test-rotate");
  assert.equal(previous, orig.sessionId);
  assert.notEqual(next, orig.sessionId);
  const re = store.read("test-org", "U1")!;
  assert.equal(re.sessionId, next);
  assert.equal(re.archived?.length, 1);
  assert.equal(re.archived?.[0].reason, "test-rotate");
});

test("recordTurn() accumulates totalCostUsd and bumps lastInteractionAt", () => {
  const ws = tempWorkspace();
  const store = new SessionStore(ws);
  const { record: original } = store.ensure("test-org", "U1");
  const before = original.lastInteractionAt;

  const sleepStart = Date.now();
  while (Date.now() - sleepStart < 5) { /* spin */ }

  store.recordTurn("test-org", "U1", 0.018);
  store.recordTurn("test-org", "U1", 0.025);
  const after = store.read("test-org", "U1")!;
  assert.equal(after.totalCostUsd, 0.043);
  assert.notEqual(after.lastInteractionAt, before);
});

test("listForOrg() returns all sessions for an org", () => {
  const ws = tempWorkspace();
  const store = new SessionStore(ws);
  store.ensure("test-org", "U1");
  store.ensure("test-org", "U2");
  store.ensure("other-org", "U1");
  const sessions = store.listForOrg("test-org");
  assert.equal(sessions.length, 2);
  const ids = sessions.map((s) => s.userId).sort();
  assert.deepEqual(ids, ["U1", "U2"]);
});

test("userId with special characters is safe-filename-encoded", () => {
  const ws = tempWorkspace();
  const store = new SessionStore(ws);
  store.ensure("test-org", "user@example.com");
  const dir = path.join(ws, "test-org", ".solosquad", "sessions");
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.equal(files[0], "user_example_com.json");
});
