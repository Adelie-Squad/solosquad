import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { WorkflowReconciler } from "../src/bot/workflow-reconciler.js";
import { SessionStore } from "../src/bot/session-store.js";
import { FileEventSink, pmEventsPath, workflowEventsPath } from "../src/bot/events.js";

function tempWorkspace(orgSlug = "test-org"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-recon-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    `version: 1.2.5\ndisplay_name: t\ncreated_at: 2026-05-12T00:00:00Z\n`
  );
  fs.mkdirSync(path.join(dir, orgSlug), { recursive: true });
  fs.writeFileSync(
    path.join(dir, orgSlug, ".org.yaml"),
    `slug: ${orgSlug}\nname: ${orgSlug}\nprovider: github\nrepos: []\ncreated_at: 2026-05-12T00:00:00Z\n`
  );
  return dir;
}

function writeStatus(
  ws: string,
  orgSlug: string,
  workflowId: string,
  stages: Array<{ id: string; status: string; agent?: string }>
) {
  const wfDir = path.join(ws, orgSlug, "workflows", workflowId);
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, "_status.yaml"),
    yaml.dump({ workflow_id: workflowId, stages })
  );
}

test("reconcileAll flips orphaned in_progress stages to needs_revision", async () => {
  const ws = tempWorkspace();
  const orgSlug = "test-org";
  writeStatus(ws, orgSlug, "wf-test-1", [
    { id: "stage-1", status: "completed", agent: "desk-researcher" },
    { id: "stage-2", status: "in_progress", agent: "ui-designer" },
    { id: "stage-3", status: "pending", agent: "backend-developer" },
  ]);

  const reconciler = new WorkflowReconciler(ws, new SessionStore(ws));
  const report = await reconciler.reconcileAll();

  assert.equal(report.scannedWorkflows, 1);
  assert.equal(report.recoveredStages.length, 1);
  assert.equal(report.recoveredStages[0].stageId, "stage-2");
  assert.equal(report.recoveredStages[0].action, "marked_needs_revision");

  const statusAfter = yaml.load(
    fs.readFileSync(path.join(ws, orgSlug, "workflows", "wf-test-1", "_status.yaml"), "utf-8")
  ) as { stages: Array<{ id: string; status: string }> };
  const stage2 = statusAfter.stages.find((s) => s.id === "stage-2");
  assert.equal(stage2?.status, "needs_revision");

  // Event was appended
  const evPath = workflowEventsPath(ws, orgSlug, "wf-test-1");
  const events = new FileEventSink(evPath).list();
  const ev = events.find((e) => e.kind === "workflow.stage_needs_revision");
  assert.ok(ev);
});

test("reconcileAll surfaces a fallback notice when no pm.message_out follows pm.message_in", async () => {
  const ws = tempWorkspace();
  const orgSlug = "test-org";
  const userId = "U_pending";

  const sessions = new SessionStore(ws);
  sessions.ensure(orgSlug, userId);

  const sink = new FileEventSink(pmEventsPath(ws, orgSlug, userId));
  sink.append({
    ts: "2026-05-12T10:00:00Z",
    kind: "pm.message_in",
    text: "unanswered message",
    userId,
  });
  // No matching pm.message_out — bot crashed mid-turn.

  const reconciler = new WorkflowReconciler(ws, sessions);
  const report = await reconciler.reconcileAll();

  assert.equal(report.pendingDeliveries.length, 1);
  const d = report.pendingDeliveries[0];
  assert.equal(d.userId, userId);
  assert.equal(d.source, "fallback-notice");
  assert.match(d.text, /bot restarted/i);

  // Reconciler should have written a pm.message_out so it doesn't re-notify
  const events = sink.list();
  assert.ok(events.some((e) => e.kind === "pm.message_out"));
});

test("reconcileAll uses stage_id mapping — completed spawn for stage keeps it in_progress untouched", async () => {
  const ws = tempWorkspace();
  const orgSlug = "test-org";
  writeStatus(ws, orgSlug, "wf-precise", [
    { id: "stage-1-research", status: "in_progress", agent: "desk-researcher" },
  ]);

  // Spawn for stage-1-research was both started AND completed — should NOT flip.
  const evPath = workflowEventsPath(ws, orgSlug, "wf-precise");
  const sink = new FileEventSink(evPath);
  sink.append({
    ts: "2026-05-13T10:00:00Z",
    kind: "spawn.start",
    taskId: "task-aaa",
    toolUseId: "u1",
    agent: "desk-researcher",
    description: "research",
    stageId: "stage-1-research",
    workflowId: "wf-precise",
  });
  sink.append({
    ts: "2026-05-13T10:00:09Z",
    kind: "spawn.complete",
    taskId: "task-aaa",
    toolUseId: "u1",
    totalTokens: 1000,
    toolUses: 0,
    durationMs: 9000,
  });

  const reconciler = new WorkflowReconciler(ws, new SessionStore(ws));
  const report = await reconciler.reconcileAll();
  // Stage is still in_progress only because PM hasn't updated _status.yaml yet
  // — but reconciler shouldn't flip it: its spawn DID complete.
  // (Reconciler is conservative: keep in_progress, let PM decide.)
  assert.equal(report.recoveredStages.length, 0);
});

test("reconcileAll uses stage_id mapping — stage with no recorded spawn → needs_revision", async () => {
  const ws = tempWorkspace();
  const orgSlug = "test-org";
  writeStatus(ws, orgSlug, "wf-orphan", [
    { id: "stage-1-research", status: "in_progress", agent: "desk-researcher" },
  ]);
  // No spawn events at all for this stage.

  const reconciler = new WorkflowReconciler(ws, new SessionStore(ws));
  const report = await reconciler.reconcileAll();
  assert.equal(report.recoveredStages.length, 1);
  assert.equal(report.recoveredStages[0].stageId, "stage-1-research");
});

test("reconcileAll is a no-op when last message_in already has a message_out", async () => {
  const ws = tempWorkspace();
  const orgSlug = "test-org";
  const userId = "U_clean";

  const sessions = new SessionStore(ws);
  sessions.ensure(orgSlug, userId);

  const sink = new FileEventSink(pmEventsPath(ws, orgSlug, userId));
  sink.append({
    ts: "2026-05-12T10:00:00Z",
    kind: "pm.message_in",
    text: "hi",
    userId,
  });
  sink.append({
    ts: "2026-05-12T10:00:05Z",
    kind: "pm.message_out",
    text: "hi back",
    costUsd: 0.02,
    durationMs: 5000,
    userId,
  });

  const reconciler = new WorkflowReconciler(ws, sessions);
  const report = await reconciler.reconcileAll();

  assert.equal(report.pendingDeliveries.length, 0);
});
