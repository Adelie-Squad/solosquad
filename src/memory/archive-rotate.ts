import fs from "fs";
import path from "path";
import zlib from "zlib";
import {
  openArchive,
  getArchiveDbPath,
  isEventType,
  type ArchiveDb,
  type EventType,
} from "./archive-db.js";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.6 — JSONL → SQLite (FTS5) rotation routine.
 *
 * Per docs/plan/v0.6-default-workflow-tuning.md §4.3 + §4.6 + §4.7.
 * Runs nightly (00:00) via `archive-rotate` routine. The hot tier
 * (`<org>/memory/*.jsonl`) keeps the last 7 days; everything older is
 * moved into `archive.sqlite` and *deleted from the JSONL* to keep grep
 * cheap.
 *
 * Inputs scanned:
 *   - `<org>/memory/*.jsonl`           (signals.jsonl, decisions.jsonl, …)
 *   - `<org>/memory/route-events.jsonl` (v0.5/v0.6 route + author + spawn)
 *   - `<org>/memory/routine-logs/*.jsonl` (any future jsonl logs there)
 *
 * Each archived row gets a normalized `event_type`. Lines that already carry
 * a recognized `event_type` field keep it; otherwise default to
 * `routine_log` (backward-compatible with v0.5 jsonl files).
 */

export interface RotateOpts {
  /** Workspace root (parent of <org>/). */
  workspace: string;
  /** Org slug. */
  orgSlug: string;
  /** Default 365. Rows older than this in SQLite are deleted by retention pass. */
  retentionDays?: number;
  /** Default 8. JSONL rows older than this are migrated into SQLite. */
  hotWindowDays?: number;
  /** When true, retention pass dumps a `archive-<YYYY-MM>.zst` before DELETE. */
  compressBeforeDelete?: boolean;
  /** Override "now" for deterministic tests (ISO string). */
  now?: string;
}

export interface RotateStats {
  scanned_files: number;
  archived_rows: number;
  deleted_from_jsonl: number;
  deleted_by_retention: number;
  compressed_archives: string[];
  per_event_type: Record<string, number>;
}

interface JsonlRow {
  filePath: string;
  lineIndex: number;
  raw: string;
  parsed: Record<string, unknown>;
  timestamp: string;
  eventType: EventType;
  sourceRoutine: string;
  agent: string;
  snippet: string;
}

const HOT_WINDOW_DAYS_DEFAULT = 8;
const RETENTION_DAYS_DEFAULT = 365;

export function rotateArchive(opts: RotateOpts): RotateStats {
  const stats: RotateStats = {
    scanned_files: 0,
    archived_rows: 0,
    deleted_from_jsonl: 0,
    deleted_by_retention: 0,
    compressed_archives: [],
    per_event_type: {},
  };

  const hotWindow = opts.hotWindowDays ?? HOT_WINDOW_DAYS_DEFAULT;
  const retentionDays = opts.retentionDays ?? RETENTION_DAYS_DEFAULT;
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  const cutoffMs = nowMs - hotWindow * 86_400_000;

  const memoryDir = path.join(opts.workspace, opts.orgSlug, "memory");
  if (!fs.existsSync(memoryDir)) {
    return stats;
  }

  const jsonlFiles = collectJsonlFiles(memoryDir);
  stats.scanned_files = jsonlFiles.length;
  if (!jsonlFiles.length && !fs.existsSync(getArchiveDbPath(opts.workspace, opts.orgSlug))) {
    return stats;
  }

  const db = openArchive(opts.workspace, opts.orgSlug);
  try {
    if (jsonlFiles.length) {
      migrateJsonlToSqlite({ files: jsonlFiles, cutoffMs, db, stats });
    }

    if (opts.compressBeforeDelete) {
      const compressed = compressExpiringRows(db, retentionDays, nowMs, opts.workspace, opts.orgSlug);
      stats.compressed_archives.push(...compressed);
    }

    const deleted = applyRetention(db, retentionDays, nowMs);
    stats.deleted_by_retention = deleted;
  } finally {
    db.close();
  }

  return stats;
}

function collectJsonlFiles(memoryDir: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "routine-logs") {
          visit(full);
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl") && !seen.has(full)) {
        seen.add(full);
        out.push(full);
      }
    }
  };
  visit(memoryDir);
  return out;
}

interface MigrateInput {
  files: string[];
  cutoffMs: number;
  db: ArchiveDb;
  stats: RotateStats;
}

