import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getOrgDir } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { readResults, type CycleResult } from "./tracker.js";

/**
 * v0.6 §5b — Stop-hook adapter (P0 #2).
 *
 * v0.5 `loop_mode.kind: spec-gate` defined the *spec*; this module *executes*
 * it. The goal-runner calls `evaluateStopCondition()` at the end of each
 * cycle. The SKILL frontmatter's `loop_mode.stop_when` may be:
 *
 *   (1) command   `loop_mode.stop_when.command = "npm test"`
 *                  exit 0 → STOP, non-zero → CONTINUE
 *   (2) metric    `loop_mode.stop_when.metric = { name, threshold, direction }`
 *                  read results.tsv last row → compare → STOP / CONTINUE
 *   (3) natural   `loop_mode.stop_when.natural = "all tests pass"`
 *                  LLM fallback — caller supplies the evaluator (so the
 *                  v0.5 budget cap can be applied without this module
 *                  depending on the LLM transport)
 *
 * v0.5 `SkillLoopMode.stop_when` is typed `string` only. v0.6 admits the
 * three forms by treating any object with a recognized key as the DSL and
 * falling back to the v0.5 single-string interpretation when the field is a
 * raw string. The normalize step lives **here** in the adapter, not in
 * `skill-parser.ts`, so the v0.5 parser stays frozen (S5 DO-NOT scope) and
 * a workspace mixing v0.5- and v0.6-authored SKILLs works without a flag-day
 * migration.
 *
 * Safety (§5b.3):
 *   - 5s timeout on command form — SIGTERM, conservative continue on expiry
 *   - LLM fallback rejected if no caller-supplied evaluator is provided
 *   - Hook failure → CONTINUE (false negative is safer than false positive)
 *
 * Logging: every evaluation appends to
 * `<org>/memory/stop-hook-events.jsonl` so we can measure timeout rate per
 * §7 success criteria.
 */

const STOP_HOOK_EVENT_FILE = "stop-hook-events.jsonl";
const COMMAND_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// DSL types
// ---------------------------------------------------------------------------

export type StopDirection = "≥" | "≤" | ">" | "<" | "==";

export interface StopWhenCommand {
  command: string;
  /** Override default 5s timeout. */
  timeoutMs?: number;
}

export interface StopWhenMetric {
  metric: {
    name: string;
    threshold: number;
    direction: StopDirection;
  };
}

export interface StopWhenNatural {
  natural: string;
}

export type StopWhenDsl = StopWhenCommand | StopWhenMetric | StopWhenNatural;

export type StopWhenForm = "command" | "metric" | "natural";

