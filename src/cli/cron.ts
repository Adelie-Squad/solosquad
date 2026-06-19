import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getCronsWriteDir } from "../util/paths.js";
import {
  loadCronDefs,
  writeCronDef,
  patchCronDef,
  setCronEnabled,
  deleteCronFiles,
  resolveCronRef,
  cronMdPath,
  type CronDef,
} from "../scheduler/cron-def.js";
import {
  validateCronDef,
  type CronFinding,
} from "../scheduler/cron-validate.js";
import { normalizeSchedule, describeSchedule, nextRun } from "../scheduler/cron-schedule.js";
import { CRONS } from "../scheduler/crons.js";

const BUILTIN_IDS = new Set(CRONS.map((r) => r.id));

/** Resolve an id-or-name ref to a user-cron id, printing the right error and
 *  setting exitCode on failure. Returns null if unresolved/built-in. */
function resolveOrFail(ref: string, verb: string): string | null {
  if (BUILTIN_IDS.has(ref)) {
    console.error(chalk.red(`✗ "${ref}" is a built-in cron — it can't be ${verb} (edit workspace.yaml for its time).`));
    process.exitCode = 2;
    return null;
  }
  const r = resolveCronRef(ref);
  if (r.kind === "ok") return r.id;
  if (r.kind === "ambiguous") {
    console.error(chalk.red(`✗ "${ref}" is ambiguous — matches: ${r.matches.join(", ")}. Use the exact id.`));
    process.exitCode = 2;
    return null;
  }
  console.error(chalk.red(`✗ no user cron "${ref}". Try \`solosquad cron list\`.`));
  process.exitCode = 1;
  return null;
}

/** Validate a def + print its findings; returns true if error-free. */
function reportValidation(def: CronDef): boolean {
  const result = validateCronDef(def, { reservedIds: builtinIdsExcept(def.id), promptExists });
  if (!result.ok) {
    console.log(chalk.red(`  ✗ ${result.errors.length} error(s):`));
    for (const e of result.errors) printIssue(e, "error");
  } else if (result.warnings.length) {
    for (const w of result.warnings) printIssue(w, "warn");
  }
  return result.ok;
}

/** Built-in ids minus the def's own id (so re-saving a def isn't a self-collision). */
function builtinIdsExcept(_id: string): ReadonlySet<string> {
  return BUILTIN_IDS;
}

/**
 * v1.3.2 §8 (v1.3.x cron rename) — backs the `solosquad cron` command group
 * (`start`/`run`/`list`/`new`/`show`/`validate`). Covers list + validate of
 * user-authored `crons/<id>.yaml` definitions; `start` runs the daemon and
 * `run` executes one cron manually.
 */

function promptExists(id: string): boolean {
  return fs.existsSync(path.join(getCronsWriteDir(), `${id}.md`));
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
  const dir = getCronsWriteDir();
  const yamlPath = path.join(dir, `${id}.yaml`);
  const mdPath = path.join(dir, `${id}.md`);
  if (fs.existsSync(yamlPath)) {
    console.error(chalk.red(`✗ ${yamlPath} already exists — edit it directly`));
    process.exitCode = 1;
    return;
  }

  const kind = opts.kind === "user-brief" ? "user-brief" : "background";
  const channel = opts.channel ?? "workflow";

  // Friendly schedule input (cron expr | @daily | "every 1h") → cron expression.
  const norm = normalizeSchedule(opts.cron ?? "0 9 * * 1");
  if (norm.error || !norm.cron) {
    console.error(chalk.red(`✗ schedule: ${norm.error ?? "could not parse"}`));
    process.exitCode = 2;
    return;
  }

  const def: CronDef = {
    id, name: id, kind, cron: norm.cron, channel,
    emoji: "⏰", memoryTargets: [], enabled: true,
  };
  writeCronDef(def, dir, /* scaffoldPrompt */ true);

  console.log(chalk.green(`✓ created ${yamlPath} + ${id}.md`));
  console.log(chalk.dim(`  schedule: ${norm.describe} ("${norm.cron}")`));
  printNextRun(norm.cron);

  if (reportValidation(def)) {
    console.log(chalk.dim(`  Next: edit ${mdPath} (the prompt), then \`solosquad cron validate\``));
  } else {
    process.exitCode = 1;
  }
}

/** Print the next fire time as preview/validation feedback. */
function printNextRun(expr: string): void {
  const next = nextRun(expr);
  if (next) console.log(chalk.dim(`  next run: ${next.toLocaleString()}`));
}

export interface CronEditOpts {
  cron?: string;
  name?: string;
  kind?: string;
  channel?: string;
}

