import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChiefRunner, AuthExpiredError } from "../src/bot/chief-runner.js";
import { SessionStore } from "../src/bot/session-store.js";
import { MemoryEventSink, type EventSink } from "../src/bot/events.js";
import {
  FakeClaudeProcessFactory,
  initLine,
  resultLine,
  textAssistantLine,
  taskStartedLine,
  taskNotificationLine,
} from "./fake-claude-process.js";

function tempWorkspace(orgSlug = "test-org"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-pmrunner-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    `version: 0.3.0\ndisplay_name: test\ncreated_at: 2026-05-12T00:00:00Z\n`,
    "utf-8"
  );
  fs.mkdirSync(path.join(dir, orgSlug), { recursive: true });
  return dir;
}

interface TestRig {
  workspace: string;
  orgSlug: string;
  orgCwd: string;
  fake: FakeClaudeProcessFactory;
  sessions: SessionStore;
  pm: ChiefRunner;
  events: Map<string, MemoryEventSink>;
}

function makeRig(orgSlug = "test-org"): TestRig {
  const workspace = tempWorkspace(orgSlug);
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("cancelTurn returns false when no turn is in flight (v1.2.9 §D)", () => {
  const rig = makeRig();
  assert.equal(rig.pm.cancelTurn(rig.orgSlug, "nobody"), false);
});

test("cancelTurn aborts an in-flight turn and marks the reply aborted (v1.2.9 §D)", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [
      initLine("placeholder", rig.orgCwd, []),
      textAssistantLine("placeholder", "working..."),
      textAssistantLine("placeholder", "still working..."),
      resultLine("placeholder", "done", { costUsd: 0.01 }),
    ],
    delayMsPerLine: 50,
  });
  const p = rig.pm.handleUserMessage({
    userId: "U1",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "long running task",
  });
  await sleep(60); // let the turn register as in-flight
  assert.equal(rig.pm.cancelTurn(rig.orgSlug, "U1"), true);
  const reply = await p;
  assert.equal(reply.aborted, true);
});

test("PM happy path — fresh session, single turn, message_in/out recorded", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [
      initLine("placeholder", rig.orgCwd, ["desk-researcher"]),
      textAssistantLine("placeholder", "Hello — what aspect should I clarify?"),
      resultLine("placeholder", "Hello — what aspect should I clarify?", { costUsd: 0.018 }),
    ],
  });

  const reply = await rig.pm.handleUserMessage({
    userId: "U1",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "Plan landing page redesign",
  });

  assert.equal(reply.text, "Hello — what aspect should I clarify?");
  assert.equal(reply.spawnCount, 0);
  assert.equal(reply.rateLimited, false);
  assert.equal(reply.sessionRotated, false);
  assert.ok(reply.costUsd > 0);

  const sink = rig.events.get(`${rig.orgSlug}:U1`)!;
  const kinds = sink.history.map((e) => e.kind);
  assert.deepEqual(kinds, ["pm.message_in", "pm.message_out"]);

  assert.equal(rig.fake.invocations.length, 1);
  assert.equal(rig.fake.invocations[0].resume, false);

  await rig.pm.handleUserMessage({
    userId: "U1",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "Hero section + CTA",
  });
  assert.equal(rig.fake.invocations.length, 2);
  assert.equal(rig.fake.invocations[1].resume, true);
});

test("PM serializes concurrent calls on same session-id", async () => {
  const rig = makeRig();
  const started: number[] = [];
  const finished: number[] = [];
  rig.fake.beforeInvoke = (i) => started.push(i);
  rig.fake.afterInvoke = (i) => finished.push(i);
  rig.fake.setDefaultScenario({
    delayMsPerLine: 10,
    lines: [
      initLine("placeholder", rig.orgCwd),
      resultLine("placeholder", "ok", { costUsd: 0.01 }),
    ],
  });

  await Promise.all([
    rig.pm.handleUserMessage({
      userId: "U1",
      orgSlug: rig.orgSlug,
      orgCwd: rig.orgCwd,
      userText: "first",
    }),
    rig.pm.handleUserMessage({
      userId: "U1",
      orgSlug: rig.orgSlug,
      orgCwd: rig.orgCwd,
      userText: "second",
    }),
  ]);

  assert.equal(started.length, 2);
  assert.equal(finished.length, 2);
  // mutex must keep invocation 1 from starting until invocation 0 finishes
  assert.equal(finished[0], started[0], "first invocation must finish before second starts");
  assert.equal(started[1], 1);
});

test("PM throws AuthExpiredError when claude prints 'Not logged in'", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [],
    unparsedStdout: "Not logged in · Please run /login\n",
    exitCode: 1,
  });

  await assert.rejects(
    rig.pm.handleUserMessage({
      userId: "U1",
      orgSlug: rig.orgSlug,
      orgCwd: rig.orgCwd,
      userText: "hi",
    }),
    AuthExpiredError
  );

  const sink = rig.events.get(`${rig.orgSlug}:U1`)!;
  const kinds = sink.history.map((e) => e.kind);
  assert.ok(kinds.includes("pm.auth_expired"));
});

