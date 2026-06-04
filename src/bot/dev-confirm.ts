import fs from "fs";
import path from "path";
import { getOrgDir } from "../util/paths.js";

/**
 * v0.8.2 §5.2 — sensitive-command confirmation gate.
 *
 * When an engineering SKILL tries to run a sensitive Bash command — `git
 * push`, `gh pr merge`, `gh pr close` — the PM session must be notified, the
 * user must answer `y` in their command channel, and only then the command
 * proceeds. Default timeout is 30 minutes; on timeout the command is
 * cancelled and the spawn receives a `tool_result` saying so.
 *
 * Audit trail lives in `<org>/memory/dev-confirmations.jsonl`, append-only.
 * The route-event sink (v0.6 §4 archive FTS5) picks it up by tail-reading
 * the file at archive-rotate time — no synchronous DB write on the spawn
 * hot path.
 *
 * Design constraints:
 *   - **Bot-process state**, not Claude-process state. The PM-runner holds
 *     the in-flight `DevConfirmController` and wires its resolve/reject to
 *     the next user message arriving on `command-<handle>`.
 *   - **No filesystem locks**. Single-bot-process invariant per workspace
 *     (per v0.7 lifecycle precheck) means an in-memory map is enough.
 *   - **30-min default timeout** — configurable via constructor.
 *   - **Cancel propagation**. If the PM session aborts, every pending
 *     confirmation is rejected with `"pm-aborted"`.
 */

export const DEV_CONFIRM_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** Patterns that trigger the gate. Matched left-trimmed against the bash command. */
export const SENSITIVE_BASH_PREFIXES: readonly string[] = [
  "git push",
  "gh pr merge",
  "gh pr close",
];

export type DevConfirmDecision = "y" | "n" | "timeout" | "pm-aborted";

export interface DevConfirmRequest {
  /** Stable id — derived from skill+user+ts for log correlation. */
  id: string;
  user: string;
  skill: string;
  cmd: string;
  /** Earliest ISO timestamp the request was created. */
  ts: string;
  /** Workspace path used to resolve the JSONL log location. */
  workspace: string;
  /** Org slug — where the JSONL log lives (`<org>/memory/...`). */
  orgSlug: string;
  /** Override timeout (ms) — defaults to 30 min. */
  timeoutMs?: number;
  /** Stable "now" injection for tests. */
  now?: () => number;
}

export interface DevConfirmAuditEntry {
  ts: string;
  user: string;
  skill: string;
  cmd: string;
  decision: DevConfirmDecision;
  duration_ms: number;
}

export interface DevConfirmController {
  /** Resolves once a decision (or timeout) lands. */
  promise: Promise<DevConfirmDecision>;
  /** Called by the messenger reader when a user replies. */
  resolve: (decision: "y" | "n") => void;
  /** Called by chief-runner if the PM session aborts mid-flight. */
  abort: () => void;
  /** The original request (for callers that want to render a message). */
  request: DevConfirmRequest;
}

/** Test seam: lets us replace the wall clock in unit tests. */
export interface DevConfirmDeps {
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Override the audit write path (mostly tests). */
  writeAudit?: (entry: DevConfirmAuditEntry, target: string) => void;
  /**
   * v1.2.9 Part B — fired exactly once when the decision is `"y"` (approved),
   * after the audit write. The live wiring (v1.3.0, when the gate goes live)
   * passes a sink that emits a push notification to the `git-<handle>`
   * channel via `notifyGitPush`. Best-effort: errors are swallowed so the
   * gate's resolved decision is never affected. Dormant in v1.2.9 — no
   * production code constructs a gate yet, so this never fires until then.
   */
  onApproved?: (request: DevConfirmRequest) => void;
}

export const DEFAULT_DEV_CONFIRM_DEPS: Required<Pick<DevConfirmDeps, "setTimeout" | "clearTimeout">> = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Detect whether a bash command requires a confirmation gate. Returns the
 * matched prefix (for audit logs / UI rendering) or `null` when the command
 * is OK to run without confirmation.
 */
