import chalk from "chalk";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import { listOrganizations } from "../util/config.js";
import { listSnapshots, revertToSnapshot } from "../bot/git-snapshot.js";

export interface RollbackOpts {
  workflow?: string;
  org?: string;
  to?: string;
  list?: boolean;
  yes?: boolean;
}

/**
 * `solosquad rollback`
 *   --list                     : show the snapshot history for the org
 *   --workflow <id>            : revert to the snapshot taken just before
 *                                the most recent spawn for that workflow
 *   --workflow <id> --to <sha> : revert to a specific snapshot SHA
 *
 * Only touches <org>/memory/ + <org>/workflows/. Repo code is untouched.
 */
export async function rollbackCommand(opts: RollbackOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgs = listOrganizations(ws);
  if (orgs.length === 0) {
    console.log(chalk.red("No organizations in this workspace."));
    process.exit(1);
  }

  let orgSlug = opts.org;
  if (!orgSlug) {
    if (orgs.length === 1) orgSlug = orgs[0].slug;
    else {
      const { pick } = await inquirer.prompt([
        {
          type: "list",
          name: "pick",
          message: "Which organization?",
          choices: orgs.map((o) => ({ name: o.slug, value: o.slug })),
        },
      ]);
      orgSlug = pick;
    }
  }
  if (!orgSlug) {
    console.log(chalk.red("Org selection required."));
    process.exit(1);
  }

  if (opts.list) {
    listSnapshotHistory(ws, orgSlug);
    return;
  }

  const snapshots = listSnapshots(ws, orgSlug, 50);
  if (snapshots.length === 0) {
    console.log(chalk.yellow(`No snapshot history for ${orgSlug}. Has the bot run yet?`));
    return;
  }

  let targetSha = opts.to;
  if (!targetSha) {
    // Pick the most recent pre-spawn commit. Convention: snapshots created
    // by chief-runner have subject prefixes like "before-spawn: ..." or
    // "after-spawn: ...". We pick the most recent "before-spawn" (one step
    // older than the latest record).
    const candidates = opts.workflow
      ? snapshots.filter((s) => s.subject.includes(opts.workflow as string))
      : snapshots;
    const beforeSpawn = candidates.find((s) => s.subject.startsWith("before-spawn:"));
    if (!beforeSpawn) {
      console.log(chalk.yellow("No pre-spawn snapshot found. Run with --to <sha> to pick manually:"));
      listSnapshotHistory(ws, orgSlug);
      return;
    }
    targetSha = beforeSpawn.sha;
  }

  const target = snapshots.find((s) => s.sha === targetSha || s.sha.startsWith(targetSha));
  if (!target) {
    console.log(chalk.red(`Snapshot ${targetSha} not found in history.`));
    process.exit(1);
  }

  if (!opts.yes) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Revert ${orgSlug}/memory + ${orgSlug}/workflows to ${target.sha.slice(0, 8)} ("${target.subject}")? Repos are untouched.`,
        default: false,
      },
    ]);
    if (!confirm) {
      console.log(chalk.dim("Cancelled."));
      return;
    }
  }

  const result = revertToSnapshot(
    ws,
    orgSlug,
    target.sha,
    opts.workflow ? `workflow ${opts.workflow}` : "manual rollback"
  );
  if (!result.ok) {
    console.log(chalk.red(`Rollback failed: ${result.error}`));
    process.exit(1);
  }
  console.log(
    chalk.green(`✓ Reverted ${orgSlug} memory + workflows to ${target.sha.slice(0, 8)}`)
  );
  if (result.newSha) {
    console.log(chalk.dim(`  New snapshot HEAD: ${result.newSha.slice(0, 12)}`));
  }
  console.log(
    chalk.dim(
      "  Note: Chief session is unchanged — start the next message with context about the rollback."
    )
  );
}

function listSnapshotHistory(ws: string, orgSlug: string): void {
  const entries = listSnapshots(ws, orgSlug, 30);
  if (entries.length === 0) {
    console.log(chalk.dim(`No snapshots for ${orgSlug}.`));
    return;
  }
  console.log(chalk.bold(`\nSnapshot history (${orgSlug}):\n`));
  for (const e of entries) {
    const subj =
      e.subject.length > 80 ? e.subject.slice(0, 77) + "…" : e.subject;
    console.log(`  ${chalk.cyan(e.sha.slice(0, 8))}  ${chalk.dim(e.ts.slice(0, 19))}  ${subj}`);
  }
  console.log();
}
