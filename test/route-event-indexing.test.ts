import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  recordRouteHit,
  recordRouteMiss,
  recordAuthorTurn,
  recordSpawnDecision,
  getSinkPath,
} from "../src/memory/route-event-sink.js";
import { rotateArchive } from "../src/memory/archive-rotate.js";
import { openArchive } from "../src/memory/archive-db.js";
import { searchArchive } from "../src/memory/archive-search.js";

/**
 * v0.6 §4.6 — route/author/spawn events flow:
 *   JSONL append → archive-rotate → SQLite FTS5 → searchArchive
 */

function makeWorkspace(): { workspace: string; orgSlug: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-route-events-"));
  const orgSlug = "demo";
  fs.mkdirSync(path.join(workspace, orgSlug, "memory"), { recursive: true });
  return { workspace, orgSlug };
}

function seedAllFourEvents(workspace: string, orgSlug: string, isoOld: string): void {
  // route_hit
  recordRouteHit({
    workspace,
    orgSlug,
    now: isoOld,
    message: "Need PMF analysis",
    agent: "pmf-planner",
    team: "strategy",
    channel: "keyword",
    matched: "pmf",
  });
  // route_miss
  recordRouteMiss({
    workspace,
    orgSlug,
    now: isoOld,
    message: "Where is the design tokens reference?",
  });
  // author_turn
  recordAuthorTurn({
    workspace,
    orgSlug,
    now: isoOld,
    userId: "alice",
    state: "AWAIT_CONFIRM",
    turn: 2,
    question: "What metric should we optimize?",
    answer: "Weekly retention.",
  });
  // spawn_decision
  recordSpawnDecision({
    workspace,
    orgSlug,
    now: isoOld,
    chosenAgent: "backend-developer",
    rationale: "Task involves API endpoint design and DB schema migration.",
    candidates: ["backend-developer", "api-developer"],
  });
}

test("recorders write JSONL lines with the correct event_type field", () => {
  const { workspace, orgSlug } = makeWorkspace();
  seedAllFourEvents(workspace, orgSlug, "2024-01-15T10:00:00.000Z");

  const sinkFile = getSinkPath(workspace, orgSlug);
  assert.ok(fs.existsSync(sinkFile));
  const lines = fs
    .readFileSync(sinkFile, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { event_type: string });
  const types = lines.map((l) => l.event_type).sort();
  assert.deepEqual(types, ["author_turn", "route_hit", "route_miss", "spawn_decision"]);
});

test("archive-rotate moves all 4 event_types into SQLite with preserved event_type", () => {
  const { workspace, orgSlug } = makeWorkspace();
  seedAllFourEvents(workspace, orgSlug, "2024-01-15T10:00:00.000Z");

  const stats = rotateArchive({ workspace, orgSlug, now: "2026-05-14T00:00:00.000Z", retentionDays: 10_000 });
  assert.equal(stats.archived_rows, 4);
  assert.equal(stats.per_event_type.route_hit, 1);
  assert.equal(stats.per_event_type.route_miss, 1);
  assert.equal(stats.per_event_type.author_turn, 1);
  assert.equal(stats.per_event_type.spawn_decision, 1);

  const db = openArchive(workspace, orgSlug);
  try {
    const types = db
      .prepare("SELECT event_type FROM archive")
      .all()
      .map((r: unknown) => (r as { event_type: string }).event_type)
      .sort();
    assert.deepEqual(types, [
      "author_turn",
      "route_hit",
      "route_miss",
      "spawn_decision",
    ]);
  } finally {
    db.close();
  }
});

test("archive-rotate trims route-events.jsonl after migration", () => {
  const { workspace, orgSlug } = makeWorkspace();
  seedAllFourEvents(workspace, orgSlug, "2024-01-15T10:00:00.000Z");

  rotateArchive({ workspace, orgSlug, now: "2026-05-14T00:00:00.000Z" });

  const sinkFile = getSinkPath(workspace, orgSlug);
  const content = fs.readFileSync(sinkFile, "utf-8").trim();
  assert.equal(content, "");
});

test("recent events stay in JSONL hot tier, are not archived", () => {
  const { workspace, orgSlug } = makeWorkspace();
  const isoRecent = new Date(Date.parse("2026-05-14T00:00:00.000Z") - 86_400_000).toISOString();
  recordRouteMiss({ workspace, orgSlug, now: isoRecent, message: "stays hot" });

  const stats = rotateArchive({ workspace, orgSlug, now: "2026-05-14T00:00:00.000Z", retentionDays: 10_000 });
  assert.equal(stats.archived_rows, 0);

  const sinkFile = getSinkPath(workspace, orgSlug);
  const lines = fs.readFileSync(sinkFile, "utf-8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
});

test("FTS5 search recovers archived route_miss events for fallback recall", () => {
  const { workspace, orgSlug } = makeWorkspace();
  recordRouteMiss({
    workspace,
    orgSlug,
    now: "2024-01-15T10:00:00.000Z",
    message: "design tokens reference missing",
  });
  rotateArchive({ workspace, orgSlug, now: "2026-05-14T00:00:00.000Z", retentionDays: 10_000 });

  const hits = searchArchive({ workspace, orgSlug, query: "design tokens reference" });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].event_type, "route_miss");
});
