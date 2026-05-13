import fs from "fs";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.4 — `goal.md` parser.
 *
 * Per docs/plan/v0.4-autonomous-engine.md §4.1. `goal.md` is the *volatile
 * intent* file (Codex `/goal` analogue) — written by humans, never modified
 * by AI agents. Holds the 1-line goal, metrics with provenance, pipeline,
 * budgets, termination conditions, optional signal trigger, and an optional
 * narrowing of modifiable_paths (which is otherwise inherited from
 * `<workspace>/AGENTS.md`).
 *
 * Guardrails (immutable_paths, external_side_effects, Output policies) are
 * NOT parsed here — they live in AGENTS.md and are loaded by
 * `agents-md-loader.ts`. Per v0.4 §4.2.
 */

export const GOAL_SCHEMA_VERSION = 1;

export type MetricDirection = "maximize" | "minimize";
export type SignalAutoMode = "false" | "prompt" | "true";

export interface MetricSpec {
  name: string;
  formula: string;
  source: string;
  threshold: number;
  direction: MetricDirection;
}

export interface PipelineStep {
  /** "<team>/<agent>" — e.g. "experience/desk-researcher". */
  agent: string;
  task: string;
}

export interface CostBudget {
  per_cycle_usd: number;
  total_usd: number;
}

export interface TimeBudget {
  /** Either hours OR cycles must be set, not both. */
  hours?: number;
  cycles?: number;
}

export interface SignalTrigger {
  /** false: alert only · prompt: ask user yes/no · true: auto-execute */
  auto: SignalAutoMode;
  /** Keywords that signal-scan matches against to trigger this goal. */
  match_keywords: string[];
}

export interface GoalSpec {
  schema_version: number;
  goal_id: string;
  org: string;
  target_repo: string | null;
  cycle_unit: "pipeline_pass";

  /** First H1 line — the "what are we doing" one-liner (Codex /goal style). */
  title: string;
  /** Optional 1-3 lines beneath the H1 (Acceptance / Stop rule). */
  preamble: string;

  metrics: MetricSpec[];
  pipeline: PipelineStep[];
  time_budget: TimeBudget;
  cost_budget: CostBudget;
  termination_conditions: string[];
  signal_trigger: SignalTrigger;

  /**
   * Optional goal-specific narrowing of modifiable_paths. Final modifiable
   * paths = (AGENTS.md.modifiable_paths) ∩ (goal.md.modifiable_paths_override)
   * computed by `guards.ts`. Empty/undefined means "use AGENTS.md defaults".
   */
  modifiable_paths_override?: string[];

  /** Absolute path of the goal.md that was parsed (forensic). */
  source_path: string;
}

export class GoalParseError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "GoalParseError";
  }
}

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const AGENT_REF = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const VALID_DIRECTIONS: readonly MetricDirection[] = ["maximize", "minimize"];
const VALID_AUTO_MODES: readonly SignalAutoMode[] = ["false", "prompt", "true"];

interface ParsedSections {
  frontmatter: Record<string, unknown>;
  title: string;
  preamble: string;
  sections: Map<string, string>;
}

export function parseGoalFile(absPath: string): GoalSpec {
  const raw = fs.readFileSync(absPath, "utf-8");
  return parseGoal(raw, absPath);
}

export function parseGoal(raw: string, sourcePath: string): GoalSpec {
  const normalized = normalizeLine(raw);
  const { frontmatter, title, preamble, sections } = splitSections(normalized, sourcePath);

  const fm = validateFrontmatter(frontmatter, sourcePath);

  if (!title) {
    throw new GoalParseError("missing `# Goal: ...` H1 line", sourcePath);
  }

  const metricsBody = requireSection(sections, "Metrics", sourcePath);
  const metrics = parseMetrics(metricsBody, sourcePath);

  const pipelineBody = requireSection(sections, "Pipeline", sourcePath);
  const pipeline = parsePipeline(pipelineBody, sourcePath);

  const budgetBody = requireSection(sections, "Budget", sourcePath);
  const { time_budget, cost_budget } = parseBudget(budgetBody, sourcePath);

  const terminationBody = requireSection(sections, "Termination", sourcePath);
  const termination_conditions = parseTerminationConditions(terminationBody, sourcePath);

  const signalBody = sections.get("Signal Trigger");
  const signal_trigger = signalBody
    ? parseSignalTrigger(signalBody, sourcePath)
    : { auto: "false" as SignalAutoMode, match_keywords: [] };

  const modBody = sections.get("Modifiable Paths Override");
  const modifiable_paths_override = modBody
    ? parsePathList(modBody, sourcePath, "Modifiable Paths Override")
    : undefined;

  return {
    schema_version: fm.schema_version,
    goal_id: fm.goal_id,
    org: fm.org,
    target_repo: fm.target_repo,
    cycle_unit: fm.cycle_unit,
    title,
    preamble,
    metrics,
    pipeline,
    time_budget,
    cost_budget,
    termination_conditions,
    signal_trigger,
    modifiable_paths_override,
    source_path: sourcePath,
  };
}

