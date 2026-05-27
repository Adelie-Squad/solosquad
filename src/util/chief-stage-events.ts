/**
 * Chief 6+1 stage event emitter (v1.1).
 *
 * Per v1.1 PRD §5.2. Chief's TRIAGE → DECOMPOSE → DISPATCH → AWAIT →
 * SYNTHESIZE → DECIDE → RETROSPECT state machine emits one event per
 * stage transition to `<org>/memory/chief-stage-events.jsonl`. The full
 * runner-side stage machine is wired into chief-runner in a follow-up;
 * this module is the storage layer + helpers any caller can use today
 * (e.g. retrospective skill replaying yesterday's cycles).
 *
 * Append-only, one event per line. Mirrors the existing
 * agent-costs.jsonl convention.
 */

import fs from "fs";
import path from "path";

export const CHIEF_STAGES = [
  "TRIAGE",
  "DECOMPOSE",
  "DISPATCH",
  "AWAIT",
  "SYNTHESIZE",
  "DECIDE",
  "RETROSPECT",
] as const;

export type ChiefStage = (typeof CHIEF_STAGES)[number];

export interface ChiefStageEvent {
  /** ISO 8601. */
  ts: string;
  /** Stable correlation id for the user-turn this stage belongs to. */
  turn_id: string;
  /** Which of the 6+1 stages fired. */
  stage: ChiefStage;
  /** Optional task / workflow / goal id this stage belongs to. */
  task_id?: string;
  /** Free-form short tag for the action that happened (e.g. "classified=workflow"). */
  detail?: string;
  /** Names of sub-agents dispatched (DISPATCH stage). */
  dispatched?: string[];
  /** Names of skills invoked (any stage). */
  skills_used?: string[];
}

export interface ChiefStageEventsOpts {
  /** Org root — e.g. `<workspace>/<org>/`. */
  orgRoot: string;
}

function eventsFile(opts: ChiefStageEventsOpts): string {
  return path.join(opts.orgRoot, "memory", "chief-stage-events.jsonl");
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Emit a stage event. Idempotent in the sense that re-emitting the same
 * stage in the same turn is allowed (it's appended again) — Chief may
 * loop through stages multiple times per user turn, especially the
 * AWAIT ↔ DISPATCH cycle when open_questions[] resolve.
 */
export function emit(
  opts: ChiefStageEventsOpts,
  event: Omit<ChiefStageEvent, "ts"> & { ts?: string }
): ChiefStageEvent {
  const full: ChiefStageEvent = {
    ts: event.ts ?? nowIso(),
    turn_id: event.turn_id,
    stage: event.stage,
    task_id: event.task_id,
    detail: event.detail,
    dispatched: event.dispatched,
    skills_used: event.skills_used,
  };
  const file = eventsFile(opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(full) + "\n", "utf8");
  return full;
}

/**
 * Read events, optionally filtered by turn_id, stage, or since-timestamp.
 * Returns events in append order (oldest first). Malformed lines skipped.
 */
export function readEvents(
  opts: ChiefStageEventsOpts,
  filter?: { turn_id?: string; stage?: ChiefStage; sinceIso?: string }
): ChiefStageEvent[] {
  const file = eventsFile(opts);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const out: ChiefStageEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: Partial<ChiefStageEvent>;
    try {
      parsed = JSON.parse(trimmed) as Partial<ChiefStageEvent>;
    } catch {
      continue;
    }
    if (
      typeof parsed.ts !== "string" ||
      typeof parsed.turn_id !== "string" ||
      typeof parsed.stage !== "string"
    ) {
      continue;
    }
    if (!CHIEF_STAGES.includes(parsed.stage as ChiefStage)) continue;
    if (filter?.turn_id && parsed.turn_id !== filter.turn_id) continue;
    if (filter?.stage && parsed.stage !== filter.stage) continue;
    if (filter?.sinceIso && parsed.ts < filter.sinceIso) continue;
    out.push({
      ts: parsed.ts,
      turn_id: parsed.turn_id,
      stage: parsed.stage as ChiefStage,
      task_id: parsed.task_id,
      detail: parsed.detail,
      dispatched: parsed.dispatched,
      skills_used: parsed.skills_used,
    });
  }
  return out;
}

/**
 * Helper: return the most recent stage in a given turn, or null if the
 * turn has no events. Used by chief-runner crash recovery to figure out
 * where to resume.
 */
export function latestStageForTurn(
  opts: ChiefStageEventsOpts,
  turnId: string
): ChiefStage | null {
  const events = readEvents(opts, { turn_id: turnId });
  if (events.length === 0) return null;
  const last = events[events.length - 1];
  return last?.stage ?? null;
}
