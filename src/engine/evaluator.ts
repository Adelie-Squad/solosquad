import { commitSnapshot, revertToSnapshot, listSnapshots } from "../bot/git-snapshot.js";
import type { GoalSpec, MetricSpec } from "./goal-parser.js";
import {
  appendResults,
  maybeUpdateBest,
  type CycleResult,
  type CycleStatus,
} from "./tracker.js";

/**
 * v0.4 — evaluator.
 *
 * Per docs/plan/v0.4-autonomous-engine.md §4.2:
 *
 *   v0.3 git-snapshot.commit (pre-cycle)
 *      ↓
 *   PM runs pipeline via Task tool
 *      ↓
 *   evaluator.measure(metric, provenance) → keep|discard
 *      ↓ keep:    new commit (metric=value), append results row
 *      ↓ discard: git-snapshot.revert(pre-cycle), append discard row (commit="-")
 *
 * The evaluator does NOT itself reach into the model — it accepts pre-measured
 * values from the goal-runner (which delegates measurement to specialists via
 * the Task tool, or to a deterministic measurer when one exists for this
 * metric's source).
 *
 * `MetricMeasurer` is the injection point: production passes a measurer that
 * reads `metric.source` from disk and applies `metric.formula`. Tests pass a
 * fake that returns scripted values.
 */

export interface MetricMeasurement {
  spec: MetricSpec;
  value: number;
  /** Composed provenance string for the results row. */
  provenance: string;
}

export interface MetricMeasurer {
  measure(spec: MetricSpec, ctx: MeasureContext): Promise<MetricMeasurement>;
}

export interface MeasureContext {
  workspace: string;
  orgSlug: string;
  goalId: string;
  /** Optional pre-cycle commit SHA (for verify replay). */
  commitSha?: string;
}

export interface CycleEvaluationInput {
  workspace: string;
  orgSlug: string;
  goalId: string;
  goal: GoalSpec;
  cycle: number;
  /** SHA of the pre-cycle snapshot (created by goal-runner before stages ran). */
  preCycleCommit: string;
  /** spawn events that produced this cycle's artifacts. */
  taskIds: string[];
  /** Cycle wall-clock when stages completed. ISO. */
  timestamp: string;
  /** Short label written into results.tsv `description` and commit msg. */
  description: string;
}

export interface CycleEvaluationOutput {
  status: CycleStatus;
  measurements: MetricMeasurement[];
  /** SHA of the keep commit (status=keep) OR the snapshot HEAD after revert
   * (status=discard). */
  postCycleCommit: string;
  /** Composite score (sum over normalized metric contributions). 0 when discarded. */
  compositeScore: number;
  /** Did this cycle bump the `_best.json`? */
  isNewBest: boolean;
}

/**
 * Run measurement, decide keep/discard, commit/revert, append results.tsv.
 *
 * Decision rule (per metric):
 *   maximize  → keep iff value >= threshold
 *   minimize  → keep iff value <= threshold
 * Cycle is `keep` iff ALL metrics pass; `discard` otherwise.
 */
export async function evaluateCycle(
  input: CycleEvaluationInput,
  measurer: MetricMeasurer
): Promise<CycleEvaluationOutput> {
  const ctx: MeasureContext = {
    workspace: input.workspace,
    orgSlug: input.orgSlug,
    goalId: input.goalId,
    commitSha: input.preCycleCommit,
  };

  // Measure each metric in goal definition order.
  const measurements: MetricMeasurement[] = [];
  for (const spec of input.goal.metrics) {
    measurements.push(await measurer.measure(spec, ctx));
  }

  // Decide
  const allPass = measurements.every((m) => metricPasses(m.spec, m.value));
  const status: CycleStatus = allPass ? "keep" : "discard";

  let postCycleCommit: string;
  let compositeScore = 0;
  let isNewBest = false;

  if (status === "keep") {
    // commit message embed first metric (for human scan); full list in body
    const primary = measurements[0];
    const summary =
      `[cycle-${input.cycle}] keep ${primary.spec.name}=${primary.value} ` +
      `: ${input.description}`;
    const newSha = commitSnapshot(input.workspace, input.orgSlug, summary);
    // commitSnapshot returns null when nothing changed in the working tree.
    // For our purposes the *pre-cycle commit* still anchors keep status.
    postCycleCommit = newSha ?? input.preCycleCommit;

    const bestRes = maybeUpdateBest(input.workspace, input.orgSlug, input.goalId, {
      cycle: input.cycle,
      commit: postCycleCommit,
      timestamp: input.timestamp,
      metrics: measurements.map((m) => ({ spec: m.spec, value: m.value })),
    });
    isNewBest = bestRes.updated;
    compositeScore = bestRes.best?.composite_score ?? 0;
  } else {
    // Revert the engine's snapshot tree back to pre-cycle commit. Repo code
    // (under <org>/repositories/<repo>/) is untouched per v0.3.0 git-snapshot
    // policy.
    const revertResult = revertToSnapshot(
      input.workspace,
      input.orgSlug,
      input.preCycleCommit,
      `cycle-${input.cycle} discard`
    );
    if (!revertResult.ok) {
      throw new Error(
        `cycle-${input.cycle} discard revert failed: ${revertResult.error}`
      );
    }
    postCycleCommit = revertResult.newSha ?? input.preCycleCommit;
  }

  // Append results.tsv — one row per metric.
  const rows: CycleResult[] = measurements.map((m, idx) => ({
    cycle: input.cycle,
    timestamp: input.timestamp,
    // Per spec the agent column reflects which specialist measured. When the
    // measurer is goal-runner-internal (deterministic), label "cycle".
    agent: input.goal.pipeline[idx]?.agent ?? "cycle",
    metric: m.spec.name,
    value: m.value,
    status,
    commit: status === "keep" ? postCycleCommit : "-",
    provenance: m.provenance,
    task_id: input.taskIds[Math.min(idx, input.taskIds.length - 1)] ?? "",
    description: input.description,
  }));
  appendResults(input.workspace, input.orgSlug, input.goalId, rows);

  return { status, measurements, postCycleCommit, compositeScore, isNewBest };
}

export function metricPasses(spec: MetricSpec, value: number): boolean {
  if (spec.direction === "maximize") return value >= spec.threshold;
  return value <= spec.threshold;
}

// ---------- pre-cycle snapshot helper ----------

/**
 * Goal-runner calls this before invoking the pipeline for a cycle. Returns
 * the commit SHA that evaluator will reference for keep/discard branching.
 */
export function takePreCycleSnapshot(
  workspace: string,
  orgSlug: string,
  goalId: string,
  cycle: number
): string {
  const subject = `chore(spawn): goal-${goalId} cycle-${cycle}`;
  const sha = commitSnapshot(workspace, orgSlug, subject);
  if (sha) return sha;
  // Nothing changed in the working tree — find the existing HEAD.
  const list = listSnapshots(workspace, orgSlug, 1);
  if (list.length > 0) return list[0].sha;
  throw new Error(
    `unable to anchor pre-cycle snapshot for ${orgSlug}/${goalId} cycle-${cycle}`
  );
}
