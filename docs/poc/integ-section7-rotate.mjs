// §7 — session rotation on "No conversation found".
//
// Deletes the Claude Code session jsonl mid-conversation, then sends
// a follow-up message. PmRunner should detect the stderr pattern,
// rotate the session-id, and retry.

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { RealClaudeProcessFactory } from "../../dist/src/bot/claude-process.js";
import { PmRunner } from "../../dist/src/bot/pm-runner.js";
import { SessionStore } from "../../dist/src/bot/session-store.js";
import { FileEventSink, pmEventsPath } from "../../dist/src/bot/events.js";

const WORKSPACE = process.env.WS;
const ORG = process.env.ORG;
const USER = process.env.USER_ID || "integ-test-user";

const claude = new RealClaudeProcessFactory();
const sessions = new SessionStore(WORKSPACE);
const pm = new PmRunner({
  claude,
  sessions,
  events: (org, user) => new FileEventSink(pmEventsPath(WORKSPACE, org, user)),
  maxBudgetUsd: 1,
  timeoutMs: 60_000,
});

const recBefore = sessions.read(ORG, USER);
console.log("Existing session:", recBefore?.sessionId);

// Encode cwd the way Claude Code does — slashes → dashes, drive colon → empty
function encodeCwd(cwd) {
  return cwd.replace(/[/\\:]/g, "-").replace(/^-/, "");
}
const orgCwd = path.join(WORKSPACE, ORG);
const cwdEncoded = encodeCwd(orgCwd);
const sessFile = path.join(os.homedir(), ".claude", "projects", cwdEncoded, `${recBefore.sessionId}.jsonl`);
console.log("Session jsonl:", sessFile);
console.log("Exists?", fs.existsSync(sessFile));

if (fs.existsSync(sessFile)) {
  fs.unlinkSync(sessFile);
  console.log("✓ Deleted session jsonl.");
}

console.log("\n=== Sending follow-up — should trigger rotation ===");
const reply = await pm.handleUserMessage({
  userId: USER,
  orgSlug: ORG,
  orgCwd,
  userText: "Please reply with exactly 'ROTATED-OK' and nothing else.",
});

console.log("reply:", reply.text);
console.log("sessionRotated:", reply.sessionRotated);
console.log("costUsd:", reply.costUsd);

const recAfter = sessions.read(ORG, USER);
console.log("\nNew session:", recAfter?.sessionId);
console.log("Archived count:", recAfter?.archived?.length);
console.log("Last archived:", recAfter?.archived?.[recAfter.archived.length - 1]);

const sink = new FileEventSink(pmEventsPath(WORKSPACE, ORG, USER));
const events = sink.list();
const lostEvent = events.findLast((e) => e.kind === "pm.session_lost");
console.log("\npm.session_lost event:", lostEvent);
