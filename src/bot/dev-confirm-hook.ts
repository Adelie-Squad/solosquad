import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import {
  isSensitiveGitCommand,
  parsePushBranch,
  isProtectedBranch,
} from "./sensitive-cmd.js";
import { makeConfirmId } from "./dev-confirm.js";
import { DEFAULT_PROTECTED_BRANCHES } from "../util/config.js";
import type { PendingConfirmFile, PendingDecision } from "./dev-confirm-paths.js";

/**
 * v1.3.0 Part A — the approve-flow PreToolUse(Bash) hook. Supersedes
 * `bash-deny-hook.ts` (which only ever denied): this hook turns the dormant
 * dev-confirm gate live by writing a `pending-confirms/<id>.json` request and
 * polling for the bridge's `<id>.decision` before allowing or blocking the
 * push.
 *
 * Decision matrix:
 *   - not a sensitive command         → exit 0 (allow)
 *   - `git push` to a protected branch → exit 2 (BLOCK — fail-closed guard,
 *                                         independent of the error policy)
 *   - `gh pr merge` / `gh pr close`    → confirm flow (no branch concept)
 *   - `git push` to a feature branch   → confirm flow
 *
 * Confirm flow → write pending file, poll for decision (default 30 min):
 *   - decision "y"  → exit 0 (push proceeds)
 *   - decision "n"  → exit 2 (blocked)
 *   - timeout       → exit 2 (blocked — fail-closed: no approval = no push)
 *
 * Failure policy (PRD Open Q#2): the gate fails OPEN on hook error (bad stdin,
 * unwritable pending dir, missing config) → exit 0, so a buggy hook never
 * permanently bricks every push. The protected-branch guard is the one
 * exception — it stays fail-closed regardless. Mirrors `bash-deny-hook.ts`'s
 * "fail open on malformed input" stance.
 *
 * Runs as a standalone node script (`node dev-confirm-hook.js`) inside the
 * claude sub-process; the bot injects context via env (see claude-process.ts):
 *   SOLOSQUAD_DEV_CONFIRM_DIR        absolute pending-confirms dir
 *   SOLOSQUAD_DEV_CONFIRM_ORG        org slug
 *   SOLOSQUAD_DEV_CONFIRM_USER       messenger user id
 *   SOLOSQUAD_DEV_CONFIRM_HANDLE     command-<handle> owner
 *   SOLOSQUAD_DEV_CONFIRM_WORKFLOW   active workflow id (optional)
 *   SOLOSQUAD_DEV_CONFIRM_TIMEOUT_MS approval timeout in ms
 *   SOLOSQUAD_DEV_CONFIRM_PROTECTED  comma-separated protected branches
 */

export type HookAction = "allow" | "block" | "confirm";

