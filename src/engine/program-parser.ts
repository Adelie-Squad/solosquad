import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";

export const PROGRAM_SCHEMA_VERSION = 1;

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
  agent: string; // "<team>/<agent>"
  task: string;
}

export interface ApiBudget {
  per_cycle_usd: number;
  total_usd: number;
  cap_warning_at: number;
}

export interface GuardrailsInput {
  modifiable_paths: string[];
  immutable_paths: string[]; // hardcoded defaults + user extras, deduped
  api_budget: ApiBudget;
  domain_whitelist: string[];
}

export interface GuardrailsRuntime {
  cycle_minutes: number;
  stage_timeout_seconds: number;
  consecutive_discard_limit: number;
}

export interface GuardrailsOutput {
  validate_results_tsv: boolean;
  forbidden_side_effects: string[];
}

export interface TimeBudget {
  hours?: number;
  cycles?: number;
}

export interface SignalTrigger {
  auto: SignalAutoMode;
  match_keywords: string[];
}

export interface ProgramSpec {
  schema_version: number;
  prog_id: string;
  org: string;
  target_repo: string | null;
  cycle_unit: "pipeline_pass";
  program_name: string;
  goal: string;
  metrics: MetricSpec[];
  pipeline: PipelineStep[];
  guards: {
    input: GuardrailsInput;
    runtime: GuardrailsRuntime;
    output: GuardrailsOutput;
  };
  time_budget: TimeBudget;
  termination_conditions: string[];
  signal_trigger: SignalTrigger;
  source_path: string; // absolute path of the program.md that was parsed
}

export class ProgramParseError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = "ProgramParseError";
  }
}

/**
 * Immutable paths injected on every program regardless of what the file declares.
 * Karpathy autoresearch isolation: only humans edit the engine, evaluator, and program.md.
 * `source_path` is also appended at parse time (see assembleImmutablePaths).
 */
export const IMMUTABLE_PATH_DEFAULTS: readonly string[] = [
  "src/engine/**",
  "assets/templates/results.tsv",
  "assets/templates/program.md",
];

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const AGENT_REF = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const VALID_DIRECTIONS: readonly MetricDirection[] = ["maximize", "minimize"];
const VALID_AUTO_MODES: readonly SignalAutoMode[] = ["false", "prompt", "true"];

interface ParsedSections {
  frontmatter: Record<string, unknown>;
  title: string;
  sections: Map<string, string>;
}

export function parseProgramFile(absPath: string): ProgramSpec {
  const raw = fs.readFileSync(absPath, "utf-8");
  return parseProgram(raw, absPath);
}

export function parseProgram(raw: string, sourcePath: string): ProgramSpec {
  const normalized = normalizeLine(raw);
  const { frontmatter, title, sections } = splitSections(normalized, sourcePath);

  const fm = validateFrontmatter(frontmatter, sourcePath);

  const goal = requireSection(sections, "Goal", sourcePath).trim();
  if (!goal) {
    throw new ProgramParseError("`## Goal` section is empty", sourcePath);
  }

  const metricsBody = requireSection(sections, "Metrics", sourcePath);
  const metrics = parseMetrics(metricsBody, sourcePath);

  const pipelineBody = requireSection(sections, "Pipeline", sourcePath);
  const pipeline = parsePipeline(pipelineBody, sourcePath);

  const guardrailsBody = requireSection(sections, "Guardrails", sourcePath);
  const guards = parseGuardrails(guardrailsBody, fm.prog_id, sourcePath);

  const timeBudgetBody = requireSection(sections, "Time Budget", sourcePath);
  const time_budget = parseTimeBudget(timeBudgetBody, sourcePath);

  const terminationBody = requireSection(
    sections,
    "Termination Conditions",
    sourcePath
  );
  const termination_conditions = parseTerminationConditions(
    terminationBody,
    sourcePath
  );

  const signalBody = requireSection(sections, "Signal Trigger", sourcePath);
  const signal_trigger = parseSignalTrigger(signalBody, sourcePath);

  guards.input.immutable_paths = assembleImmutablePaths(
    guards.input.immutable_paths,
    fm.org,
    fm.prog_id,
    sourcePath
  );

  return {
    schema_version: fm.schema_version,
    prog_id: fm.prog_id,
    org: fm.org,
    target_repo: fm.target_repo,
    cycle_unit: fm.cycle_unit,
    program_name: title,
    goal,
    metrics,
    pipeline,
    guards,
    time_budget,
    termination_conditions,
    signal_trigger,
    source_path: sourcePath,
  };
}