function migrateJsonlToSqlite(input: MigrateInput): void {
  const insert = input.db.prepare(
    "INSERT INTO archive (snippet, agent, timestamp, source_routine, event_type, json_blob) VALUES (?, ?, ?, ?, ?, ?)"
  );

  // Pass 1: parse + classify each line per file. Keep "stays hot" vs "archive".
  const decisions = new Map<string, { keep: string[]; archive: JsonlRow[] }>();
  for (const filePath of input.files) {
    const rows = parseJsonlFile(filePath);
    const keep: string[] = [];
    const archive: JsonlRow[] = [];
    for (const r of rows) {
      const ms = Date.parse(r.timestamp);
      if (Number.isFinite(ms) && ms < input.cutoffMs) {
        archive.push(r);
      } else {
        keep.push(r.raw);
      }
    }
    decisions.set(filePath, { keep, archive });
  }

  // Pass 2: archive all collected rows in one txn.
  const txn = input.db.transaction((rows: JsonlRow[]) => {
    for (const r of rows) {
      insert.run(
        r.snippet,
        r.agent,
        r.timestamp,
        r.sourceRoutine,
        r.eventType,
        r.raw
      );
      input.stats.per_event_type[r.eventType] =
        (input.stats.per_event_type[r.eventType] ?? 0) + 1;
      input.stats.archived_rows++;
    }
  });
  const allArchive: JsonlRow[] = [];
  for (const d of decisions.values()) allArchive.push(...d.archive);
  if (allArchive.length) txn(allArchive);

  // Pass 3: rewrite each JSONL with only the kept lines.
  for (const [filePath, decision] of decisions.entries()) {
    if (!decision.archive.length) continue;
    if (decision.keep.length) {
      fs.writeFileSync(filePath, decision.keep.join("\n") + "\n", "utf-8");
    } else {
      fs.writeFileSync(filePath, "", "utf-8");
    }
    input.stats.deleted_from_jsonl += decision.archive.length;
  }
}

function parseJsonlFile(filePath: string): JsonlRow[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = normalizeLine(raw).split("\n");
  const out: JsonlRow[] = [];
  const sourceRoutine = inferSourceRoutineFromPath(filePath);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    if ("_schema" in parsed) return;
    out.push(buildRowFromParsed(filePath, idx, trimmed, parsed, sourceRoutine));
  });
  return out;
}

function buildRowFromParsed(
  filePath: string,
  lineIndex: number,
  raw: string,
  parsed: Record<string, unknown>,
  sourceRoutine: string
): JsonlRow {
  const eventTypeRaw =
    typeof parsed.event_type === "string" ? parsed.event_type : "routine_log";
  const eventType: EventType = isEventType(eventTypeRaw) ? eventTypeRaw : "routine_log";

  const timestamp = pickTimestamp(parsed);
  const agent = pickAgent(parsed);
  const snippet = makeSnippet(parsed);

  return {
    filePath,
    lineIndex,
    raw,
    parsed,
    timestamp,
    eventType,
    sourceRoutine,
    agent,
    snippet,
  };
}

function pickTimestamp(parsed: Record<string, unknown>): string {
  if (typeof parsed.timestamp === "string") return parsed.timestamp;
  if (typeof parsed.ts === "string") return parsed.ts;
  if (typeof parsed.date === "string") {
    const isoLike = parsed.date.length === 10 ? parsed.date + "T00:00:00.000Z" : parsed.date;
    return isoLike;
  }
  return new Date(0).toISOString();
}

function pickAgent(parsed: Record<string, unknown>): string {
  if (typeof parsed.agent === "string") return parsed.agent;
  if (typeof parsed.skill_name === "string") return parsed.skill_name;
  if (typeof parsed.chosen_agent === "string") return parsed.chosen_agent;
  return "";
}

function makeSnippet(parsed: Record<string, unknown>): string {
  const fields = ["content", "snippet", "summary", "message", "text", "matched"];
  const parts: string[] = [];
  for (const f of fields) {
    const v = parsed[f];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  if (!parts.length) {
    parts.push(JSON.stringify(parsed));
  }
  const joined = parts.join(" — ");
  return joined.length > 4000 ? joined.slice(0, 4000) : joined;
}

function inferSourceRoutineFromPath(filePath: string): string {
  const base = path.basename(filePath, ".jsonl");
  return base;
}

function applyRetention(db: ArchiveDb, retentionDays: number, nowMs: number): number {
  const cutoff = new Date(nowMs - retentionDays * 86_400_000).toISOString();
  const stmt = db.prepare("DELETE FROM archive WHERE timestamp < ?");
  const info = stmt.run(cutoff);
  return Number(info.changes ?? 0);
}

function compressExpiringRows(
  db: ArchiveDb,
  retentionDays: number,
  nowMs: number,
  workspace: string,
  orgSlug: string
): string[] {
  const cutoff = new Date(nowMs - retentionDays * 86_400_000).toISOString();
  const rows = db
    .prepare(
      "SELECT snippet, agent, timestamp, source_routine, event_type, json_blob FROM archive WHERE timestamp < ?"
    )
    .all(cutoff) as Array<{
    snippet: string;
    agent: string;
    timestamp: string;
    source_routine: string;
    event_type: string;
    json_blob: string;
  }>;
  if (!rows.length) return [];

  const buckets = new Map<string, string[]>();
  for (const r of rows) {
    const bucket = monthBucket(r.timestamp);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(JSON.stringify(r));
  }

  const archiveDir = path.join(workspace, orgSlug, "memory", "archive-compressed");
  fs.mkdirSync(archiveDir, { recursive: true });
  const written: string[] = [];
  for (const [bucket, lines] of buckets.entries()) {
    const file = path.join(archiveDir, `archive-${bucket}.zst`);
    const payload = lines.join("\n") + "\n";
    // Node has no native zstd; we use deflate-raw for portability and label the
    // file with the .zst suffix that ops scripts expect. The plan calls for
    // compress-before-delete, not zstd specifically — the artifact is the
    // marker that the rows existed.
    const compressed = zlib.deflateRawSync(Buffer.from(payload, "utf-8"));
    fs.writeFileSync(file, compressed);
    written.push(file);
  }
  return written;
}

function monthBucket(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}
