import chalk from "chalk";
import { detectWorkspaceVersion } from "./detect.js";
import { resolveChain } from "./index.js";
import { createBackup } from "./backup.js";
import type { MigrationPlan } from "./types.js";

export interface MigrateOptions {
  workspace: string;
  targetVersion: string;
  dryRun: boolean;
  verbose?: boolean;
}

export interface MigrateResult {
  success: boolean;
  sourceVersion: string;
  targetVersion: string;
  chain: string[];
  backupPath?: string;
  error?: string;
}

function printPlan(
  migrationFrom: string,
  migrationTo: string,
  plan: MigrationPlan
): void {
  console.log(chalk.bold(`\nMigration ${migrationFrom} → ${migrationTo}:`));
  for (const step of plan.steps) {
    const marker = step.kind === "note" ? chalk.dim("·") : chalk.green("✓");
    const head = step.from && step.to ? `${step.from} → ${step.to}` : step.description;
    console.log(`  ${marker} ${head}`);
    if (step.kind !== "note" && step.from && step.to && step.description !== head) {
      console.log(`      ${chalk.dim(step.description)}`);
    }
  }
  if (plan.warnings.length) {
    console.log(chalk.yellow("\n  Warnings:"));
    for (const w of plan.warnings) console.log(`    ⚠ ${w}`);
  }
  if (plan.irreversible_changes.length) {
    console.log(chalk.yellow("\n  Irreversible changes:"));
    for (const c of plan.irreversible_changes) console.log(`    ! ${c}`);
  }
  console.log(
    chalk.dim(
      `\n  Estimated disk delta: ${plan.estimated_disk_delta_mb >= 0 ? "+" : ""}${plan.estimated_disk_delta_mb.toFixed(1)} MB`
    )
  );
}

export async function runMigration(opts: MigrateOptions): Promise<MigrateResult> {
  const source = detectWorkspaceVersion(opts.workspace);
  if (!source) {
    return {
      success: false,
      sourceVersion: "unknown",
      targetVersion: opts.targetVersion,
      chain: [],
      error: "Workspace structure not recognized as SoloSquad (no .solosquad/, agents/, etc.)",
    };
  }

  if (source === opts.targetVersion) {
    console.log(
      chalk.green(`✓ Workspace is already at ${source}. Nothing to migrate.`)
    );
    return {
      success: true,
      sourceVersion: source,
      targetVersion: opts.targetVersion,
      chain: [],
    };
  }

  let chain;
  try {
    chain = resolveChain(source, opts.targetVersion);
  } catch (e) {
    return {
      success: false,
      sourceVersion: source,
      targetVersion: opts.targetVersion,
      chain: [],
      error: (e as Error).message,
    };
  }

  console.log(chalk.bold(`Workspace: ${opts.workspace}`));
  console.log(`Detected structure: ${source}  (source)`);
  console.log(`Target version:     ${opts.targetVersion}`);

  const plans: { from: string; to: string; plan: MigrationPlan }[] = [];
  for (const m of chain) {
    const plan = await m.plan(opts.workspace);
    plans.push({ from: m.from, to: m.to, plan });
    printPlan(m.from, m.to, plan);
  }

  if (opts.dryRun) {
    console.log(chalk.dim("\nNothing written yet. Re-run with `--apply` to perform the migration."));
    return {
      success: true,
      sourceVersion: source,
      targetVersion: opts.targetVersion,
      chain: chain.map((m) => `${m.from} → ${m.to}`),
    };
  }

  const backupPath = createBackup(
    opts.workspace,
    source,
    opts.targetVersion,
    chain.map((m) => `${m.from} → ${m.to}`)
  );
  console.log(chalk.dim(`\nBackup: ${backupPath}`));

  let stepNum = 0;
  for (const m of chain) {
    stepNum++;
    console.log(
      chalk.bold(`\n[${stepNum}/${chain.length}] Applying ${m.from} → ${m.to} ...`)
    );
    try {
      const plan = plans[stepNum - 1].plan;
      await m.apply(opts.workspace, plan);
      const verify = await m.verify(opts.workspace);
      if (!verify.ok) {
        return {
          success: false,
          sourceVersion: source,
          targetVersion: opts.targetVersion,
          chain: chain.map((x) => `${x.from} → ${x.to}`),
          backupPath,
          error: `Verify failed at ${m.to}: ${verify.error ?? "unknown"}`,
        };
      }
      console.log(chalk.green("    ✓ applied + verified"));
    } catch (e) {
      return {
        success: false,
        sourceVersion: source,
        targetVersion: opts.targetVersion,
        chain: chain.map((x) => `${x.from} → ${x.to}`),
        backupPath,
        error: `Step ${m.from} → ${m.to} threw: ${(e as Error).message}`,
      };
    }
  }

  return {
    success: true,
    sourceVersion: source,
    targetVersion: opts.targetVersion,
    chain: chain.map((m) => `${m.from} → ${m.to}`),
    backupPath,
  };
}
