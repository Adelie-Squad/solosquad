import chalk from "chalk";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import { runMigration } from "../migrations/runner.js";
import { listBackups, restoreBackup, deleteBackup, getBackupRoot } from "../migrations/backup.js";

const CLI_VERSION_TARGET = "1.2.2";

export interface MigrateCliOpts {
  apply?: boolean;
  rollback?: boolean;
  listBackups?: boolean;
  deleteBackup?: string;
  to?: string;
}

export async function migrateCommand(opts: MigrateCliOpts): Promise<void> {
  if (opts.listBackups) {
    listBackupsCommand();
    return;
  }
  if (opts.deleteBackup) {
    const ok = deleteBackup(opts.deleteBackup);
    console.log(ok ? chalk.green(`✓ Deleted ${opts.deleteBackup}`) : chalk.red(`✗ Not found: ${opts.deleteBackup}`));
    return;
  }
  if (opts.rollback) {
    await rollbackCommand();
    return;
  }

  const workspace = getWorkspaceRoot();
  const target = opts.to ?? CLI_VERSION_TARGET;
  const dryRun = !opts.apply;

  const result = await runMigration({ workspace, targetVersion: target, dryRun });

  if (!result.success) {
    console.log(chalk.red(`\n✗ Migration failed: ${result.error}`));
    if (result.backupPath) {
      console.log(chalk.dim(`  Backup preserved at: ${result.backupPath}`));
      console.log(chalk.dim(`  Run: solosquad migrate --rollback`));
    }
    process.exit(1);
  }

  if (!dryRun && result.chain.length > 0) {
    console.log(chalk.green.bold(`\n✓ Migration complete (${result.sourceVersion} → ${result.targetVersion}).`));
    console.log(chalk.dim(`Backup: ${result.backupPath}`));
    console.log("\nNext steps:");
    console.log("  1. solosquad doctor");
    console.log("  2. cd <your-org> && git clone <your-repos>   (if you have repos)");
    console.log("  3. solosquad sync   (register repos in .org.yaml)");
    console.log("  4. solosquad bot    (start the bot)");
    console.log(chalk.dim("\nIf something looks wrong: solosquad migrate --rollback"));
  }
}

function listBackupsCommand(): void {
  const backups = listBackups();
  if (!backups.length) {
    console.log(chalk.dim(`No backups found in ${getBackupRoot()}`));
    return;
  }
  console.log(chalk.bold("\nSoloSquad workspace backups:\n"));
  for (const b of backups) {
    console.log(
      `  ${chalk.cyan(b.id)}  ${chalk.dim("from")} ${b.meta.source_version} ${chalk.dim("→")} ${b.meta.target_version}`
    );
    console.log(`    ${chalk.dim(b.meta.workspace)}`);
  }
  console.log(chalk.dim(`\nLocation: ${getBackupRoot()}`));
}

async function rollbackCommand(): Promise<void> {
  const workspace = getWorkspaceRoot();
  const backups = listBackups().filter((b) => b.meta.workspace === workspace);

  if (!backups.length) {
    console.log(chalk.yellow(`No backups available for workspace: ${workspace}`));
    return;
  }

  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "Which backup should we restore?",
      choices: backups.map((b) => ({
        name: `${b.id}  (${b.meta.source_version} → ${b.meta.target_version})`,
        value: b.id,
      })),
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `This will overwrite ${workspace} with the backup. Continue?`,
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim("Rollback cancelled."));
    return;
  }

  const target = backups.find((b) => b.id === choice);
  if (!target) {
    console.log(chalk.red("Selected backup missing."));
    return;
  }

  restoreBackup(target.path, workspace);
  console.log(chalk.green(`\n✓ Restored workspace to state at ${target.id} (v${target.meta.source_version}).`));
  console.log(chalk.yellow("\nNote: if the installed CLI is newer than the restored workspace version,"));
  console.log(chalk.yellow("      downgrade with: npm install -g solosquad@" + target.meta.source_version));
}
