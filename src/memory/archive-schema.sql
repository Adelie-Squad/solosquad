-- SoloSquad v0.6 — FTS5 cold archive schema
--
-- Per docs/plan/v0.6-default-workflow-tuning.md §4.2 / §4.5 / §4.6.
-- One virtual table holds all event types. event_type discriminates between
-- routine logs (default, backward-compatible) and v0.5/v0.6 router events.
--
-- schema_version is recorded in the side-car `archive_meta` table — bumped
-- whenever the SQL below changes shape.

CREATE TABLE IF NOT EXISTS archive_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO archive_meta (key, value) VALUES ('schema_version', '1');

-- Virtual table — FTS5 indexes `snippet` (the searchable text). The other
-- columns ride along as UNINDEXED so SELECT can return them without taking
-- on tokenizer cost.
CREATE VIRTUAL TABLE IF NOT EXISTS archive USING fts5(
  snippet,
  agent           UNINDEXED,
  timestamp       UNINDEXED,
  source_routine  UNINDEXED,
  event_type      UNINDEXED,
  json_blob       UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
