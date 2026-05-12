// §2 of V0.3-INTEGRATION-TEST-PLAN.md — PM bootstrap without messenger.
//
// Usage: WS=<workspace> ORG=<org-slug> node integ-section2-bootstrap.mjs
//
// Drives PmRunner against the real Claude Code subprocess. Caps cost at $2
// per call so a runaway prompt cache miss can't drain the wallet.

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
  maxBudgetUsd: 2,
  timeoutMs: 180_000,
});

console.log("=== PM bootstrap ===");
console.log("Workspace:", WORKSPACE);
console.log("Org:", ORG);
console.log("User:", USER);
console.log("Auth status:", await claude.authStatus());

console.log("\n=== Call 1 — fresh session ===");
const t0 = Date.now();
const r1 = await pm.handleUserMessage({
  userId: USER,
  orgSlug: ORG,
  orgCwd: path.join(WORKSPACE, ORG),
  userText:
    "Just reply with the literal word READY and nothing else, on one line.",
});
console.log("reply:", JSON.stringify(r1.text));
console.log("costUsd:", r1.costUsd, "spawns:", r1.spawnCount, "durationMs:", r1.durationMs);
console.log("session rotated?", r1.sessionRotated);

const t1 = Date.now();
console.log("\n=== Call 2 — resume should hit cache ===");
const r2 = await pm.handleUserMessage({
  userId: USER,
  orgSlug: ORG,
  orgCwd: path.join(WORKSPACE, ORG),
  userText:
    "What did you say in your previous reply? Just repeat that single word.",
});
console.log("reply:", JSON.stringify(r2.text));
console.log("costUsd:", r2.costUsd, "spawns:", r2.spawnCount, "durationMs:", r2.durationMs);
console.log("ratio:", (r1.costUsd / r2.costUsd).toFixed(2) + "x cost reduction on resume");

const sessRec = sessions.read(ORG, USER);
console.log("\n=== Session record ===");
console.log(sessRec);

console.log("\n=== Events ===");
const sink = new FileEventSink(pmEventsPath(WORKSPACE, ORG, USER));
for (const ev of sink.list()) {
  console.log(ev);
}

console.log("\n=== Total wall-clock ===", (Date.now() - t0) + "ms,  call 2 alone:", (Date.now() - t1) + "ms");
