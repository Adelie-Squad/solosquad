import path from "path";
import { getOrgDir } from "../util/paths.js";

/**
 * v1.3.0 Part A — file-IPC contract shared by the PreToolUse hook
 * (`dev-confirm-hook.ts`, runs inside the claude sub-process) and the bot-side
 * bridge (`dev-confirm-bridge.ts`, runs in the bot process). Kept dependency-
 * light (only `path` + `getOrgDir`) so the hot-path hook loads fast on every
 * Bash tool call.
 *
 * Layout (per org):
 *   <org>/memory/pending-confirms/<id>.json       ← hook writes, bridge reads
 *   <org>/memory/pending-confirms/<id>.decision   ← bridge writes, hook polls
 *
 * The hook writes the request, then polls for the `.decision` sibling. The
 * bridge watches the directory, posts the approval card, and writes the
 * decision. Single-bot-process invariant (v0.7) means no file locks are needed.
 */

/** The pending-confirms directory for one org. */
export function pendingConfirmsDir(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "memory", "pending-confirms");
}

/** Absolute path to the request file for a confirm id. */
export function pendingRequestPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

/** Absolute path to the decision file the bridge writes for a confirm id. */
export function decisionPath(dir: string, id: string): string {
  return path.join(dir, `${id}.decision`);
}

/** Decision tokens written into the `.decision` file. */
export type PendingDecision = "y" | "n";

/**
 * The request the hook writes for the bridge. `branch` is the resolved
 * destination branch (current branch if the push had no explicit target);
 * `commits` is a best-effort `git log --oneline <remote>/<branch>..HEAD`
 * sample so the bridge can map the approval to the actual commit range.
 */
export interface PendingConfirmFile {
  /** Stable correlation id (see makeConfirmId in dev-confirm.ts). */
  id: string;
  /** Org slug — which org's command channel the card posts to. */
  orgSlug: string;
  /** Handle owning the command-<handle> channel. */
  handle?: string;
  /** Messenger user id the spawn was acting for (audit). */
  user: string;
  /** The full bash command that triggered the gate. */
  cmd: string;
  /** Resolved destination branch (never a protected branch — hook guards). */
  branch: string;
  /** Repo slug derived from the hook's cwd, when resolvable. */
  repoSlug?: string;
  /** Best-effort commit hashes/subjects in the push range. */
  commits: string[];
  /** Active workflow id when discoverable (for audit mapping). */
  workflowId?: string;
  /** ISO timestamp the hook created the request. */
  ts: string;
}
