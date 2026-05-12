import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getOrgDir } from "../util/paths.js";
import { listOrganizations } from "../util/config.js";
import { SessionStore } from "./session-store.js";
import {
  FileEventSink,
  pmEventsPath,
  workflowEventsPath,
  nowIso,
  type AnyEvent,
} from "./events.js";
import { readLastAssistantTurn, sessionJsonlPath } from "./cc-jsonl-reader.js";

/**
 * v1.3.1 — boot-time reconciliation.
 *
 * Two recovery paths:
 *
 * 1. **In-flight workflow stages** — if `<org>/workflows/<wf-id>/_status.yaml`
 *    has any stage with `status: in_progress` but no matching spawn.complete
 *    event in `_events.jsonl`, the stage was killed mid-run. Flip it to
 *    `needs_revision` so the PM (on next user message) asks the user how
 *    to proceed. Append a workflow.stage_needs_revision event.
 *
 * 2. **Undelivered PM messages** — if the PM session's `events.jsonl` has
 *    a `pm.message_in` without a paired `pm.message_out`, the assistant
 *    reply may exist inside Claude Code's session jsonl (Claude Code
 *    writes it to disk independent of our stdout pipe — see PoC #2 §1.2).
 *    Read it and surface via the `pendingDeliveries` array so the bot can
 *    deliver it back to the messenger.
 *
 * Per docs/plan/v0.3-pm-mode-orchestration.md §3 + RECOVERY-AND-TEST-DESIGN.md §3.
 */

export interface PendingDelivery {
  orgSlug: string;
  userId: string;
  text: string;
  source: "cc-jsonl" | "fallback-notice";
}

export interface RecoveredStage {
  orgSlug: string;
  workflowId: string;
  stageId: string;
  action: "marked_needs_revision" | "completed_post_hoc";
}

export interface ReconcileReport {
  scannedWorkflows: number;
  scannedSessions: number;
  recoveredStages: RecoveredStage[];
  pendingDeliveries: PendingDelivery[];
}

interface StatusYaml {
  workflow_id?: string;
  stages?: Array<{
    id: string;
    status: string;
    agent?: string;
    target_repo?: string | null;
    depends_on?: string[];
  }>;
}

export class WorkflowReconciler {
  constructor(
    private readonly workspace: string,
    private readonly sessions: SessionStore
  ) {}