interface Frontmatter {
  schema_version: number;
  prog_id: string;
  org: string;
  target_repo: string | null;
  cycle_unit: "pipeline_pass";
}

function splitSections(content: string, sourcePath: string): ParsedSections {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new ProgramParseError(
      "Missing YAML frontmatter delimited by `---` lines",
      sourcePath
    );
  }
  const frontmatter = loadYamlObject(fmMatch[1], "frontmatter", sourcePath);
  const body = fmMatch[2];

  const titleMatch = body.match(/^\s*#\s+Program:\s*(.+?)\s*$/m);
  if (!titleMatch) {
    throw new ProgramParseError(
      "Missing `# Program: <name>` heading after frontmatter",
      sourcePath
    );
  }
  const title = titleMatch[1].trim();

  const sections = new Map<string, string>();
  const lines = body.split("\n");
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (currentHeading) sections.set(currentHeading, buffer.join("\n"));
      currentHeading = headingMatch[1].trim();
      buffer = [];
    } else if (currentHeading) {
      buffer.push(line);
    }
  }
  if (currentHeading) sections.set(currentHeading, buffer.join("\n"));

  return { frontmatter, title, sections };
}

function validateFrontmatter(
  fm: Record<string, unknown>,
  sourcePath: string
): Frontmatter {
  const schema_version = fm.schema_version;
  if (typeof schema_version !== "number") {
    throw new ProgramParseError(
      "frontmatter.schema_version must be a number",
      sourcePath
    );
  }
  if (schema_version !== PROGRAM_SCHEMA_VERSION) {
    throw new ProgramParseError(
      `frontmatter.schema_version=${schema_version} unsupported (engine expects ${PROGRAM_SCHEMA_VERSION})`,
      sourcePath
    );
  }

  const prog_id = expectString(fm, "prog_id", sourcePath);
  if (!KEBAB_CASE.test(prog_id)) {
    throw new ProgramParseError(
      `frontmatter.prog_id="${prog_id}" must be kebab-case`,
      sourcePath
    );
  }

  const org = expectString(fm, "org", sourcePath);
  if (!KEBAB_CASE.test(org)) {
    throw new ProgramParseError(
      `frontmatter.org="${org}" must be kebab-case`,
      sourcePath
    );
  }

  const target_repo_raw = fm.target_repo;
  let target_repo: string | null;
  if (
    target_repo_raw === null ||
    target_repo_raw === undefined ||
    target_repo_raw === ""
  ) {
    target_repo = null;
  } else if (typeof target_repo_raw === "string") {
    if (!KEBAB_CASE.test(target_repo_raw)) {
      throw new ProgramParseError(
        `frontmatter.target_repo="${target_repo_raw}" must be kebab-case or null`,
        sourcePath
      );
    }
    target_repo = target_repo_raw;
  } else {
    throw new ProgramParseError(
      "frontmatter.target_repo must be a kebab-case string or null",
      sourcePath
    );
  }

  const cycle_unit = expectString(fm, "cycle_unit", sourcePath);
  if (cycle_unit !== "pipeline_pass") {
    throw new ProgramParseError(
      `frontmatter.cycle_unit="${cycle_unit}" not supported in v0.4 (expected "pipeline_pass")`,
      sourcePath
    );
  }

  return {
    schema_version,
    prog_id,
    org,
    target_repo,
    cycle_unit: "pipeline_pass",
  };
}

function parseMetrics(body: string, sourcePath: string): MetricSpec[] {
  const obj = loadYamlObject(body, "## Metrics", sourcePath);
  const list = obj.metrics;
  if (!Array.isArray(list) || list.length === 0) {
    throw new ProgramParseError(
      "## Metrics must define a non-empty `metrics:` list",
      sourcePath
    );
  }
  return list.map((entry, i) => validateMetric(entry, i, sourcePath));
}

