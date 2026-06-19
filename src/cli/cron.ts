import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getCronsDir } from "../util/paths.js";
import { loadCronDefs } from "../scheduler/cron-def.js";
import {
  validateCronDef,
  type CronFinding,
} from "../scheduler/cron-validate.js";
import { CRONS } from "../scheduler/crons.js";

/**
 * v1.3.2 §8 (v1.3.x cron rename) — backs the `solosquad cron` command group
 * (`start`/`run`/`list`/`new`/`show`/`validate`). Covers list + validate of
 * user-authored `crons/<id>.yaml` definitions; `start` runs the daemon and
 * `run` executes one cron manually.
 */

function promptExists(id: string): boolean {
  return fs.existsSync(path.join(getCronsDir(), `${id}.md`));
}

export interface CronNewOpts {
  cron?: string;
  kind?: string;
  channel?: string;
}

/**
 * §9.6 — `cron new <id>`: scaffold `crons/<id>.yaml` + `<id>.md`. The
 * cron domain previously had no create path (users hand-wrote both files).
 * The yaml is machine-generated and the result is validated before reporting
 * success. Authoring the prompt body from intent is a conversational job —
 * ask Chief in `solosquad chat` (the asset-review / author skills).
 */
export async function cronNewCommand(id: string | undefined, opts: CronNewOpts = {}): Promise<void> {
  const { isKebabCase } = await import("../util/naming.js");
  if (!id || !isKebabCase(id)) {
    console.error(chalk.red(`error: provide a kebab-case id — \`solosquad cron new <id>\``));
    process.exitCode = 2;
    return;
  }
  const dir = getCronsDir();
  const yamlPath = path.join(dir, `${id}.yaml`);
  const mdPath = path.join(dir, `${id}.md`);
  if (fs.existsSync(yamlPath)) {
    console.error(chalk.red(`✗ ${yamlPath} already exists — edit it directly`));
    process.exitCode = 1;
    return;
  }

  const kind = opts.kind === "user-brief" ? "user-brief" : "background";
  const cron = opts.cron ?? "0 9 * * 1";
  const channel = opts.channel ?? "workflow";
  const yamlBody =
    `id: ${id}\nname: ${id}\nkind: ${kind}\ncron: "${cron}"\nchannel: ${channel}\nenabled: true\n`;

  const promptBody = `# ${id}\n\nTODO: describe what this scheduled run should do.\n`;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(yamlPath, yamlBody, "utf-8");
  fs.writeFileSync(mdPath, promptBody, "utf-8");

  // validate-then-report
  const def = loadCronDefs(dir).find((d) => d.id === id);
  const result = def
    ? validateCronDef(def, { reservedIds: new Set(CRONS.map((r) => r.id)), promptExists })
    : { ok: false, errors: [{ code: "LOAD", message: "could not reload", id }], warnings: [] };

  console.log(chalk.green(`✓ created ${yamlPath} + ${id}.md`));
  if (!result.ok) {
    console.log(chalk.red(`  ✗ ${result.errors.length} validation error(s):`));
    for (const e of result.errors) printIssue(e, "error");
    process.exitCode = 1;
  } else {
    if (result.warnings.length) for (const w of result.warnings) printIssue(w, "warn");
    console.log(chalk.dim(`  Next: edit the prompt, then \`solosquad cron validate\``));
  }
}

export async function cronListCommand(): Promise<void> {
  const dir = getCronsDir();
  const defs = loadCronDefs(dir);
  console.log(chalk.bold(`Built-in crons (${CRONS.length}):`));
  for (const r of CRONS) {
    console.log(`  ${r.emoji} ${chalk.cyan(r.id)} — ${r.name} (${r.kind})`);
  }
  console.log(chalk.bold(`\nUser crons in ${dir} (${defs.length}):`));
  if (defs.length === 0) {
    console.log(chalk.dim("  (none — add crons/<id>.yaml + crons/<id>.md)"));
    return;
  }
  for (const d of defs) {
    const flag = d.enabled ? chalk.green("on") : chalk.dim("off");
    console.log(`  ${d.emoji} ${chalk.cyan(d.id)} — ${d.name} [${flag}] cron="${d.cron}" (${d.kind})`);
  }
}

