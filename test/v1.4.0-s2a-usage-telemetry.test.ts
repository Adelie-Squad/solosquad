import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChiefRunner } from "../src/bot/chief-runner.js";
import { SessionStore } from "../src/bot/session-store.js";
import { MemoryEventSink, type EventSink, type ChiefUsageEvent } from "../src/bot/events.js";
import {
  FakeClaudeProcessFactory,
  initLine,
  resultLine,
  textAssistantLine,
} from "./fake-claude-process.js";

/**
 * v1.4.0 (S-2a) — passive token-usage telemetry.
 *
 * The Chief turn loop parses the stream-json `result` line's `usage` block and
 * emits a `chief.usage` event. OBSERVATION ONLY: the session must NOT rotate
 * (rotation = S-2b, deferred to v1.4.x). These tests guard that the event is
 * emitted with the right contextTokens, and that turns without usage are
 * silent (no spurious event).
 */

function makeRig(orgSlug = "test-org") {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-s2a-"));
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

function usageEvents(rig: ReturnType<typeof makeRig>, user: string): ChiefUsageEvent[] {
  const sink = rig.events.get(`${rig.orgSlug}:${user}`);
  return (sink?.history ?? []).filter((e): e is ChiefUsageEvent => e.kind === "chief.usage");
}

test("S-2a — emits chief.usage with contextTokens = input + cache_read + cache_creation", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [
      initLine("s", rig.orgCwd, []),
      textAssistantLine("s", "done"),
      resultLine("s", "done", {
        costUsd: 0.05,
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 300,
        },
      }),
    ],
  });

  await rig.pm.handleUserMessage({
    userId: "U1",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "hello",
  });

  const evs = usageEvents(rig, "U1");
  assert.equal(evs.length, 1, "exactly one chief.usage event per turn");
  const ev = evs[0];
  assert.equal(ev.contextTokens, 1000 + 5000 + 300);
  assert.equal(ev.inputTokens, 1000);
  assert.equal(ev.outputTokens, 200);
  assert.equal(ev.cacheReadTokens, 5000);
  assert.equal(ev.cacheCreationTokens, 300);
  assert.equal(ev.costUsd, 0.05);
});

test("S-2a — no usage block → no chief.usage event (no spurious telemetry)", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [
      initLine("s", rig.orgCwd, []),
      textAssistantLine("s", "done"),
      resultLine("s", "done", { costUsd: 0.01 }), // no usage
    ],
  });

  await rig.pm.handleUserMessage({
    userId: "U2",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "hi",
  });

  assert.equal(usageEvents(rig, "U2").length, 0);
});

test("S-2a — observation does NOT rotate the session", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [
      initLine("s", rig.orgCwd, []),
      textAssistantLine("s", "done"),
      resultLine("s", "done", {
        usage: { input_tokens: 999999, cache_read_input_tokens: 999999 },
      }),
    ],
  });

  const reply = await rig.pm.handleUserMessage({
    userId: "U3",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "huge context",
  });

  assert.equal(reply.sessionRotated ?? false, false, "S-2a must not rotate (that is S-2b)");
  const sink = rig.events.get(`${rig.orgSlug}:U3`);
  const rotated = (sink?.history ?? []).filter((e) => e.kind === "chief.session_rotated");
  assert.equal(rotated.length, 0);
});
