import fs from "fs";
import path from "path";
import { parseGoalFile, GoalParseError, type GoalSpec } from "../engine/goal-parser.js";
import { Findings, type BaseFinding, type ValidationResult } from "../util/validation.js";

/**
 * v1.3.7 §3.5 — static validation of a `goal.md`. Mirrors the other four
 * managers ({code, message, field} findings via the shared `Findings`
 * collector). `src/engine/**` is immutable, so this lives in `src/bot/` and
 * only *calls* `parseGoalFile` — the parser already throws `GoalParseError`
 * on structural/semantic shape issues; this wrapper turns that into a
 * non-throwing diagnostic and adds the extra static checks v1.3.6 §3.2 made
 * for skill/agent: metric provenance, pipeline agent existence, termination
 * presence, and a composite-vs-single Goodhart guardrail warning.
 *
 * Pure given the option callbacks (no fs unless `sourceExists` is supplied) so
 * it stays unit-testable like `validateCronDef`.
 */

export interface GoalFinding extends BaseFinding {
  goalId?: string;
}
export type GoalValidationResult = ValidationResult<GoalFinding>;

export interface ValidateGoalOptions {
  /** Does the metric `source` resolve (file path / known URL)? Caller supplies. */
  sourceExists?: (source: string) => boolean;
  /** Does the pipeline `<team>/<agent>` resolve to a real workspace agent? */
  agentExists?: (ref: string) => boolean;
}

const AGENT_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validate an already-parsed spec. Split out so tests can skip fs. */
export function validateGoalSpec(
  spec: GoalSpec,
  opts: ValidateGoalOptions = {},
  f: Findings<GoalFinding> = new Findings<GoalFinding>(),
): GoalValidationResult {
  const goalId = spec.goal_id;

  // --- Metrics: provenance + Goodhart guardrail ---
  if (spec.metrics.length === 0) {
    f.error({ code: "GOAL_NO_METRIC", goalId, field: "Metrics", message: "no metric defined" });
  }
  for (const m of spec.metrics) {
    f.errorIf(!m.source || m.source.trim() === "", {
      code: "GOAL_METRIC_SOURCE_EMPTY", goalId, field: `metric ${m.name}.source`,
      message: `metric "${m.name}" has no source (provenance)`,
    });
    if (m.source && m.source.trim() !== "" && opts.sourceExists && !opts.sourceExists(m.source)) {
      f.warn({
        code: "GOAL_METRIC_SOURCE_MISSING", goalId, field: `metric ${m.name}.source`,
        message: `metric "${m.name}" source "${m.source}" not found`,
      });
    }
  }
  f.warnIf(spec.metrics.length === 1, {
    code: "GOAL_SINGLE_METRIC", goalId, field: "Metrics",
    message: "single metric — consider a composite + guardrail (ALL-pass) to resist Goodhart gaming",
  });

  // --- Pipeline: agent refs ---
  if (spec.pipeline.length === 0) {
    f.error({ code: "GOAL_NO_PIPELINE", goalId, field: "Pipeline", message: "no pipeline step defined" });
  }
  for (const step of spec.pipeline) {
    const ref = step.agent;
    const wellFormed = AGENT_REF.test(ref);
    f.errorIf(!wellFormed, {
      code: "GOAL_PIPELINE_AGENT_FORMAT", goalId, field: "Pipeline",
      message: `pipeline agent "${ref}" must be "<team>/<agent>"`,
    });
    if (wellFormed && opts.agentExists && !opts.agentExists(ref)) {
      f.error({
        code: "GOAL_PIPELINE_AGENT_MISSING", goalId, field: "Pipeline",
        message: `pipeline agent "${ref}" not found in workspace`,
      });
    }
  }

  // --- Termination ---
  f.errorIf(spec.termination_conditions.length === 0, {
    code: "GOAL_NO_TERMINATION", goalId, field: "Termination",
    message: "no termination condition (convergence / budget / discard-streak)",
  });

  return f.result();
}

/** Parse + validate a goal.md at `absPath`. Parse failure → single GOAL_PARSE error. */
export function validateGoalFile(absPath: string, opts: ValidateGoalOptions = {}): GoalValidationResult {
  const f = new Findings<GoalFinding>();
  let spec: GoalSpec;
  try {
    spec = parseGoalFile(absPath);
  } catch (e) {
    const msg = e instanceof GoalParseError ? e.message : String((e as Error)?.message ?? e);
    f.error({ code: "GOAL_PARSE", field: "file", message: msg });
    return f.result();
  }
  // Resolve metric `source` paths relative to the goal.md directory when no
  // explicit checker is supplied (URLs are treated as present).
  const baseDir = path.dirname(absPath);
  const resolved: ValidateGoalOptions = {
    agentExists: opts.agentExists,
    sourceExists: opts.sourceExists ?? ((src) =>
      /^https?:\/\//i.test(src) || fs.existsSync(path.resolve(baseDir, src))),
  };
  return validateGoalSpec(spec, resolved, f);
}
