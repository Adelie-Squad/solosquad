import fs from "fs";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  listBackups,
  deleteBackup,
  getBackupRoot,
  type BackupEntry,
} from "../migrations/backup.js";

/**
 * v0.8.4 §7 — `solosquad backup` subgroup.
 *
 * Owns lifecycle management of `~/.solosquad-backups/` — the same directory
 * already used by `migrate` to snapshot pre-migration state. Consolidates
 * three flags that previously lived in different commands:
 *
 *   - `migrate --list-backups`     → `backup list`
 *   - `migrate --delete-backup`    → `backup delete <id>`
 *   - `uninstall --also-purge-backups` → `backup purge`
 *
 * The migrate/uninstall flags still work in v0.8.4 (with deprecation
 * warnings) for a 1-minor compat window. Removed in v1.0.
 */

export interface BackupPurgeOpts {
  keepRecent?: string;
  yes?: boolean;
  dryRun?: boolean;
}

export function backupListCommand(): void {
  const backups = listBackups();
  if (!backups.length) {
    console.log(chalk.dim(`No backups found in ${getBackupRoot()}`));
    return;
  }
  console.log(chalk.bold("\nSoloSquad workspace backups:\n"));
  for (const b of backups) {
    console.log(
      `  ${chalk.cyan(b.id)}  ${chalk.dim("from")} ${b.meta.source_version} ${chalk.dim("→")} ${b.meta.target_version}`,
    );
    console.log(`    ${chalk.dim(b.meta.workspace)}`);
  }
  console.log(chalk.dim(`\nLocation: ${getBackupRoot()}`));
}

export function backupDeleteCommand(id: string | undefined): void {
  if (!id) {
    console.error(chalk.red("error: backup id is required"));
    console.error("usage: solosquad backup delete <id>");
    process.exitCode = 2;
    return;
  }
  const ok = deleteBackup(id);
  console.log(ok ? chalk.green(`✓ Deleted ${id}`) : chalk.red(`✗ Not found: ${id}`));
  if (!ok) process.exitCode = 1;
}

export async function backupPurgeCommand(opts: BackupPurgeOpts): Promise<void> {
  const root = getBackupRoot();
  if (!fs.existsSync(root)) {
    console.log(chalk.dim(`Nothing to purge — ${root} does not exist.`));
    return;
  }

  const keepRecent = parseKeepRecent(opts.keepRecent);
  const allBackups = listBackups();
  let toDelete: BackupEntry[];

  if (keepRecent === null) {
    toDelete = allBackups;
  } else {
    // listBackups sorts newest-first by ISO timestamp prefix.
    toDelete = allBackups.slice(keepRecent);
  }

  if (toDelete.length === 0) {
    if (keepRecent !== null) {
      console.log(
        chalk.dim(`Nothing to purge (have ${allBackups.length}, keeping ${keepRecent}).`),
      );
    } else {
      console.log(chalk.dim("Nothing to purge — backup root is empty."));
    }
    return;
  }

  console.log(chalk.bold(`\nWill remove ${toDelete.length} backup(s) from ${root}:`));
  for (const b of toDelete) {
    console.log(`  ${chalk.dim(b.id)}  (${b.meta.source_version} → ${b.meta.target_version})`);
  }
  if (keepRecent !== null) {
    console.log(chalk.dim(`\nKeeping ${Math.min(keepRecent, allBackups.length)} most-recent.`));
  }

  if (opts.dryRun) {
    console.log(chalk.dim("\n(dry-run) Nothing removed."));
    return;
  }

  if (!opts.yes) {
    const { proceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: keepRecent === null
          ? `Permanently delete ALL ${toDelete.length} backup(s)?`
          : `Permanently delete ${toDelete.length} older backup(s)?`,
        default: false,
      },
    ]);
    if (!proceed) {
      console.log(chalk.dim("Aborted by user."));
      return;
    }
  }

  let removed = 0;
  for (const b of toDelete) {
    if (deleteBackup(b.id)) removed++;
  }
  console.log(chalk.green(`\n✓ Removed ${removed} backup(s).`));

  // If we just emptied the entire root and the user didn't ask to keep any,
  // also tidy up the (now-empty) root directory itself. Match the prior
  // `uninstall --also-purge-backups` behavior.
  if (keepRecent === null && fs.existsSync(root)) {
    try {
      const remaining = fs.readdirSync(root);
      if (remaining.length === 0) {
        fs.rmdirSync(root);
        console.log(chalk.dim(`  Removed empty ${root}`));
      }
    } catch {
      // ignore — non-fatal cleanup
    }
  }
}

function parseKeepRecent(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) {
    console.error(chalk.red("error: --keep-recent expects a non-negative integer"));
    process.exit(2);
  }
  return n;
}

// Re-export for any callers that need to introspect the location.
export { getBackupRoot };
