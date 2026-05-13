import fs from "fs";
import path from "path";
import { getOrgDir } from "../util/paths.js";
import { workflowEventsPath, type AnyEvent } from "../bot/events.js";
import { FileEventSink } from "../bot/events.js";
import type { GoalSpec, MetricSpec } from "./goal-parser.js";

/**
 * v0.4 — `results.tsv` append-only tracker + `_best.json` keeper.
 *
 * Per docs/plan/v0.4-autonomous-engine.md §5.
 *
 * results.tsv schema (10 fields, append-only, schema_version=1):
 *   cycle  timestamp  agent  metric  value  status  commit  provenance  task_id  description
 *
 * task_id is a foreign key into v1.2.5 `_events.jsonl` of the workflow that
 * the cycle's spawn(s) belong to — allows JOIN of cost/duration/stage onto
 * each result row.
 */

export const RESULTS_SCHEMA_VERSION = 1;

export type CycleStatus = "keep" | "discard";

export interface CycleResult {
  cycle: number;
  timestamp: string;          // ISO
  agent: string;              // "team/agent" or aggregate "cycle"
  metric: string;             // metric name
  value: number;              // measured value
  status: CycleStatus;
  commit: string | "-";       // "-" for discard
  provenance: string;         // formula+source joined
  task_id: string;            // foreign key into _events.jsonl
  description: string;        // human-readable
}

export interface BestCycle {
  /** Cycle index. */
  cycle: number;
  /** Commit SHA of this keep cycle. */
  commit: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Sum of normalized metric scores. Higher = better. */
  composite_score: number;
  /** Map metric name → value for transparency. */
  metric_values: Record<string, number>;
}

export function resultsTsvPath(workspace: string, orgSlug: string, goalId: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "goals", goalId, "results.tsv");
}

export function bestJsonPath(workspace: string, orgSlug: string, goalId: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "goals", goalId, "_best.json");
}

export function goalDir(workspace: string, orgSlug: string, goalId: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "goals", goalId);
}

// ---------- results.tsv ----------

const TSV_HEADER =
  "cycle\ttimestamp\tagent\tmetric\tvalue\tstatus\tcommit\tprovenance\ttask_id\tdescription";

export function ensureResultsTsv(workspace: string, orgSlug: string, goalId: string): string {
  const p = resultsTsvPath(workspace, orgSlug, goalId);
  if (fs.existsSync(p)) return p;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    `# schema_version=${RESULTS_SCHEMA_VERSION}\n${TSV_HEADER}\n`,
    "utf-8"
  );
  return p;
}

export function appendResults(
  workspace: string,
  orgSlug: string,
  goalId: string,
  rows: CycleResult[]
): void {
  if (rows.length === 0) return;
  const p = ensureResultsTsv(workspace, orgSlug, goalId);
  const lines = rows.map(rowToTsv).join("\n") + "\n";
  fs.appendFileSync(p, lines, "utf-8");
}

function rowToTsv(r: CycleResult): string {
  return [
    String(r.cycle),
    r.timestamp,
    r.agent,
    r.metric,
    String(r.value),
    r.status,
    r.commit,
    r.provenance.replace(/\t/g, " "),
    r.task_id,
    r.description.replace(/\t/g, " "),
  ].join("\t");
}

export function readResults(
  workspace: string,
  orgSlug: string,
  goalId: string
): CycleResult[] {
  const p = resultsTsvPath(workspace, orgSlug, goalId);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
  const out: CycleResult[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("cycle\t")) continue;
    const parts = line.split("\t");
    if (parts.length < 10) continue;
    const cycle = Number(parts[0]);
    const value = Number(parts[4]);
    if (!Number.isFinite(cycle) || !Number.isFinite(value)) continue;
    const status = parts[5] === "keep" || parts[5] === "discard" ? (parts[5] as CycleStatus) : null;
    if (!status) continue;
    out.push({
      cycle,
      timestamp: parts[1],
      agent: parts[2],
      metric: parts[3],
      value,
      status,
      commit: parts[6],
      provenance: parts[7],
      task_id: parts[8],
      description: parts[9],
    });
  }
  return out;
}

// ---------- _best.json ----------

export function readBest(
  workspace: string,
  orgSlug: string,
  goalId: string
): BestCycle | null {
  const p = bestJsonPath(workspace, orgSlug, goalId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as BestCycle;
  } catch {
    return null;
  }
}

export function writeBest(
  workspace: string,
  orgSlug: string,
  goalId: string,
  best: BestCycle
): void {
  const p = bestJsonPath(workspace, orgSlug, goalId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(best, null, 2) + "\n", "utf-8");
}

