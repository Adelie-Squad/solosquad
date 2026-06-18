/**
 * v1.3.2 §9.4 — domain-agnostic guardrail core.
 *
 * Three brakes recur across every autonomous loop SoloSquad runs — a workflow
 * `mode:agentic` stage, the goal pipeline, and agent delegation depth:
 *
 *   1. iteration cap   — stop after N turns
 *   2. budget cap      — stop at a cost ceiling (with an early warning band)
 *   3. loop detection  — stop when the last few outputs are identical (the
 *                        agent is spinning, producing the same thing each turn)
 *
 * `src/engine/guards.ts` already enforces these for the *goal* runtime, but
 * coupled to `GoalSpec`/`PersistentGuide`. This module is the pure, type-free
 * kernel those three call-sites can share: the workflow validator uses
 * {@link GUARDRAIL_KEYS}/{@link hasAnyGuardrail} to check a stage *declares* a
 * brake; a runtime can use the detectors below to *enforce* one.
 */

/** The guardrail fields a `mode:agentic` stage may declare (§6). */
export const GUARDRAIL_KEYS = ["max_iterations", "budget_usd", "loop_detection"] as const;
export type GuardrailKey = (typeof GUARDRAIL_KEYS)[number];

/** Does this (loosely-typed, e.g. from YAML) spec declare at least one guardrail? */
export function hasAnyGuardrail(spec: unknown): boolean {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
  return GUARDRAIL_KEYS.some((k) => k in (spec as Record<string, unknown>));
}

// ---------- iteration cap ----------

/** True once `iteration` (0-based) has reached/exceeded the cap. */
export function iterationCapReached(iteration: number, max: number): boolean {
  return Number.isFinite(max) && iteration >= max;
}

// ---------- budget cap ----------

export interface BudgetStatus {
  /** Spend has met/exceeded the ceiling — stop now. */
  exceeded: boolean;
  /** Spend has crossed the warning band (default 90%) but not the ceiling. */
  warning: boolean;
}

/** Evaluate spend against a ceiling. `warnPct` is the fraction (0..1) at which
 *  to raise the early warning. A non-positive `total` disables the cap. */
export function budgetStatus(spent: number, total: number, warnPct = 0.9): BudgetStatus {
  if (!(total > 0)) return { exceeded: false, warning: false };
  const exceeded = spent >= total;
  const warning = !exceeded && spent >= total * warnPct;
  return { exceeded, warning };
}

// ---------- loop detection ----------

/**
 * Flags when the last `window` recorded outputs are all identical — the
 * canonical "the agent is stuck repeating itself" signal. Outputs are compared
 * after trimming + whitespace collapse so trivially-different reformatting of
 * the same content still trips it. Stateful and cheap (keeps only the window).
 */
export class LoopDetector {
  private readonly recent: string[] = [];

  constructor(private readonly window = 3) {
    if (window < 2) throw new Error("LoopDetector window must be >= 2");
  }

  /** Record an output; returns true iff the last `window` outputs are identical. */
  record(output: string): boolean {
    const norm = output.trim().replace(/\s+/g, " ");
    this.recent.push(norm);
    if (this.recent.length > this.window) this.recent.shift();
    if (this.recent.length < this.window) return false;
    return this.recent.every((o) => o === this.recent[0]);
  }

  reset(): void {
    this.recent.length = 0;
  }
}
