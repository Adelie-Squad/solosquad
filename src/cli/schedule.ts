import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getSchedulesDir } from "../util/paths.js";
import { loadScheduleDefs } from "../scheduler/schedule-def.js";
import {
  validateScheduleDef,
  type ScheduleFinding,
} from "../scheduler/schedule-validate.js";
import { ROUTINES } from "../scheduler/routines.js";

/**
 * v1.3.2 §8 — `solosquad schedules` management group (plural; the singular
 * `schedule` command starts the scheduler). Covers list + validate of
 * user-authored `schedules/<id>.yaml` definitions.
 */

function promptExists(id: string): boolean {
  return fs.existsSync(path.join(getSchedulesDir(), `${id}.md`));
}

export interface ScheduleNewOpts {
  cron?: string;
  kind?: string;
  channel?: string;
}

/**
 * §9.6 — `schedules new <id>`: scaffold `schedules/<id>.yaml` + `<id>.md`. The
 * schedule domain previously had no create path (users hand-wrote both files).
 * The yaml is machine-generated and the result is validated before reporting
 * success. Authoring the prompt body from intent is a conversational job —
 * ask Chief in `solosquad chat` (the asset-review / author skills).
 */
export async function scheduleNewCommand(id: string | undefined, opts: ScheduleNewOpts = {}): Promise<void> {
  const { isKebabCase } = await import("../util/naming.js");
  if (!id || !isKebabCase(id)) {
    console.error(chalk.red(`error: provide a kebab-case id — \`solosquad schedules new <id>\``));
    process.exitCode = 2;
    return;
  }
  const dir = getSchedulesDir();
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
  const def = loadScheduleDefs(dir).find((d) => d.id === id);
  const result = def
    ? validateScheduleDef(def, { reservedIds: new Set(ROUTINES.map((r) => r.id)), promptExists })
    : { ok: false, errors: [{ code: "LOAD", message: "could not reload", id }], warnings: [] };

  console.log(chalk.green(`✓ created ${yamlPath} + ${id}.md`));
  if (!result.ok) {
    console.log(chalk.red(`  ✗ ${result.errors.length} validation error(s):`));
    for (const e of result.errors) printIssue(e, "error");
    process.exitCode = 1;
  } else {
    if (result.warnings.length) for (const w of result.warnings) printIssue(w, "warn");
    console.log(chalk.dim(`  Next: edit the prompt, then \`solosquad schedules validate\``));
  }
}

export async function scheduleListCommand(): Promise<void> {
  const dir = getSchedulesDir();
  const defs = loadScheduleDefs(dir);
  console.log(chalk.bold(`Built-in routines (${ROUTINES.length}):`));
  for (const r of ROUTINES) {
    console.log(`  ${r.emoji} ${chalk.cyan(r.id)} — ${r.name} (${r.kind})`);
  }
  console.log(chalk.bold(`\nUser schedules in ${dir} (${defs.length}):`));
  if (defs.length === 0) {
    console.log(chalk.dim("  (none — add schedules/<id>.yaml + schedules/<id>.md)"));
    return;
  }
  for (const d of defs) {
    const flag = d.enabled ? chalk.green("on") : chalk.dim("off");
    console.log(`  ${d.emoji} ${chalk.cyan(d.id)} — ${d.name} [${flag}] cron="${d.cron}" (${d.kind})`);
  }
}

export async function scheduleShowCommand(id: string): Promise<void> {
  // §9.6 — homogeneous `show <id>`, matching `goal show` / `workflow show`.
  const builtin = ROUTINES.find((r) => r.id === id);
  if (builtin) {
    console.log(chalk.bold(`${builtin.emoji} ${builtin.id}`) + chalk.dim("  (built-in routine)"));
    console.log(`  name:    ${builtin.name}`);
    console.log(`  kind:    ${builtin.kind}`);
    console.log(chalk.dim(`  cron:    resolved at scheduler startup from workspace.yaml`));
    return;
  }
  const dir = getSchedulesDir();
  const def = loadScheduleDefs(dir).find((d) => d.id === id);
  if (!def) {
    console.log(chalk.red(`✗ no schedule "${id}" (built-in or user-defined). Try \`solosquad schedules list\`.`));
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
  const result = validateScheduleDef(def, { reservedIds: new Set(ROUTINES.map((r) => r.id)), promptExists });
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

export async function scheduleValidateCommand(): Promise<void> {
  const defs = loadScheduleDefs(getSchedulesDir());
  if (defs.length === 0) {
    console.log(chalk.yellow("△ no user schedules found (schedules/<id>.yaml)"));
    process.exitCode = 0;
    return;
  }

  const builtinIds = new Set(ROUTINES.map((r) => r.id));
  let failed = 0;
  for (const def of defs) {
    const result = validateScheduleDef(def, { reservedIds: builtinIds, promptExists });
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
    console.log(chalk.green(`✓ ${defs.length} schedule(s) validated, 0 failed`));
    process.exitCode = 0;
  } else {
    console.log(chalk.red(`✗ ${failed} failed (of ${defs.length})`));
    process.exitCode = 1;
  }
}

function printIssue(issue: ScheduleFinding, kind: "error" | "warn"): void {
  const tag = kind === "error" ? chalk.red("[error]") : chalk.yellow("[warn ]");
  const field = issue.field ? chalk.dim(` (${issue.field})`) : "";
  console.log(`    ${tag} ${issue.code}${field}: ${issue.message}`);
}
