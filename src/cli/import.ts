import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { fileURLToPath } from "url";
import { importArchive, type ImportReport } from "../lifecycle/import.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * v0.8.1 — `solosquad import <archive.zip>` CLI.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §4.1. Thin wrapper around
 * `importArchive` — argument parsing, --dry-run output formatting, and
 * --replace confirmation prompt live here. The lifecycle module is the
 * single source of truth for *what* happens; this command owns *how it's
 * reported to the user*.
 */

export interface ImportCliOpts {
  workspace?: string;
  into?: string;
  dryRun?: boolean;
  merge?: boolean;
  replace?: boolean;
  yes?: boolean;
}

export async function importCommand(
  archiveArg: string | undefined,
  opts: ImportCliOpts,
): Promise<void> {
  if (!archiveArg) {
    console.error(chalk.red("error: archive path is required"));
    console.error("usage: solosquad import <archive.zip> [--workspace <path>] [--into <org>] [--dry-run] [--merge | --replace]");
    process.exitCode = 2;
    return;
  }

  const archivePath = path.resolve(archiveArg);
  if (!fs.existsSync(archivePath)) {
    console.error(chalk.red(`error: archive not found at ${archivePath}`));
    process.exitCode = 2;
    return;
  }

  if (opts.merge && opts.replace) {
    console.error(chalk.red("error: --merge and --replace are mutually exclusive"));
    process.exitCode = 2;
    return;
  }

  const mode: "merge" | "replace" = opts.replace ? "replace" : "merge";
  const dryRun = Boolean(opts.dryRun);

  // Workspace resolution: explicit --workspace > CWD if it already looks like
  // a workspace > a new folder named after the archive's workspace_slug
  // beside CWD (created lazily).
  const workspace = await resolveWorkspace(opts.workspace, archivePath);

  if (mode === "replace" && !dryRun && !opts.yes) {
    const { proceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: `Replace existing org content under ${workspace}? This overwrites conflicting workflows/goals/memory.`,
        default: false,
      },
    ]);
    if (!proceed) {
      console.log(chalk.dim("Aborted by user."));
      return;
    }
  }

  console.log(chalk.bold(`\nSoloSquad import — archive: ${archivePath}`));
  console.log(chalk.dim(`  Workspace : ${workspace}`));
  console.log(chalk.dim(`  Mode      : ${dryRun ? "DRY-RUN" : mode.toUpperCase()}`));
  if (opts.into) console.log(chalk.dim(`  --into    : ${opts.into}`));

  const cliVersion = readCliVersion();
  let report: ImportReport;
  try {
    report = await importArchive({
      archivePath,
      workspace,
      cliVersion,
      into: opts.into,
      dryRun,
      mode,
    });
  } catch (e) {
    console.error(chalk.red(`\n✗ import failed: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }

  printReport(report, { dryRun, mode });

  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function resolveWorkspace(
  explicit: string | undefined,
  archivePath: string,
): Promise<string> {
  if (explicit) {
    const abs = path.resolve(explicit);
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  }
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, ".solosquad"))) {
    return cwd;
  }
  // New workspace: derive from archive name (best-effort) or fall back to "imported-workspace".
  const base = path.basename(archivePath, ".zip");
  // typical pattern: solosquad-archive-<slug>-<ts>
  const m = /^solosquad-archive-(.+?)-\d{4}-\d{2}-\d{2}/.exec(base);
  const slug = m ? m[1] : "imported-workspace";
  const target = path.join(cwd, slug);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function printReport(report: ImportReport, ctx: { dryRun: boolean; mode: string }): void {
  console.log("");
  console.log(chalk.bold("Archive metadata:"));
  console.log(`  export_ts         : ${report.archiveYaml.export_ts}`);
  console.log(`  solosquad_version : ${report.archiveYaml.solosquad_version}`);
  console.log(`  workspace_slug    : ${report.archiveYaml.workspace_slug}`);
  console.log(`  archive_format    : ${report.archiveYaml.archive_format}`);
  console.log(`  included_orgs     : ${report.includedOrgs.join(", ") || "(none)"}`);

  console.log("");
  console.log(chalk.bold("Verify:"));
  console.log(`  schema_version    : ${report.verify.schemaVersion}`);
  console.log(`  manifest entries  : ${report.verify.manifestRows}`);
  console.log(`  archive entries   : ${report.verify.archiveRows}`);
  if (report.verify.shaMismatches.length > 0) {
    console.log(chalk.red(`  ✗ ${report.verify.shaMismatches.length} SHA mismatch(es)`));
    for (const m of report.verify.shaMismatches.slice(0, 5)) {
      console.log(chalk.dim(`    - ${m.path}`));
    }
  }
  if (!report.verify.schemaCompat.ok) {
    console.log(chalk.red("  ✗ schema compat:"));
    for (const r of report.verify.schemaCompat.reasons) console.log(chalk.dim(`    - ${r}`));
  } else {
    console.log(chalk.green(`  ✓ schema compat OK`));
  }

  if (report.idConflicts.length > 0) {
    console.log("");
    console.log(chalk.bold("ID conflicts (workflows/goals):"));
    for (const c of report.idConflicts) {
      console.log(`  org ${c.org}:`);
      for (const id of c.workflowConflicts) console.log(chalk.yellow(`    workflow ${id}`));
      for (const id of c.goalConflicts) console.log(chalk.yellow(`    goal     ${id}`));
    }
    if (ctx.mode === "merge") {
      console.log(chalk.dim("  --merge refuses to overwrite. Rename archive-side or rerun with --replace."));
    }
  }

  console.log("");
  console.log(chalk.bold("Plan:"));
  for (const [k, v] of Object.entries(report.summary)) {
    if (v > 0) console.log(`  ${k.padEnd(16)} ${v}`);
  }

  if (report.repoCloneTargets.length > 0) {
    console.log("");
    console.log(chalk.bold("Repo source code (NOT in archive — class A policy):"));
    for (const t of report.repoCloneTargets) {
      console.log(chalk.dim(`  - ${t.org}/${t.repo} → restore via git clone, then place at ${path.dirname(path.dirname(t.repoYamlPath))}`));
    }
  }

  console.log("");
  if (ctx.dryRun) {
    console.log(chalk.cyan("Dry-run complete — no disk changes were made."));
    console.log(chalk.dim("Re-run without --dry-run to apply, optionally with --replace to overwrite id conflicts."));
  } else if (report.ok) {
    console.log(chalk.green(`✓ Import complete (runId ${report.runId})`));
  } else {
    console.log(chalk.red(`✗ Import finished with ${report.errors.length} error(s):`));
    for (const e of report.errors) console.log(chalk.dim(`  - ${e}`));
  }
}

function readCliVersion(): string {
  let pkgPath = path.resolve(__dirname, "..", "..", "package.json");
  if (!fs.existsSync(pkgPath)) {
    pkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
