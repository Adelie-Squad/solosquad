import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChiefRunner } from "../src/bot/chief-runner.js";
import { SessionStore } from "../src/bot/session-store.js";
import { MemoryEventSink, type EventSink } from "../src/bot/events.js";
import { FakeClaudeProcessFactory, initLine, resultLine } from "./fake-claude-process.js";

/**
 * v1.4.0 — "session start" signal (ChiefReply.newSession).
 *
 * newSession is true when a turn opens a NEW Chief session (no transcript to
 * resume): a brand-new session, a fresh start after `chief reset`, or a
 * mid-turn rotation recovery. The Discord adapter renders a "🆕 세션 시작"
 * marker before the Chief name on such a reply. These tests guard the signal.
 */

function makeRig(orgSlug = "test-org") {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-newsession-"));
  fs.mkdirSync(path.join(workspace, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, ".solosquad", "workspace.yaml"),
    "version: 0.3.0\ndisplay_name: test\ncreated_at: 2026-06-27T00:00:00Z\n",
    "utf-8",
  );
  fs.mkdirSync(path.join(workspace, orgSlug), { recursive: true });
  const orgCwd = path.join(workspace, orgSlug);
  const fake = new FakeClaudeProcessFactory();
  const sessions = new SessionStore(workspace);
  const events = new Map<string, MemoryEventSink>();
  const sinkFor = (org: string, user: string): EventSink => {
    const key = `${org}:${user}`;
    let s = events.get(key);
    if (!s) {
      s = new MemoryEventSink();
      events.set(key, s);
    }
    return s;
  };
  const pm = new ChiefRunner({ claude: fake, sessions, events: sinkFor });
  return { workspace, orgSlug, orgCwd, fake, sessions, pm, events };
}

test("newSession=true on the first-ever turn", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [initLine("s", rig.orgCwd), resultLine("s", "hello", { costUsd: 0.01 })],
  });
  const reply = await rig.pm.handleUserMessage({
    userId: "U1", orgSlug: rig.orgSlug, orgCwd: rig.orgCwd, userText: "hi",
  });
  assert.equal(reply.newSession, true);
  // first-ever turn must NOT resume.
  assert.equal(rig.fake.invocations[0].resume, false);
});

test("newSession=false on a continuation turn (resumes the session)", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [initLine("s", rig.orgCwd), resultLine("s", "ok", { costUsd: 0.01 })],
  });
  await rig.pm.handleUserMessage({
    userId: "U1", orgSlug: rig.orgSlug, orgCwd: rig.orgCwd, userText: "first",
  });
  const second = await rig.pm.handleUserMessage({
    userId: "U1", orgSlug: rig.orgSlug, orgCwd: rig.orgCwd, userText: "second",
  });
  assert.equal(second.newSession, false, "a resumed turn is not a new session");
  assert.equal(rig.fake.invocations[1].resume, true);
});

test("newSession=true after a mid-turn rotation (session-not-found recovery)", async () => {
  const rig = makeRig();
  rig.sessions.ensure(rig.orgSlug, "U1");
  const rec = rig.sessions.read(rig.orgSlug, "U1")!;
  rec.lastInteractionAt = new Date().toISOString();
  rig.sessions.write(rec);

  rig.fake.setDefaultScenario({
    lines: [initLine("placeholder", rig.orgCwd), resultLine("placeholder", "recovered", { costUsd: 0.01 })],
  });
  rig.fake.registerScenario(
    { sessionId: rec.sessionId, resume: true },
    { lines: [], stderr: `No conversation found with session ID: ${rec.sessionId}\n`, exitCode: 1 },
  );

  const reply = await rig.pm.handleUserMessage({
    userId: "U1", orgSlug: rig.orgSlug, orgCwd: rig.orgCwd, userText: "hi",
  });
  assert.equal(reply.sessionRotated, true);
  assert.equal(reply.newSession, true, "a rotated/restarted session is a new session");
});
