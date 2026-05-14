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
import { getAgentsDir } from "../util/paths.js";

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
  corpus?: boolean;
}

export async function agentValidateCommand(
  filePath: string | undefined,
  opts: ValidateOpts
): Promise<void> {
  if (!filePath && !opts.all) {
    console.error(chalk.red("error: provide a path or use --all"));
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

  if (opts.corpus) {
    const { runCorpusRegression } = await import("../analyze/validator-corpus.js");
    const corpusResult = await runCorpusRegression();
    console.log();
    if (corpusResult.ok) {
      console.log(
        chalk.green(
          `✓ corpus round-trip: ${corpusResult.checked} files OK`
        )
      );
    } else {
      console.log(
        chalk.red(
          `✗ corpus round-trip: ${corpusResult.failures.length} failures (of ${corpusResult.checked})`
        )
      );
      for (const f of corpusResult.failures.slice(0, 5)) {
        console.log(chalk.dim(`    - ${f.path}: ${f.reason}`));
      }
      if (corpusResult.failures.length > 5) {
        console.log(chalk.dim(`    ... and ${corpusResult.failures.length - 5} more`));
      }
      totalFailed += corpusResult.failures.length;
      totalChecked += corpusResult.checked;
    }
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
