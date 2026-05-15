import { parseChannelName } from "./user-registry.js";

/**
 * v0.8 §3.4 — author-guard (defense in depth).
 *
 * Messenger ACL is the primary defense. This guard is the second layer:
 * if a user is mistakenly invited to someone else's `command-<handle>` or
 * `works-<handle>` channel, the bot refuses to act on their input. Broadcast
 * channels and any channel that does not match the `(command|works)-<handle>`
 * pattern are passed through (return true) — broadcast is push-only and
 * other channels are out of scope.
 *
 * The function is intentionally pure so it can be unit-tested without spinning
 * up a Discord/Slack client.
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
