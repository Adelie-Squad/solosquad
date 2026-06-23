/**
 * v1.3.6 §3.3 — skill eval scoring (deterministic bookkeeping).
 *
 * The eval *judgments* are made by the running Claude, not an API client:
 * skill-manager/skill-refinement (Chief in-session) spawns judge sub-agents
 * via the Task tool — "does this query surface the skill?" (trigger) and
 * "is the with-skill output better?" (output A/B). This module is only the
 * deterministic arithmetic around those judgments: tally trigger-rate, split
 * train/val reproducibly, and aggregate A/B deltas. Pure — no fs here, no LLM.
 *
 * See `skills/skill-manager/references/eval-recipe.md` for the procedure the
 * agent follows; this is the scorer it hands results to.
 */

// ---------------------------------------------------------------------------
// (1) description trigger eval
// ---------------------------------------------------------------------------

export interface TriggerQuery {
  query: string;
  /** true = should trigger the skill; false = should-NOT (near-miss negative). */
  should: boolean;
}

export interface TriggerResult extends TriggerQuery {
  /** Did the skill fire for this query (judged by the running agent)? */
  triggered: boolean;
}

export interface TriggerScore {
  /** Fraction of should-trigger queries that fired (higher is better). */
  shouldRate: number;
  /** Fraction of should-NOT queries that fired (lower is better). */
  shouldNotRate: number;
  passShould: boolean;
  passShouldNot: boolean;
  pass: boolean;
  counts: { should: number; shouldNot: number };
}

/**
 * Score one run of trigger results. Pass = should-trigger rate strictly above
 * `threshold` AND should-NOT rate strictly below it (0.5 default, §3.3).
 */
export function scoreTrigger(results: TriggerResult[], threshold = 0.5): TriggerScore {
  const should = results.filter((r) => r.should);
  const shouldNot = results.filter((r) => !r.should);
  const rate = (rs: TriggerResult[]) =>
    rs.length === 0 ? 0 : rs.filter((r) => r.triggered).length / rs.length;
  const shouldRate = rate(should);
  const shouldNotRate = rate(shouldNot);
  const passShould = should.length > 0 && shouldRate > threshold;
  const passShouldNot = shouldNot.length === 0 || shouldNotRate < threshold;
  return {
    shouldRate,
    shouldNotRate,
    passShould,
    passShouldNot,
    pass: passShould && passShouldNot,
    counts: { should: should.length, shouldNot: shouldNot.length },
  };
}

/**
 * Deterministic train/val split (default 60/40, §3.3) so iterations are
 * reproducible and we never overfit description tweaks to val queries. Uses a
 * seeded LCG shuffle — same items + seed => same split.
 */
export function splitTrainVal<T>(
  items: T[],
  ratio = 0.6,
  seed = 1,
): { train: T[]; val: T[] } {
  const arr = [...items];
  let s = (seed >>> 0) || 1;
  // Fisher–Yates with an LCG (numerical-recipes constants).
  for (let i = arr.length - 1; i > 0; i--) {
    s = (1664525 * s + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const cut = Math.round(arr.length * ratio);
  return { train: arr.slice(0, cut), val: arr.slice(cut) };
}

// ---------------------------------------------------------------------------
// (2) output quality A/B
// ---------------------------------------------------------------------------

export interface OutputCaseResult {
  id: string;
  withSkillPass: boolean;
  withoutSkillPass: boolean;
  tokensWith: number;
  tokensWithout: number;
  durationMsWith: number;
  durationMsWithout: number;
}

export interface OutputABScore {
  passRateWith: number;
  passRateWithout: number;
  /** with − without; positive means the skill body helped. */
  passDelta: number;
  /** Mean extra tokens the skill costs (with − without). */
  tokenDelta: number;
  /** Mean extra wall-clock the skill costs (with − without). */
  durationMsDelta: number;
  n: number;
}

/** Aggregate A/B case results into pass-rate + cost deltas (§3.3). */
export function scoreOutputAB(results: OutputCaseResult[]): OutputABScore {
  const n = results.length;
  if (n === 0) {
    return {
      passRateWith: 0,
      passRateWithout: 0,
      passDelta: 0,
      tokenDelta: 0,
      durationMsDelta: 0,
      n: 0,
    };
  }
  const mean = (f: (r: OutputCaseResult) => number) =>
    results.reduce((a, r) => a + f(r), 0) / n;
  const passRateWith = mean((r) => (r.withSkillPass ? 1 : 0));
  const passRateWithout = mean((r) => (r.withoutSkillPass ? 1 : 0));
  return {
    passRateWith,
    passRateWithout,
    passDelta: passRateWith - passRateWithout,
    tokenDelta: mean((r) => r.tokensWith - r.tokensWithout),
    durationMsDelta: mean((r) => r.durationMsWith - r.durationMsWithout),
    n,
  };
}
