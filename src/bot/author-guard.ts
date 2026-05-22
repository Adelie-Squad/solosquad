import { parseChannelName } from "./user-registry.js";

/**
 * v0.8 §3.4 — author-guard (defense in depth).
 *
 * @deprecated since v1.0.2 for the Discord adapter. The `isAuthorizedAuthor`
 * compare against Discord's `message.author.username` was the root cause of a
 * universal false-positive: a SoloSquad handle in `[a-z0-9_]` charset can
 * never equal a Discord username in arbitrary unicode (e.g. `seungw1n.` with
 * a trailing dot). Discord channel ACL is the canonical permission boundary
 * and SoloSquad does not own that ACL — there is no meaningful 2nd defense
 * to layer here. Discord adapter no longer calls these helpers as of v1.0.2.
 *
 * The Slack adapter still imports both functions; equivalent removal is
 * scheduled for v1.0.3. After that, this whole file goes away.
 *
 * Spec retraction: docs/plan/v1.0.2-discord-author-guard-decoupling.md.
 */
export function isAuthorizedAuthor(
  channelName: string,
  authorHandle: string,
): boolean {
  const parsed = parseChannelName(channelName);
  if (!parsed) return true; // broadcast / unrelated channel
  return parsed.handle === authorHandle.trim().toLowerCase();
}

/** Convenience helper for adapters: produce the ephemeral DM body. */
export function unauthorizedAuthorMessage(
  channelName: string,
  authorHandle: string,
): string {
  const parsed = parseChannelName(channelName);
  const owner = parsed?.handle ?? "this channel's owner";
  return (
    `이 채널은 ${owner}의 명령 전용입니다. ` +
    `command-${authorHandle.trim().toLowerCase()} 채널을 사용하세요.`
  );
}