/** Normalized form — what the adapter actually evaluates. */
export interface NormalizedStopWhen {
  form: StopWhenForm;
  dsl: StopWhenDsl;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StopHookCycleResult {
  cycle: number;
  /** Latest results.tsv rows for this cycle — adapter only consumes those. */
  rows?: CycleResult[];
}

/**
 * v0.5 typed `loop_mode.stop_when` as `string`. v0.6 admits an object form
 * (DSL). Accept either; normalize is local to this module.
 */
export type LoopModeStopWhen = string | StopWhenDsl;

export interface LoopModeForHook {
  kind: "spec-gate";
  stop_when?: LoopModeStopWhen;
}

export interface EvaluateStopOpts {
  workspace: string;
  orgSlug: string;
  goalId: string;
  cycleResult: StopHookCycleResult;
  loopMode: LoopModeForHook;
  /**
   * Optional LLM evaluator for the natural form (§5b.6 form 3). Caller is
   * responsible for applying the v0.5 author-budget cap. When absent and
   * the DSL form is natural, the adapter returns `continue` (conservative).
   */
  naturalEvaluator?: NaturalEvaluator;
  /** Override "now" for deterministic test logging. */
  now?: string;
  /** Override the 5s command timeout (tests). */
  commandTimeoutMs?: number;
}

export interface NaturalEvaluator {
  evaluate(args: {
    natural: string;
    cycleRows: CycleResult[];
  }): Promise<{ stop: boolean; reason: string }>;
}

export interface EvaluateStopResult {
  stop: boolean;
  reason: string;
  /** "command" | "metric" | "natural" | "none" — what form was evaluated. */
  form: StopWhenForm | "none";
  /** True when the evaluation hit the timeout path. */
  timedOut: boolean;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function evaluateStopCondition(
  opts: EvaluateStopOpts,
): Promise<EvaluateStopResult> {
  const normalized = normalizeStopWhen(opts.loopMode.stop_when);
  if (!normalized) {
    const reason = "loop_mode.stop_when missing or unrecognized — continue";
    logStopHookEvent(opts, {
      form: "none",
      stop: false,
      reason,
      timedOut: false,
    });
    return { stop: false, reason, form: "none", timedOut: false };
  }

  let result: EvaluateStopResult;
  switch (normalized.form) {
    case "command":
      result = await evaluateCommand(
        normalized.dsl as StopWhenCommand,
        opts.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
      );
      break;
    case "metric":
      result = evaluateMetric(
        normalized.dsl as StopWhenMetric,
        opts.workspace,
        opts.orgSlug,
        opts.goalId,
        opts.cycleResult,
      );
      break;
    case "natural":
      result = await evaluateNatural(
        normalized.dsl as StopWhenNatural,
        opts.cycleResult,
        opts.naturalEvaluator,
      );
      break;
  }

  logStopHookEvent(opts, result);
  return result;
}

// ---------------------------------------------------------------------------
// Normalization (string OR object → DSL)
// ---------------------------------------------------------------------------

/**
 * Accept v0.5 string form *or* v0.6 object form. The object form is decided
 * by which DSL key is present; priority command > metric > natural so a
 * SKILL that accidentally sets more than one still gets a deterministic
 * resolution.
 *
 * Why normalize *here* and not in `skill-parser.ts`: the v0.5 parser is
 * frozen for this sprint (`DO NOT` scope), and putting the string→DSL bridge
 * in the adapter keeps the parser's surface unchanged so workspaces that
 * mix v0.5 and v0.6 SKILLs do not need a migration to keep loading.
 */
export function normalizeStopWhen(raw: LoopModeStopWhen | undefined): NormalizedStopWhen | null {
  if (raw === undefined || raw === null) return null;

  if (typeof raw === "string") {
    // v0.5 form — a free-text predicate. Recognize a few decisive shapes,
    // otherwise treat as a natural-language clause.
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return {
      form: "natural",
      dsl: { natural: trimmed },
    };
  }

  if (typeof raw !== "object") return null;
  const obj = raw as unknown as Record<string, unknown>;

  // Priority: command > metric > natural.
  if (typeof obj.command === "string" && obj.command.trim()) {
    const dsl: StopWhenCommand = { command: obj.command.trim() };
    if (typeof obj.timeoutMs === "number" && obj.timeoutMs > 0) {
      dsl.timeoutMs = obj.timeoutMs;
    }
    return { form: "command", dsl };
  }

  if (obj.metric && typeof obj.metric === "object") {
    const m = obj.metric as Record<string, unknown>;
    const name = typeof m.name === "string" ? m.name.trim() : "";
    const threshold = typeof m.threshold === "number" ? m.threshold : NaN;
    const direction = parseDirection(m.direction);
    if (name && Number.isFinite(threshold) && direction) {
      const dsl: StopWhenMetric = {
        metric: { name, threshold, direction },
      };
      return { form: "metric", dsl };
    }
  }

  if (typeof obj.natural === "string" && obj.natural.trim()) {
    return { form: "natural", dsl: { natural: obj.natural.trim() } };
  }

  return null;
}

function parseDirection(raw: unknown): StopDirection | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const allowed: StopDirection[] = ["≥", "≤", ">", "<", "=="];
  if ((allowed as string[]).includes(t)) return t as StopDirection;
  if (t === ">=") return "≥";
  if (t === "<=") return "≤";
  return null;
}

// ---------------------------------------------------------------------------
// Form 1: command
// ---------------------------------------------------------------------------

async function evaluateCommand(
  dsl: StopWhenCommand,
  timeoutMs: number,
): Promise<EvaluateStopResult> {
  const parts = parseCommand(dsl.command);
  if (parts.length === 0) {
    return {
      stop: false,
      reason: "command form had no parsable executable",
      form: "command",
      timedOut: false,
    };
  }

  return await new Promise<EvaluateStopResult>((resolve) => {
    const effectiveTimeout = dsl.timeoutMs ?? timeoutMs;
    let resolved = false;
    let timer: NodeJS.Timeout | null = null;

    const child = spawn(parts[0], parts.slice(1), {
      stdio: "ignore",
      shell: process.platform === "win32",
    });

    const finish = (result: EvaluateStopResult): void => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    timer = setTimeout(() => {
      // Conservative continue (§5b.3): hook timeout never *stops* a goal — a
      // false-positive stop would discard work; a false-negative continue
      // just runs another cycle. The time/cost budgets still hard-cap the
      // run elsewhere (goal-runner runtime guard), so this can never cause
      // an infinite loop.
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore — process may have already exited
      }
      finish({
        stop: false,
        reason: `command timeout after ${effectiveTimeout}ms — continue (conservative)`,
        form: "command",
        timedOut: true,
      });
    }, effectiveTimeout);

    child.on("error", (err) => {
      finish({
        stop: false,
        reason: `command spawn error: ${err.message} — continue (conservative)`,
        form: "command",
        timedOut: false,
      });
    });

    child.on("exit", (code) => {
      if (code === 0) {
        finish({
          stop: true,
          reason: `command exit 0 — stop condition met`,
          form: "command",
          timedOut: false,
        });
      } else {
        finish({
          stop: false,
          reason: `command exit ${code ?? "?"} — continue`,
          form: "command",
          timedOut: false,
        });
      }
    });
  });
}

