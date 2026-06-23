/**
 * v1.3.6 §3.5① — behaviour-layer self-improvement gate (deterministic).
 *
 * The rollout + reflection + edit *authoring* are done by the running Claude
 * (skill-refinement / skill-manager in-session, SkillOpt-style): run the skill,
 * read the scored trajectory, propose a bounded prose patch. This module is the
 * deterministic guardrail around that loop so a self-editing skill can't drift:
 *   - bounded edit budget (Lt=4, floor 2) per epoch;
 *   - held-out gate: accept a candidate only if it *strictly* beats the best
 *     score seen so far (no ties, no regressions);
 *   - rejected-edit buffer: remember edits that dropped the score so the agent
 *     doesn't re-propose them (negative signal).
 *
 * The scorer feeding this is `eval-corpus.ts` (trigger-rate / output A/B) — the
 * §3.3 eval. No scorer ⇒ no behaviour-layer self-improvement (static gate only).
 */

export interface EditBudget {
  /** Max edits per epoch (SkillOpt Lt). Default 4. */
  max: number;
  /** Minimum edits to attempt before stopping early. Default 2. */
  floor: number;
}

export const DEFAULT_EDIT_BUDGET: EditBudget = { max: 4, floor: 2 };

/** True while more edits are allowed this epoch. */
export function editsRemaining(used: number, budget: EditBudget = DEFAULT_EDIT_BUDGET): boolean {
  return used < budget.max;
}

/** Has the floor been met (so we may stop on a plateau)? */
export function mayStopEarly(used: number, budget: EditBudget = DEFAULT_EDIT_BUDGET): boolean {
  return used >= budget.floor;
}

/**
 * Held-out gate: accept the candidate edit only if its held-out score is
 * *strictly* greater than the best score so far. Ties and regressions reject —
 * "the best description may not be the last one".
 */
export function acceptEdit(bestScore: number, candidateScore: number): boolean {
  return candidateScore > bestScore;
}

/**
 * Negative-signal memory: edits that lowered the score, keyed by a stable edit
 * id (e.g. a hash of the patch), so the agent stops re-proposing them.
 */
export class RejectedEditBuffer {
  private readonly drops = new Map<string, number>();

  /** Record a rejected edit and how far it dropped the held-out score (≥0). */
  record(editId: string, scoreDrop: number): void {
    const prev = this.drops.get(editId) ?? 0;
    this.drops.set(editId, Math.max(prev, scoreDrop));
  }

  isRejected(editId: string): boolean {
    return this.drops.has(editId);
  }

  /** Worst recorded drop for an edit (0 if never rejected). */
  dropFor(editId: string): number {
    return this.drops.get(editId) ?? 0;
  }

  get size(): number {
    return this.drops.size;
  }
}

export interface RefineStep {
  editId: string;
  candidateScore: number;
  accepted: boolean;
}

export interface RefineOutcome {
  /** Best score reached (starts at the baseline). */
  bestScore: number;
  steps: RefineStep[];
  rejected: RejectedEditBuffer;
}

/**
 * Drive the accept/reject + budget + rejection bookkeeping over an already-
 * authored, already-scored sequence of candidate edits. (The authoring/scoring
 * upstream is the running agent + eval-corpus; this just gates the sequence so
 * the same logic is unit-testable.)
 */
export function runRefineGate(
  baselineScore: number,
  candidates: Array<{ editId: string; score: number }>,
  budget: EditBudget = DEFAULT_EDIT_BUDGET,
): RefineOutcome {
  let bestScore = baselineScore;
  const steps: RefineStep[] = [];
  const rejected = new RejectedEditBuffer();
  let used = 0;

  for (const c of candidates) {
    if (!editsRemaining(used, budget)) break;
    if (rejected.isRejected(c.editId)) continue; // never re-try a known-bad edit
    used++;
    const accepted = acceptEdit(bestScore, c.score);
    if (accepted) {
      bestScore = c.score;
    } else {
      rejected.record(c.editId, bestScore - c.score);
    }
    steps.push({ editId: c.editId, candidateScore: c.score, accepted });
  }

  return { bestScore, steps, rejected };
}
