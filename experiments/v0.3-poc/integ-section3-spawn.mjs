// §3 of V0.3-INTEGRATION-TEST-PLAN.md — subagent spawn via Task tool.
//
// Assumes §2 already ran (PM session exists for this user).

import path from "node:path";
import { RealClaudeProcessFactory } from "../../dist/src/bot/claude-process.js";
import { PmRunner } from "../../dist/src/bot/pm-runner.js";
import { SessionStore } from "../../dist/src/bot/session-store.js";
import { FileEventSink, pmEventsPath } from "../../dist/src/bot/events.js";

const WORKSPACE = process.env.WS;
const ORG = process.env.ORG;
const USER = process.env.USER_ID || "integ-test-user";

if (!WORKSPACE || !ORG) {
  console.error("Set WS and ORG env vars first.");
  process.exit(1);
}

const claude = new RealClaudeProcessFactory();
const sessions = new SessionStore(WORKSPACE);
const pm = new PmRunner({
  claude,
  sessions,
  events: (org, user) => new FileEventSink(pmEventsPath(WORKSPACE, org, user)),
  maxBudgetUsd: 3,
  timeoutMs: 240_000,
});

console.log("=== §3 subagent spawn test ===");

const reply = await pm.handleUserMessage({
  userId: USER,
  orgSlug: ORG,
  orgCwd: path.join(WORKSPACE, ORG),
  userText:
    "Delegate this to the idea-refiner subagent via the Task tool: 'Brainstorm 3 short product-name ideas for a 1-person developer task manager. Each name <= 2 words. Just list them on numbered lines, nothing else.' Then report what idea-refiner returned, verbatim. Do not brainstorm yourself.",
});
console.log("\nReply:", reply.text);
console.log("\nspawnCount:", reply.spawnCount);
console.log("costUsd:", reply.costUsd);
console.log("durationMs:", reply.durationMs);

console.log("\n=== Events since §2 ===");
const sink = new FileEventSink(pmEventsPath(WORKSPACE, ORG, USER));
const events = sink.list();
// Show only the last 4 events from this turn
const tailEvents = events.slice(-Math.max(4, reply.spawnCount * 2 + 2));
for (const ev of tailEvents) {
  console.log(ev);
}

console.log("\n=== Spawn summary ===");
const spawnStarts = events.filter((e) => e.kind === "spawn.start");
const spawnCompletes = events.filter((e) => e.kind === "spawn.complete");
console.log(`spawn.start count: ${spawnStarts.length}`);
console.log(`spawn.complete count: ${spawnCompletes.length}`);
if (spawnCompletes.length > 0) {
  const last = spawnCompletes[spawnCompletes.length - 1];
  console.log("last spawn task_id:", last.taskId);
  console.log("last spawn tokens:", last.totalTokens, "tools:", last.toolUses, "duration:", last.durationMs);
}
