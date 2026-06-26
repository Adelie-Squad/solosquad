import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getCronsWriteDir } from "../util/paths.js";
import { listOrganizations } from "../util/config.js";
import {
  loadCronDefs,
  writeCronDef,
  patchCronDef,
  setCronEnabled,
  deleteCronFiles,
  resolveCronRef,
  cronMdPath,
  CRON_PRESETS,
  type CronDef,
} from "../cron/cron-def.js";
import { getCronsDir } from "../util/paths.js";
import {
  validateCronDef,
  type CronFinding,
} from "../cron/cron-validate.js";
import { normalizeSchedule, describeSchedule, nextRun, nextRuns, parseWhen } from "../cron/cron-schedule.js";
import { CRONS } from "../cron/crons.js";

const BUILTIN_IDS = new Set(CRONS.map((r) => r.id));

/**
 * v1.3.5 §3.9 B-D3 — crons are org-scoped (`<org>/crons/`). Resolve which org a
 * command operates on: explicit `--org`, else the sole org, else require `--org`.
 * Returns the org slug + its cron dir, or null (with exitCode set) on failure.
 */
function resolveOrgDir(orgOpt?: string): { org: string; dir: string } | null {
  const orgs = listOrganizations();
  if (orgs.length === 0) {
    console.error(chalk.red("✗ no organizations — run `solosquad init` first."));
    process.exitCode = 1;
    return null;
  }
  let org: string;
  if (orgOpt) {
    if (!orgs.some((o) => o.slug === orgOpt)) {
      console.error(chalk.red(`✗ no org "${orgOpt}". Known: ${orgs.map((o) => o.slug).join(", ")}.`));
      process.exitCode = 1;
      return null;
    }
    org = orgOpt;
  } else if (orgs.length === 1) {
    org = orgs[0].slug;
  } else {
    console.error(chalk.red(`✗ multiple orgs — pass --org <slug> (${orgs.map((o) => o.slug).join(", ")}).`));
    process.exitCode = 2;
    return null;
  }
  return { org, dir: getCronsWriteDir(org) };
}

/** A `promptExists` predicate bound to a specific org cron dir. */
function promptExistsIn(dir: string): (id: string) => boolean {
  return (id: string) => fs.existsSync(path.join(dir, `${id}.md`));
}

/** Resolve an id-or-name ref to a user-cron id, printing the right error and
 *  setting exitCode on failure. Returns null if unresolved/built-in. */
