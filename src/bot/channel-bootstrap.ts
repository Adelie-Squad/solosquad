import { listOrganizations } from "../util/config.js";
import {
  deriveChannelNames,
  findUserByBotId,
  listUserYamls,
  type UserYaml,
} from "./user-registry.js";

/**
 * v0.8 §3.5 — Channel bootstrap. At bot startup, each adapter calls this
 * helper to resolve which user yaml matches its live `bot_user_id` and which
 * `(command-<handle>, works-<handle>)` channel pair it should listen on.
 *
 * The pure resolver here knows nothing about Discord/Slack APIs — it returns
 * structured intent that adapters then realize via their native channel-create
 * primitives. This keeps the matching policy unit-testable.
 */

export interface BotIdentity {
  orgSlug: string;
  user: UserYaml;
  channels: {
    command: string;
    works: string;
    /** v1.2.9 Part B — VCS event feed channel (`git-<handle>`). */
    git: string;
  };
}

export interface ResolveBotIdentityInput {
  workspace: string;
  botUserId: string;
  /** Optional restriction to one org slug. */
  orgSlug?: string;
}

/**
 * v0.8 §3.5 — Returns the user yaml whose `bot_user_id` matches across all
 * (or one) org. Returns `null` when no match — adapter logs and skips
 * listening (it must not silently fall back to another user's channels).
 */
export function resolveBotIdentity(
  input: ResolveBotIdentityInput,
): BotIdentity | null {
  const orgs = input.orgSlug
    ? [{ slug: input.orgSlug }]
    : listOrganizations(input.workspace).map((o) => ({ slug: o.slug }));

  for (const o of orgs) {
    const found = findUserByBotId(o.slug, input.botUserId, input.workspace);
    if (found) {
      return {
        orgSlug: o.slug,
        user: found,
        channels: {
          command: found.channels.command,
          works: found.channels.works,
          // v1.2.9 Part B — fall back to the derived name for pre-v1.2.9
          // yamls (schema_version 1) that predate the field.
          git: found.channels.git ?? `git-${found.handle}`,
        },
      };
    }
  }
  return null;
}

/**
 * v0.8 §3.5 — List every (org, user, channel) tuple this workspace knows
 * about. Adapter uses this to confirm "channel exists for *some* user" when
 * deciding whether to ignore a message on a `command-bob` it doesn't own.
 */
export function listKnownChannels(workspace: string): Array<{
  orgSlug: string;
  handle: string;
  command: string;
  works: string;
  git: string;
}> {
  const out: Array<{
    orgSlug: string;
    handle: string;
    command: string;
    works: string;
    git: string;
  }> = [];
  for (const o of listOrganizations(workspace)) {
    for (const u of listUserYamls(o.slug, workspace)) {
      out.push({
        orgSlug: o.slug,
        handle: u.handle,
        command: u.channels.command,
        works: u.channels.works,
        // v1.2.9 Part B — derive when absent (pre-migration yamls).
        git: u.channels.git ?? `git-${u.handle}`,
      });
    }
  }
  return out;
}

/** Channel names this bot expects to own — convenience for adapter setup. */
export function expectedChannelNamesFor(handle: string): {
  command: string;
  works: string;
  git: string;
} {
  return deriveChannelNames(handle);
}
