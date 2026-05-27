/**
 * Goal queue (v1.1) — 1-active-per-org semaphore + FIFO queue.
 *
 * Per v1.1 PRD §12.1. SoloSquad supports parallel goals across orgs but
 * within a single org only one goal runs at a time. Two reasons:
 *
 *  1. A goal cycle holds the chief session and frequently dispatches to
 *     PM + specialists — concurrent goals would multiply Claude Code
 *     sessions and budget burn beyond the founder's intent.
 *  2. Goals share org-level memory (archive.sqlite, customers.md). Two
 *     simultaneous keep/discard cycles on the same domain context would
 *     produce racing decisions.
 *
 * Layout:
 *   <org>/goals/.active-goal     ← single-line file with active goal id
 *   <org>/goals/.goal-queue      ← jsonl, one queued goal id per line
 *
 * Both files are conventional plain text — git-able, observable, and
 * trivial to inspect with `cat`. Concurrent writers should serialize
 * through chief-runner's session mutex.
 */

import fs from "fs";
import path from "path";

export interface GoalQueueOpts {
  /** Org root, e.g. `<workspace>/<org>/`. */
  orgRoot: string;
}

interface QueueEntry {
  goal_id: string;
  /** ISO 8601 enqueue time. */
  enqueued_at: string;
}

function goalsDir(opts: GoalQueueOpts): string {
  return path.join(opts.orgRoot, "goals");
}

function activeMarker(opts: GoalQueueOpts): string {
  return path.join(goalsDir(opts), ".active-goal");
}

function queueFile(opts: GoalQueueOpts): string {
  return path.join(goalsDir(opts), ".goal-queue");
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(opts: GoalQueueOpts): void {
  fs.mkdirSync(goalsDir(opts), { recursive: true });
}

/** Currently active goal id, or null if none is running. */
export function getActive(opts: GoalQueueOpts): string | null {
  const file = activeMarker(opts);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8").trim();
  return raw.length > 0 ? raw : null;
}

function readQueue(opts: GoalQueueOpts): QueueEntry[] {
  const file = queueFile(opts);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const out: QueueEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<QueueEntry>;
      if (typeof parsed.goal_id === "string") {
        out.push({
          goal_id: parsed.goal_id,
          enqueued_at: parsed.enqueued_at ?? nowIso(),
        });
      }
    } catch {
      // Skip malformed.
    }
  }
  return out;
}

function writeQueue(opts: GoalQueueOpts, entries: QueueEntry[]): void {
  ensureDir(opts);
  const body = entries.map((e) => JSON.stringify(e)).join("\n");
  fs.writeFileSync(queueFile(opts), body.length > 0 ? body + "\n" : "", "utf8");
}

/**
 * Acquire the active slot for `goalId`. Throws if another goal is already
 * active. Caller (goal-runner) holds the slot until `release` is called.
 */
export function acquire(opts: GoalQueueOpts, goalId: string): void {
  const current = getActive(opts);
  if (current !== null) {
    throw new Error(
      `goal-queue: cannot acquire — '${current}' is already active. Use 'solosquad goal queue ${goalId}' to enqueue instead.`
    );
  }
  ensureDir(opts);
  fs.writeFileSync(activeMarker(opts), goalId, "utf8");
}

/**
 * Release the active slot. Idempotent — releasing a non-active goal is a
 * no-op (so callers can safely cleanup in finally blocks).
 */
export function release(opts: GoalQueueOpts, goalId: string): void {
  const current = getActive(opts);
  if (current !== goalId) return;
  const file = activeMarker(opts);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Append a goal id to the queue. Duplicate enqueues are silently dropped. */
export function enqueue(opts: GoalQueueOpts, goalId: string): void {
  const queue = readQueue(opts);
  if (queue.some((e) => e.goal_id === goalId)) return;
  queue.push({ goal_id: goalId, enqueued_at: nowIso() });
  writeQueue(opts, queue);
}

/** Return the queue in FIFO order without modifying state. */
export function listQueue(opts: GoalQueueOpts): QueueEntry[] {
  return readQueue(opts);
}

/**
 * Take the head of the queue (FIFO). Returns the goal id, or null if the
 * queue is empty. The queue file is updated atomically (single
 * writeFileSync) so concurrent calls are safe when serialized through
 * the chief-runner mutex.
 */
export function dequeue(opts: GoalQueueOpts): string | null {
  const queue = readQueue(opts);
  if (queue.length === 0) return null;
  const head = queue[0];
  if (!head) return null;
  writeQueue(opts, queue.slice(1));
  return head.goal_id;
}

/** Remove `goalId` from the queue if present. Used by `goal stop`. */
export function remove(opts: GoalQueueOpts, goalId: string): boolean {
  const queue = readQueue(opts);
  const filtered = queue.filter((e) => e.goal_id !== goalId);
  if (filtered.length === queue.length) return false;
  writeQueue(opts, filtered);
  return true;
}

/**
 * Promote next queued goal to active if no goal is currently active.
 * Returns the newly active goal id, or null if either (a) something is
 * already running or (b) the queue is empty. Idempotent.
 */
export function promoteNext(opts: GoalQueueOpts): string | null {
  if (getActive(opts) !== null) return null;
  const next = dequeue(opts);
  if (next === null) return null;
  acquire(opts, next);
  return next;
}
