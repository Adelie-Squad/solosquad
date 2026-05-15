import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getEnvPath, getWorkspaceRoot } from "../util/paths.js";
import { maskEnvFile } from "../util/secrets.js";
import {
  collectRevokeData,
  renderRevokeChecklist,
} from "../lifecycle/revoke-checklist.js";
import { acquireLock, logoutLockPath, LockHeldError } from "../lifecycle/lockfile.js";
import { _precheckInternals } from "../lifecycle/precheck.js";

/**
 * v0.7 — `solosquad logout` lightweight session/credential clear.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §5.6 + P2 #11.
 *
 *  - Masks `.env` in place (token values redacted, variable keys preserved)
 *  - Writes REVOKE-CHECKLIST.md to workspace root
 *  - Moves `.solosquad/sessions/*.json` to `.solosquad/sessions/_archived/`
 *  - Drops `logout.lock` so subsequent `solosquad bot/schedule/pm` calls
 *    refuse to start until the user explicitly removes it.
 *
 * Does not archive. Does not touch workflows/memory/knowledge.
 */

export interface LogoutOpts {
  org?: string;
  all?: boolean;
  yes?: boolean;
  force?: boolean;
}

export async function logoutCommand(opts: LogoutOpts): Promise<void> {
  const workspace = getWorkspaceRoot();
  if (!fs.existsSync(path.join(workspace, ".solosquad"))) {
    console.log(chalk.red("✗ No SoloSquad workspace found at " + workspace));
    process.exit(1);
  }

  console.log(chalk.bold(`\nSoloSquad logout — workspace: ${workspace}`));

  // 1. Live process check
  const livePids = _precheckInternals.detectLivePids();
  if (livePids.length > 0 && !opts.force) {
    console.log(chalk.red(
      `\n✗ solosquad bot/schedule appears to be running (pid ${livePids.join(", ")}).\n` +
      "  Stop these processes first, or rerun with --force.\n" +
      "  Reason: masked .env will cause the bot to fail auth on the next cron tick.",
    ));
    process.exit(1);
  } else if (livePids.length > 0) {
    console.log(chalk.yellow(`  ⚠ --force overrides ${livePids.length} live process(es).`));
  }

  // 2. Confirm prompt
  if (!opts.yes) {
    const { proceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: "Mask .env secrets and archive session mappings? (no data is deleted)",
        default: false,
      },
    ]);
    if (!proceed) {
      console.log(chalk.dim("Aborted by user."));
      process.exit(0);
    }
  }

  // 3. Mask .env
  const envPath = path.join(workspace, ".solosquad", ".env");
  const envExists = fs.existsSync(envPath) ? envPath : getEnvPath(workspace);
  if (fs.existsSync(envExists)) {
    const result = maskEnvFile(envExists);
    console.log(chalk.green(`  ✓ .env masked: ${result.redactedKeys.length} secret(s) redacted (${envExists})`));
    if (result.redactedKeys.length > 0) {
      console.log(chalk.dim(`    Keys: ${result.redactedKeys.join(", ")}`));
    }
  } else {
    console.log(chalk.dim("  · .env not found — skipping mask."));
  }

  // 4. Write REVOKE-CHECKLIST.md
  const revokeData = collectRevokeData(workspace);
  const revokeChecklist = renderRevokeChecklist(revokeData);
  fs.writeFileSync(path.join(workspace, "REVOKE-CHECKLIST.md"), revokeChecklist);
  console.log(chalk.green(`  ✓ REVOKE-CHECKLIST.md written to ${workspace}`));

  // 5. Archive session mappings
  const archivedTotal = archiveSessionsForOrgs(workspace, opts);
  if (archivedTotal > 0) {
    console.log(chalk.green(`  ✓ ${archivedTotal} session mapping(s) moved to _archived/`));
  }

  // 6. Drop logout.lock so subsequent bot/schedule refuse to start
  try {
    acquireLock(logoutLockPath(workspace), { clearStale: false });
    console.log(chalk.green(`  ✓ logout.lock created — solosquad bot/schedule will refuse to start`));
  } catch (err) {
    if (err instanceof LockHeldError) {
      console.log(chalk.dim("  · logout.lock already present — no change."));
    } else {
      throw err;
    }
  }

  console.log("");
  console.log(chalk.bold("Next steps:"));
  console.log(`  1. Review REVOKE-CHECKLIST.md for server-side token revoke`);
  console.log(`  2. To restart: remove ${logoutLockPath(workspace)} and refresh .env values`);
  console.log("");
}

function archiveSessionsForOrgs(workspace: string, opts: LogoutOpts): number {
  let total = 0;
  // workspace-level sessions
  total += archiveSessionsIn(path.join(workspace, ".solosquad", "sessions"));
  // per-org sessions
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (opts.org && !opts.all && entry.name !== opts.org) continue;
    total += archiveSessionsIn(path.join(workspace, entry.name, ".solosquad", "sessions"));
  }
  return total;
}

function archiveSessionsIn(sessionsDir: string): number {
  if (!fs.existsSync(sessionsDir)) return 0;
  const archived = path.join(sessionsDir, "_archived");
  fs.mkdirSync(archived, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const src = path.join(sessionsDir, entry.name);
    const dest = path.join(archived, entry.name);
    try {
      fs.renameSync(src, dest);
      count++;
    } catch {
      // ignore
    }
  }
  return count;
}
