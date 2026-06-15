import fs from "fs";
import path from "path";
import { getOrgDir } from "../util/paths.js";

/**
 * v0.3.0 — `_events.jsonl` append/query.
 *
 * Two scopes:
 *   - Chief session events: <workspace>/<org>/.solosquad/sessions/<user>.events.jsonl
 *   - Per-workflow events:  <workspace>/<org>/workflows/<wf-id>/_events.jsonl
 *
 * Per docs/plan/v0.3-pm-mode-orchestration.md §4.4 + PoC #2 (auth, rate-limit,
 * mid-stream kill scenarios all surface here). task_id-based dedup so a
 * task_notification line that re-arrives across a retry isn't double-counted.
 *
 * v1.2.10 — the session-driver event namespace was renamed `pm.*` → `chief.*`
 * to match the v1.1 Chief rebrand. New events emit `chief.*`; readers that scan
 * pre-v1.2.10 logs (`workflow-reconciler`) accept BOTH the legacy `pm.*` and the
 * new `chief.*` kinds. The on-disk file path (`<user>.events.jsonl`) is
 * unchanged, and archive.sqlite never indexed these kinds — so no external
 * consumer breaks.
 */

export type EventKind =
  | "chief.message_in"
  | "chief.message_out"
  | "chief.error"
  | "chief.auth_expired"
  | "chief.session_lost"
  | "chief.session_rotated"
  | "chief.rate_limit"
  | "spawn.start"
  | "spawn.complete"
  | "spawn.fail"
  | "workflow.stage_started"
  | "workflow.stage_completed"
  | "workflow.stage_needs_revision";

export interface BaseEvent {
  ts: string;
  kind: EventKind;
}

export interface ChiefMessageInEvent extends BaseEvent {
  kind: "chief.message_in";
  text: string;
  userId: string;
}

export interface ChiefMessageOutEvent extends BaseEvent {
  kind: "chief.message_out";
  text: string;
  costUsd: number;
  durationMs: number;
  userId: string;
}

export interface ChiefErrorEvent extends BaseEvent {
  kind: "chief.error";
  reason: string;
  exitCode?: number | null;
  signal?: string | null;
  stderrTail?: string;
  userId: string;
}

export interface ChiefAuthExpiredEvent extends BaseEvent {
  kind: "chief.auth_expired";
  userId: string;
}

export interface ChiefSessionLostEvent extends BaseEvent {
  kind: "chief.session_lost";
  oldSessionId: string;
  newSessionId: string;
  userId: string;
}

export interface ChiefSessionRotatedEvent extends BaseEvent {
  kind: "chief.session_rotated";
  oldSessionId: string;
  newSessionId: string;
  reason: string;
  userId: string;
}

export interface ChiefRateLimitEvent extends BaseEvent {
  kind: "chief.rate_limit";
  resetsAt?: number;
  rateLimitType?: string;
  userId: string;
}

export interface SpawnStartEvent extends BaseEvent {
  kind: "spawn.start";
  taskId: string;
  toolUseId: string;
  agent: string;
  description: string;
  /** v0.3.0+: workflow stage this spawn belongs to (parsed from Chief's [stage:<id>] marker). */
  stageId?: string;
  /** v0.3.0+: workflow id (parsed from Chief's [stage:<id> wf:<wf-id>] marker). */
  workflowId?: string;
}

export interface SpawnCompleteEvent extends BaseEvent {
  kind: "spawn.complete";
  taskId: string;
  toolUseId: string;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

export interface SpawnFailEvent extends BaseEvent {
  kind: "spawn.fail";
  taskId: string;
  toolUseId: string;
  status: string;
}

export interface WorkflowStageEvent extends BaseEvent {
  kind:
    | "workflow.stage_started"
    | "workflow.stage_completed"
    | "workflow.stage_needs_revision";
  workflowId: string;
  stageId: string;
  agent?: string;
}

export type AnyEvent =
  | ChiefMessageInEvent
  | ChiefMessageOutEvent
  | ChiefErrorEvent
  | ChiefAuthExpiredEvent
  | ChiefSessionLostEvent
  | ChiefSessionRotatedEvent
  | ChiefRateLimitEvent
  | SpawnStartEvent
  | SpawnCompleteEvent
  | SpawnFailEvent
  | WorkflowStageEvent;

export interface EventSink {
  append(ev: AnyEvent): void;
  list(): AnyEvent[];
}

export function chiefEventsPath(workspace: string, orgSlug: string, userId: string): string {
  const dir = path.join(getOrgDir(orgSlug, workspace), ".solosquad", "sessions");
  return path.join(dir, `${safeFileName(userId)}.events.jsonl`);
}

/**
 * @deprecated v1.2.10 — renamed to {@link chiefEventsPath}. Retained as an
 * alias so the immutable autonomous-engine module (`src/engine/**`, which must
 * not be edited per AGENTS.md) keeps compiling against the old symbol. New
 * call sites should import `chiefEventsPath`.
 */
export const pmEventsPath = chiefEventsPath;

export function workflowEventsPath(
  workspace: string,
  orgSlug: string,
  workflowId: string
): string {
  return path.join(
    getOrgDir(orgSlug, workspace),
    "workflows",
    workflowId,
    "_events.jsonl"
  );
}

function safeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

export class FileEventSink implements EventSink {
  private readonly seenTaskNotifications = new Set<string>();

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) {
      try {
        for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
          if (!line.trim()) continue;
          const obj = JSON.parse(line) as AnyEvent;
          if (
            obj.kind === "spawn.complete" ||
            obj.kind === "spawn.fail"
          ) {
            const key = `${obj.kind}:${obj.taskId}`;
            this.seenTaskNotifications.add(key);
          }
        }
      } catch {
        // ignore corrupt history; new events still append
      }
    }
  }

  append(ev: AnyEvent): void {
    if (ev.kind === "spawn.complete" || ev.kind === "spawn.fail") {
      const key = `${ev.kind}:${ev.taskId}`;
      if (this.seenTaskNotifications.has(key)) return;
      this.seenTaskNotifications.add(key);
    }
    fs.appendFileSync(this.filePath, JSON.stringify(ev) + "\n", "utf-8");
  }

  list(): AnyEvent[] {
    if (!fs.existsSync(this.filePath)) return [];
    const out: AnyEvent[] = [];
    for (const line of fs.readFileSync(this.filePath, "utf-8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AnyEvent);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  }
}

/** In-memory sink for unit tests. */
export class MemoryEventSink implements EventSink {
  readonly history: AnyEvent[] = [];
  private readonly seen = new Set<string>();

  append(ev: AnyEvent): void {
    if (ev.kind === "spawn.complete" || ev.kind === "spawn.fail") {
      const key = `${ev.kind}:${ev.taskId}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    this.history.push(ev);
  }

  list(): AnyEvent[] {
    return this.history.slice();
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
