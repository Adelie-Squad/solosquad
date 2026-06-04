import type { MessengerAdapter } from "../messenger/base.js";
import type { MessengerWorkspaceConfig } from "../util/config.js";

/**
 * v1.2.9 Part B — `git-<handle>` VCS event feed.
 *
 * Formats + emits a push notification to a user's `git-<handle>` channel.
 * The event source is the dev-confirm gate's *approval* moment (B.3.2):
 * when an agent-driven `git push` is approved (`y`), we record it here.
 *
 * NOTE (v1.2.9 scope — "1안"): the dev-confirm gate is still DORMANT (defined
 * but not wired into the live spawn path). This module is complete and
 * unit-tested, and `createDevConfirm`'s `onApproved` hook is ready to call
 * `notifyGitPush`, but no production code creates a gate yet — so no
 * notification actually fires until the gate goes live (designed in the
 * v1.3.0 PRD). Channel creation / config / migration ARE live.
 */

export interface PushEvent {
  /** Repo slug the push targets (from spawn target_repo, else "(unknown)"). */
  repoSlug: string;
  /** Remote name, e.g. "origin". "(default)" when omitted on the cmd line. */
  remote: string;
  /** Branch ref. "(default)" when omitted. */
  branch: string;
  /** Messenger handle of the user whose agent pushed. */
  userHandle: string;
  /** ISO timestamp of approval. */
  ts: string;
  /** Best-effort `git log --oneline <remote>/<branch>..HEAD` summary lines. */
  commits?: string[];
}

/**
 * Parse `git push [flags] [<remote> [<branch>]]` into `{ remote, branch }`,
 * defaulting to "(default)" when a positional is omitted. Flags (tokens
 * starting with "-") are ignored when locating the positionals.
 */
export function parsePushCommand(cmd: string): { remote: string; branch: string } {
  const trimmed = cmd.trim().replace(/\s+/g, " ");
  const m = trimmed.match(/^git\s+push\b(.*)$/);
  const rest = (m?.[1] ?? "").trim();
  const positional = rest.split(" ").filter((t) => t.length > 0 && !t.startsWith("-"));
  return {
    remote: positional[0] ?? "(default)",
    branch: positional[1] ?? "(default)",
  };
}

/**
 * v1.2.9 Part B — git_events defaults ON; only an explicit `enabled: false`
 * disables the sink.
 */
export function isGitEventsEnabled(cfg: MessengerWorkspaceConfig | undefined): boolean {
  return cfg?.git_events?.enabled !== false;
}

/** Format a push-approval notification for the `git-<handle>` channel. */
export function formatPushNotification(ev: PushEvent): string {
  const head = `✅ Push 승인: \`${ev.repoSlug}\` · \`${ev.branch}\` → \`${ev.remote}\``;
  const meta = `by @${ev.userHandle} · ${ev.ts}`;
  const lines = [head, meta];
  if (ev.commits && ev.commits.length > 0) {
    lines.push("", ...ev.commits.map((c) => `• ${c}`));
  }
  return lines.join("\n");
}

/**
 * Emit the push notification to `git-<handle>`. No-op (returns false) when
 * git_events is disabled or delivery fails. Best-effort — never throws, so a
 * notification failure can't poison the push-approval flow.
 */
export async function notifyGitPush(
  adapter: Pick<MessengerAdapter, "sendToChannel">,
  productConfig: Record<string, unknown>,
  handle: string,
  ev: PushEvent,
  workspaceMessengerConfig?: MessengerWorkspaceConfig,
): Promise<boolean> {
  if (!isGitEventsEnabled(workspaceMessengerConfig)) return false;
  try {
    return await adapter.sendToChannel(
      productConfig,
      `git-${handle}`,
      formatPushNotification(ev),
    );
  } catch {
    return false;
  }
}
