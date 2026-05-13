import type { GoalSpec } from "./goal-parser.js";
import type { PersistentGuide } from "./agents-md-loader.js";

/**
 * v0.4 — 3-tier guardrails per `docs/plan/v0.4-autonomous-engine.md` §4.2.
 *
 *   Input  : 비용·시간·경로 화이트리스트 + immutable. 사이클 진입 전 평가.
 *   Runtime: timeout · discard streak · 누적 비용 cap. 사이클 진행 중 평가.
 *   Output : 외부 부수효과 금지 (메신저 직접 전송 등). 결과 통보는 morning-brief 경유.
 *
 * 본 모듈은 *순수 함수* — git 트랜잭션·spawn 호출 없음. goal-runner가
 * 사이클 진행 흐름에서 결과를 평가해 행동에 옮긴다.
 */

export interface ResolvedPaths {
  /** 자율 실행이 만질 수 있는 경로. AGENTS.md.modifiable_paths ∩ goal.modifiable_paths_override.
   *  override가 비어 있으면 AGENTS.md 기본값 그대로. */
  modifiable: string[];
  /** 절대 수정 금지 경로. AGENTS.md.immutable_paths + goal source_path 자체. */
  immutable: string[];
}

export interface InputGuardCheck {
  ok: boolean;
  reason?: string;
}

export interface CostTracker {
  total_usd: number;
  per_cycle_usd: Record<number, number>;
}

export interface RuntimeGuardCheck {
  /** Continue the loop, or terminate? */
  shouldContinue: boolean;
  /** Reason emitted when shouldContinue=false. */
  reason?: string;
  /** True iff we just crossed the cost_cap_warning_pct threshold. */
  costCapWarning: boolean;
}

export interface OutputGuardCheck {
  ok: boolean;
  violations: string[];
}

// ---------- Input ----------

/** Resolve final paths from GoalSpec + AGENTS.md. */
export function resolvePaths(goal: GoalSpec, guide: PersistentGuide): ResolvedPaths {
  // immutable always includes guide defaults + goal's own source_path
  const immutable = uniq([
    ...guide.immutable_paths,
    goal.source_path,
    // results.tsv path the runner will append to is also immutable to the
    // agents (only the engine writes it).
    `<org>/${goal.org}/goals/${goal.goal_id}/results.tsv`,
  ]);

  // modifiable: AGENTS.md defaults intersected with goal override if any.
  let modifiable: string[];
  if (goal.modifiable_paths_override && goal.modifiable_paths_override.length > 0) {
    modifiable = uniq(
      goal.modifiable_paths_override.filter((p) =>
        guide.modifiable_paths.some((g) => pathMatches(p, g) || pathMatches(g, p))
      )
    );
  } else {
    modifiable = uniq(guide.modifiable_paths);
  }

  return { modifiable, immutable };
}

/**
 * Pre-flight Input guard. Called once before the cycle loop starts. Catches
 * obvious "this goal is dead on arrival" cases.
 */
export function preflightInputGuard(
  goal: GoalSpec,
  guide: PersistentGuide,
  resolved: ResolvedPaths
): InputGuardCheck {
  if (resolved.modifiable.length === 0) {
    return {
      ok: false,
      reason:
        "modifiable_paths is empty after intersection with AGENTS.md. Goal cannot make any changes.",
    };
  }

  // Sanity: if goal's modifiable_paths_override declared a path that the
  // AGENTS.md immutable list also names, the goal contradicts the guide.
  if (goal.modifiable_paths_override) {
    for (const p of goal.modifiable_paths_override) {
      for (const imm of guide.immutable_paths) {
        if (pathMatches(p, imm)) {
          return {
            ok: false,
            reason: `goal.modifiable_paths_override "${p}" conflicts with AGENTS.md immutable "${imm}"`,
          };
        }
      }
    }
  }

  // Sanity: cost_budget must be enough for at least 1 cycle.
  if (goal.cost_budget.total_usd < goal.cost_budget.per_cycle_usd) {
    return {
      ok: false,
      reason: `cost_budget.total_usd (${goal.cost_budget.total_usd}) < per_cycle_usd (${goal.cost_budget.per_cycle_usd})`,
    };
  }

  return { ok: true };
}

/**
 * Per-stage path guard: is the file the specialist intends to write
 * within the resolved modifiable set, and not in immutable? Goal-runner
 * calls this against each `_events.jsonl` event that records a file write,
 * post-hoc — we don't intercept the write itself (that's Claude Code's
 * scope).
 */
export function isPathAllowed(filepath: string, resolved: ResolvedPaths): boolean {
  // Immutable first — wins
  for (const imm of resolved.immutable) {
    if (pathMatches(filepath, imm)) return false;
  }
  // Modifiable: must match at least one
  for (const mod of resolved.modifiable) {
    if (pathMatches(filepath, mod)) return true;
  }
  return false;
}

