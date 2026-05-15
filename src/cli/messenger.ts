import chalk from "chalk";
import { handoverBroadcast } from "../messenger/broadcast.js";
import { listOrganizations } from "../util/config.js";
import { listUserYamls } from "../bot/user-registry.js";
import { getWorkspaceRoot } from "../util/paths.js";

/**
 * v0.8 §3.6 — `solosquad messenger broadcast-handover --to <handle>`.
 *
 * Reassigns the broadcast-eligible bot to a new user handle. The CLI verifies
 * that the target handle exists in *some* org's user registry before stamping
 * workspace.yaml; otherwise the handover silently elects a non-existent bot.
 */
export interface BroadcastHandoverOptions {
  to: string;
  enable?: boolean;
}

export async function broadcastHandoverCommand(
  opts: BroadcastHandoverOptions,
): Promise<void> {
  const workspace = getWorkspaceRoot();
  const toHandle = opts.to.trim().toLowerCase();
  if (!toHandle) {
    console.log(chalk.red("✗ --to <handle> is required."));
    process.exitCode = 1;
    return;
  }

  // Sanity check — target handle must be registered somewhere in the workspace.
  const orgs = listOrganizations(workspace);
  let found = false;
  for (const o of orgs) {
    if (listUserYamls(o.slug, workspace).some((u) => u.handle === toHandle)) {
      found = true;
      break;
    }
  }
  if (!found) {
    console.log(
      chalk.red(
        `✗ Handle "${toHandle}" is not registered in any org under this workspace.`,
      ),
    );
    console.log(
      chalk.dim(
        "  Run `solosquad init` on the target user's machine first, then re-run this command.",
      ),
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = handoverBroadcast({
      toHandle,
      workspace,
      enable: opts.enable === true,
    });
    console.log(
      chalk.green(
        `✓ Broadcast designation: ${result.previous ?? "(none)"} → ${result.next}`,
      ),
    );
    console.log(
      chalk.dim(
        `  broadcast_enabled=${result.enabled} — workspace.yaml stamped.`,
      ),
    );
    if (!result.enabled) {
      console.log(
        chalk.yellow(
          "  Tip: pass --enable to also flip broadcast_enabled: true.",
        ),
      );
    }
  } catch (err) {
    console.log(
      chalk.red(
        `✗ ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    process.exitCode = 1;
  }
}
