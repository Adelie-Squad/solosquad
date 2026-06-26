/**
 * v1.4.2 — de-dupe Claude Code rate-limit notices.
 *
 * Claude Code reports a rate-limit status every turn (`allowed` / `warning` /
 * `exceeded`). v1.4.1 echoed any non-allowed status on EVERY reply, so a user
 * sitting in the `warning` zone (approaching their usage cap) saw the ⚠️ notice
 * on every message. This announces a given (status, reset-window) at most once
 * per user, so:
 *   - `warning` (approaching) → announced once per reset window, then silent;
 *   - `exceeded` (actually limited) → announced once (re-announced if the reset
 *     window changes, or after a warning→exceeded transition).
 *
 * State is in-memory (single bot process per workspace). A bot restart re-warns
 * once, which is fine.
 */
function formatReset(resetsAt?: number): string {
  if (!resetsAt) return "";
  // resetsAt is a unix seconds (Claude Code) — render as a Discord relative
  // timestamp so it localises per viewer.
  return ` (리셋: <t:${Math.floor(resetsAt)}:R>)`;
}

export class RateLimitNotifier {
  private lastKey = new Map<string, string>();

  /**
   * Returns the message to post for this turn's rate-limit status, or null to
   * stay silent (already announced for this window, or status is allowed/none).
   */
  decide(
    userId: string,
    rateLimit: { status: "warning" | "exceeded"; resetsAt?: number } | undefined,
  ): string | null {
    if (!rateLimit) return null;
    const { status, resetsAt } = rateLimit;
    const key = `${status}:${resetsAt ?? "none"}`;
    if (this.lastKey.get(userId) === key) return null;
    this.lastKey.set(userId, key);

    if (status === "exceeded") {
      return `⚠️ Claude Code 사용 한도를 초과했습니다${formatReset(resetsAt)}. 호출이 지연되거나 거부될 수 있어요.`;
    }
    return `⚠️ Claude Code 사용량이 한도에 근접했습니다${formatReset(resetsAt)}. 이후 호출이 지연될 수 있어요.`;
  }
}