function parseCommand(raw: string): string[] {
  // Lightweight tokenizer — splits on whitespace but respects double-quoted
  // segments. Sufficient for `npm test`, `pytest -q`, `bash scripts/check.sh`.
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(c)) {
      if (buf.length > 0) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    buf += c;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

// ---------------------------------------------------------------------------
// Form 2: metric
// ---------------------------------------------------------------------------

function evaluateMetric(
  dsl: StopWhenMetric,
  workspace: string,
  orgSlug: string,
  goalId: string,
  cycleResult: StopHookCycleResult,
): EvaluateStopResult {
  // Prefer the caller-supplied rows (in-memory, no I/O). Fall back to
  // results.tsv last cycle row when the caller didn't provide one — the
  // adapter is sometimes called outside the runner's hot path (e.g. CLI
  // verify-stop).
  const rows = cycleResult.rows ?? readResults(workspace, orgSlug, goalId);
  const targetCycle = cycleResult.cycle;

  let candidate: CycleResult | undefined;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.metric === dsl.metric.name && (targetCycle === undefined || r.cycle === targetCycle)) {
      candidate = r;
      break;
    }
  }
  if (!candidate) {
    return {
      stop: false,
      reason: `metric ${dsl.metric.name} not yet recorded — continue`,
      form: "metric",
      timedOut: false,
    };
  }

  const ok = compareMetric(candidate.value, dsl.metric.threshold, dsl.metric.direction);
  return {
    stop: ok,
    reason: ok
      ? `metric ${dsl.metric.name}=${candidate.value} ${dsl.metric.direction} ${dsl.metric.threshold} — stop`
      : `metric ${dsl.metric.name}=${candidate.value} ${dsl.metric.direction} ${dsl.metric.threshold} not met — continue`,
    form: "metric",
    timedOut: false,
  };
}

function compareMetric(value: number, threshold: number, direction: StopDirection): boolean {
  switch (direction) {
    case "≥":
      return value >= threshold;
    case "≤":
      return value <= threshold;
    case ">":
      return value > threshold;
    case "<":
      return value < threshold;
    case "==":
      return value === threshold;
  }
}

// ---------------------------------------------------------------------------
// Form 3: natural (LLM fallback)
// ---------------------------------------------------------------------------

async function evaluateNatural(
  dsl: StopWhenNatural,
  cycleResult: StopHookCycleResult,
  evaluator?: NaturalEvaluator,
): Promise<EvaluateStopResult> {
  if (!evaluator) {
    return {
      stop: false,
      reason: `natural form "${dsl.natural}" but no LLM evaluator supplied — continue (conservative)`,
      form: "natural",
      timedOut: false,
    };
  }
  try {
    const verdict = await evaluator.evaluate({
      natural: dsl.natural,
      cycleRows: cycleResult.rows ?? [],
    });
    return {
      stop: verdict.stop,
      reason: verdict.reason || (verdict.stop ? "natural verdict: stop" : "natural verdict: continue"),
      form: "natural",
      timedOut: false,
    };
  } catch (e) {
    return {
      stop: false,
      reason: `natural evaluator threw: ${(e as Error).message} — continue (conservative)`,
      form: "natural",
      timedOut: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Event logging
// ---------------------------------------------------------------------------

function logStopHookEvent(opts: EvaluateStopOpts, result: EvaluateStopResult): void {
  const file = path.join(
    getOrgDir(opts.orgSlug, opts.workspace),
    "memory",
    STOP_HOOK_EVENT_FILE,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    event_type: "stop_hook",
    timestamp: opts.now ?? new Date().toISOString(),
    goal_id: opts.goalId,
    cycle: opts.cycleResult.cycle,
    form: result.form,
    stop: result.stop,
    reason: result.reason,
    timed_out: result.timedOut,
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
}

/** Exposed for `solosquad memory stats` + consumers that want to tail the log. */
export function stopHookEventsPath(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "memory", STOP_HOOK_EVENT_FILE);
}

/** Read all stop-hook events from the org's log. Read-only — for tests/CLI. */
export function readStopHookEvents(workspace: string, orgSlug: string): unknown[] {
  const file = stopHookEventsPath(workspace, orgSlug);
  if (!fs.existsSync(file)) return [];
  const raw = normalizeLine(fs.readFileSync(file, "utf-8"));
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // ignore
    }
  }
  return out;
}