function resolveOrFail(ref: string, verb: string, dir: string): string | null {
  if (BUILTIN_IDS.has(ref)) {
    console.error(chalk.red(`✗ "${ref}" is a built-in cron — it can't be ${verb} (edit workspace.yaml for its time).`));
    process.exitCode = 2;
    return null;
  }
  const r = resolveCronRef(ref, dir);
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
function reportValidation(def: CronDef, dir: string): boolean {
  const result = validateCronDef(def, { reservedIds: builtinIdsExcept(def.id), promptExists: promptExistsIn(dir) });
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

export interface CronNewOpts {
  cron?: string;
  at?: string;
  kind?: string;
  channel?: string;
  timezone?: string;
  yes?: boolean;
  org?: string;
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
  const resolved = resolveOrgDir(opts.org);
  if (!resolved) return;
  const { dir } = resolved;
  const yamlPath = path.join(dir, `${id}.yaml`);
  const mdPath = path.join(dir, `${id}.md`);
  if (fs.existsSync(yamlPath)) {
    console.error(chalk.red(`✗ ${yamlPath} already exists — edit it directly`));
    process.exitCode = 1;
    return;
  }

  const kind = opts.kind === "user-brief" ? "user-brief" : "background";
  // v1.3.4 §F2 — channel defaults to "" (auto-resolve works-<handle> at runtime).
  const channel = opts.channel ?? "";
  // v1.3.4 §C — validate an explicit timezone before we even preview.
  if (opts.timezone) {
    const { isValidIanaTimezone, suggestTimezone } = await import("../util/timezone.js");
    if (!isValidIanaTimezone(opts.timezone)) {
      const hint = suggestTimezone(opts.timezone);
      console.error(chalk.red(`✗ --timezone "${opts.timezone}" is not a valid IANA name${hint ? ` — did you mean "${hint}"?` : ""}`));
      process.exitCode = 2;
      return;
    }
  }

  let def: CronDef;
  if (opts.at) {
    // One-shot: runs once at `--at <ISO | "20m">` then auto-deletes.
    const when = parseWhen(opts.at);
    if (when.error || !when.at) {
      console.error(chalk.red(`✗ --at: ${when.error ?? "could not parse"}`));
      process.exitCode = 2;
      return;
    }
    def = { id, name: id, kind, cron: "", at: when.at, channel, timezone: opts.timezone, emoji: "⏰", memoryTargets: [], enabled: true };
    // v1.3.4 §F4 — preview + confirm before writing.
    console.log(chalk.dim(`  one-shot: runs once at ${new Date(when.at).toLocaleString()}, then auto-deletes`));
    if (!(await confirmOrAbort(`Create one-shot cron "${id}"?`, opts.yes))) return;
  } else {
    // Friendly recurring schedule (cron expr | @daily | "every 1h") → cron expression.
    const norm = normalizeSchedule(opts.cron ?? "0 9 * * 1");
    if (norm.error || !norm.cron) {
      console.error(chalk.red(`✗ schedule: ${norm.error ?? "could not parse"}`));
      process.exitCode = 2;
      return;
    }
    def = { id, name: id, kind, cron: norm.cron, channel, timezone: opts.timezone, emoji: "⏰", memoryTargets: [], enabled: true };
    // v1.3.4 §B/§F4 — preview the schedule + next runs, then confirm.
    console.log(chalk.dim(`  schedule: ${norm.describe} ("${norm.cron}")`));
    printNextRuns(norm.cron, opts.timezone);
    if (!(await confirmOrAbort(`Create cron "${id}"?`, opts.yes))) return;
  }

  writeCronDef(def, dir, /* scaffoldPrompt */ true);
  console.log(chalk.green(`✓ created ${yamlPath} + ${id}.md  ${chalk.dim(`(org: ${resolved.org})`)}`));

  if (reportValidation(def, dir)) {
    console.log(chalk.dim(`  Next: edit ${mdPath} (the prompt), then \`solosquad cron validate\``));
  } else {
    process.exitCode = 1;
  }
}

export interface CronPresetOpts {
  cron?: string;
  org?: string;
  yes?: boolean;
}

/**
 * v1.4.0 (§5.5) — `cron preset <id>`: enable an opt-in cron preset. Writes the
 * preset's def into the org crons dir and copies the bundled prompt in (so the
 * user owns + can edit it). Unlike `cron new` (which scaffolds a TODO prompt),
 * the preset reuses the shipped `crons/<id>.md`.
 */
export async function cronPresetCommand(id: string | undefined, opts: CronPresetOpts = {}): Promise<void> {
  const available = Object.keys(CRON_PRESETS).sort();
  if (!id || !CRON_PRESETS[id]) {
    console.error(
      chalk.red(`error: unknown preset "${id ?? ""}". Available: ${available.join(", ") || "(none)"}`),
    );
    process.exitCode = 2;
    return;
  }
  const preset = CRON_PRESETS[id];
  const resolved = resolveOrgDir(opts.org);
  if (!resolved) return;
  const { dir } = resolved;

  const yamlPath = path.join(dir, `${id}.yaml`);
  if (fs.existsSync(yamlPath)) {
    console.error(chalk.red(`✗ ${yamlPath} already exists — already enabled (\`solosquad cron list\`).`));
    process.exitCode = 1;
    return;
  }

  let cronExpr = preset.cron;
  if (opts.cron) {
    const norm = normalizeSchedule(opts.cron);
    if (norm.error || !norm.cron) {
      console.error(chalk.red(`✗ schedule: ${norm.error ?? "could not parse"}`));
      process.exitCode = 2;
      return;
    }
    cronExpr = norm.cron;
  }

  const def: CronDef = {
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    cron: cronExpr,
    channel: "",
    emoji: preset.emoji,
    memoryTargets: preset.memoryTargets,
    enabled: true,
  };

  console.log(chalk.dim(`  ${preset.description}`));
  console.log(chalk.dim(`  schedule: ${describeSchedule(cronExpr)} ("${cronExpr}")`));
  printNextRuns(cronExpr);
  if (!(await confirmOrAbort(`Enable preset cron "${id}"?`, opts.yes))) return;

  writeCronDef(def, dir); // no scaffold — the bundled prompt is copied below.

  // Copy the shipped prompt into the org dir so the cron is self-contained and
  // user-editable. If a local prompt already exists, keep the user's version.
  const bundledPrompt = path.join(getCronsDir(), `${id}.md`);
  const orgPrompt = cronMdPath(id, dir);
  if (!fs.existsSync(orgPrompt) && fs.existsSync(bundledPrompt)) {
    fs.copyFileSync(bundledPrompt, orgPrompt);
  }

  console.log(chalk.green(`✓ enabled ${yamlPath} + ${id}.md  ${chalk.dim(`(org: ${resolved.org})`)}`));
  if (!reportValidation(def, dir)) process.exitCode = 1;
}

/** v1.3.4 §B — print the next N fire times as a save-time preview. */
function printNextRuns(expr: string, tz?: string, n = 5): void {
  const runs = nextRuns(expr, n, tz);
  if (runs.length === 0) {
    const next = nextRun(expr, tz);
    if (next) console.log(chalk.dim(`  next run: ${next.toLocaleString()}`));
    return;
  }
  console.log(chalk.dim(`  next ${runs.length} run(s)${tz ? ` (${tz})` : ""}:`));
  for (const d of runs) console.log(chalk.dim(`    • ${d.toLocaleString("en-US", tz ? { timeZone: tz } : {})}`));
}

/** v1.3.4 §F4/§E1 — confirm a destructive/creating action unless --yes. */
async function confirmOrAbort(message: string, yes?: boolean): Promise<boolean> {
  if (yes) return true;
  const inquirer = (await import("inquirer")).default;
  const { ok } = await inquirer.prompt([{ name: "ok", type: "confirm", default: true, message }]);
  if (!ok) console.log(chalk.dim("aborted."));
  return ok;
}

/** Human "in 2h 5m" / "overdue" for a one-shot ISO time. */
function relativeFromNow(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return "?";
  if (ms <= 0) return "overdue (will be cleaned up)";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return `in ${h}h${m ? ` ${m}m` : ""}`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export interface CronEditOpts {
  cron?: string;
  name?: string;
  kind?: string;
  channel?: string;
  timezone?: string;
  yes?: boolean;
  org?: string;
}

/** `cron edit <ref>` — patch fields of an existing user cron, then re-validate. */
export async function cronEditCommand(ref: string, opts: CronEditOpts = {}): Promise<void> {
  const resolved = resolveOrgDir(opts.org);
  if (!resolved) return;
  const { dir } = resolved;
  const id = resolveOrFail(ref, "edited", dir);
  if (!id) return;
  const patch: Partial<CronDef> = {};
  if (opts.name) patch.name = opts.name;
  if (opts.channel !== undefined) patch.channel = opts.channel;
  if (opts.kind) {
    if (opts.kind !== "user-brief" && opts.kind !== "background") {
      console.error(chalk.red(`✗ --kind must be "user-brief" or "background"`));
      process.exitCode = 2;
      return;
    }
    patch.kind = opts.kind;
  }
  if (opts.timezone) {
    const { isValidIanaTimezone, suggestTimezone } = await import("../util/timezone.js");
    if (!isValidIanaTimezone(opts.timezone)) {
      const hint = suggestTimezone(opts.timezone);
      console.error(chalk.red(`✗ --timezone "${opts.timezone}" is not a valid IANA name${hint ? ` — did you mean "${hint}"?` : ""}`));
      process.exitCode = 2;
      return;
    }
    patch.timezone = opts.timezone;
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
    console.log(chalk.yellow(`△ nothing to change — pass --cron / --name / --kind / --channel / --timezone`));
    return;
  }
  // v1.3.4 §B/§F4 — preview the resulting schedule, then confirm before writing.
  if (patch.cron) {
    console.log(chalk.dim(`  schedule: ${describeSchedule(patch.cron)} ("${patch.cron}")`));
    printNextRuns(patch.cron, opts.timezone);
  }
  if (!(await confirmOrAbort(`Apply changes to cron "${id}"?`, opts.yes))) return;

  const def = patchCronDef(id, patch, dir);
  if (!def) {
    console.error(chalk.red(`✗ could not read cron "${id}"`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(`✓ updated ${id}`));
  if (!reportValidation(def, dir)) process.exitCode = 1;
}

/** `cron enable <ref>` / `cron disable <ref>` — pause ≠ delete. */
export async function cronSetEnabledCommand(ref: string, enabled: boolean, opts: { org?: string } = {}): Promise<void> {
  const resolved = resolveOrgDir(opts.org);
  if (!resolved) return;
  const { dir } = resolved;
  const id = resolveOrFail(ref, enabled ? "enabled" : "disabled", dir);
  if (!id) return;
  const def = setCronEnabled(id, enabled, dir);
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
  org?: string;
}

/** `cron delete <ref>` — archive (default) or hard-remove the backing files. */
export async function cronDeleteCommand(ref: string, opts: CronDeleteOpts = {}): Promise<void> {
  const resolved = resolveOrgDir(opts.org);
  if (!resolved) return;
  const { dir } = resolved;
  const id = resolveOrFail(ref, "deleted", dir);
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
  const touched = deleteCronFiles(id, dir, { hard: opts.hard });
  if (touched.length === 0) {
    console.error(chalk.red(`✗ no files for "${id}"`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(`✓ ${opts.hard ? "deleted" : "archived"} ${id}`));
  for (const p of touched) console.log(chalk.dim(`  ${p}`));
  console.log(chalk.dim(`  A running daemon stops it on next reload.`));
}

export async function cronListCommand(opts: { org?: string } = {}): Promise<void> {
  console.log(chalk.bold(`Built-in crons (${CRONS.length}):`));
  for (const r of CRONS) {
    console.log(`  ${r.emoji} ${chalk.cyan(r.id)} — ${r.name} (${r.kind})`);
  }
  // v1.3.5 B-D3 — user crons are org-scoped; list per org (or one via --org).
  const orgs = listOrganizations().filter((o) => !opts.org || o.slug === opts.org);
  if (orgs.length === 0) {
    console.log(chalk.dim(`\n(no organizations${opts.org ? ` matching "${opts.org}"` : ""})`));
    return;
  }
  for (const org of orgs) {
    const dir = getCronsWriteDir(org.slug);
    const defs = loadCronDefs(dir);
    console.log(chalk.bold(`\n${org.slug} — user crons (${defs.length}):`) + chalk.dim(`  ${dir}`));
    if (defs.length === 0) {
      console.log(chalk.dim("  (none — `solosquad cron new <id>`)"));
      continue;
    }
    for (const d of defs) {
      const flag = d.enabled ? chalk.green("on") : chalk.dim("off");
      const sched = d.at ? `at=${d.at} (one-shot)` : `cron="${d.cron}"`;
      console.log(`  ${d.emoji} ${chalk.cyan(d.id)} — ${d.name} [${flag}] ${sched} (${d.kind})`);
    }
  }
}

export async function cronShowCommand(id: string, opts: { org?: string } = {}): Promise<void> {
  // §9.6 — homogeneous `show <id>`, matching `goal show` / `workflow show`.
  const builtin = CRONS.find((r) => r.id === id);
  if (builtin) {
    console.log(chalk.bold(`${builtin.emoji} ${builtin.id}`) + chalk.dim("  (built-in cron)"));
    console.log(`  name:    ${builtin.name}`);
    console.log(`  kind:    ${builtin.kind}`);
    console.log(chalk.dim(`  cron:    resolved at scheduler startup from workspace.yaml`));
    return;
  }
  const resolved = resolveOrgDir(opts.org);
  if (!resolved) return;
  const { dir } = resolved;
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
  if (def.at) {
    console.log(`  at:      ${def.at}  ${chalk.dim("(one-shot — runs once, then auto-deletes)")}`);
    console.log(`  in:      ${chalk.dim(relativeFromNow(def.at))}`);
  } else {
    console.log(`  cron:    ${def.cron}  ${chalk.dim(`(${describeSchedule(def.cron)})`)}`);
    if (def.timezone) console.log(`  tz:      ${def.timezone}`);
    const upcoming = nextRuns(def.cron, 5, def.timezone);
    if (upcoming.length) {
      console.log(`  next:    ${chalk.dim(upcoming[0].toLocaleString())}`);
      for (const d of upcoming.slice(1)) console.log(`           ${chalk.dim(d.toLocaleString())}`);
    }
  }
  const recent = await recentRunsAcrossOrgs(def.id, 1);
  if (recent[0]) {
    const r = recent[0];
    const tag = r.status === "ok" ? chalk.green("ok") : r.status === "silent" ? chalk.dim("silent") : chalk.red("error");
    console.log(`  last:    ${tag} ${chalk.dim(new Date(r.finishedAt).toLocaleString())}`);
  }
  if (def.channel) console.log(`  channel: ${def.channel}`);
  const prompt = cronMdPath(def.id, dir);
  const promptExists = promptExistsIn(dir);
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

export async function cronValidateCommand(opts: { org?: string } = {}): Promise<void> {
  const orgs = listOrganizations().filter((o) => !opts.org || o.slug === opts.org);
  const builtinIds = new Set(CRONS.map((r) => r.id));
  let total = 0;
  let failed = 0;
  for (const org of orgs) {
    const dir = getCronsWriteDir(org.slug);
    const defs = loadCronDefs(dir);
    if (defs.length === 0) continue;
    const promptExists = promptExistsIn(dir);
    console.log(chalk.bold(`${org.slug}:`));
    for (const def of defs) {
      total++;
      const result = validateCronDef(def, { reservedIds: builtinIds, promptExists });
      if (result.ok && result.warnings.length === 0) {
        console.log(chalk.green(`  ✓ ${def.id}`));
        continue;
      }
      if (result.ok) {
        console.log(chalk.yellow(`  △ ${def.id} — ${result.warnings.length} warning(s)`));
        for (const w of result.warnings) printIssue(w, "warn");
        continue;
      }
      failed++;
      console.log(chalk.red(`  ✗ ${def.id} — ${result.errors.length} error(s)`));
      for (const e of result.errors) printIssue(e, "error");
      for (const w of result.warnings) printIssue(w, "warn");
    }
  }

  if (total === 0) {
    console.log(chalk.yellow("△ no user crons found (`solosquad cron new <id>`)"));
    process.exitCode = 0;
    return;
  }
  console.log();
  if (failed === 0) {
    console.log(chalk.green(`✓ ${total} cron(s) validated, 0 failed`));
    process.exitCode = 0;
  } else {
    console.log(chalk.red(`✗ ${failed} failed (of ${total})`));
    process.exitCode = 1;
  }
}

/** Aggregate run records for an id (or all) across every org, newest-first. */
async function recentRunsAcrossOrgs(id: string | undefined, limit: number): Promise<import("../cron/cron-runlog.js").CronRunRecord[]> {
  const { loadProducts } = await import("../util/config.js");
  const { getReposBase } = await import("../util/paths.js");
  const { readCronRuns } = await import("../cron/cron-runlog.js");
  const base = getReposBase();
  const all = loadProducts().flatMap((p) => readCronRuns(path.join(base, p.slug), { id }));
  all.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  return all.slice(0, limit);
}

/** `cron runs [ref]` — recent run history (status / when / duration). */
export async function cronRunsCommand(ref: string | undefined, opts: { limit?: string } = {}): Promise<void> {
  let id: string | undefined;
  if (ref) {
    if (BUILTIN_IDS.has(ref)) id = ref;
    else {
      // Run history aggregates across orgs; resolve the ref against every
      // org's crons (org-scoped since v1.3.5 B-D3).
      let resolvedId: string | undefined;
      let ambiguous: string[] | null = null;
      for (const org of listOrganizations()) {
        const r = resolveCronRef(ref, getCronsWriteDir(org.slug));
        if (r.kind === "ok") { resolvedId = r.id; break; }
        if (r.kind === "ambiguous") ambiguous = r.matches;
      }
      if (!resolvedId && ambiguous) {
        console.error(chalk.red(`✗ "${ref}" is ambiguous — matches: ${ambiguous.join(", ")}`));
        process.exitCode = 2;
        return;
      }
      if (!resolvedId) {
        console.error(chalk.red(`✗ no cron "${ref}". Try \`solosquad cron list\`.`));
        process.exitCode = 1;
        return;
      }
      id = resolvedId;
    }
  }
  const limit = Math.max(1, parseInt(opts.limit ?? "20", 10) || 20);
  const runs = await recentRunsAcrossOrgs(id, limit);
  if (runs.length === 0) {
    console.log(chalk.dim(`(no run history${id ? ` for ${id}` : ""} yet)`));
    return;
  }
  const mark = (s: string) => (s === "ok" ? chalk.green("ok") : s === "silent" ? chalk.dim("silent") : chalk.red("error"));
  for (const r of runs) {
    const when = new Date(r.finishedAt).toLocaleString();
    const dur = `${(r.ms / 1000).toFixed(1)}s`;
    const idTag = id ? "" : ` ${chalk.cyan(r.id)}`;
    console.log(`  ${mark(r.status)}${idTag}  ${chalk.dim(when)}  ${chalk.dim(dur)}${r.error ? chalk.red(`  ${r.error}`) : ""}`);
  }
}

/**
 * v1.3.3 §4.3 — `cron freq [--apply <id>]`: review (and optionally apply) the
 * freq miner's keyword-routing suggestions. Suggest-only: nothing is applied
 * without an explicit `--apply`.
 */
export async function cronFreqCommand(opts: { apply?: string } = {}): Promise<void> {
  const { loadProducts } = await import("../util/config.js");
  const { getReposBase } = await import("../util/paths.js");
  const { mineFrequentKeywords, applyKeywordSuggestion } = await import("../cron/freq-keyword-miner.js");
  const base = getReposBase();
  const products = loadProducts();
  if (!products.length) {
    console.log(chalk.red("No products registered. Run: solosquad init"));
    return;
  }

  let any = false;
  for (const p of products) {
    const suggestions = await mineFrequentKeywords({ workspace: base, orgSlug: p.slug });
    if (suggestions.length === 0) continue;
    any = true;
    if (opts.apply) {
      const hit = suggestions.find((s) => s.suggestion_id === opts.apply);
      if (!hit) continue;
      await applyKeywordSuggestion({ workspace: base, orgSlug: p.slug, suggestion: hit });
      console.log(chalk.green(`✓ applied: "${hit.keyword}" → ${hit.target_skill_name} (${p.slug})`));
      return;
    }
    console.log(chalk.bold(`\n${p.name} — ${suggestions.length} routing suggestion(s):`));
    for (const s of suggestions) {
      console.log(`  ${chalk.cyan(s.keyword)} → ${s.target_skill_name}  ${chalk.dim(`(${s.miss_count} misses, id=${s.suggestion_id})`)}`);
    }
  }
  if (opts.apply) {
    console.log(chalk.red(`✗ no suggestion with id "${opts.apply}"`));
    process.exitCode = 1;
  } else if (!any) {
    console.log(chalk.dim("(no routing suggestions — nothing missed ≥3× in 30 days)"));
  } else {
    console.log(chalk.dim(`\nApply one with \`solosquad cron freq --apply <id>\` (never auto-applied).`));
  }
}

function printIssue(issue: CronFinding, kind: "error" | "warn"): void {
  const tag = kind === "error" ? chalk.red("[error]") : chalk.yellow("[warn ]");
  const field = issue.field ? chalk.dim(` (${issue.field})`) : "";
  console.log(`    ${tag} ${issue.code}${field}: ${issue.message}`);
}
