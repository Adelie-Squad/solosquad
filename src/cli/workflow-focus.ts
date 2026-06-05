import chalk from "chalk";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import { listOrganizations } from "../util/config.js";
import { SessionStore } from "../bot/session-store.js";
import { loadWorkflowSummary } from "../bot/workspace-meta.js";

export interface FocusOpts {
  org?: string;
  user?: string;
  clear?: boolean;
}

/**
 * `solosquad workflow focus <workflow-id>` — set the active workflow for a
 * user's Chief session. The next Chief turn will get a system-prompt hint
 * telling it which workflow context is current. The Chief can also override at
 * runtime by emitting [focus:<wf-id>] in its reply.
 */
export async function workflowFocusCommand(
  workflowId: string | undefined,
  opts: FocusOpts
): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgs = listOrganizations(ws);
  if (orgs.length === 0) {
    console.log(chalk.red("No organizations in this workspace."));
    process.exit(1);
  }
  const sessions = new SessionStore(ws);

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
      console.log(chalk.yellow(`No Chief sessions for org ${orgSlug}.`));
      return;
    }
    if (records.length === 1) userId = records[0].userId;
    else {
      const { pick } = await inquirer.prompt([
        {
          type: "list",
          name: "pick",
          message: "Which user's session should we update?",
          choices: records.map((r) => ({
            name: `${r.userId}  (active=${r.activeWorkflowId ?? "(none)"})`,
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

  if (opts.clear) {
    sessions.setActiveWorkflow(orgSlug, userId, undefined);
    console.log(chalk.green(`✓ Cleared focus for ${userId}@${orgSlug}.`));
    return;
  }

  if (!workflowId) {
    console.log(chalk.red("workflow-id required (or pass --clear)."));
    process.exit(1);
  }

  const wf = loadWorkflowSummary(ws, orgSlug, workflowId);
  if (!wf) {
    console.log(chalk.red(`Workflow not found: ${orgSlug}/${workflowId}`));
    process.exit(1);
  }

  sessions.setActiveWorkflow(orgSlug, userId, workflowId);
  console.log(chalk.green(`✓ Focus set for ${userId}@${orgSlug}: ${workflowId}`));
  if (wf.title) console.log(chalk.dim(`  ${wf.title}`));
  console.log(
    chalk.dim(
      `  Stages: ${wf.completedStages}/${wf.totalStages} completed, ${wf.inProgressStages} in progress`
    )
  );
}