// ---------- Runtime ----------

export function newCostTracker(): CostTracker {
  return { total_usd: 0, per_cycle_usd: {} };
}

export function recordCycleCost(
  tracker: CostTracker,
  cycle: number,
  costUsd: number
): void {
  tracker.total_usd = Math.round((tracker.total_usd + costUsd) * 1_000_000) / 1_000_000;
  tracker.per_cycle_usd[cycle] =
    (tracker.per_cycle_usd[cycle] ?? 0) + costUsd;
}

/**
 * Called between cycles. Decides whether to continue, terminate, or warn.
 */
export function runtimeGuard(
  goal: GoalSpec,
  guide: PersistentGuide,
  tracker: CostTracker,
  cycleIndex: number,
  consecutiveDiscards: number,
  elapsedHours: number
): RuntimeGuardCheck {
  // Cost cap absolute
  if (tracker.total_usd >= goal.cost_budget.total_usd) {
    return {
      shouldContinue: false,
      reason: `cost cap reached: $${tracker.total_usd.toFixed(2)} >= $${goal.cost_budget.total_usd}`,
      costCapWarning: false,
    };
  }

  // Cost cap warning (90% by default)
  const warningThreshold = goal.cost_budget.total_usd * guide.cost_cap_warning_pct;
  const costCapWarning = tracker.total_usd >= warningThreshold;

  // Time budget (hours)
  if (goal.time_budget.hours != null && elapsedHours >= goal.time_budget.hours) {
    return {
      shouldContinue: false,
      reason: `time budget reached: ${elapsedHours.toFixed(2)}h >= ${goal.time_budget.hours}h`,
      costCapWarning,
    };
  }

  // Cycle budget
  if (goal.time_budget.cycles != null && cycleIndex >= goal.time_budget.cycles) {
    return {
      shouldContinue: false,
      reason: `cycle budget reached: ${cycleIndex} >= ${goal.time_budget.cycles}`,
      costCapWarning,
    };
  }

  // Discard streak
  if (consecutiveDiscards >= guide.consecutive_discard_limit) {
    return {
      shouldContinue: false,
      reason: `consecutive discard limit: ${consecutiveDiscards} >= ${guide.consecutive_discard_limit}`,
      costCapWarning,
    };
  }

  return { shouldContinue: true, costCapWarning };
}

// ---------- Output ----------

/**
 * Output guard — verifies that the cycle's recorded events do not contain
 * forbidden side-effects (messenger direct send, external mutating API,
 * non-whitelisted HTTP, etc.).
 *
 * We look at the spawn events' "agent ran X tool with Y target" trail —
 * goal-runner extracts target hosts/channels/etc. from events.jsonl entries
 * and passes them as a flat list of `effect descriptors`. Each descriptor is
 * a free-text string we compare against forbidden_side_effects (substring
 * match) and external_domain_whitelist (host comparison).
 */
export function outputGuard(
  guide: PersistentGuide,
  effectDescriptors: string[]
): OutputGuardCheck {
  const violations: string[] = [];
  for (const eff of effectDescriptors) {
    const low = eff.toLowerCase();

    // Forbidden substring match
    for (const forb of guide.forbidden_side_effects) {
      if (low.includes(forb.toLowerCase())) {
        violations.push(`forbidden side-effect "${forb}" detected: ${eff}`);
      }
    }

    // External HTTP whitelist
    const httpMatch = eff.match(/https?:\/\/([^/\s]+)/i);
    if (httpMatch) {
      const host = httpMatch[1].toLowerCase();
      if (guide.external_domain_whitelist.length === 0) {
        violations.push(`external HTTP blocked (no whitelist): ${eff}`);
      } else if (!guide.external_domain_whitelist.some((d) => host.endsWith(d.toLowerCase()))) {
        violations.push(`external HTTP host "${host}" not in whitelist: ${eff}`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ---------- helpers ----------

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

/**
 * Glob-ish match: supports `**` (any segments) and `*` (single segment).
 * Conservative — file ops touching a "broader" parent path are considered
 * to match. Used for both modifiable/immutable resolution and per-event
 * post-hoc verification.
 */
export function pathMatches(filepath: string, pattern: string): boolean {
  // Normalize both sides
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/$/, "");
  const f = norm(filepath);
  const p = norm(pattern);

  // Direct prefix shortcut (most common: "src/engine" matches "src/engine/foo.ts")
  if (f === p) return true;
  if (f.startsWith(p + "/")) return true;
  if (p.startsWith(f + "/")) return true; // pattern's child === file's parent

  // Convert glob → regex
  const escaped = p
    .replace(/[.+^$()|{}[\]]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return re.test(f);
}
