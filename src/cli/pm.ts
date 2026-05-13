import chalk from "chalk";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import { listOrganizations } from "../util/config.js";
import { SessionStore } from "../bot/session-store.js";
import { FileEventSink, pmEventsPath } from "../bot/events.js";

export interface PmStatusOpts {
  org?: string;
}

/** `solosquad pm status` — list active sessions + cost + activity. */
export async function pmStatusCommand(opts: PmStatusOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const sessions = new SessionStore(ws);
  const orgs = listOrganizations(ws).filter((o) => !opts.org || o.slug === opts.org);

  if (orgs.length === 0) {
    console.log(chalk.dim("No organizations match the filter."));
    return;
  }

  console.log(chalk.bold("\nPM sessions:\n"));
  let totalSessions = 0;
  let totalCost = 0;
  for (const org of orgs) {
    const records = sessions.listForOrg(org.slug);
    if (records.length === 0) {
      console.log(chalk.dim(`  ${org.slug}: (no PM sessions yet)`));
      continue;
    }
    console.log(chalk.cyan(`  ${org.slug}:`));
    for (const rec of records) {
      const last = rec.lastInteractionAt.replace("T", " ").slice(0, 19);
      const arch = rec.archived?.length ? ` archived×${rec.archived.length}` : "";
      const wf = rec.activeWorkflowId ? chalk.magenta(` wf=${rec.activeWorkflowId}`) : "";
      console.log(
        `    ${chalk.bold(rec.userId)}  ${chalk.dim("session=")}${rec.sessionId.slice(0, 8)}…  ` +
          `${chalk.dim("last=")}${last}  ` +
          `${chalk.green("$" + rec.totalCostUsd.toFixed(4))}` +
          wf +
          chalk.dim(arch)
      );
      totalSessions++;
      totalCost += rec.totalCostUsd;
    }
  }
  console.log();
  console.log(chalk.dim(`  Total: ${totalSessions} session(s), $${totalCost.toFixed(4)} cumulative cost`));
  console.log();
}

export interface PmResetOpts {
  org?: string;
  user?: string;
  reason?: string;
  yes?: boolean;
}

/** `solosquad pm reset` — archive existing session, mint a new id. */
export async function pmResetCommand(opts: PmResetOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const sessions = new SessionStore(ws);
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

  let userId = opts.user;
  const records = sessions.listForOrg(orgSlug);
  if (!userId) {
    if (records.length === 0) {
      console.log(chalk.yellow(`No PM sessions for org ${orgSlug}.`));
      return;
    }
    if (records.length === 1) userId = records[0].userId;
    else {
      const { pick } = await inquirer.prompt([
        {
          type: "list",
          name: "pick",
          message: "Which user's session should we reset?",
          choices: records.map((r) => ({
            name: `${r.userId}  (last=${r.lastInteractionAt.slice(0, 19)}, $${r.totalCostUsd.toFixed(4)})`,
            value: r.userId,
          })),
        },
      ]);
      userId = pick;
    }
  }
  if (!userId) {
    console.log(chalk.red("User selection required."));
    process.exit(1);
  }

  const reason = opts.reason ?? "user-requested";

  if (!opts.yes) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Archive PM session for ${userId}@${orgSlug} (reason: "${reason}") and mint a new one?`,
        default: false,
      },
    ]);
    if (!confirm) {
      console.log(chalk.dim("Cancelled."));
      return;
    }
  }

  const { previous, next } = sessions.rotate(orgSlug, userId, reason);

  // Record the rotation in the PM events log too.
  const sink = new FileEventSink(pmEventsPath(ws, orgSlug, userId));
  sink.append({
    ts: new Date().toISOString(),
    kind: "pm.session_rotated",
    oldSessionId: previous ?? "(none)",
    newSessionId: next,
    reason,
    userId,
  });

  console.log(chalk.green(`✓ Rotated PM session for ${userId}@${orgSlug}.`));
  console.log(chalk.dim(`  previous: ${previous ?? "(none)"}`));
  console.log(chalk.dim(`  next:     ${next}`));
}

/** `solosquad pm compact` — manual trigger for the pm-compaction routine. */
export async function pmCompactCommand(_opts: { org?: string }): Promise<void> {
  // Phase B placeholder — full routine ships with `pm-compaction.md` integration.
  // For 1.2.5 we just point users at the routine command.
  console.log(
    chalk.yellow(
      "pm-compaction is delivered as a scheduled routine. To trigger it manually now, run:"
    )
  );
  console.log(chalk.cyan("  solosquad run-routine pm-compaction"));
}