export async function cronShowCommand(id: string): Promise<void> {
  // §9.6 — homogeneous `show <id>`, matching `goal show` / `workflow show`.
  const builtin = CRONS.find((r) => r.id === id);
  if (builtin) {
    console.log(chalk.bold(`${builtin.emoji} ${builtin.id}`) + chalk.dim("  (built-in cron)"));
    console.log(`  name:    ${builtin.name}`);
    console.log(`  kind:    ${builtin.kind}`);
    console.log(chalk.dim(`  cron:    resolved at scheduler startup from workspace.yaml`));
    return;
  }
  const dir = getCronsDir();
  const def = loadCronDefs(dir).find((d) => d.id === id);
  if (!def) {
    console.log(chalk.red(`✗ no cron "${id}" (built-in or user-defined). Try \`solosquad cron list\`.`));
    process.exitCode = 1;
    return;
  }
  const flag = def.enabled ? chalk.green("on") : chalk.dim("off");
  console.log(chalk.bold(`${def.emoji} ${def.id}`) + `  [${flag}]`);
  console.log(`  name:    ${def.name}`);
  console.log(`  kind:    ${def.kind}`);
  console.log(`  cron:    ${def.cron}`);
  if (def.channel) console.log(`  channel: ${def.channel}`);
  const prompt = path.join(dir, `${def.id}.md`);
  console.log(`  prompt:  ${promptExists(def.id) ? prompt : chalk.red(`${prompt} (missing)`)}`);

  // surface validation state inline (validate-then-trust)
  const result = validateCronDef(def, { reservedIds: new Set(CRONS.map((r) => r.id)), promptExists });
  if (!result.ok) {
    console.log(chalk.red(`\n  ✗ ${result.errors.length} error(s):`));
    for (const e of result.errors) printIssue(e, "error");
  } else if (result.warnings.length) {
    console.log(chalk.yellow(`\n  △ ${result.warnings.length} warning(s):`));
    for (const w of result.warnings) printIssue(w, "warn");
  } else {
    console.log(chalk.green(`\n  ✓ valid`));
  }
}

export async function cronValidateCommand(): Promise<void> {
  const defs = loadCronDefs(getCronsDir());
  if (defs.length === 0) {
    console.log(chalk.yellow("△ no user crons found (crons/<id>.yaml)"));
    process.exitCode = 0;
    return;
  }

  const builtinIds = new Set(CRONS.map((r) => r.id));
  let failed = 0;
  for (const def of defs) {
    const result = validateCronDef(def, { reservedIds: builtinIds, promptExists });
    if (result.ok && result.warnings.length === 0) {
      console.log(chalk.green(`✓ ${def.id}`));
      continue;
    }
    if (result.ok) {
      console.log(chalk.yellow(`△ ${def.id} — ${result.warnings.length} warning(s)`));
      for (const w of result.warnings) printIssue(w, "warn");
      continue;
    }
    failed++;
    console.log(chalk.red(`✗ ${def.id} — ${result.errors.length} error(s)`));
    for (const e of result.errors) printIssue(e, "error");
    for (const w of result.warnings) printIssue(w, "warn");
  }

  console.log();
  if (failed === 0) {
    console.log(chalk.green(`✓ ${defs.length} cron(s) validated, 0 failed`));
    process.exitCode = 0;
  } else {
    console.log(chalk.red(`✗ ${failed} failed (of ${defs.length})`));
    process.exitCode = 1;
  }
}

function printIssue(issue: CronFinding, kind: "error" | "warn"): void {
  const tag = kind === "error" ? chalk.red("[error]") : chalk.yellow("[warn ]");
  const field = issue.field ? chalk.dim(` (${issue.field})`) : "";
  console.log(`    ${tag} ${issue.code}${field}: ${issue.message}`);
}