function validateMetric(
  entry: unknown,
  index: number,
  sourcePath: string
): MetricSpec {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new ProgramParseError(
      `metrics[${index}] must be a mapping`,
      sourcePath
    );
  }
  const m = entry as Record<string, unknown>;
  const name = expectString(m, `metrics[${index}].name`, sourcePath);
  const formula = expectString(m, `metrics[${index}].formula`, sourcePath);
  const source = expectString(m, `metrics[${index}].source`, sourcePath);
  const threshold = m.threshold;
  if (typeof threshold !== "number" || Number.isNaN(threshold)) {
    throw new ProgramParseError(
      `metrics[${index}].threshold must be a number`,
      sourcePath
    );
  }
  const direction = m.direction;
  if (
    typeof direction !== "string" ||
    !VALID_DIRECTIONS.includes(direction as MetricDirection)
  ) {
    throw new ProgramParseError(
      `metrics[${index}].direction must be one of ${VALID_DIRECTIONS.join("|")}`,
      sourcePath
    );
  }
  return {
    name,
    formula,
    source,
    threshold,
    direction: direction as MetricDirection,
  };
}

function parsePipeline(body: string, sourcePath: string): PipelineStep[] {
  const obj = loadYamlObject(body, "## Pipeline", sourcePath);
  const list = obj.pipeline;
  if (!Array.isArray(list) || list.length === 0) {
    throw new ProgramParseError(
      "## Pipeline must define a non-empty `pipeline:` list",
      sourcePath
    );
  }
  return list.map((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ProgramParseError(
        `pipeline[${i}] must be a mapping with agent + task`,
        sourcePath
      );
    }
    const e = entry as Record<string, unknown>;
    const agent = expectString(e, `pipeline[${i}].agent`, sourcePath);
    if (!AGENT_REF.test(agent)) {
      throw new ProgramParseError(
        `pipeline[${i}].agent="${agent}" must be "<team>/<agent>" kebab-case`,
        sourcePath
      );
    }
    const task = expectString(e, `pipeline[${i}].task`, sourcePath);
    return { agent, task };
  });
}

function parseGuardrails(
  body: string,
  _progId: string,
  sourcePath: string
): { input: GuardrailsInput; runtime: GuardrailsRuntime; output: GuardrailsOutput } {
  const subsections = splitSubsections(body);

  const inputBody = requireSubsection(subsections, "Input", sourcePath);
  const runtimeBody = requireSubsection(subsections, "Runtime", sourcePath);
  const outputBody = requireSubsection(subsections, "Output", sourcePath);

  const inputObj = loadYamlObject(inputBody, "### Input", sourcePath).input;
  if (typeof inputObj !== "object" || inputObj === null) {
    throw new ProgramParseError(
      "### Input must define an `input:` mapping",
      sourcePath
    );
  }
  const input = validateInput(inputObj as Record<string, unknown>, sourcePath);

  const runtimeObj = loadYamlObject(runtimeBody, "### Runtime", sourcePath)
    .runtime;
  if (typeof runtimeObj !== "object" || runtimeObj === null) {
    throw new ProgramParseError(
      "### Runtime must define a `runtime:` mapping",
      sourcePath
    );
  }
  const runtime = validateRuntime(
    runtimeObj as Record<string, unknown>,
    sourcePath
  );

  const outputObj = loadYamlObject(outputBody, "### Output", sourcePath).output;
  if (typeof outputObj !== "object" || outputObj === null) {
    throw new ProgramParseError(
      "### Output must define an `output:` mapping",
      sourcePath
    );
  }
  const output = validateOutput(
    outputObj as Record<string, unknown>,
    sourcePath
  );

  return { input, runtime, output };
}

function validateInput(
  o: Record<string, unknown>,
  sourcePath: string
): GuardrailsInput {
  const modifiable_paths = expectStringArray(
    o,
    "input.modifiable_paths",
    sourcePath,
    { allowEmpty: false }
  );
  const immutable_paths_extra = optionalStringArray(
    o,
    "input.immutable_paths_extra",
    sourcePath
  );
  const apiBudget = o.api_budget;
  if (typeof apiBudget !== "object" || apiBudget === null) {
    throw new ProgramParseError(
      "input.api_budget must be a mapping",
      sourcePath
    );
  }
  const b = apiBudget as Record<string, unknown>;
  const per_cycle_usd = expectNumber(
    b,
    "input.api_budget.per_cycle_usd",
    sourcePath
  );
  const total_usd = expectNumber(b, "input.api_budget.total_usd", sourcePath);
  const cap_warning_at = expectNumber(
    b,
    "input.api_budget.cap_warning_at",
    sourcePath
  );
  if (cap_warning_at <= 0 || cap_warning_at >= 1) {
    throw new ProgramParseError(
      "input.api_budget.cap_warning_at must be between 0 and 1 exclusive",
      sourcePath
    );
  }
  if (per_cycle_usd <= 0 || total_usd <= 0) {
    throw new ProgramParseError(
      "input.api_budget per_cycle_usd and total_usd must be positive",
      sourcePath
    );
  }
  const domain_whitelist = optionalStringArray(
    o,
    "input.domain_whitelist",
    sourcePath
  );
  return {
    modifiable_paths,
    immutable_paths: immutable_paths_extra,
    api_budget: { per_cycle_usd, total_usd, cap_warning_at },
    domain_whitelist,
  };
}