  /** Bot-startup call. Scans every org for orphaned state. */
  async reconcileAll(): Promise<ReconcileReport> {
    const orgs = listOrganizations(this.workspace);
    const report: ReconcileReport = {
      scannedWorkflows: 0,
      scannedSessions: 0,
      recoveredStages: [],
      pendingDeliveries: [],
    };

    for (const org of orgs) {
      // Workflow stage recovery
      const workflowsDir = path.join(getOrgDir(org.slug, this.workspace), "workflows");
      if (fs.existsSync(workflowsDir)) {
        for (const entry of fs.readdirSync(workflowsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const recovered = this.reconcileWorkflow(org.slug, entry.name);
          report.scannedWorkflows++;
          for (const r of recovered) report.recoveredStages.push(r);
        }
      }

      // Session undelivered-message recovery
      const sessions = this.sessions.listForOrg(org.slug);
      for (const sess of sessions) {
        report.scannedSessions++;
        const pending = this.recoverUndeliveredMessage(org.slug, sess.userId, sess.sessionId);
        if (pending) report.pendingDeliveries.push(pending);
      }
    }

    return report;
  }

  /** Reconcile a single workflow. Returns the list of stages flipped. */
  reconcileWorkflow(orgSlug: string, workflowId: string): RecoveredStage[] {
    const statusPath = path.join(
      getOrgDir(orgSlug, this.workspace),
      "workflows",
      workflowId,
      "_status.yaml"
    );
    if (!fs.existsSync(statusPath)) return [];

    let doc: StatusYaml;
    try {
      doc = yaml.load(fs.readFileSync(statusPath, "utf-8")) as StatusYaml;
    } catch {
      return [];
    }
    if (!Array.isArray(doc.stages)) return [];

    const events = this.readWorkflowEvents(orgSlug, workflowId);
    const completedTaskIds = new Set(
      events
        .filter((e) => e.kind === "spawn.complete")
        .map((e) => (e as { taskId: string }).taskId)
    );
    const failedTaskIds = new Set(
      events
        .filter((e) => e.kind === "spawn.fail")
        .map((e) => (e as { taskId: string }).taskId)
    );

    const out: RecoveredStage[] = [];
    let mutated = false;
    for (const stage of doc.stages) {
      if (stage.status !== "in_progress") continue;
      // Heuristic: any spawn for this stage that has a completion?
      // We don't strictly map task_id to stage_id yet (that mapping lands
      // in v0.3.2 via the workspace-meta builder). For now, if the stage
      // is in_progress and no spawn.complete event exists at all for it,
      // flip to needs_revision and let the PM ask the user.
      const stageTouchedByCompletedSpawn = events.some(
        (e) =>
          e.kind === "spawn.complete" &&
          stage.agent &&
          (e as { taskId: string }).taskId.includes(stage.agent)
      );

      if (stageTouchedByCompletedSpawn) continue;

      stage.status = "needs_revision";
      mutated = true;
      out.push({
        orgSlug,
        workflowId,
        stageId: stage.id,
        action: "marked_needs_revision",
      });

      this.appendWorkflowEvent(orgSlug, workflowId, {
        ts: nowIso(),
        kind: "workflow.stage_needs_revision",
        workflowId,
        stageId: stage.id,
        agent: stage.agent,
      });
    }

    if (mutated) {
      fs.writeFileSync(statusPath, yaml.dump(doc, { lineWidth: 100 }));
    }

    // Touch completed/failed sets to keep the unused-warning silent.
    void completedTaskIds;
    void failedTaskIds;
    return out;
  }

  /**
   * Check whether the user's last PM turn was delivered. If not, try to
   * pull the assistant reply from Claude Code's session jsonl.
   */
  private recoverUndeliveredMessage(
    orgSlug: string,
    userId: string,
    sessionId: string
  ): PendingDelivery | null {
    const sinkPath = pmEventsPath(this.workspace, orgSlug, userId);
    if (!fs.existsSync(sinkPath)) return null;
    const events = new FileEventSink(sinkPath).list();
    if (events.length === 0) return null;

    // Pair message_in <-> message_out chronologically. If the last
    // message_in has no subsequent message_out, treat it as undelivered.
    let lastIn: AnyEvent | null = null;
    let lastInIdx = -1;
    let lastOutIdx = -1;
    for (let i = 0; i < events.length; i++) {
      if (events[i].kind === "pm.message_in") {
        lastIn = events[i];
        lastInIdx = i;
      } else if (events[i].kind === "pm.message_out") {
        lastOutIdx = i;
      }
    }
    if (!lastIn) return null;
    if (lastOutIdx > lastInIdx) return null; // last in was already delivered

    // Try to recover the assistant reply from Claude Code's jsonl.
    const orgCwd = getOrgDir(orgSlug, this.workspace);
    const turn = readLastAssistantTurn(sessionJsonlPath(orgCwd, sessionId));
    if (turn) {
      // Record an out event so we don't try again next boot.
      new FileEventSink(sinkPath).append({
        ts: nowIso(),
        kind: "pm.message_out",
        text: turn.text,
        costUsd: 0,
        durationMs: 0,
        userId,
      });
      return { orgSlug, userId, text: turn.text, source: "cc-jsonl" };
    }

    // Couldn't recover — emit a fallback notice. Still write message_out
    // so we don't re-notify on every boot.
    const fallback =
      "🔄 The bot restarted while I was working on your previous message. " +
      "I might not have saved everything. Could you resend?";
    new FileEventSink(sinkPath).append({
      ts: nowIso(),
      kind: "pm.message_out",
      text: fallback,
      costUsd: 0,
      durationMs: 0,
      userId,
    });
    return { orgSlug, userId, text: fallback, source: "fallback-notice" };
  }

  private readWorkflowEvents(orgSlug: string, workflowId: string): AnyEvent[] {
    const p = workflowEventsPath(this.workspace, orgSlug, workflowId);
    if (!fs.existsSync(p)) return [];
    return new FileEventSink(p).list();
  }

  private appendWorkflowEvent(orgSlug: string, workflowId: string, ev: AnyEvent): void {
    const p = workflowEventsPath(this.workspace, orgSlug, workflowId);
    new FileEventSink(p).append(ev);
  }
}
