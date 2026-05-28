import chalk from "chalk";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getWorkspaceRoot, getEnvPath } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { listAllUsers } from "../bot/user-registry.js";
import {
  buildInviteUrl,
  DEFAULT_PERMISSIONS_BITFIELD,
} from "../messenger/discord-invite-url.js";

/**
 * v1.2 §10 — `solosquad doctor --discord` 5-hop diagnostic. Every hop is
 * attributable (which step failed) and actionable (what to run next).
 * Silent failure budget = 0.
 *
 * Hops:
 *   1. DISCORD_TOKEN env exists + has the Discord token shape.
 *   2. REST `/users/@me` returns the bot user (token live + valid).
 *   3. bot_user_id matches at least one user.yaml in the workspace.
 *   4. Bot is a member of ≥1 guild (covers GuildCreate event readiness).
 *   5. <org>/discord/config.yaml exists + binds the bot's guild + has
 *      the command-<handle> channel ID recorded.
 *
 * Returns the count of failed hops so callers can `process.exitCode = n`.
 */

export interface DoctorDiscordOpts {
  /** Non-zero exit on failure (for CI). */
  ci?: boolean;
}

interface HopResult {
  ok: boolean;
  label: string;
  detail?: string;
  hint?: string;
}

export async function doctorDiscordCommand(
  opts: DoctorDiscordOpts = {},
): Promise<void> {
  console.log(chalk.bold("\nSoloSquad — Doctor (Discord 5-hop)\n"));
  const workspace = getWorkspaceRoot();

  const results: HopResult[] = [];

  // ---- Hop 1: DISCORD_TOKEN ----
  const token = readDiscordTokenFromEnv(workspace);
  if (!token) {
    results.push({
      ok: false,
      label: "1. DISCORD_TOKEN env",
      detail: ".solosquad/.env missing DISCORD_TOKEN",
      hint: "Set DISCORD_TOKEN in <workspace>/.solosquad/.env (or env). Re-run `solosquad init` to walk the wizard.",
    });
  } else if (!isDiscordTokenShape(token)) {
    results.push({
      ok: false,
      label: "1. DISCORD_TOKEN env",
      detail: "Found, but format is not <base64>.<base64>.<base64>",
      hint: "Re-paste the token from Developer Portal → Bot → Reset Token. Bot Token, not Client Secret.",
    });
  } else {
    results.push({
      ok: true,
      label: "1. DISCORD_TOKEN env",
      detail: `present, length=${token.length}`,
    });
  }

  // ---- Hop 2: REST /users/@me ----
  let liveBotUserId: string | null = null;
  let liveAppId: string | null = null;
  if (results[0].ok && token) {
    const me = await fetchUsersMe(token);
    if (!me) {
      results.push({
        ok: false,
        label: "2. REST /users/@me",
        detail: "Discord rejected the token (401 / network failure)",
        hint: "Reset the token (Developer Portal → Bot → Reset Token), then re-run doctor.",
      });
    } else {
      liveBotUserId = me.id;
      liveAppId = me.application_id ?? null;
      results.push({
        ok: true,
        label: "2. REST /users/@me",
        detail: `bot_user_id=${me.id}${liveAppId ? ` app_id=${liveAppId}` : ""}`,
      });
    }
  } else {
    results.push({
      ok: false,
      label: "2. REST /users/@me",
      detail: "skipped — Hop 1 failed",
    });
  }

  // ---- Hop 3: bot_user_id matches a user.yaml ----
  const users = listAllUsers(workspace).filter(
    (u) => u.user.messenger === "discord",
  );
  if (!liveBotUserId) {
    results.push({
      ok: false,
      label: "3. bot_user_id match",
      detail: "skipped — Hop 2 failed",
    });
  } else if (users.length === 0) {
    results.push({
      ok: false,
      label: "3. bot_user_id match",
      detail: "no Discord user.yaml registered",
      hint: "Run `solosquad init` (or rerun the wizard) to write user.yaml for the bot's handle.",
    });
  } else {
    const match = users.find((u) => u.user.bot_user_id === liveBotUserId);
    if (!match) {
      const knownIds = users.map((u) => `${u.user.handle}:${u.user.bot_user_id}`).join(", ");
      results.push({
        ok: false,
        label: "3. bot_user_id match",
        detail: `live=${liveBotUserId} not in any user.yaml (have: ${knownIds})`,
        hint: "Reset the bot token and re-run init, or edit user.yaml.bot_user_id to match the live value.",
      });
    } else {
      results.push({
        ok: true,
        label: "3. bot_user_id match",
        detail: `matched ${match.user.handle} in org ${match.orgSlug}`,
      });
      // Opportunistic: if the user.yaml lacks bot_application_id but we
      // have a live one, surface the gap (it's needed for invite-url).
      if (!match.user.bot_application_id && liveAppId) {
        console.log(
          chalk.yellow(
            `    △ user.yaml.bot_application_id missing — live app_id=${liveAppId}. ` +
              "Edit user.yaml or re-run init.",
          ),
        );
      }
    }
  }

  // ---- Hop 4: guild membership (offline approximation) ----
  // Online membership requires a live Gateway session — that's too heavy
  // for a doctor sweep. Use the org/discord/config.yaml guild_id binding
  // as the proxy: if config.yaml records a guild, the bot has been added
  // at least once. The runtime adapter does the live check on bot start.
  const matchedUser = liveBotUserId
    ? users.find((u) => u.user.bot_user_id === liveBotUserId)
    : null;
  const discordCfg = matchedUser
    ? loadOrgDiscordConfig(workspace, matchedUser.orgSlug)
    : null;
  const recordedGuildId = discordCfg?.guild_id;
  if (!matchedUser) {
    results.push({
      ok: false,
      label: "4. guild membership",
      detail: "skipped — Hop 3 failed",
    });
  } else if (!recordedGuildId) {
    let hint =
      "Invite the bot using the URL from `solosquad discord invite-url` and click Authorize on a guild you own.";
    if (liveAppId) {
      try {
        hint += `\n        URL: ${buildInviteUrl({ applicationClientId: liveAppId })}`;
      } catch {
        /* ignore — buildInviteUrl already validated upstream */
      }
    }
    results.push({
      ok: false,
      label: "4. guild membership",
      detail: `no guild_id recorded in <${matchedUser.orgSlug}>/discord/config.yaml`,
      hint,
    });
  } else {
    results.push({
      ok: true,
      label: "4. guild membership",
      detail: `bound to guild_id=${recordedGuildId}`,
    });
  }

  // ---- Hop 5: config.yaml + command channel binding ----
  if (!matchedUser || !discordCfg || !recordedGuildId) {
    results.push({
      ok: false,
      label: "5. config.yaml + command channel",
      detail: "skipped — Hop 4 failed",
    });
  } else {
    const expectedCommand = `command-${matchedUser.user.handle}`;
    const channelIds = discordCfg.channels ?? {};
    const recorded =
      typeof channelIds === "object" && channelIds !== null
        ? (channelIds as Record<string, unknown>)[expectedCommand]
        : undefined;
    if (typeof recorded === "string" && recorded.length > 0) {
      results.push({
        ok: true,
        label: "5. config.yaml + command channel",
        detail: `${expectedCommand} channel_id=${recorded}`,
      });
    } else {
      results.push({
        ok: false,
        label: "5. config.yaml + command channel",
        detail: `${expectedCommand} channel ID not recorded in config.yaml`,
        hint: "Start the bot once (`solosquad bot`) — it auto-creates the channel pair and writes the IDs back to config.yaml.",
      });
    }
  }

  // ---- Render ----
  for (const r of results) {
    const tag = r.ok ? chalk.green("  ✓") : chalk.red("  ✗");
    console.log(`${tag} ${r.label}${r.detail ? chalk.dim(` — ${r.detail}`) : ""}`);
    if (!r.ok && r.hint) {
      console.log(chalk.dim(`        → ${r.hint}`));
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log("");
  if (failed === 0) {
    console.log(chalk.green.bold("  ✓ Discord 5-hop diagnostic clean"));
  } else {
    console.log(chalk.red.bold(`  ${failed} of 5 hop(s) failed`));
    console.log(
      chalk.dim(
        `  Default permissions bitfield (for invite URL): ${DEFAULT_PERMISSIONS_BITFIELD}`,
      ),
    );
  }

  if (opts.ci && failed > 0) {
    process.exitCode = 1;
  }
}

function readDiscordTokenFromEnv(workspace: string): string | null {
  const envFile = getEnvPath(workspace);
  if (fs.existsSync(envFile)) {
    for (const line of normalizeLine(fs.readFileSync(envFile, "utf-8")).split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx === -1) continue;
      if (t.slice(0, idx).trim() === "DISCORD_TOKEN") {
        return t.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return process.env.DISCORD_TOKEN ?? null;
}

function isDiscordTokenShape(token: string): boolean {
  // Discord bot tokens are <id-base64>.<timestamp-base64>.<hmac-base64>.
  return /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}$/.test(token);
}

interface UsersMeBody {
  id: string;
  application_id?: string;
}

async function fetchUsersMe(token: string): Promise<UsersMeBody | null> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<UsersMeBody>;
    if (!body.id) return null;
    return { id: body.id, application_id: body.application_id };
  } catch {
    return null;
  }
}

interface OrgDiscordConfig {
  guild_id?: string;
  channels?: Record<string, string>;
}

function loadOrgDiscordConfig(
  workspace: string,
  orgSlug: string,
): OrgDiscordConfig | null {
  const cfgPath = path.join(workspace, orgSlug, "discord", "config.yaml");
  if (!fs.existsSync(cfgPath)) return null;
  try {
    return (
      (yaml.load(normalizeLine(fs.readFileSync(cfgPath, "utf-8"))) as OrgDiscordConfig) ??
      {}
    );
  } catch {
    return null;
  }
}