export function detectSensitiveCommand(cmd: string): string | null {
  const trimmed = cmd.trim();
  if (!trimmed) return null;
  for (const prefix of SENSITIVE_BASH_PREFIXES) {
    if (trimmed === prefix) return prefix;
    if (trimmed.startsWith(`${prefix} `)) return prefix;
    if (trimmed.startsWith(`${prefix}\t`)) return prefix;
  }
  return null;
}

/**
 * Build a stable id for a confirmation request. Used as the correlation token
 * the PM session relays to the user (`"확인 #abc123: git push origin feat/x ?"`).
 */
export function makeConfirmId(req: Pick<DevConfirmRequest, "skill" | "user" | "ts">): string {
  // Cheap stable hash — sufficient for human-readable correlation.
  const seed = `${req.user}|${req.skill}|${req.ts}`;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 33) ^ seed.charCodeAt(i);
  }
  return Math.abs(h).toString(36).slice(0, 8);
}

/**
 * Create a controller. The caller is responsible for:
 *   1. Holding the controller in a `Map<confirmId, DevConfirmController>`
 *      keyed by the request id.
 *   2. Calling `resolve("y"|"n")` when the user replies on their channel.
 *   3. Calling `abort()` if the PM session crashes / a new turn arrives.
 *   4. Awaiting `promise` from the bash-tool wrapper to gate execution.
 *
 * The controller writes a `DevConfirmAuditEntry` to
 * `<org>/memory/dev-confirmations.jsonl` regardless of outcome.
 */
export function createDevConfirm(
  request: DevConfirmRequest,
  deps: DevConfirmDeps = {},
): DevConfirmController {
  const set = deps.setTimeout ?? DEFAULT_DEV_CONFIRM_DEPS.setTimeout;
  const clr = deps.clearTimeout ?? DEFAULT_DEV_CONFIRM_DEPS.clearTimeout;
  const now = request.now ?? Date.now;
  const startTs = now();
  const timeoutMs = request.timeoutMs ?? DEV_CONFIRM_DEFAULT_TIMEOUT_MS;

  let settle: ((d: DevConfirmDecision) => void) | null = null;
  const promise = new Promise<DevConfirmDecision>((resolve) => {
    settle = resolve;
  });

  const timer = set(() => {
    finish("timeout");
  }, timeoutMs);

  function finish(decision: DevConfirmDecision): void {
    if (!settle) return;
    const s = settle;
    settle = null;
    try {
      clr(timer);
    } catch {
      // ignore — best-effort cleanup
    }
    const entry: DevConfirmAuditEntry = {
      ts: new Date(startTs).toISOString(),
      user: request.user,
      skill: request.skill,
      cmd: request.cmd,
      decision,
      duration_ms: Math.max(0, now() - startTs),
    };
    try {
      if (deps.writeAudit) {
        deps.writeAudit(entry, devConfirmAuditPath(request.workspace, request.orgSlug));
      } else {
        appendAuditEntry(request.workspace, request.orgSlug, entry);
      }
    } catch {
      // Audit logging is best-effort — never throw out of the gate.
    }
    // v1.2.9 Part B — notify the git-<handle> feed on approval. Best-effort,
    // after audit. Swallow errors so a sink failure can't change the gate
    // decision the caller awaits.
    if (decision === "y" && deps.onApproved) {
      try {
        deps.onApproved(request);
      } catch {
        // best-effort — never throw out of the gate
      }
    }
    s(decision);
  }

  return {
    promise,
    resolve: (decision: "y" | "n") => finish(decision),
    abort: () => finish("pm-aborted"),
    request,
  };
}

/** Path to the audit JSONL — exposed for tests + archive-rotate. */
export function devConfirmAuditPath(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "memory", "dev-confirmations.jsonl");
}

function appendAuditEntry(
  workspace: string,
  orgSlug: string,
  entry: DevConfirmAuditEntry,
): void {
  const file = devConfirmAuditPath(workspace, orgSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
}
