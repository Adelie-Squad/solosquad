import fs from "fs";
import path from "path";
import type { EventType } from "./archive-db.js";

/**
 * v0.6 — route-events sink (§4.6 P1).
 *
 * Five event types land in `<workspace>/<org>/memory/route-events.jsonl`:
 *
 *   - route_hit       — router resolved a SKILL for a message
 *   - route_miss      — router returned null (used by §3.4 freq mining)
 *   - author_turn     — author loop turn log (clarification turn N)
 *   - spawn_decision  — PM Task tool chose a SKILL with rationale
 *   - (routine_log is the default for legacy JSONL — not emitted here)
 *
 * Sink is sync, append-only — cheap enough for the hot path of every
 * message. archive-rotate (`src/memory/archive-rotate.ts`) reads this same
 * JSONL nightly and migrates the cold portion into FTS5.
 */

const SINK_FILENAME = "route-events.jsonl";

interface BaseFields {
  workspace: string;
  orgSlug: string;
  /** Override timestamp for tests (ISO string). */
  now?: string;
}

export interface RouteHitEvent extends BaseFields {
  message: string;
  agent: string;
  team: string;
  channel: "slash" | "keyword" | "freq" | "explicit";
  matched: string;
}

export interface RouteMissEvent extends BaseFields {
  message: string;
}

export interface AuthorTurnEvent extends BaseFields {
  userId: string;
  state: string;
  turn: number;
  question?: string;
  answer?: string;
}

export interface SpawnDecisionEvent extends BaseFields {
  chosenAgent: string;
  rationale: string;
  candidates?: string[];
}

export function recordRouteHit(event: RouteHitEvent): void {
  appendEvent(event.workspace, event.orgSlug, {
    event_type: "route_hit",
    timestamp: event.now ?? new Date().toISOString(),
    agent: event.agent,
    team: event.team,
    channel: event.channel,
    matched: event.matched,
    message: clip(event.message, 500),
  });
}

export function recordRouteMiss(event: RouteMissEvent): void {
  appendEvent(event.workspace, event.orgSlug, {
    event_type: "route_miss",
    timestamp: event.now ?? new Date().toISOString(),
    message: clip(event.message, 500),
  });
}

export function recordAuthorTurn(event: AuthorTurnEvent): void {
  appendEvent(event.workspace, event.orgSlug, {
    event_type: "author_turn",
    timestamp: event.now ?? new Date().toISOString(),
    user_id: event.userId,
    state: event.state,
    turn: event.turn,
    question: event.question ? clip(event.question, 500) : undefined,
    answer: event.answer ? clip(event.answer, 500) : undefined,
  });
}

export function recordSpawnDecision(event: SpawnDecisionEvent): void {
  appendEvent(event.workspace, event.orgSlug, {
    event_type: "spawn_decision",
    timestamp: event.now ?? new Date().toISOString(),
    chosen_agent: event.chosenAgent,
    rationale: clip(event.rationale, 800),
    candidates: event.candidates,
  });
}

/** Path the sink writes to — exposed for tests + archive-rotate ledger. */
export function getSinkPath(workspace: string, orgSlug: string): string {
  return path.join(workspace, orgSlug, "memory", SINK_FILENAME);
}

function appendEvent(workspace: string, orgSlug: string, payload: Record<string, unknown>): void {
  const file = getSinkPath(workspace, orgSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) filtered[k] = v;
  }
  fs.appendFileSync(file, JSON.stringify(filtered) + "\n", "utf-8");
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Sentinel for callers that need to validate event_type strings. */
export const ROUTE_EVENT_TYPES: ReadonlyArray<EventType> = [
  "route_hit",
  "route_miss",
  "author_turn",
  "spawn_decision",
];