function validateRuntime(
  o: Record<string, unknown>,
  sourcePath: string
): GuardrailsRuntime {
  const cycle_minutes = expectNumber(o, "runtime.cycle_minutes", sourcePath);
  const stage_timeout_seconds = expectNumber(
    o,
    "runtime.stage_timeout_seconds",
    sourcePath
  );
  const consecutive_discard_limit = expectNumber(
    o,
    "runtime.consecutive_discard_limit",
    sourcePath
  );
  if (
    cycle_minutes <= 0 ||
    stage_timeout_seconds <= 0 ||
    consecutive_discard_limit <= 0
  ) {
    throw new ProgramParseError(
      "runtime values must be positive",
      sourcePath
    );
  }
  return { cycle_minutes, stage_timeout_seconds, consecutive_discard_limit };
}

function validateOutput(
  o: Record<string, unknown>,
  sourcePath: string
): GuardrailsOutput {
  const validate_results_tsv = o.validate_results_tsv;
  if (typeof validate_results_tsv !== "boolean") {
    throw new ProgramParseError(
      "output.validate_results_tsv must be boolean",
      sourcePath
    );
  }
  const forbidden_side_effects = optionalStringArray(
    o,
    "output.forbidden_side_effects",
    sourcePath
  );
  return { validate_results_tsv, forbidden_side_effects };
}

function parseTimeBudget(body: string, sourcePath: string): TimeBudget {
  const obj = loadYamlObject(body, "## Time Budget", sourcePath).time_budget;
  if (typeof obj !== "object" || obj === null) {
    throw new ProgramParseError(
      "## Time Budget must define a `time_budget:` mapping",
      sourcePath
    );
  }
  const o = obj as Record<string, unknown>;
  const hoursRaw = o.hours;
  const cyclesRaw = o.cycles;

  const hasHours = hoursRaw !== undefined && hoursRaw !== null;
  const hasCycles = cyclesRaw !== undefined && cyclesRaw !== null;

  if (hasHours === hasCycles) {
    throw new ProgramParseError(
      "time_budget must specify exactly one of `hours` or `cycles`",
      sourcePath
    );
  }
  if (hasHours) {
    if (typeof hoursRaw !== "number" || hoursRaw <= 0) {
      throw new ProgramParseError(
        "time_budget.hours must be a positive number",
        sourcePath
      );
    }
    return { hours: hoursRaw };
  }
  if (typeof cyclesRaw !== "number" || cyclesRaw <= 0 || !Number.isInteger(cyclesRaw)) {
    throw new ProgramParseError(
      "time_budget.cycles must be a positive integer",
      sourcePath
    );
  }
  return { cycles: cyclesRaw };
}

function parseTerminationConditions(
  body: string,
  sourcePath: string
): string[] {
  const obj = loadYamlObject(body, "## Termination Conditions", sourcePath)
    .termination;
  if (!Array.isArray(obj) || obj.length === 0) {
    throw new ProgramParseError(
      "## Termination Conditions must define a non-empty `termination:` list",
      sourcePath
    );
  }
  return obj.map((c, i) => {
    if (typeof c !== "string" || c.trim().length === 0) {
      throw new ProgramParseError(
        `termination[${i}] must be a non-empty string`,
        sourcePath
      );
    }
    return c.trim();
  });
}

