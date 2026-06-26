import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyIncoming } from "../src/bot/user-registry.js";
import { resolveWorkflowIdByThread } from "../src/bot/workspace-meta.js";

/**
 * v1.4.1 — works-thread chat routing.
 *
 * classifyIncoming decides whether an incoming Discord message is handled and
 * as what surface; resolveWorkflowIdByThread reverse-looks-up a thread's task.
 * These guard the listener-extension + security parity (PRD v1.4.1 §6.3).
 */

test("classifyIncoming — command-<handle> channel for this bot → command", () => {
  assert.deepEqual(
    classifyIncoming({ channelName: "command-alice", isThread: false, parentChannelName: null, ownHandle: "alice" }),
    { kind: "command" },
  );
});

test("classifyIncoming — thread under works-<handle> for this bot → works-thread", () => {
  assert.deepEqual(
    classifyIncoming({ channelName: "workflow-wf-1", isThread: true, parentChannelName: "works-alice", ownHandle: "alice" }),
    { kind: "works-thread" },
  );
});

test("classifyIncoming — another user's command channel → ignored", () => {
  assert.equal(
    classifyIncoming({ channelName: "command-bob", isThread: false, parentChannelName: null, ownHandle: "alice" }),
    null,
  );
});

test("classifyIncoming — thread under another user's works channel → ignored", () => {
  assert.equal(
    classifyIncoming({ channelName: "t", isThread: true, parentChannelName: "works-bob", ownHandle: "alice" }),
    null,
  );
});

test("classifyIncoming — works-<handle> channel ROOT (not a thread) → ignored", () => {
  // Messages typed directly in the works channel (not a thread) stay ignored;
  // only task threads are in scope for v1.4.1.
  assert.equal(
    classifyIncoming({ channelName: "works-alice", isThread: false, parentChannelName: null, ownHandle: "alice" }),
    null,
  );
});

test("classifyIncoming — thread whose parent is NOT a works channel → ignored", () => {
  assert.equal(
    classifyIncoming({ channelName: "t", isThread: true, parentChannelName: "command-alice", ownHandle: "alice" }),
    null,
  );
});

test("classifyIncoming — no ownHandle (bot not bound) → ignored", () => {
  assert.equal(
    classifyIncoming({ channelName: "command-alice", isThread: false, parentChannelName: null, ownHandle: null }),
    null,
  );
});

test("resolveWorkflowIdByThread — matches the workflow that owns the thread", () => {
  const orgCwd = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-thr-"));
  const wfDir = path.join(orgCwd, "workflows", "wf-2026-06-27-demo");
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, "discord-thread.txt"),
    "thread_id=T-123456\nthread_url=https://discord.com/x\nworks_message_id=M-9\nkind=workflow\nstarted_at=2026-06-27T00:00:00Z\n",
  );
  // a decoy workflow without a thread file
  fs.mkdirSync(path.join(orgCwd, "workflows", "wf-other"), { recursive: true });

  assert.equal(resolveWorkflowIdByThread(orgCwd, "T-123456"), "wf-2026-06-27-demo");
  assert.equal(resolveWorkflowIdByThread(orgCwd, "T-nope"), null);
});

test("resolveWorkflowIdByThread — no workflows dir → null", () => {
  const orgCwd = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-thr-empty-"));
  assert.equal(resolveWorkflowIdByThread(orgCwd, "T-1"), null);
});
