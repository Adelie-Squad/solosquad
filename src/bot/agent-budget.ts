import fs from "fs";
import path from "path";
import { getOrgDir } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import type { CostModel } from "../util/cost.js";
import type { OnCapAction } from "./author-budget.js";
import {
  loadAgentProfile,
  resolveAgentBudget,
  type AgentProfileMerged,
} from "../util/agent-profile.js";

/**
 * v0.6 §2.2 P0 #1 — Agent spawn budget envelope.
 *
 * Generalization of the v0.5 author-loop envelope (`src/bot/author-budget.ts`)
 * to PM-mediated specialist spawns. The two budgets are intentionally kept in
 * *separate JSONL files* (`agent-costs.jsonl` vs `author-costs.jsonl`) so the
 * v0.5 author cap is not silently consumed by spawn traffic — a single ledger
 * would force solo-founders to size one cap to dominate both flows.
 *
 * File: `<workspace>/<org>/memory/agent-costs.jsonl` — append-only JSONL,
 * one row per spawn (or per spawn step when broken down).
 *
 * Windows + boundary semantics mirror v0.5: UTC day, rolling 7-day window.
 */

export interface AgentCostRow {
  ts: string;
  agent_name: string;
  step: string;
  usd: number;
  model?: CostModel;
}

export interface RecordAgentCostInput {
  workspace: string;
  orgSlug: string;
  agentName: string;
  step: string;
  usd: number;
  model?: CostModel;
}

export interface CheckAgentBudgetInput {
  workspace: string;
  orgSlug: string;
  agentName: string;
  /**
   * Pre-loaded merged profile; pass-through if the caller already has it.
   * Otherwise `loadAgentProfile` is called internally.
   */
  agentProfile?: AgentProfileMerged;
}

export interface CheckAgentBudgetResult {
  allowed: boolean;
  reason?: string;
  /** Remaining headroom — never negative. Infinity when no cap is set. */
  remaining: { today: number; week: number };
  exceeded: boolean;
  action: OnCapAction;
}

export function agentCostsPath(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "memory", "agent-costs.jsonl");
}

export function recordAgentCost(input: RecordAgentCostInput): void {
  const file = agentCostsPath(input.workspace, input.orgSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row: AgentCostRow = {
    ts: new Date().toISOString(),
    agent_name: input.agentName,
    step: input.step,
    usd: input.usd,
    model: input.model,
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
}

export function readAgentCosts(
  workspace: string,
  orgSlug: string,
): AgentCostRow[] {
  const file = agentCostsPath(workspace, orgSlug);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf-8");
  const out: AgentCostRow[] = [];
  for (const line of normalizeLine(raw).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as AgentCostRow;
      if (
        typeof parsed.ts === "string" &&
        typeof parsed.usd === "number" &&
        typeof parsed.agent_name === "string"
      ) {
        out.push(parsed);
      }
    } catch {
      // Corrupt line — skip silently. Append-only design keeps a single
      // partial write recoverable on next read.
    }
  }
  return out;
}

function utcStartOfDay(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
}

function utcStartOfWeekRolling(now: Date): Date {
  const day = utcStartOfDay(now);
  return new Date(day.getTime() - 6 * 24 * 60 * 60 * 1000);
}

function sumSince(rows: AgentCostRow[], agentName: string, since: Date): number {
  const cutoff = since.getTime();
  let total = 0;
  for (const r of rows) {
    if (r.agent_name !== agentName) continue;
    const t = Date.parse(r.ts);
    if (Number.isNaN(t)) continue;
    if (t >= cutoff) total += r.usd;
  }
  return total;
}

/**
 * Resolve the effective cap + remaining headroom for a single agent.
 *
 * The merged profile already encodes the 3-tier inheritance (workspace
 * bundle → user global → org agent-profile) and the "agent budget may only
 * tighten parent" invariant — this function only needs to look up the
 * resolved row and compare against cumulative spend.
 */
export function checkAgentBudget(
  input: CheckAgentBudgetInput,
): CheckAgentBudgetResult {
  const profile =
    input.agentProfile ??
    loadAgentProfile({
      workspace: input.workspace,
      orgSlug: input.orgSlug,
    });

  const budget = resolveAgentBudget(profile, input.agentName);
  const action: OnCapAction = budget?.on_cap_action ?? "pause";

  const rows = readAgentCosts(input.workspace, input.orgSlug);
  const now = new Date();

  const spentToday = sumSince(rows, input.agentName, utcStartOfDay(now));
  const spentWeek = sumSince(rows, input.agentName, utcStartOfWeekRolling(now));

  const dailyCap = budget?.daily_usd;
  const weeklyCap = budget?.weekly_usd;

  const remainingToday =
    typeof dailyCap === "number"
      ? Math.max(0, dailyCap - spentToday)
      : Number.POSITIVE_INFINITY;
  const remainingWeek =
    typeof weeklyCap === "number"
      ? Math.max(0, weeklyCap - spentWeek)
      : Number.POSITIVE_INFINITY;

  let exceeded = false;
  let reason: string | undefined;

  if (typeof dailyCap === "number" && spentToday >= dailyCap) {
    exceeded = true;
    reason = `daily budget reached for ${input.agentName}: spent $${spentToday.toFixed(
      4,
    )} of $${dailyCap.toFixed(2)} (UTC)`;
  } else if (typeof weeklyCap === "number" && spentWeek >= weeklyCap) {
    exceeded = true;
    reason = `weekly budget reached for ${input.agentName}: spent $${spentWeek.toFixed(
      4,
    )} of $${weeklyCap.toFixed(2)} (rolling 7d UTC)`;
  }

  const allowed = !exceeded || action === "warn";

  return {
    allowed,
    reason,
    exceeded,
    action,
    remaining: { today: remainingToday, week: remainingWeek },
  };
}
