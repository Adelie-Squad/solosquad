import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

/**
 * v0.6 — shared FTS5 archive open/initialize helper.
 *
 * Per docs/plan/v0.6-default-workflow-tuning.md §4. All five v0.6 events
 * (routine_log + route_hit + route_miss + author_turn + spawn_decision)
 * land in `<workspace>/<org>/memory/archive.sqlite`, indexed by the
 * `archive` FTS5 virtual table defined here. Schema lives inline so the
 * npm package keeps its single-file dist surface (no .sql shipping).
 * The canonical reference SQL is also kept at `src/memory/archive-schema.sql`
 * for human review + spec alignment (§4.5 #1).
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS archive_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO archive_meta (key, value) VALUES ('schema_version', '1');

CREATE VIRTUAL TABLE IF NOT EXISTS archive USING fts5(
  snippet,
  agent           UNINDEXED,
  timestamp       UNINDEXED,
  source_routine  UNINDEXED,
  event_type      UNINDEXED,
  json_blob       UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export function getArchiveDbPath(workspace: string, orgSlug: string): string {
  return path.join(workspace, orgSlug, "memory", "archive.sqlite");
}

export type ArchiveDb = Database.Database;

export function openArchive(workspace: string, orgSlug: string): ArchiveDb {
  const file = getArchiveDbPath(workspace, orgSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}

export const ALLOWED_EVENT_TYPES = [
  "routine_log",
  "route_hit",
  "route_miss",
  "author_turn",
  "spawn_decision",
] as const;

export type EventType = (typeof ALLOWED_EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  return (ALLOWED_EVENT_TYPES as readonly string[]).includes(value);
}