function parseSignalTrigger(body: string, sourcePath: string): SignalTrigger {
  const obj = loadYamlObject(body, "## Signal Trigger", sourcePath)
    .signal_trigger;
  if (typeof obj !== "object" || obj === null) {
    throw new ProgramParseError(
      "## Signal Trigger must define a `signal_trigger:` mapping",
      sourcePath
    );
  }
  const o = obj as Record<string, unknown>;
  const autoRaw = o.auto;
  const auto =
    typeof autoRaw === "boolean"
      ? autoRaw
        ? "true"
        : "false"
      : typeof autoRaw === "string"
        ? autoRaw
        : undefined;
  if (auto === undefined || !VALID_AUTO_MODES.includes(auto as SignalAutoMode)) {
    throw new ProgramParseError(
      `signal_trigger.auto must be one of ${VALID_AUTO_MODES.join("|")}`,
      sourcePath
    );
  }
  const match_keywords = optionalStringArray(
    o,
    "signal_trigger.match_keywords",
    sourcePath
  );
  return { auto: auto as SignalAutoMode, match_keywords };
}

function assembleImmutablePaths(
  userExtras: string[],
  org: string,
  progId: string,
  sourcePath: string
): string[] {
  const programRelative = path
    .relative(process.cwd(), sourcePath)
    .replace(/\\/g, "/");
  const defaults = [
    ...IMMUTABLE_PATH_DEFAULTS,
    programRelative,
    `${org}/programs/${progId}/results.tsv`,
    `${org}/programs/${progId}/program.md`,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of [...defaults, ...userExtras]) {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  }
  return result;
}

function splitSubsections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = body.split("\n");
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (m) {
      if (current) out.set(current, buf.join("\n"));
      current = m[1].trim();
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) out.set(current, buf.join("\n"));
  return out;
}

function requireSection(
  sections: Map<string, string>,
  name: string,
  sourcePath: string
): string {
  const body = sections.get(name);
  if (body === undefined) {
    throw new ProgramParseError(`Missing required section "## ${name}"`, sourcePath);
  }
  return body;
}

function requireSubsection(
  subsections: Map<string, string>,
  name: string,
  sourcePath: string
): string {
  const body = subsections.get(name);
  if (body === undefined) {
    throw new ProgramParseError(
      `Missing required subsection "### ${name}" under ## Guardrails`,
      sourcePath
    );
  }
  return body;
}

function loadYamlObject(
  body: string,
  where: string,
  sourcePath: string
): Record<string, unknown> {
  const stripped = stripHtmlComments(body);
  let loaded: unknown;
  try {
    loaded = yaml.load(stripped);
  } catch (err) {
    throw new ProgramParseError(
      `YAML parse error in ${where}: ${(err as Error).message}`,
      sourcePath
    );
  }
  if (loaded === null || loaded === undefined) {
    return {};
  }
  if (typeof loaded !== "object" || Array.isArray(loaded)) {
    throw new ProgramParseError(
      `${where} body must parse to a YAML mapping`,
      sourcePath
    );
  }
  return loaded as Record<string, unknown>;
}

function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "");
}

function expectString(
  o: Record<string, unknown>,
  key: string,
  sourcePath: string
): string {
  const leaf = key.split(".").pop() ?? key;
  const v = o[leaf];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new ProgramParseError(
      `${key} must be a non-empty string`,
      sourcePath
    );
  }
  return v.trim();
}

function expectNumber(
  o: Record<string, unknown>,
  key: string,
  sourcePath: string
): number {
  const leaf = key.split(".").pop() ?? key;
  const v = o[leaf];
  if (typeof v !== "number" || Number.isNaN(v)) {
    throw new ProgramParseError(`${key} must be a number`, sourcePath);
  }
  return v;
}

function expectStringArray(
  o: Record<string, unknown>,
  key: string,
  sourcePath: string,
  opts: { allowEmpty: boolean }
): string[] {
  const leaf = key.split(".").pop() ?? key;
  const v = o[leaf];
  if (!Array.isArray(v)) {
    throw new ProgramParseError(`${key} must be a list of strings`, sourcePath);
  }
  if (!opts.allowEmpty && v.length === 0) {
    throw new ProgramParseError(`${key} must not be empty`, sourcePath);
  }
  return v.map((s, i) => {
    if (typeof s !== "string" || s.trim().length === 0) {
      throw new ProgramParseError(
        `${key}[${i}] must be a non-empty string`,
        sourcePath
      );
    }
    return s.trim();
  });
}

function optionalStringArray(
  o: Record<string, unknown>,
  key: string,
  sourcePath: string
): string[] {
  const leaf = key.split(".").pop() ?? key;
  const v = o[leaf];
  if (v === undefined || v === null) return [];
  return expectStringArray(o, key, sourcePath, { allowEmpty: true });
}
