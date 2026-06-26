import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChiefRunner } from "../src/bot/chief-runner.js";
import { SessionStore } from "../src/bot/session-store.js";
import { MemoryEventSink, type EventSink } from "../src/bot/events.js";
import type { StreamJsonOutputLine } from "../src/bot/claude-process.js";
import { FakeClaudeProcessFactory, initLine, resultLine } from "./fake-claude-process.js";

/**
 * v1.4.2 — chief-runner surfaces the Claude Code rate-limit status (from a
 * `rate_limit_event` stream line) on the reply so the messenger can de-dupe it.
 */

function makeRig(orgSlug = "test-org") {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-rl-"));
  fs.mkdirSync(path.join(workspace, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, ".solosquad", "workspace.yaml"),
    "version: 0.3.0\ndisplay_name: test\ncreated_at: 2026-06-27T00:00:00Z\n",
  );
  fs.mkdirSync(path.join(workspace, orgSlug), { recursive: true });
  const orgCwd = path.join(workspace, orgSlug);
  const fake = new FakeClaudeProcessFactory();
  const sessions = new SessionStore(workspace);
  const events = new Map<string, MemoryEventSink>();
  const sinkFor = (org: string, user: string): EventSink => {
    const k = `${org}:${user}`;
    let s = events.get(k);
    if (!s) events.set(k, (s = new MemoryEventSink()));
    return s;
  };
  const pm = new ChiefRunner({ claude: fake, sessions, events: sinkFor });
  return { orgSlug, orgCwd, fake, pm };
}

function rateLimitLine(status: string, resetsAt?: number): StreamJsonOutputLine {
  return { type: "rate_limit_event", rate_limit_info: { status, resetsAt } } as unknown as StreamJsonOutputLine;
}

test("reply.rateLimit carries `warning` from a rate_limit_event", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [
      initLine("s", rig.orgCwd),
      rateLimitLine("warning", 1717),
      resultLine("s", "hi", { costUsd: 0.01 }),
    ],
  });
  const reply = await rig.pm.handleUserMessage({
    userId: "U1", orgSlug: rig.orgSlug, orgCwd: rig.orgCwd, userText: "안녕",
  });
  assert.equal(reply.rateLimited, true);
  assert.deepEqual(reply.rateLimit, { status: "warning", resetsAt: 1717 });
});

test("an `allowed` status produces no rate-limit on the reply", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [
      initLine("s", rig.orgCwd),
      rateLimitLine("allowed"),
      resultLine("s", "hi", { costUsd: 0.01 }),
    ],
  });
  const reply = await rig.pm.handleUserMessage({
    userId: "U1", orgSlug: rig.orgSlug, orgCwd: rig.orgCwd, userText: "안녕",
  });
  assert.equal(reply.rateLimited, false);
  assert.equal(reply.rateLimit, undefined);
});
