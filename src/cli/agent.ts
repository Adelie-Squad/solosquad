import fs from "fs";
import path from "path";
import chalk from "chalk";
import {
  parseSkillMd,
  validateSkill,
  SkillParseError,
  type SkillValidationError,
} from "../bot/skill-parser.js";
import { listSourceAgents } from "../bot/agents-builder.js";
import { loadAgentSpecs } from "../bot/agent-spec.js";
import { validateAgents, type AgentFinding } from "../bot/agent-validate.js";
import { getAgentsDir, getWorkspaceRoot, getOrgDir } from "../util/paths.js";

/**
 * v0.5 — `solosquad agent` CLI group.
 *
 * Per docs/plan/v0.5-workflow-maker.md §8 + §10. The `validate` subcommand is
 * the one that ships in S1; `add`/`list`/`info` are added in S3 alongside
 * the author loop.
 *
 * Why `--all` matters: the 0.4.0→0.5.0 migration prepends frontmatter to 25
 * bundled SKILL.md files. Pass 1 is automatic, Pass 2 (this command + CI
 * gate per §13) catches anything that needed human-authored polish.
 */

interface ValidateOpts {
  all?: boolean;
  /** Also run cross-agent graph validation (refs, cycles, orphans). */
  graph?: boolean;
}

export async function agentValidateCommand(
  filePath: string | undefined,
  opts: ValidateOpts
): Promise<void> {
  if (!filePath && !opts.all && !opts.graph) {
    console.error(chalk.red("error: provide a path, or use --all / --graph"));
    process.exitCode = 2;
    return;
  }

  let totalChecked = 0;
  let totalFailed = 0;

  if (filePath) {
    const result = validateOne(filePath);
    totalChecked++;
    if (!result) totalFailed++;
  }

  if (opts.all) {
    const sources = listSourceAgents(getAgentsDir());
    if (sources.length === 0) {
      console.log(chalk.yellow("△ no SKILL.md files discovered under agents dir"));
    }
    for (const { skillPath } of sources) {
      const result = validateOne(skillPath);
      totalChecked++;
      if (!result) totalFailed++;
    }
  }

  // Cross-agent graph validation — refs/cycles/orphans the per-file
  // validateSkill pass cannot see (it only sees one SKILL.md at a time).
  if (opts.all || opts.graph) {
    totalChecked++;
    if (validateAgentGraph()) totalFailed++;
  }

  if ((opts as { corpus?: unknown }).corpus !== undefined) {
    // v0.8.4 — `--corpus` was a dev-only regression test. Moved to
    // `npm run test:corpus` so the user-visible surface stays clean.
    process.stderr.write(
      "[removed] --corpus was removed in v0.8.4. Run `npm run test:corpus` from the solosquad repo to run the Anthropic skills corpus round-trip regression.\n",
    );
  }

  console.log();
  if (totalFailed === 0) {
    console.log(chalk.green(`✓ ${totalChecked} validated, 0 failed`));
    process.exitCode = 0;
  } else {
    console.log(chalk.red(`✗ ${totalFailed} failed (of ${totalChecked})`));
    process.exitCode = 1;
  }
}

function validateOne(filePath: string): boolean {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.log(chalk.red(`✗ ${filePath} — file not found`));
    return false;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf-8");
  } catch (e) {
    console.log(chalk.red(`✗ ${filePath} — read error: ${(e as Error).message}`));
    return false;
  }

  try {
    const spec = parseSkillMd(raw, filePath);
    const result = validateSkill(spec);
    if (result.ok && result.warnings.length === 0) {
      console.log(chalk.green(`✓ ${filePath}`));
      return true;
    }
    if (result.ok) {
      console.log(
        chalk.yellow(
          `△ ${filePath} — ${result.warnings.length} warning(s)`
        )
      );
      for (const w of result.warnings) printIssue(w, "warn");
      return true;
    }
    console.log(chalk.red(`✗ ${filePath} — ${result.errors.length} error(s)`));
    for (const e of result.errors) printIssue(e, "error");
    for (const w of result.warnings) printIssue(w, "warn");
    return false;
  } catch (e) {
    if (e instanceof SkillParseError) {
      console.log(chalk.red(`✗ ${filePath} — parse error: ${e.message}`));
    } else {
      console.log(chalk.red(`✗ ${filePath} — ${(e as Error).message}`));
    }
    return false;
  }
}