// ---------- splitters ----------

function splitSections(raw: string, sourcePath: string): ParsedSections {
  // Frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    throw new GoalParseError("missing YAML frontmatter (--- … ---)", sourcePath);
  }
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = (yaml.load(fmMatch[1]) ?? {}) as Record<string, unknown>;
  } catch (e) {
    throw new GoalParseError(`invalid YAML frontmatter: ${(e as Error).message}`, sourcePath);
  }

  const body = raw.slice(fmMatch[0].length);

  // Title (first H1)
  const titleMatch = body.match(/^#\s+(?:Goal:\s*)?(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Preamble: lines after H1, before first H2
  let preamble = "";
  if (titleMatch) {
    const afterTitle = body.slice(titleMatch.index! + titleMatch[0].length);
    const nextH2 = afterTitle.match(/^##\s+/m);
    preamble = (nextH2 ? afterTitle.slice(0, nextH2.index!) : afterTitle).trim();
  }

  // ## Sections
  const sections = new Map<string, string>();
  const sectionRegex = /^##\s+(.+)$/gm;
  const matches: Array<{ name: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRegex.exec(body)) !== null) {
    matches.push({
      name: m[1].trim(),
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  for (let i = 0; i < matches.length; i++) {
    const next = matches[i + 1];
    const end = next ? next.start : body.length;
    const content = body.slice(matches[i].bodyStart, end).trim();
    sections.set(matches[i].name, content);
  }

  return { frontmatter, title, preamble, sections };
}

interface ValidatedFrontmatter {
  schema_version: number;
  goal_id: string;
  org: string;
  target_repo: string | null;
  cycle_unit: "pipeline_pass";
}

function validateFrontmatter(
  fm: Record<string, unknown>,
  sourcePath: string
): ValidatedFrontmatter {
  const schema_version = Number(fm.schema_version);
  if (!Number.isFinite(schema_version) || schema_version < 1) {
    throw new GoalParseError(
      `frontmatter.schema_version must be >= 1 (got ${JSON.stringify(fm.schema_version)})`,
      sourcePath
    );
  }
  if (schema_version > GOAL_SCHEMA_VERSION) {
    throw new GoalParseError(
      `frontmatter.schema_version=${schema_version} is newer than supported ${GOAL_SCHEMA_VERSION}. Upgrade SoloSquad.`,
      sourcePath
    );
  }

  const goal_id = String(fm.goal_id ?? "");
  if (!goal_id) {
    throw new GoalParseError("frontmatter.goal_id is required", sourcePath);
  }
  if (!KEBAB_CASE.test(goal_id)) {
    throw new GoalParseError(
      `frontmatter.goal_id="${goal_id}" must be kebab-case`,
      sourcePath
    );
  }

  const org = String(fm.org ?? "");
  if (!org) {
    throw new GoalParseError("frontmatter.org is required", sourcePath);
  }

  const target_repo =
    fm.target_repo === null || fm.target_repo === undefined || fm.target_repo === ""
      ? null
      : String(fm.target_repo);

  const cycle_unit = String(fm.cycle_unit ?? "pipeline_pass");
  if (cycle_unit !== "pipeline_pass") {
    throw new GoalParseError(
      `frontmatter.cycle_unit must be "pipeline_pass" (got "${cycle_unit}")`,
      sourcePath
    );
  }

  return { schema_version, goal_id, org, target_repo, cycle_unit };
}

// ---------- section helpers ----------

function requireSection(
  sections: Map<string, string>,
  name: string,
  sourcePath: string
): string {
  const body = sections.get(name);
  if (body === undefined) {
    throw new GoalParseError(`missing required \`## ${name}\` section`, sourcePath);
  }
  if (!body) {
    throw new GoalParseError(`\`## ${name}\` section is empty`, sourcePath);
  }
  return body;
}

// ---------- metrics ----------

function parseMetrics(body: string, sourcePath: string): MetricSpec[] {
  // Metrics are YAML under the section, but author-friendly bullets are also
  // accepted. We try YAML first; fall back to bullet parse.
  // Authoritative form (template):
  //   metrics:
  //     - name: "foo"
  //       formula: "..."
  //       source: "..."
  //       threshold: 0.7
  //       direction: maximize
  const yamlMatch = body.match(/^(metrics:[\s\S]*?)(?:\n##|\n$|$)/);
  let raw: unknown;
  try {
    raw = yaml.load(yamlMatch ? yamlMatch[1] : body);
  } catch (e) {
    throw new GoalParseError(
      `Metrics YAML parse failed: ${(e as Error).message}`,
      sourcePath
    );
  }
  let arr: unknown;
  if (raw && typeof raw === "object" && "metrics" in (raw as Record<string, unknown>)) {
    arr = (raw as { metrics: unknown }).metrics;
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new GoalParseError(
      "Metrics must be a non-empty YAML list under `metrics:`",
      sourcePath
    );
  }

  const out: MetricSpec[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") {
      throw new GoalParseError("metric entry is not an object", sourcePath);
    }
    const m = entry as Record<string, unknown>;
    const name = String(m.name ?? "");
    if (!name) throw new GoalParseError("metric.name is required", sourcePath);
    const formula = String(m.formula ?? "");
    if (!formula) throw new GoalParseError(`metric.${name}.formula is required`, sourcePath);
    const source = String(m.source ?? "");
    if (!source) throw new GoalParseError(`metric.${name}.source is required`, sourcePath);
    const threshold = Number(m.threshold);
    if (!Number.isFinite(threshold)) {
      throw new GoalParseError(
        `metric.${name}.threshold must be a finite number (got ${JSON.stringify(m.threshold)})`,
        sourcePath
      );
    }
    const direction = String(m.direction ?? "");
    if (!VALID_DIRECTIONS.includes(direction as MetricDirection)) {
      throw new GoalParseError(
        `metric.${name}.direction must be maximize|minimize (got "${direction}")`,
        sourcePath
      );
    }
    out.push({ name, formula, source, threshold, direction: direction as MetricDirection });
  }
  return out;
}

// ---------- pipeline ----------

function parsePipeline(body: string, sourcePath: string): PipelineStep[] {
  // Accept ordered list (1. agent: task) OR YAML pipeline: [...]
  const yamlMatch = body.match(/^(pipeline:[\s\S]*?)(?:\n##|\n$|$)/);
  if (yamlMatch) {
    let raw: unknown;
    try {
      raw = yaml.load(yamlMatch[1]);
    } catch (e) {
      throw new GoalParseError(
        `Pipeline YAML parse failed: ${(e as Error).message}`,
        sourcePath
      );
    }
    const arr = (raw as { pipeline?: unknown }).pipeline;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new GoalParseError(
        "Pipeline must be a non-empty list under `pipeline:`",
        sourcePath
      );
    }
    return arr.map((e, i) => validatePipelineStep(e, i, sourcePath));
  }

  // Bullet form: "1. agent: task description"
  const out: PipelineStep[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^\d+\.\s*([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)\s*:\s*(.+)$/);
    if (m) {
      const agent = m[1];
      const task = m[2].trim();
      if (!AGENT_REF.test(agent)) {
        throw new GoalParseError(`pipeline step agent "${agent}" must be team/agent`, sourcePath);
      }
      out.push({ agent, task });
    }
  }
  if (out.length === 0) {
    throw new GoalParseError(
      "Pipeline must have at least 1 step (bullet form `N. team/agent: task` or YAML)",
      sourcePath
    );
  }
  return out;
}

function validatePipelineStep(entry: unknown, idx: number, sourcePath: string): PipelineStep {
  if (!entry || typeof entry !== "object") {
    throw new GoalParseError(`pipeline[${idx}] is not an object`, sourcePath);
  }
  const m = entry as Record<string, unknown>;
  const agent = String(m.agent ?? "");
  if (!AGENT_REF.test(agent)) {
    throw new GoalParseError(
      `pipeline[${idx}].agent="${agent}" must match team/agent`,
      sourcePath
    );
  }
  const task = String(m.task ?? "");
  if (!task) throw new GoalParseError(`pipeline[${idx}].task is required`, sourcePath);
  return { agent, task };
}

// ---------- budget ----------

function parseBudget(
  body: string,
  sourcePath: string
): { time_budget: TimeBudget; cost_budget: CostBudget } {
  let raw: unknown;
  try {
    raw = yaml.load(body);
  } catch (e) {
    throw new GoalParseError(`Budget YAML parse failed: ${(e as Error).message}`, sourcePath);
  }
  if (!raw || typeof raw !== "object") {
    throw new GoalParseError("Budget section must be a YAML mapping", sourcePath);
  }
  const r = raw as Record<string, unknown>;

  const time = (r.time ?? r.time_budget) as Record<string, unknown> | undefined;
  let time_budget: TimeBudget;
  if (!time || typeof time !== "object") {
    throw new GoalParseError("Budget.time must be a mapping with `hours` or `cycles`", sourcePath);
  } else {
    const hours = time.hours != null ? Number(time.hours) : undefined;
    const cycles = time.cycles != null ? Number(time.cycles) : undefined;
    if (hours == null && cycles == null) {
      throw new GoalParseError("Budget.time must set `hours` or `cycles`", sourcePath);
    }
    if (hours != null && (!Number.isFinite(hours) || hours <= 0)) {
      throw new GoalParseError("Budget.time.hours must be > 0", sourcePath);
    }
    if (cycles != null && (!Number.isInteger(cycles) || cycles <= 0)) {
      throw new GoalParseError("Budget.time.cycles must be a positive integer", sourcePath);
    }
    time_budget = { hours, cycles };
  }

  const cost = (r.cost ?? r.cost_budget) as Record<string, unknown> | undefined;
  if (!cost || typeof cost !== "object") {
    throw new GoalParseError(
      "Budget.cost must be a mapping with `per_cycle_usd` and `total_usd`",
      sourcePath
    );
  }
  const per_cycle_usd = Number(cost.per_cycle_usd);
  const total_usd = Number(cost.total_usd);
  if (!Number.isFinite(per_cycle_usd) || per_cycle_usd <= 0) {
    throw new GoalParseError("Budget.cost.per_cycle_usd must be > 0", sourcePath);
  }
  if (!Number.isFinite(total_usd) || total_usd <= 0) {
    throw new GoalParseError("Budget.cost.total_usd must be > 0", sourcePath);
  }
  if (total_usd < per_cycle_usd) {
    throw new GoalParseError(
      "Budget.cost.total_usd must be >= per_cycle_usd",
      sourcePath
    );
  }

  return { time_budget, cost_budget: { per_cycle_usd, total_usd } };
}

// ---------- termination ----------

function parseTerminationConditions(body: string, sourcePath: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^[-*]\s+(.+)$/);
    if (m) out.push(m[1].trim());
  }
  if (out.length === 0) {
    throw new GoalParseError("Termination must list at least 1 bullet condition", sourcePath);
  }
  return out;
}

// ---------- signal trigger ----------

function parseSignalTrigger(body: string, sourcePath: string): SignalTrigger {
  let raw: unknown;
  try {
    raw = yaml.load(body);
  } catch (e) {
    throw new GoalParseError(
      `Signal Trigger YAML parse failed: ${(e as Error).message}`,
      sourcePath
    );
  }
  if (!raw || typeof raw !== "object") {
    return { auto: "false", match_keywords: [] };
  }
  const r = raw as Record<string, unknown>;
  const autoVal = r.auto;
  const auto = autoVal === true || autoVal === false ? String(autoVal) : String(autoVal ?? "false");
  if (!VALID_AUTO_MODES.includes(auto as SignalAutoMode)) {
    throw new GoalParseError(
      `Signal Trigger.auto must be one of ${VALID_AUTO_MODES.join("|")} (got "${auto}")`,
      sourcePath
    );
  }
  const kws = r.match_keywords;
  const match_keywords =
    Array.isArray(kws) ? kws.map((x) => String(x).trim()).filter(Boolean) : [];
  return { auto: auto as SignalAutoMode, match_keywords };
}

// ---------- path list (modifiable_paths_override) ----------

function parsePathList(body: string, sourcePath: string, label: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^[-*]\s+(.+)$/);
    if (m) out.push(m[1].trim());
  }
  if (out.length === 0) {
    throw new GoalParseError(
      `\`## ${label}\` section present but empty — remove the section if not overriding`,
      sourcePath
    );
  }
  return out;
}