/** `cron edit <ref>` — patch fields of an existing user cron, then re-validate. */
export async function cronEditCommand(ref: string, opts: CronEditOpts = {}): Promise<void> {
  const id = resolveOrFail(ref, "edited");
  if (!id) return;
  const patch: Partial<CronDef> = {};
  if (opts.name) patch.name = opts.name;
  if (opts.channel) patch.channel = opts.channel;
  if (opts.kind) {
    if (opts.kind !== "user-brief" && opts.kind !== "background") {
      console.error(chalk.red(`✗ --kind must be "user-brief" or "background"`));
      process.exitCode = 2;
      return;
    }
    patch.kind = opts.kind;
  }
  if (opts.cron) {
    const norm = normalizeSchedule(opts.cron);
    if (norm.error || !norm.cron) {
      console.error(chalk.red(`✗ schedule: ${norm.error ?? "could not parse"}`));
      process.exitCode = 2;
      return;
    }
    patch.cron = norm.cron;
  }
  if (Object.keys(patch).length === 0) {
    console.log(chalk.yellow(`△ nothing to change — pass --cron / --name / --kind / --channel`));
    return;
  }
  const def = patchCronDef(id, patch);
  if (!def) {
    console.error(chalk.red(`✗ could not read cron "${id}"`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(`✓ updated ${id}`));
  if (patch.cron) {
    console.log(chalk.dim(`  schedule: ${describeSchedule(def.cron)} ("${def.cron}")`));
    printNextRun(def.cron);
  }
  if (!reportValidation(def)) process.exitCode = 1;
}

/** `cron enable <ref>` / `cron disable <ref>` — pause ≠ delete. */
export async function cronSetEnabledCommand(ref: string, enabled: boolean): Promise<void> {
  const id = resolveOrFail(ref, enabled ? "enabled" : "disabled");
  if (!id) return;
  const def = setCronEnabled(id, enabled);
  if (!def) {
    console.error(chalk.red(`✗ could not read cron "${id}"`));
    process.exitCode = 1;
    return;
  }
  const state = enabled ? chalk.green("enabled") : chalk.yellow("disabled (paused)");
  console.log(`✓ ${id} → ${state}`);
  console.log(chalk.dim(`  Definition kept; a running daemon picks up the change on next reload.`));
}

export interface CronDeleteOpts {
  hard?: boolean;
  yes?: boolean;
}

/** `cron delete <ref>` — archive (default) or hard-remove the backing files. */
export async function cronDeleteCommand(ref: string, opts: CronDeleteOpts = {}): Promise<void> {
  const id = resolveOrFail(ref, "deleted");
  if (!id) return;
  if (!opts.yes) {
    const inquirer = (await import("inquirer")).default;
    const { ok } = await inquirer.prompt([{
      name: "ok", type: "confirm", default: false,
      message: opts.hard
        ? `Permanently delete cron "${id}" (yaml + prompt)?`
        : `Archive cron "${id}" to crons/_archived/? (recoverable)`,
    }]);
    if (!ok) {
      console.log(chalk.dim("aborted."));
      return;
    }
  }
  const touched = deleteCronFiles(id, getCronsWriteDir(), { hard: opts.hard });
  if (touched.length === 0) {
    console.error(chalk.red(`✗ no files for "${id}"`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(`✓ ${opts.hard ? "deleted" : "archived"} ${id}`));
  for (const p of touched) console.log(chalk.dim(`  ${p}`));
  console.log(chalk.dim(`  A running daemon stops it on next reload.`));
}

export async function cronListCommand(): Promise<void> {
  const dir = getCronsWriteDir();
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
  const dir = getCronsWriteDir();
  const def = loadCronDefs(dir).find((d) => d.id === id);
  if (!def) {
    console.log(chalk.red(`✗ no cron "${id}" (built-in or user-defined). Try \`solosquad cron list\`.`));
    process.exitCode = 1;
    return;
  }
  const flag = def.enabled ? chalk.green("on") : chalk.dim("off (paused)");
  console.log(chalk.bold(`${def.emoji} ${def.id}`) + `  [${flag}]`);
  console.log(`  name:    ${def.name}`);
  console.log(`  kind:    ${def.kind}`);
  console.log(`  cron:    ${def.cron}  ${chalk.dim(`(${describeSchedule(def.cron)})`)}`);
  const next = nextRun(def.cron);
  if (next) console.log(`  next:    ${chalk.dim(next.toLocaleString())}`);
  if (def.channel) console.log(`  channel: ${def.channel}`);
  const prompt = cronMdPath(def.id, dir);
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
  const defs = loadCronDefs(getCronsWriteDir());
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
