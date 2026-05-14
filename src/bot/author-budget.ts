import fs from "fs";
import path from "path";
import { getOrgDir } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import type { CostModel } from "../util/cost.js";

/**
 * v0.5 §5.6 — Author loop budget envelope.
 *
 * Cumulative USD spent on author-loop LLM calls per org. Persisted to
 * `<workspace>/<org>/memory/author-costs.jsonl` as append-only JSONL so the
 * file can be tail-read for diagnostics without a parse pass over the entire
 * history. Caps come from `workspace.yaml` `author.budget` (read by the
 * caller — `checkBudget` is pure on its `opts`).
 *
 * Daily/weekly windows use UTC boundaries (avoids subtle DST drift when a
 * solo-founder workspace migrates timezones). The week is rolling — last 7
 * UTC days, not "current ISO week" — because solo-founder usage is
 * continuous, not aligned to a Mon-Sun cycle.
 *
 * `on_cap_action: warn` always allows; `pause` refuses. `checkBudget`
 * surfaces both so the caller can either short-circuit (pause) or just log
 * a warning (warn).
 */

export type OnCapAction = "pause" | "warn";

export interface AuthorCostRow {
  ts: string;
  skill_draft_id: string;
  step: string;
  usd: number;
  model: CostModel;
}

export interface RecordAuthorCostInput {
  workspace: string;
  orgSlug: string;
  skillDraftId: string;
  step: string;
  usd: number;
  model: CostModel;
}

export interface CheckBudgetOpts {
  workspace: string;
  orgSlug: string;
  /** Optional cap on a single upcoming call. */
  perCallUsd?: number;
  dailyUsd?: number;
  weeklyUsd?: number;
  onCapAction?: OnCapAction;
}

export interface CheckBudgetResult {
  allowed: boolean;
  reason?: string;
  /** Remaining headroom for diagnostics — never negative. */
  remaining: { today: number; week: number };
  /** True when the call would breach a cap regardless of action policy. */
  exceeded: boolean;
}

export function authorCostsPath(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "memory", "author-costs.jsonl");
}

export function recordAuthorCost(input: RecordAuthorCostInput): void {
  const file = authorCostsPath(input.workspace, input.orgSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row: AuthorCostRow = {
    ts: new Date().toISOString(),
    skill_draft_id: input.skillDraftId,
    step: input.step,
    usd: input.usd,
    model: input.model,
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
}

export function readAuthorCosts(
  workspace: string,
  orgSlug: string
): AuthorCostRow[] {
  const file = authorCostsPath(workspace, orgSlug);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf-8");
  const out: AuthorCostRow[] = [];
  for (const line of normalizeLine(raw).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as AuthorCostRow;
      if (typeof parsed.ts === "string" && typeof parsed.usd === "number") {
        out.push(parsed);
      }
    } catch {
      // Corrupt line — skip silently. The append-only design makes a single
      // partial write recoverable on next read.
    }
  }
  return out;
}

/**
 * Sum USD spent since a cutoff (inclusive of `since`).
 */
function sumSince(rows: AuthorCostRow[], since: Date): number {
  const cutoff = since.getTime();
  let total = 0;
  for (const r of rows) {
    const t = Date.parse(r.ts);
    if (Number.isNaN(t)) continue;
    if (t >= cutoff) total += r.usd;
  }
  return total;
}

function utcStartOfDay(now: Date): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0,
  ));
}

function utcStartOfWeekRolling(now: Date): Date {
  const day = utcStartOfDay(now);
  return new Date(day.getTime() - 6 * 24 * 60 * 60 * 1000);
}

export function checkBudget(opts: CheckBudgetOpts): CheckBudgetResult {
  const rows = readAuthorCosts(opts.workspace, opts.orgSlug);
  const now = new Date();

  const spentToday = sumSince(rows, utcStartOfDay(now));
  const spentWeek = sumSince(rows, utcStartOfWeekRolling(now));

  const dailyCap = opts.dailyUsd;
  const weeklyCap = opts.weeklyUsd;
  const perCallCap = opts.perCallUsd;
  const action: OnCapAction = opts.onCapAction ?? "pause";

  const remainingToday =
    dailyCap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, dailyCap - spentToday);
  const remainingWeek =
    weeklyCap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, weeklyCap - spentWeek);

  let exceeded = false;
  let reason: string | undefined;

  if (dailyCap !== undefined && spentToday >= dailyCap) {
    exceeded = true;
    reason = `daily budget reached: spent $${spentToday.toFixed(4)} of $${dailyCap.toFixed(2)} (UTC)`;
  } else if (weeklyCap !== undefined && spentWeek >= weeklyCap) {
    exceeded = true;
    reason = `weekly budget reached: spent $${spentWeek.toFixed(4)} of $${weeklyCap.toFixed(2)} (rolling 7d UTC)`;
  } else if (perCallCap !== undefined && perCallCap < 0) {
    exceeded = true;
    reason = `per_call_usd cap is negative ($${perCallCap}) — refusing to proceed`;
  }

  const allowed = !exceeded || action === "warn";

  return {
    allowed,
    reason,
    exceeded,
    remaining: {
      today: remainingToday,
      week: remainingWeek,
    },
  };
}