export interface HookEnv {
  dir?: string;
  org: string;
  user: string;
  handle?: string;
  workflowId?: string;
  timeoutMs: number;
  protectedBranches: string[];
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 500;

export function readHookEnv(env: NodeJS.ProcessEnv): HookEnv {
  const protectedRaw = env.SOLOSQUAD_DEV_CONFIRM_PROTECTED;
  const protectedBranches = protectedRaw
    ? protectedRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [...DEFAULT_PROTECTED_BRANCHES];
  const timeoutRaw = Number(env.SOLOSQUAD_DEV_CONFIRM_TIMEOUT_MS);
  return {
    dir: env.SOLOSQUAD_DEV_CONFIRM_DIR || undefined,
    org: env.SOLOSQUAD_DEV_CONFIRM_ORG ?? "",
    user: env.SOLOSQUAD_DEV_CONFIRM_USER ?? "unknown",
    handle: env.SOLOSQUAD_DEV_CONFIRM_HANDLE || undefined,
    workflowId: env.SOLOSQUAD_DEV_CONFIRM_WORKFLOW || undefined,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? timeoutRaw
        : DEFAULT_TIMEOUT_MS,
    protectedBranches,
  };
}

/** Extract `tool_input.command` from a PreToolUse payload; null on any error. */
export function extractCommand(stdin: string): string | null {
  try {
    const parsed = JSON.parse(stdin) as {
      tool_input?: { command?: string };
    };
    return parsed.tool_input?.command ?? null;
  } catch {
    return null;
  }
}

const PUSH_RE = /(^|&&|\|\||;|\||\n)\s*git\s+push\b/;

/**
 * Decide what to do with a command. Pure — `resolveBranch` is injected so the
 * current-branch lookup (a `git rev-parse`) can be faked in tests.
 */
export function classifySensitive(
  cmd: string,
  opts: { protectedBranches: string[]; resolveBranch: () => string | null },
): { action: HookAction; branch: string | null } {
  if (!isSensitiveGitCommand(cmd)) return { action: "allow", branch: null };
  // `gh pr merge` / `gh pr close` have no destination branch — straight to
  // confirm (the protected-branch guard is git-push-specific).
  if (!PUSH_RE.test(cmd)) return { action: "confirm", branch: null };
  const branch = parsePushBranch(cmd) ?? opts.resolveBranch();
  if (isProtectedBranch(branch, opts.protectedBranches)) {
    return { action: "block", branch };
  }
  return { action: "confirm", branch };
}

export interface HookDeps {
  readStdin: () => Promise<string>;
  env: NodeJS.ProcessEnv;
  cwd: string;
  resolveBranch: (cwd: string) => string | null;
  collectCommits: (cwd: string, branch: string | null) => string[];
  makeId: (seed: { user: string; skill: string; ts: string }) => string;
  writePending: (file: string, body: PendingConfirmFile) => void;
  pollDecision: (
    decisionFile: string,
    timeoutMs: number,
  ) => Promise<PendingDecision | "timeout">;
  warn: (msg: string) => void;
  now: () => Date;
}

/** Run the gate. Returns the process exit code (0 allow / 2 block). */
export async function runHook(deps: HookDeps): Promise<number> {
  const stdin = await deps.readStdin();
  const cmd = extractCommand(stdin);
  if (!cmd) return 0; // malformed payload — fail open

  const env = readHookEnv(deps.env);
  const { action, branch } = classifySensitive(cmd, {
    protectedBranches: env.protectedBranches,
    resolveBranch: () => deps.resolveBranch(deps.cwd),
  });

  if (action === "allow") return 0;

  if (action === "block") {
    deps.warn(
      `BLOCKED: direct push to protected branch "${branch ?? "?"}" is not ` +
        `allowed (chief.git.protected_branches). Push to a feature branch and ` +
        `open a PR instead.`,
    );
    return 2;
  }

  // confirm flow
  if (!env.dir) {
    // Gate not configured (no bridge) — fail open so a missing wire-up doesn't
    // brick every push. Protected branches were already blocked above.
    deps.warn(
      "dev-confirm gate not configured (SOLOSQUAD_DEV_CONFIRM_DIR unset) — allowing.",
    );
    return 0;
  }

  const ts = deps.now().toISOString();
  const repoSlug = deriveRepoSlug(deps.cwd);
  const id = deps.makeId({
    user: env.user,
    skill: repoSlug ?? "git",
    ts,
  });
  const pendingFile = path.join(env.dir, `${id}.json`);
  const decisionFile = path.join(env.dir, `${id}.decision`);

  const body: PendingConfirmFile = {
    id,
    orgSlug: env.org,
    handle: env.handle,
    user: env.user,
    cmd,
    branch: branch ?? "(current)",
    repoSlug,
    commits: deps.collectCommits(deps.cwd, branch),
    workflowId: env.workflowId,
    ts,
  };

  try {
    deps.writePending(pendingFile, body);
  } catch (e) {
    deps.warn(
      `dev-confirm pending write failed (${(e as Error).message}) — failing open.`,
    );
    return 0; // fail open on IPC write error
  }

  const decision = await deps.pollDecision(decisionFile, env.timeoutMs);
  if (decision === "y") return 0;
  if (decision === "n") {
    deps.warn("Push rejected by the user.");
    return 2;
  }
  deps.warn(
    `Push approval timed out after ${Math.round(env.timeoutMs / 60000)}m — blocked.`,
  );
  return 2;
}

/** `<workspace>/<org>/repositories/<slug>/…` or path basename → slug. */
function deriveRepoSlug(cwd: string): string | undefined {
  const m = cwd.replace(/\\/g, "/").match(/repositories\/([^/]+)/);
  if (m) return m[1];
  const base = path.basename(cwd);
  return base || undefined;
}

// ---------------------------------------------------------------------------
// Real-dependency wiring (used when invoked as a script)
// ---------------------------------------------------------------------------

function realResolveBranch(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function realCollectCommits(cwd: string, branch: string | null): string[] {
  if (!branch) return [];
  try {
    const out = execFileSync(
      "git",
      ["log", "--oneline", "-n", "20", `origin/${branch}..HEAD`],
      { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function realWritePending(file: string, body: PendingConfirmFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf-8");
}

function realPollDecision(
  decisionFile: string,
  timeoutMs: number,
): Promise<PendingDecision | "timeout"> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      let raw: string | null = null;
      try {
        raw = fs.readFileSync(decisionFile, "utf-8");
      } catch {
        raw = null;
      }
      if (raw !== null) {
        const v = raw.trim();
        resolve(v === "y" ? "y" : "n");
        return;
      }
      if (Date.now() >= deadline) {
        resolve("timeout");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    // If stdin never opens (no payload), resolve empty after a tick.
    process.stdin.on("error", () => resolve(buf));
  });
}

export const REAL_HOOK_DEPS: HookDeps = {
  readStdin,
  env: process.env,
  cwd: process.cwd(),
  resolveBranch: realResolveBranch,
  collectCommits: realCollectCommits,
  makeId: makeConfirmId,
  writePending: realWritePending,
  pollDecision: realPollDecision,
  warn: (msg) => process.stderr.write(msg + "\n"),
  now: () => new Date(),
};

// Script entry: run only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  runHook(REAL_HOOK_DEPS)
    .then((code) => process.exit(code))
    .catch(() => process.exit(0)); // any unexpected error — fail open
}
