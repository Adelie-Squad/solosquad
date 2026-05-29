import chalk from "chalk";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import { runMigration } from "../migrations/runner.js";
import { listBackups, restoreBackup, deleteBackup, getBackupRoot } from "../migrations/backup.js";
import { warnDeprecated } from "../util/deprecation.js";
import { SOLOSQUAD_VERSION } from "../util/version.js";

/**
 * v0.8.6 — Migration target is the CLI version, read dynamically from
 * package.json via `src/util/version.ts`. Prior to v0.8.6 this was hardcoded
 * to "0.4.0", silently no-op'ing `solosquad migrate` for every release after
 * v0.4 unless the user passed `--to` explicitly. Same regression class as the
 * v0.8.5 init.ts SOLOSQUAD_VERSION fix.
 */
const CLI_VERSION_TARGET = SOLOSQUAD_VERSION;

export interface MigrateCliOpts {
  dryRun?: boolean;
  apply?: boolean;
  rollback?: boolean;
  listBackups?: boolean;
  deleteBackup?: string;
  to?: string;
}

export async function migrateCommand(opts: MigrateCliOpts): Promise<void> {
  if (opts.listBackups) {
    warnDeprecated({ oldName: "--list-backups", newName: "solosquad backup list" });
    listBackupsCommand();
    return;
  }
  if (opts.deleteBackup) {
    warnDeprecated({ oldName: "--delete-backup", newName: "solosquad backup delete <id>" });
    const ok = deleteBackup(opts.deleteBackup);
    console.log(ok ? chalk.green(`✓ Deleted ${opts.deleteBackup}`) : chalk.red(`✗ Not found: ${opts.deleteBackup}`));
    return;
  }
  if (opts.rollback) {
    await rollbackCommand();
    return;
  }

  if (opts.apply && opts.dryRun) {
    console.log(chalk.red("✗ --dry-run 과 --apply 를 동시에 쓸 수 없습니다."));
    process.exit(1);
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

    // v1.2.8 §A.10 — if a `solosquad bot` is running, signal it so it
    // reloads with the new on-disk code. Cloud users with PM2 / systemd /
    // Docker auto-restart on SIGTERM. Local users with `solosquad bot
    // --supervise` auto-respawn. Plain local users still need to re-run
    // `solosquad bot` manually, but at least the running instance dies
    // cleanly instead of using stale code.
    try {
      const { signalBotRestart } = await import("../util/bot-pidfile.js");
      const r = signalBotRestart();
      if (r.kind === "signaled") {
        console.log(
          chalk.green(
            `\n✓ Signalled running bot (PID ${r.pid}) to restart with the new code.`,
          ),
        );
        console.log(
          chalk.dim(
            "  Cloud (PM2/systemd/Docker) will auto-respawn. Local: re-run `solosquad bot` if you didn't use --supervise.",
          ),
        );
      } else if (r.kind === "error" && r.pid) {
        console.log(
          chalk.yellow(
            `\n⚠ Failed to signal bot PID ${r.pid}: ${r.message ?? "unknown error"}`,
          ),
        );
        console.log(
          chalk.dim(
            "  You may need to stop the bot manually so it picks up the new code.",
          ),
        );
      }
      // r.kind === "not-running": no message — most users aren't running
      // the bot during a migration. Quiet success.
    } catch (err) {
      console.log(
        chalk.dim(
          `\n(skip bot restart signal: ${err instanceof Error ? err.message : String(err)})`,
        ),
      );
    }
    console.log("\nNext steps:");
    console.log("  1. solosquad doctor                                 # general environment check");
    console.log("  2. solosquad doctor --discord                       # Discord-specific 5-hop diagnostic (v1.2+)");
    console.log("  3. solosquad bot                                    # start the bot");
    console.log("");
    console.log(chalk.dim("  (Optional) Register additional repos using v1.0+ path-reference mode:"));
    console.log(chalk.dim("     git clone <url> <your-local-path>      # cloning happens OUTSIDE the workspace"));
    console.log(chalk.dim("     solosquad add repo <your-local-path>   # register the local path (no move, no copy)"));
    console.log(chalk.dim("     # v1.2.7+: Chief can also do this for you via conversation — \"X repo 클론해서 추가해줘\"."));
    console.log("");
    console.log(chalk.dim("If something looks wrong: solosquad migrate --rollback"));
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