function printIssue(issue: SkillValidationError, kind: "error" | "warn"): void {
  const tag = kind === "error" ? chalk.red("[error]") : chalk.yellow("[warn ]");
  const field = issue.field ? chalk.dim(` (${issue.field})`) : "";
  console.log(`    ${tag} ${issue.code}${field}: ${issue.message}`);
}

/**
 * Cross-actor graph validation (§5 agent-manager): referential integrity of
 * collaborators/used_by, peer-mesh cycles, orphans, name/dir/tier. Returns
 * true on failure (≥1 error). Scope = the bundled actor set.
 */
function validateAgentGraph(): boolean {
  const specs = loadAgentSpecs();
  const result = validateAgents(specs);
  const label = `agent graph (${specs.length} actors)`;
  if (result.ok && result.warnings.length === 0) {
    console.log(chalk.green(`✓ ${label}`));
    return false;
  }
  if (result.ok) {
    console.log(chalk.yellow(`△ ${label} — ${result.warnings.length} warning(s)`));
    for (const w of result.warnings) printGraphIssue(w, "warn");
    return false;
  }
  console.log(chalk.red(`✗ ${label} — ${result.errors.length} error(s)`));
  for (const e of result.errors) printGraphIssue(e, "error");
  for (const w of result.warnings) printGraphIssue(w, "warn");
  return true;
}

function printGraphIssue(issue: AgentFinding, kind: "error" | "warn"): void {
  const tag = kind === "error" ? chalk.red("[error]") : chalk.yellow("[warn ]");
  const scope = issue.agent ? chalk.dim(` ${issue.agent}`) : "";
  console.log(`    ${tag} ${issue.code}${scope}: ${issue.message}`);
}

// ---------------------------------------------------------------------------
// `solosquad agent add` — scaffolding (no LLM)
// ---------------------------------------------------------------------------

export interface AddAgentOpts {
  name: string;
  team: string;
  /** Override org slug — defaults to no org-local subfolder, writes under workspace agents dir. */
  org?: string;
  /** Override description (defaults to a placeholder). */
  description?: string;
  /** Override workspace root (mostly for tests). */
  workspace?: string;
  /** Skip rebuilding the route index (useful for tests). */
  skipRouterReload?: boolean;
}

export interface AddAgentResult {
  skillPath: string;
}

/**
 * Scaffold a minimal SKILL.md for users who want to skip the messenger
 * author loop. v0.5 §S3 line 6.
 *
 * Writes to `<workspace>/<org>/.agents/<team>/<name>/SKILL.md` when `org` is
 * provided, otherwise to `<workspace agents dir>/<team>/<name>/SKILL.md`.
 */
