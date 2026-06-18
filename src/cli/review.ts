import fs from "fs";
import path from "path";
import chalk from "chalk";
import yaml from "js-yaml";
import {
  type ReviewKind,
  type ReviewInput,
  type ReviewCaller,
  type ReviewResult,
  createClaudeReviewCaller,
} from "../bot/review.js";
import { getBundledAgentsDir, getSchedulesDir, getBundledSkillsDir } from "../util/paths.js";
import { loadAgentSpecs } from "../bot/agent-spec.js";
import { validateWorkflow } from "../bot/workflow-validate.js";

/**
 * v1.3.2 §P1 — `solosquad <manager> review <id>`. Loads the definition + its
 * static-validation findings, then runs the LLM review pass (review.ts). The
 * caller is injectable so tests stay offline; the default is the Claude-backed
 * caller, gated on the human running the command (review is never automatic).
 */

export interface ReviewCliOpts {
  /** Override the LLM caller (tests). */
  caller?: ReviewCaller;
  /** Resolve against the workspace instead of the bundle (agent/skill). */
  workspace?: boolean;
}

/** Locate + read the definition body for a manager asset. Returns null if not found. */
function loadDefinition(
  kind: ReviewKind,
  idOrPath: string,
  opts: ReviewCliOpts,
): { id: string; body: string; findings: string[] } | null {
  if (kind === "agent") {
    const specs = loadAgentSpecs(opts.workspace ? undefined : getBundledAgentsDir());
    const spec = specs.find((s) => s.id === idOrPath || s.name === idOrPath);
    if (!spec) return null;
    return { id: spec.id, body: fs.readFileSync(spec.skillPath, "utf-8"), findings: [] };
  }
  if (kind === "schedule") {
    const dir = getSchedulesDir();
    const yamlPath = path.join(dir, `${idOrPath}.yaml`);
    if (!fs.existsSync(yamlPath)) return null;
    const promptPath = path.join(dir, `${idOrPath}.md`);
    const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf-8") : "(no prompt file)";
    return {
      id: idOrPath,
      body: `# ${idOrPath}.yaml\n${fs.readFileSync(yamlPath, "utf-8")}\n# ${idOrPath}.md\n${prompt}`,
      findings: [],
    };
  }
  // skill / workflow / goal — accept a path, or resolve a bundled id.
  let file = path.resolve(idOrPath);
  if (!fs.existsSync(file)) {
    if (kind === "workflow") file = path.join(getBundledSkillsDir(), "workflow-maker", "assets", "workflows", idOrPath, "workflow.yaml");
    else if (kind === "skill") file = path.join(getBundledSkillsDir(), idOrPath, "SKILL.md");
  }
  if (!fs.existsSync(file)) return null;
  return { id: idOrPath, body: fs.readFileSync(file, "utf-8"), findings: collectFindings(kind, file) };
}

/** Best-effort static findings to feed as review context (never throws). */
function collectFindings(kind: ReviewKind, file: string): string[] {
  try {
    if (kind === "workflow") {
      const doc = yaml.load(fs.readFileSync(file, "utf-8"));
      const r = validateWorkflow(doc, {});
      return [...r.errors, ...r.warnings].map((f) => `${f.code}: ${f.message}`);
    }
  } catch {
    /* findings are optional context */
  }
  return [];
}

const SEV_COLOR = {
  blocker: chalk.red,
  improvement: chalk.yellow,
  nit: chalk.dim,
} as const;

export async function reviewCommand(kind: ReviewKind, idOrPath: string | undefined, opts: ReviewCliOpts = {}): Promise<void> {
  if (!idOrPath) {
    console.error(chalk.red(`error: provide a ${kind} id or path — \`solosquad ${kind} review <id>\``));
    process.exitCode = 2;
    return;
  }
  const def = loadDefinition(kind, idOrPath, opts);
  if (!def) {
    console.error(chalk.red(`✗ could not locate ${kind} "${idOrPath}"`));
    process.exitCode = 1;
    return;
  }

  const input: ReviewInput = { kind, id: def.id, body: def.body, findings: def.findings };
  const caller = opts.caller ?? createClaudeReviewCaller(process.cwd());

  console.log(chalk.dim(`Reviewing ${kind}/${def.id} with the LLM…`));
  let result: ReviewResult | null;
  try {
    result = await caller.review(input);
  } catch (e) {
    console.error(chalk.red(`✗ review failed: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }
  if (!result) {
    console.error(chalk.red("✗ the reviewer returned no usable result"));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.bold(`\nReview — ${kind}/${def.id}`));
  if (result.summary) console.log(chalk.dim(result.summary));
  if (result.suggestions.length === 0) {
    console.log(chalk.green("✓ no suggestions — looks good"));
  } else {
    for (const s of result.suggestions) {
      console.log(`  ${SEV_COLOR[s.severity](`[${s.severity}]`)} ${s.message}`);
    }
  }
  process.exitCode = 0;
}
