import fs from "fs";
import { openArchive, getArchiveDbPath, isEventType, type EventType } from "./archive-db.js";

/**
 * v0.6 — FTS5 search over the cold archive.
 *
 * Per docs/plan/v0.6-default-workflow-tuning.md §4.3 + §4.7. Used by:
 *   - agent-router.ts fallback (when keyword resolve returns null)
 *   - CLI `solosquad memory search`
 *
 * The function is read-only; safe to call from message handlers.
 */

export interface SearchOpts {
  workspace: string;
  orgSlug: string;
  query: string;
  limit?: number;
  /** Restrict to a single event_type. */
  eventType?: EventType;
}

export interface SearchResult {
  snippet: string;
  agent: string;
  timestamp: string;
  source_routine: string;
  event_type: string;
  rank: number;
}

export function searchArchive(opts: SearchOpts): SearchResult[] {
  const file = getArchiveDbPath(opts.workspace, opts.orgSlug);
  if (!fs.existsSync(file)) return [];

  const db = openArchive(opts.workspace, opts.orgSlug);
  try {
    const limit = Math.max(1, Math.min(50, opts.limit ?? 10));
    const safeQuery = sanitizeFts5Query(opts.query);
    if (!safeQuery) return [];

    const filterClause = opts.eventType && isEventType(opts.eventType) ? "AND event_type = ?" : "";
    const sql = `
      SELECT snippet, agent, timestamp, source_routine, event_type, rank
      FROM archive
      WHERE archive MATCH ?
        ${filterClause}
      ORDER BY rank
      LIMIT ?
    `;
    const params: unknown[] = [safeQuery];
    if (opts.eventType && isEventType(opts.eventType)) params.push(opts.eventType);
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as SearchResult[];
    return rows;
  } finally {
    db.close();
  }
}

/** Statistics over the cold archive — used by `memory stats` CLI + dashboards. */
export interface ArchiveStats {
  totalRows: number;
  oldestIso: string | null;
  newestIso: string | null;
  diskBytes: number;
  perEventType: Record<string, number>;
}

export function getStats(args: { workspace: string; orgSlug: string }): ArchiveStats {
  const file = getArchiveDbPath(args.workspace, args.orgSlug);
  const empty: ArchiveStats = {
    totalRows: 0,
    oldestIso: null,
    newestIso: null,
    diskBytes: 0,
    perEventType: {},
  };
  if (!fs.existsSync(file)) return empty;

  const db = openArchive(args.workspace, args.orgSlug);
  try {
    const total = db.prepare("SELECT COUNT(*) AS n FROM archive").get() as { n: number };
    const minRow = db.prepare("SELECT MIN(timestamp) AS t FROM archive").get() as { t: string | null };
    const maxRow = db.prepare("SELECT MAX(timestamp) AS t FROM archive").get() as { t: string | null };
    const perType = db
      .prepare("SELECT event_type, COUNT(*) AS n FROM archive GROUP BY event_type")
      .all() as Array<{ event_type: string; n: number }>;

    const perEventType: Record<string, number> = {};
    for (const r of perType) perEventType[r.event_type] = r.n;

    const diskBytes = computeDiskBytes(file);

    return {
      totalRows: total.n,
      oldestIso: minRow.t,
      newestIso: maxRow.t,
      diskBytes,
      perEventType,
    };
  } finally {
    db.close();
  }
}

function computeDiskBytes(dbFile: string): number {
  let total = 0;
  for (const f of [dbFile, dbFile + "-wal", dbFile + "-shm"]) {
    try {
      if (fs.existsSync(f)) total += fs.statSync(f).size;
    } catch {
      // ignore
    }
  }
  return total;
}

/**
 * Strip characters that break FTS5 query parsing while preserving Unicode
 * tokens (Korean / Chinese / etc). The router fallback gets free-form
 * messages — letting raw quotes through trips MATCH syntax errors.
 */
export function sanitizeFts5Query(input: string): string {
  if (!input) return "";
  // Replace double quotes (FTS5 phrase delimiter when paired) + backslashes.
  // Split on whitespace + control chars; quote each token to make it literal.
  const tokens = input
    .replace(/["'`\\]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (!tokens.length) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}