export async function agentAddCommand(opts: AddAgentOpts): Promise<AddAgentResult> {
  const team = opts.team.trim();
  const name = opts.name.trim();

  if (!name || !team) {
    console.error(chalk.red("error: --name and --team are required"));
    process.exitCode = 2;
    throw new Error("missing --name or --team");
  }

  const baseDir = opts.org
    ? path.join(getOrgDir(opts.org, opts.workspace ?? getWorkspaceRoot()), ".agents")
    : getAgentsDir();
  const agentDir = path.join(baseDir, team, name);
  const skillPath = path.join(agentDir, "SKILL.md");

  if (fs.existsSync(skillPath)) {
    console.error(chalk.red(`error: ${skillPath} already exists — refusing to overwrite`));
    process.exitCode = 2;
    throw new Error(`refusing to overwrite existing SKILL.md at ${skillPath}`);
  }

  const description = (opts.description ?? `${name} — TODO: describe what this agent does`).trim();

  const content = renderScaffold(name, team, description);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(skillPath, content, "utf-8");

  console.log(chalk.green(`✓ scaffolded ${skillPath}`));
  console.log(
    chalk.dim(
      "  Edit the SKILL.md to fill in triggers, inputs, outputs, and the process body.",
    ),
  );

  if (!opts.skipRouterReload) {
    try {
      const { rebuildRoutes } = await import("../bot/agent-router.js");
      rebuildRoutes(
        opts.org
          ? { org: opts.org, workspace_root: opts.workspace ?? getWorkspaceRoot() }
          : {},
      );
    } catch (e) {
      console.log(
        chalk.yellow(
          `△ router reload skipped: ${(e as Error).message}`,
        ),
      );
    }
  }

  return { skillPath };
}

// ---------------------------------------------------------------------------
// `solosquad agent reload` — manual hot-reload (v0.6 §10.5 manual mode)
// ---------------------------------------------------------------------------

export interface AgentReloadOpts {
  /** Restrict reload to a specific org's `.agents/` tier. */
  org?: string;
  /** Override workspace root (mostly for tests). */
  workspace?: string;
}

export interface AgentReloadResult {
  triggerCount: number;
  slashCount: number;
  keywordCount: number;
  explicitCount: number;
  freqCount: number;
}

/**
 * Manually rebuild the router. In v0.6 the fs-watcher does this
 * automatically for `auto` and (with confirmation) `prompt` modes; in
 * `manual` mode the user runs this command after editing a SKILL.md.
 *
 * Implementation: a thin wrapper around `rebuildRoutes()` that prints a
 * human-readable summary. Returns the per-channel counts so tests can
 * assert against them.
 */
export async function agentReloadCommand(
  opts: AgentReloadOpts = {},
): Promise<AgentReloadResult> {
  const { rebuildRoutes } = await import("../bot/agent-router.js");
  const buildOpts = opts.org
    ? { org: opts.org, workspace_root: opts.workspace ?? getWorkspaceRoot() }
    : {};
  const idx = rebuildRoutes(buildOpts);
  const result: AgentReloadResult = {
    slashCount: Object.keys(idx.slash).length,
    keywordCount: Object.keys(idx.keyword).length,
    explicitCount: Object.keys(idx.explicit).length,
    freqCount: idx.freq.length,
    triggerCount: 0,
  };
  result.triggerCount =
    result.slashCount + result.keywordCount + result.explicitCount + result.freqCount;

  console.log(
    chalk.green(
      `✓ SKILL routes reloaded — ${result.triggerCount} triggers`,
    ),
  );
  console.log(
    chalk.dim(
      `  slash=${result.slashCount}  keyword=${result.keywordCount}  ` +
        `explicit=${result.explicitCount}  freq=${result.freqCount}`,
    ),
  );

  return result;
}

function renderScaffold(name: string, team: string, description: string): string {
  const frontmatter = [
    `name: "${name}"`,
    `description: "${description}"`,
    `team: ${team}`,
    "stateful: false",
    "triggers:",
    "  explicit: true",
    "  keyword: []",
    "scope: agent",
    "confidence: 1.0",
    `source: cli-scaffold`,
  ].join("\n");

  const body = [
    "",
    `# ${name}`,
    "",
    `> ${description}`,
    "",
    "## Process",
    "",
    "1. Describe step one.",
    "2. Describe step two.",
    "3. Describe step three.",
    "",
    "## Inputs",
    "",
    "- TODO: list required inputs",
    "",
    "## Outputs",
    "",
    "- TODO: list outputs",
    "",
  ].join("\n");

  return `---\n${frontmatter}\n---\n${body}`;
}
