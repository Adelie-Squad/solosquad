import chalk from "chalk";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import { listAllUsers } from "../bot/user-registry.js";
import {
  buildInviteUrl,
  DEFAULT_PERMISSIONS_BITFIELD,
  openInBrowser,
} from "../messenger/discord-invite-url.js";

export interface InviteUrlOpts {
  /** Override the auto-detected application_client_id (e.g. CI). */
  clientId?: string;
  /** Skip browser-open — print URL only. */
  printOnly?: boolean;
  /** Restrict to one org when the workspace has many. */
  org?: string;
}

/**
 * v1.2 §3.1 — `solosquad discord invite-url`. Synthesizes the OAuth invite
 * URL from `user.yaml.bot_application_id` + the v1.2 §4.2 permissions
 * bitfield, prints it, and (unless `--print-only`) opens it in the default
 * browser. The URL is always printed regardless of browser-open success so
 * the user can copy it manually.
 *
 * Source-of-truth for `application_client_id`:
 *   1. `--client-id <id>` flag — explicit override.
 *   2. Walk `<workspace>/<org>/.solosquad/users/*.yaml`. If exactly one
 *      `bot_application_id` is found, use it. If multiple orgs / handles
 *      report different ids, refuse and ask the user to disambiguate with
 *      `--org` or `--client-id`.
 */
export async function inviteUrlCommand(opts: InviteUrlOpts): Promise<void> {
  let clientId = opts.clientId?.trim();

  if (!clientId) {
    const workspace = getWorkspaceRoot();
    const users = listAllUsers(workspace);
    let candidates = users
      .filter((u) => u.user.messenger === "discord")
      .filter((u) => !opts.org || u.orgSlug === opts.org)
      .map((u) => ({
        org: u.orgSlug,
        handle: u.user.handle,
        appId: u.user.bot_application_id,
      }))
      .filter((u): u is { org: string; handle: string; appId: string } =>
        typeof u.appId === "string" && u.appId.length > 0,
      );

    const unique = Array.from(new Set(candidates.map((c) => c.appId)));
    if (unique.length === 0) {
      console.log(
        chalk.red(
          "✗ No `bot_application_id` found in any Discord user.yaml.",
        ),
      );
      console.log(
        chalk.dim(
          "  Run `solosquad init` (or `solosquad doctor --discord`) to register your bot first,",
        ),
      );
      console.log(
        chalk.dim(
          "  or pass --client-id <id> to compose an invite URL ad-hoc.",
        ),
      );
      process.exitCode = 1;
      return;
    }
    if (unique.length > 1) {
      const answer = await inquirer.prompt([
        {
          name: "appId",
          type: "list",
          message:
            "Multiple Discord application ids registered. Pick one to generate the invite URL:",
          choices: candidates.map((c) => ({
            name: `${c.appId}  (${c.org} / ${c.handle})`,
            value: c.appId,
          })),
        },
      ]);
      clientId = answer.appId;
    } else {
      clientId = unique[0];
    }
  }

  let url: string;
  try {
    url = buildInviteUrl({ applicationClientId: clientId! });
  } catch (err) {
    console.log(chalk.red(`✗ ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.green("✓ Discord invite URL ready"));
  console.log("");
  console.log(chalk.cyan(url));
  console.log("");
  console.log(
    chalk.dim(
      `  permissions bitfield: ${DEFAULT_PERMISSIONS_BITFIELD.toString()} (v1.2 §4.2)`,
    ),
  );

  if (opts.printOnly) return;

  const opened = openInBrowser(url);
  if (opened) {
    console.log(chalk.dim("  → opened in your default browser"));
  } else {
    console.log(
      chalk.yellow(
        "  ⚠ Could not launch a browser automatically — copy the URL above manually.",
      ),
    );
  }
}

/** Smoke test: bundle reachable. */
export function bundleSanity(): boolean {
  // Touch `path` import so esbuild keeps it; also catches accidental dead imports.
  return typeof path.join === "function" && typeof fs.existsSync === "function";
}
