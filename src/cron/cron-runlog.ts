import fs from "fs";
import path from "path";
import { normalizeLine } from "../util/platform.js";

/**
 * v1.3.3 §C — structured cron run history (OpenClaw `cron runs` pattern).
 *
 * Separate from the human-readable `memory/cron-logs/<id>-<ts>.md` (full
 * output): this is a compact, machine-readable outcome log used for
 * observability — `cron runs`, `cron show` last-run state, and the
 * dead-man's-switch overdue check. One JSONL per org.
 */

export type CronRunStatus = "ok" | "silent" | "error";

export interface CronRunRecord {
  id: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  status: CronRunStatus;
  ms: number;
  error?: string;
}

function runLogPath(orgDir: string): string {
  return path.join(orgDir, "memory", "cron-runs.jsonl");
}

/** Append one run outcome to the org's cron-runs.jsonl (best-effort). */
export function recordCronRun(orgDir: string, rec: CronRunRecord): void {
  try {
    const file = runLogPath(orgDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + "\n", "utf-8");
  } catch {
    /* observability is best-effort — never break a run over its own log */
  }
}

/** Read run records for one org, newest-first. Filter by id; cap with limit. */
export function readCronRuns(
  orgDir: string,
  opts: { id?: string; limit?: number } = {},
): CronRunRecord[] {
  const file = runLogPath(orgDir);
  if (!fs.existsSync(file)) return [];
  let recs: CronRunRecord[] = [];
  try {
    for (const line of normalizeLine(fs.readFileSync(file, "utf-8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as CronRunRecord;
        if (!opts.id || r.id === opts.id) recs.push(r);
      } catch {
        /* skip a corrupt line */
      }
    }
  } catch {
    return [];
  }
  recs.reverse(); // newest-first
  return opts.limit ? recs.slice(0, opts.limit) : recs;
}

/** The most recent run for an id (any status), or null. */
export function lastCronRun(orgDir: string, id: string): CronRunRecord | null {
  return readCronRuns(orgDir, { id, limit: 1 })[0] ?? null;
}

/** The most recent *successful* (ok|silent) run for an id, or null. */
export function lastSuccessfulRun(orgDir: string, id: string): CronRunRecord | null {
  return readCronRuns(orgDir, { id }).find((r) => r.status !== "error") ?? null;
}
