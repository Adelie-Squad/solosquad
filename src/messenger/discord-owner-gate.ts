import type { Message, TextChannel } from "discord.js";
import {
  loadDiscordWorkspaceConfig,
  loadOrgYaml,
} from "../util/config.js";
import { getOrgDir } from "../util/paths.js";
import { listUserYamls } from "../bot/user-registry.js";

/**
 * v1.2 §4.5 — Owner-only gate (default ON for fresh installs; OFF for
 * v1.1.0 upgrades to preserve v1.0.2 channel-ACL-only behavior — the
 * migration writes `owner_only: false` explicitly so the resolver never
 * has to guess).
 *
 * The bot processes a message iff
 *   `message.author.id === user.yaml.messenger_user_id`.
 * Other senders in the same channel are silently ignored. Each
 * unrecognized sender gets *one* ephemeral notice per cooldown window so
 * the channel does not flood — every subsequent message from the same
 * (guild, sender) pair is fully silent.
 *
 * v1.0.2 was wrong-by-omission: it removed the author-guard because the
 * *channel name* at the time was user-id based, so the bot could not
 * tell which user's channel it was looking at — disambiguation was
 * impossible without the channel mapping that landed in v0.8.0
 * (`command-<handle>` / `works-<handle>`). With channel recognition
 * solved, the owner-id check becomes both feasible and the right policy
 * for a personal Chief bot. v1.2 restores it; existing installs keep
 * v1.0.2 behavior unless they opt in.
 */

export interface OwnerGateContext {
  workspace: string;
  orgSlug: string | null;
  ownHandle: string | null;
}

export interface OwnerGateDecision {
  /** When true the messageCreate handler should continue processing. */
  allow: boolean;
  /** When set, send this string to the message author as an ephemeral. */
  ephemeralNotice?: string;
}

const NOTICE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per (guild, author)

/**
 * Map<`${guildId}:${authorId}`, lastWarnedAtMs>. Bounded by natural
 * Discord ratio of strangers per guild (small for personal bots), but
 * we still trim entries older than 24h on every check so the map never
 * grows unbounded under abuse.
 */
const noticeLog: Map<string, number> = new Map();

function dedupeKey(guildId: string, authorId: string): string {
  return `${guildId}:${authorId}`;
}

function gcStaleNotices(now: number): void {
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [key, ts] of noticeLog) {
    if (ts < cutoff) noticeLog.delete(key);
  }
}

/**
 * Decide whether to allow / silently ignore / silently-with-ephemeral the
 * incoming message. Pure-ish (mutates only the in-memory dedupe log).
 * No Discord API calls — caller handles the actual `interaction.reply`
 * style ephemeral send (regular `Message` doesn't support ephemeral
 * directly, so callers typically `channel.send` then auto-delete, or use
 * a DM fallback).
 */
export function decideOwnerGate(
  message: Message,
  ctx: OwnerGateContext,
): OwnerGateDecision {
  const cfg = loadDiscordWorkspaceConfig(ctx.workspace);
  if (!cfg.owner_only) return { allow: true };

  if (!ctx.orgSlug || !ctx.ownHandle) {
    // No identity bound — defer to existing v0.8 ownHandle short-circuit
    // upstream. We don't synthesize a notice here because the upstream
    // log already explains the binding failure.
    return { allow: true };
  }

  // Find the user yaml for the bound handle to read messenger_user_id.
  const userYamls = listUserYamls(ctx.orgSlug, ctx.workspace);
  const owner = userYamls.find((u) => u.handle === ctx.ownHandle);
  if (!owner || !owner.messenger_user_id) {
    // Owner-only is requested but the workspace lacks the messenger_user_id
    // to compare against. Fail open + warn once per process — refusing
    // every message would brick the bot, and the workspace.yaml owner_only
    // flag is a workspace-wide policy, not an opt-in per user.
    if (!warnedAboutMissingMessengerUserId) {
      console.log(
        "[Discord Bot] owner_only=true but messenger_user_id is missing in user.yaml — gate disabled. " +
          "Run `solosquad doctor --discord` to fix.",
      );
      warnedAboutMissingMessengerUserId = true;
    }
    return { allow: true };
  }

  if (message.author.id === owner.messenger_user_id) {
    return { allow: true };
  }

  // Mismatch — block + maybe ephemeral.
  const now = Date.now();
  gcStaleNotices(now);
  const key = dedupeKey(message.guild?.id ?? "dm", message.author.id);
  const lastWarned = noticeLog.get(key) ?? 0;
  if (now - lastWarned < NOTICE_COOLDOWN_MS) {
    return { allow: false };
  }
  noticeLog.set(key, now);

  const channelName = (message.channel as TextChannel).name ?? "this channel";
  const orgYaml = loadOrgYaml(getOrgDir(ctx.orgSlug, ctx.workspace));
  const chiefLabel = orgYaml?.chief_name ?? "This Chief";
  return {
    allow: false,
    ephemeralNotice:
      `${chiefLabel} only takes commands from <@${owner.messenger_user_id}>. ` +
      `Other senders in #${channelName} are ignored. If you should be the owner, run ` +
      "`solosquad doctor --discord` to update `messenger_user_id` in your user.yaml.",
  };
}

let warnedAboutMissingMessengerUserId = false;

/**
 * Test helpers — exported so unit tests can reset state between cases
 * without exporting the internal Map.
 */
export function _resetOwnerGateState(): void {
  noticeLog.clear();
  warnedAboutMissingMessengerUserId = false;
}
