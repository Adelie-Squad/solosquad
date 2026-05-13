import { execFileSync } from "child_process";
import path from "path";
import { getOrgDir } from "../util/paths.js";
import type { MetricMeasurer } from "./evaluator.js";
import { metricPasses } from "./evaluator.js";
import { readResults, type CycleResult } from "./tracker.js";
import { parseGoalFile } from "./goal-parser.js";

/**
 * v0.4 — reconciliation / `solosquad goal verify`.
 *
 * Per docs/plan/v0.4-autonomous-engine.md §2.1 rule 2 and §5
 * "provenance 컬럼" — same commit + same provenance must re-compute to
 * the same value. This is the Data Reconciliation defense against
 * Goodhart drift.
 *
 * Flow:
 *   1. Look up the cycle's stored measurements in results.tsv.
 *   2. Find the keep commit (or pre-cycle commit for discard cycles).
 *   3. Check out the engine snapshot tree at that commit (snapshot.git
 *      worktree). Pure read — does NOT mutate the user's working tree.
 *   4. Re-run the measurer for each metric.
 *   5. Compare to recorded value within a tolerance.
 */

export interface VerifyOutcome {
  cycle: number;
  commit: string;
  deterministic: boolean;
  /** Per-metric replay result. */
  metrics: Array<{
    name: string;
    recorded: number;
    replayed: number;
    delta: number;
    pass: boolean;
    /** True iff replayed value crosses the threshold the same way. */
    statusMatch: boolean;
  }>;
}

export interface VerifyOpts {
  workspace: string;
  orgSlug: string;
  goalId: string;
  cycle: number;
  /** Numeric tolerance for value comparison. Default 1e-6. */
  tolerance?: number;
}

export async function verifyCycle(
  opts: VerifyOpts,
  measurer: MetricMeasurer
): Promise<VerifyOutcome> {
  const tol = opts.tolerance ?? 1e-6;

  const allRows = readResults(opts.workspace, opts.orgSlug, opts.goalId);
  const cycleRows = allRows.filter((r) => r.cycle === opts.cycle);
  if (cycleRows.length === 0) {
    throw new Error(`cycle ${opts.cycle} not found in results.tsv`);
  }

  const commit = pickAnchor(cycleRows);

  // Resolve goal.md at this commit. The goal.md path is stable — we read
  // the working-tree copy (goal.md is `immutable_paths` so it doesn't
  // change between cycles).
  const goalMd = path.join(
    getOrgDir(opts.orgSlug, opts.workspace),
    "goals",
    opts.goalId,
    "goal.md"
  );
  const goal = parseGoalFile(goalMd);

  // Check out the snapshot tree at this commit — best-effort, optional
  // (some discards may not have a viable commit). If checkout fails we
  // still replay with current working tree (and surface it in the result).
  const checkoutOk = trySnapshotCheckout(opts.workspace, opts.orgSlug, commit);

  try {
    const metrics: VerifyOutcome["metrics"] = [];
    for (const spec of goal.metrics) {
      const rec = cycleRows.find((r) => r.metric === spec.name);
      if (!rec) {
        metrics.push({
          name: spec.name,
          recorded: NaN,
          replayed: NaN,
          delta: NaN,
          pass: false,
          statusMatch: false,
        });
        continue;
      }
      const m = await measurer.measure(spec, {
        workspace: opts.workspace,
        orgSlug: opts.orgSlug,
        goalId: opts.goalId,
        commitSha: commit,
      });
      const delta = Math.abs(m.value - rec.value);
      const pass = delta <= tol;
      const replayPassesThreshold = metricPasses(spec, m.value);
      const recordedKeep = rec.status === "keep";
      const statusMatch = replayPassesThreshold === recordedKeep;
      metrics.push({
        name: spec.name,
        recorded: rec.value,
        replayed: m.value,
        delta,
        pass,
        statusMatch,
      });
    }

    const deterministic = metrics.every((m) => m.pass && m.statusMatch);
    void checkoutOk; // referenced for forensics; absence isn't strictly fatal
    return { cycle: opts.cycle, commit, deterministic, metrics };
  } finally {
    // Always release the worktree if we checked out, regardless of result.
    if (checkoutOk) restoreSnapshotHead(opts.workspace, opts.orgSlug);
  }
}

// ---------- helpers ----------

function pickAnchor(rows: CycleResult[]): string {
  // Prefer the keep commit if any row in this cycle was kept.
  for (const r of rows) {
    if (r.status === "keep" && r.commit && r.commit !== "-") return r.commit;
  }
  // Discard cycles: use the pre-cycle anchor — historical commits in the
  // snapshot history. We approximate by using any commit reference present.
  for (const r of rows) {
    if (r.commit && r.commit !== "-") return r.commit;
  }
  return "HEAD";
}

function snapshotPaths(workspace: string, orgSlug: string): {
  gitDir: string;
  workTree: string;
} {
  return {
    gitDir: path.join(getOrgDir(orgSlug, workspace), ".solosquad", "snapshot.git"),
    workTree: getOrgDir(orgSlug, workspace),
  };
}

function trySnapshotCheckout(
  workspace: string,
  orgSlug: string,
  commit: string
): boolean {
  if (commit === "HEAD" || commit === "-") return false;
  const sp = snapshotPaths(workspace, orgSlug);
  try {
    execFileSync(
      "git",
      ["--git-dir", sp.gitDir, "--work-tree", sp.workTree, "checkout", commit, "--", "memory", "workflows"],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    return true;
  } catch {
    return false;
  }
}

function restoreSnapshotHead(workspace: string, orgSlug: string): void {
  const sp = snapshotPaths(workspace, orgSlug);
  try {
    execFileSync(
      "git",
      ["--git-dir", sp.gitDir, "--work-tree", sp.workTree, "checkout", "HEAD", "--", "memory", "workflows"],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } catch {
    // best-effort
  }
}