test("PM rotates session-id on 'No conversation found' and retries once", async () => {
  const rig = makeRig();
  rig.sessions.ensure(rig.orgSlug, "U1");
  const rec = rig.sessions.read(rig.orgSlug, "U1")!;
  rec.lastInteractionAt = new Date().toISOString();
  rig.sessions.write(rec);

  rig.fake.setDefaultScenario({
    lines: [
      initLine("placeholder", rig.orgCwd),
      resultLine("placeholder", "recovered", { costUsd: 0.012 }),
    ],
  });

  rig.fake.registerScenario(
    { sessionId: rec.sessionId, resume: true },
    {
      lines: [],
      stderr: `No conversation found with session ID: ${rec.sessionId}\n`,
      exitCode: 1,
    }
  );

  const reply = await rig.pm.handleUserMessage({
    userId: "U1",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "hi",
  });

  assert.equal(reply.sessionRotated, true);
  assert.equal(reply.text, "recovered");
  assert.equal(rig.fake.invocations.length, 2);

  // Retry after rotation must use the new session-id with resume=false
  // (the rotated UUID has never been seen by Claude Code yet).
  assert.equal(rig.fake.invocations[0].resume, true, "first call resumes existing session");
  assert.equal(rig.fake.invocations[1].resume, false, "retry uses --session-id on the new UUID");
  assert.notEqual(rig.fake.invocations[1].sessionId, rec.sessionId, "retry uses the rotated UUID");

  const sink = rig.events.get(`${rig.orgSlug}:U1`)!;
  const kinds = sink.history.map((e) => e.kind);
  assert.ok(kinds.includes("pm.session_lost"));
});

test("PM records spawn.start + spawn.complete from task_started/task_notification", async () => {
  const rig = makeRig();
  const taskId = "task-abc-123";
  const toolUseId = "toolu_xyz";
  rig.fake.setDefaultScenario({
    lines: [
      initLine("placeholder", rig.orgCwd, ["desk-researcher"]),
      taskStartedLine("placeholder", taskId, toolUseId, "desk-researcher", "Find 3 refs"),
      taskNotificationLine("placeholder", taskId, toolUseId, "completed", {
        total_tokens: 22300,
        tool_uses: 1,
        duration_ms: 9500,
      }),
      textAssistantLine("placeholder", "Found 3 references."),
      resultLine("placeholder", "Found 3 references.", { costUsd: 0.05 }),
    ],
  });

  const reply = await rig.pm.handleUserMessage({
    userId: "U1",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "find references",
  });

  assert.equal(reply.spawnCount, 1);

  const sink = rig.events.get(`${rig.orgSlug}:U1`)!;
  const spawnStart = sink.history.find((e) => e.kind === "spawn.start");
  const spawnComplete = sink.history.find((e) => e.kind === "spawn.complete");
  assert.ok(spawnStart, "spawn.start event should be recorded");
  assert.ok(spawnComplete, "spawn.complete event should be recorded");
  assert.equal((spawnComplete as { taskId: string }).taskId, taskId);
  assert.equal(
    (spawnComplete as { totalTokens: number }).totalTokens,
    22300
  );

  // Dedup test: appending the same task_notification twice produces only 1 row
  sink.append({
    ts: new Date().toISOString(),
    kind: "spawn.complete",
    taskId,
    toolUseId,
    totalTokens: 22300,
    toolUses: 1,
    durationMs: 9500,
  });
  const completes = sink.history.filter((e) => e.kind === "spawn.complete");
  assert.equal(completes.length, 1, "dedup by task_id should prevent duplicate spawn.complete");
});

test("v1.1 §5.2 — Chief stage events emit TRIAGE → SYNTHESIZE → DECIDE → RETROSPECT on a discussion-only turn", async () => {
  const rig = makeRig();
  rig.fake.setDefaultScenario({
    lines: [
      initLine("placeholder", rig.orgCwd, ["desk-researcher"]),
      textAssistantLine("placeholder", "Acknowledged."),
      resultLine("placeholder", "Acknowledged.", { costUsd: 0.01 }),
    ],
  });

  await rig.pm.handleUserMessage({
    userId: "U1",
    orgSlug: rig.orgSlug,
    orgCwd: rig.orgCwd,
    userText: "Just checking in.",
  });

  const { readEvents } = await import("../src/util/chief-stage-events.js");
  const events = readEvents({ orgRoot: rig.orgCwd });
  const stages = events.map((e) => e.stage);
  assert.deepEqual(
    stages,
    ["TRIAGE", "SYNTHESIZE", "DECIDE", "RETROSPECT"],
    "discussion turn: no DECOMPOSE/DISPATCH/AWAIT, only the closing arc"
  );
  // All events share the same turn_id.
  const turnIds = new Set(events.map((e) => e.turn_id));
  assert.equal(turnIds.size, 1, "all stages in one turn share a turn_id");
});
