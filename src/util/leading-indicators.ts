/**
 * Leading-indicator jsonl writer/reader (v1.1).
 *
 * Per v1.1 PRD §14. The daily `crons/leading-indicator.md` cron
 * computes 5 indicators over 1d + 7d windows and appends one line to
 * `<org>/memory/leading-indicators.jsonl`. This module is the typed
 * interface for that file — the cron prompt writes through here,
 * the Chief RETROSPECT stage (loop engineering) reads from here.
 *
 * Append-only by design: each daily run produces exactly one line. The
 * file is intentionally never rotated (PRD §15.1) — long-horizon trend
 * tracking is the entire point.
 */

import fs from "fs";
import path from "path";

export interface IndicatorSnapshot {
  /** Conversation → workflow/goal conversion rate (0..1). */
  conversion_to_task_rate: number;
  /** Mergeable PR rate among auto-produced PRs (0..1). */
  auto_pr_success_rate: number;
  /** Count of autonomous goal cycles completed without user intervention. */
  autonomous_goal_cycles: number;
  /** Consecutive release days. */
  shipping_streak_days: number;
  /** Average confidence score across PM hypotheses (0..100). */
  avg_confidence_score: number;
}

export interface LeadingIndicatorEntry {
  /** ISO 8601 timestamp when the snapshot was taken. */
  ts: string;
  /** Last-24h window. */
  window_1d: IndicatorSnapshot;
  /** Trailing-7d window. */
  window_7d: IndicatorSnapshot;
  /** Pointers to ledger / archive entries that supplied the numbers. */
  evidence_refs: string[];
}

export interface LeadingIndicatorsOpts {
  /** Org root, e.g. `<workspace>/<org>/`. */
  orgRoot: string;
}

function filePath(opts: LeadingIndicatorsOpts): string {
  return path.join(opts.orgRoot, "memory", "leading-indicators.jsonl");
}

/** Append one snapshot to the org's leading-indicators.jsonl. */
export function appendEntry(
  opts: LeadingIndicatorsOpts,
  entry: LeadingIndicatorEntry
): void {
  const target = filePath(opts);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(target, line, "utf8");
}

/**
 * Read all snapshots, optionally limited to entries newer than `sinceIso`.
 * Returns chronological order (oldest first). Malformed lines are skipped.
 */
export function readEntries(
  opts: LeadingIndicatorsOpts,
  sinceIso?: string
): LeadingIndicatorEntry[] {
  const target = filePath(opts);
  if (!fs.existsSync(target)) return [];
  const raw = fs.readFileSync(target, "utf8");
  const out: LeadingIndicatorEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<LeadingIndicatorEntry>;
      if (typeof parsed.ts !== "string") continue;
      if (sinceIso && parsed.ts < sinceIso) continue;
      if (!parsed.window_1d || !parsed.window_7d) continue;
      out.push(parsed as LeadingIndicatorEntry);
    } catch {
      // Skip malformed lines — cron may have been interrupted.
    }
  }
  return out;
}

/**
 * Latest entry, or null if the file is empty/missing. Used by the Chief
 * RETROSPECT stage to compare against the prior period.
 */
export function latestEntry(
  opts: LeadingIndicatorsOpts
): LeadingIndicatorEntry | null {
  const all = readEntries(opts);
  if (all.length === 0) return null;
  return all[all.length - 1] ?? null;
}