/**
 * Update _best.json if `candidate` outperforms the current best.
 * Composite score = sum over metrics of (normalized contribution).
 * For maximize: value / threshold (capped to [0, +∞)).
 * For minimize: threshold / value (with value clamped to >0).
 * All metrics must be >= threshold for the cycle to be eligible (CONFIRMING gate).
 *
 * Returns the new best (or unchanged previous best).
 */
export function maybeUpdateBest(
  workspace: string,
  orgSlug: string,
  goalId: string,
  candidate: {
    cycle: number;
    commit: string;
    timestamp: string;
    metrics: Array<{ spec: MetricSpec; value: number }>;
  }
): { best: BestCycle | null; updated: boolean } {
  // All metrics must clear threshold
  for (const m of candidate.metrics) {
    if (m.spec.direction === "maximize" && m.value < m.spec.threshold) {
      return { best: readBest(workspace, orgSlug, goalId), updated: false };
    }
    if (m.spec.direction === "minimize" && m.value > m.spec.threshold) {
      return { best: readBest(workspace, orgSlug, goalId), updated: false };
    }
  }

  const composite = candidate.metrics.reduce((acc, m) => {
    if (m.spec.direction === "maximize") {
      return acc + (m.spec.threshold > 0 ? m.value / m.spec.threshold : m.value);
    }
    const v = Math.max(m.value, 1e-9);
    return acc + (m.spec.threshold > 0 ? m.spec.threshold / v : 1);
  }, 0);

  const metric_values: Record<string, number> = {};
  for (const m of candidate.metrics) metric_values[m.spec.name] = m.value;

  const newBest: BestCycle = {
    cycle: candidate.cycle,
    commit: candidate.commit,
    timestamp: candidate.timestamp,
    composite_score: composite,
    metric_values,
  };

  const current = readBest(workspace, orgSlug, goalId);
  if (current && current.composite_score >= newBest.composite_score) {
    return { best: current, updated: false };
  }
  writeBest(workspace, orgSlug, goalId, newBest);
  return { best: newBest, updated: true };
}

// ---------- _events.jsonl JOIN ----------

export interface JoinedRow extends CycleResult {
  /** Total tokens from the matching spawn.complete event in _events.jsonl, if any. */
  totalTokens?: number;
  /** Spawn duration in ms. */
  spawnDurationMs?: number;
}

/**
 * Join results.tsv rows with the workflow-level _events.jsonl by task_id.
 * Used by `solosquad workflow show <id>` for unified cycle display.
 *
 * The workflowId is derived from the events.jsonl location — caller passes
 * it (goal-runner records which workflow each cycle belongs to).
 */
export function joinEventsByTaskId(
  workspace: string,
  orgSlug: string,
  goalId: string,
  workflowId: string
): JoinedRow[] {
  const rows = readResults(workspace, orgSlug, goalId);
  const evPath = workflowEventsPath(workspace, orgSlug, workflowId);
  if (!fs.existsSync(evPath)) return rows;
  const events = new FileEventSink(evPath).list();
  const byTask = new Map<
    string,
    { totalTokens?: number; durationMs?: number }
  >();
  for (const e of events) {
    if (e.kind === "spawn.complete") {
      const ev = e as AnyEvent & {
        taskId: string;
        totalTokens?: number;
        durationMs?: number;
      };
      byTask.set(ev.taskId, {
        totalTokens: ev.totalTokens,
        durationMs: ev.durationMs,
      });
    }
  }
  return rows.map((r) => {
    const hit = byTask.get(r.task_id);
    if (!hit) return r;
    return { ...r, totalTokens: hit.totalTokens, spawnDurationMs: hit.durationMs };
  });
}

// ---------- summary helpers ----------

export interface GoalRunSummary {
  goalId: string;
  cycleCount: number;
  keepCount: number;
  discardCount: number;
  totalCostUsd: number;
  bestCycle: BestCycle | null;
  lastCycleTimestamp?: string;
}

export function summarizeRun(
  workspace: string,
  orgSlug: string,
  goalId: string,
  cycleCostMap: Record<number, number>
): GoalRunSummary {
  const rows = readResults(workspace, orgSlug, goalId);
  // Distinct cycles
  const cycles = new Set(rows.map((r) => r.cycle));
  const keeps = new Set(rows.filter((r) => r.status === "keep").map((r) => r.cycle));
  const discards = new Set(rows.filter((r) => r.status === "discard").map((r) => r.cycle));

  let totalCostUsd = 0;
  for (const v of Object.values(cycleCostMap)) totalCostUsd += v;
  totalCostUsd = Math.round(totalCostUsd * 1_000_000) / 1_000_000;

  const lastCycleTimestamp = rows.length > 0 ? rows[rows.length - 1].timestamp : undefined;

  return {
    goalId,
    cycleCount: cycles.size,
    keepCount: keeps.size,
    discardCount: discards.size,
    totalCostUsd,
    bestCycle: readBest(workspace, orgSlug, goalId),
    lastCycleTimestamp,
  };
}
