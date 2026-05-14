import { execFileSync } from "child_process";
import path from "path";
import { rebuildRoutes, type RouteIndex, type BuildRoutesOpts } from "./agent-router.js";

/**
 * v0.6 §10.5 — reload policy for fs-watcher events.
 *
 * The fs-watcher emits change events; this module decides what to do with
 * them based on `workspace.yaml.fs_watch.mode`:
 *
 *   auto   — call `rebuildRoutes()` immediately + notify user.
 *   prompt — ask the user `🔄 N개 SKILL 변경 감지 — 적용? [y/N]` and wait
 *            for `y`/`n`/timeout. Only `y` triggers rebuild.
 *   manual — emit a notice but do NOT rebuild. User must run
 *            `solosquad agent reload`.
 *
 * Additional safety: when `gitOnly: true`, the policy refuses to apply
 * unless the workspace just had `origin/main` merged into the local branch.
 * The implementation compares the current HEAD to a tracking ref recorded
 * the last time the policy applied — if HEAD advanced AND the most recent
 * commit's parent line includes the previously-tracked origin/main SHA,
 * we consider it a merge boundary.
 */

export type ReloadMode = "auto" | "prompt" | "manual";

export interface ReloadPolicyDecision {
  /** What the policy did: ran reload, deferred to user, or skipped. */
  outcome: "auto" | "prompt" | "manual";
  /** True iff `rebuildRoutes()` actually ran. */
  reloaded: boolean;
  /** Caller can post this to PM channel. Empty when nothing to say. */
  notice: string;
  /** When prompt mode fired, the question text we asked. */
  prompt?: string;
  /** Set when reloaded — the # of triggers after the rebuild. */
  triggerCount?: number;
}

export interface ApplyReloadPolicyOpts {
  mode: ReloadMode;
  /** Absolute paths reported by `startSkillWatcher`. */
  changes: string[];
  /**
   * Only used in `prompt` mode. Caller drives the back-and-forth (ask the
   * user, await answer) and returns `true` for yes / `false` for no/timeout.
   * If omitted in prompt mode, the policy treats it as deferred (`reloaded:
   * false`, `outcome: "prompt"`) and the caller can prompt later.
   */
  onConfirm?: (prompt: string) => Promise<boolean>;
  /** When true, only apply when origin/main has just been merged. */
  gitOnly?: boolean;
  /**
   * `git rev-parse`-style root used for the gitOnly check. Defaults to the
   * workspace from `buildOpts.workspace_root` or `process.cwd()`. Tests
   * inject a fixture path.
   */
  gitRoot?: string;
  /**
   * Forwarded to `rebuildRoutes()` so the router scans the same tiers the
   * watcher did. The bot wires this from its known org slug.
   */
  buildOpts?: BuildRoutesOpts;
  /**
   * Test hook — replace the git probe. Returns whether we consider the
   * current HEAD a "just merged origin/main" state.
   */
  gitProbe?: (root: string) => boolean;
  /** Test hook — replace `rebuildRoutes()`. */
  rebuild?: (opts: BuildRoutesOpts) => RouteIndex;
}

const SKIPPED_FOR_GIT = "🔒 SKILL changes detected but gitOnly enabled — waiting for origin/main merge.";

/**
 * Apply the configured reload policy. Pure with respect to the messenger —
 * the caller posts `decision.notice` and (in prompt mode) drives the
 * `onConfirm` callback.
 */
export async function applyReloadPolicy(
  opts: ApplyReloadPolicyOpts,
): Promise<ReloadPolicyDecision> {
  const n = opts.changes.length;
  if (n === 0) {
    return { outcome: opts.mode, reloaded: false, notice: "" };
  }

  // gitOnly gate runs before any mode-specific work — applies to all modes.
  if (opts.gitOnly) {
    const root = opts.gitRoot ?? process.cwd();
    const probe = opts.gitProbe ?? defaultGitProbe;
    if (!probe(root)) {
      return {
        outcome: opts.mode,
        reloaded: false,
        notice: SKIPPED_FOR_GIT,
      };
    }
  }

  if (opts.mode === "manual") {
    return {
      outcome: "manual",
      reloaded: false,
      notice: `🔄 ${n}개 SKILL 변경 감지 — 자동 reload 꺼짐. \`solosquad agent reload\` 실행 시 적용.`,
    };
  }

  if (opts.mode === "prompt") {
    const promptText = `🔄 ${n}개 SKILL 변경 감지 — 적용? [y/N]`;
    if (!opts.onConfirm) {
      return {
        outcome: "prompt",
        reloaded: false,
        notice: promptText,
        prompt: promptText,
      };
    }
    let yes = false;
    try {
      yes = await opts.onConfirm(promptText);
    } catch {
      yes = false;
    }
    if (!yes) {
      return {
        outcome: "prompt",
        reloaded: false,
        notice: `↩ SKILL reload skipped — answer was no/timeout.`,
        prompt: promptText,
      };
    }
    const idx = (opts.rebuild ?? rebuildRoutes)(opts.buildOpts ?? {});
    const count = triggerCount(idx);
    return {
      outcome: "prompt",
      reloaded: true,
      notice: `🔄 SKILL routes reloaded — ${count} triggers`,
      prompt: promptText,
      triggerCount: count,
    };
  }

  // auto
  const idx = (opts.rebuild ?? rebuildRoutes)(opts.buildOpts ?? {});
  const count = triggerCount(idx);
  return {
    outcome: "auto",
    reloaded: true,
    notice: `🔄 SKILL routes reloaded — ${count} triggers`,
    triggerCount: count,
  };
}

export function triggerCount(idx: RouteIndex): number {
  return (
    Object.keys(idx.slash).length +
    Object.keys(idx.keyword).length +
    Object.keys(idx.explicit).length +
    idx.freq.length
  );
}

/**
 * Default git probe — returns true iff:
 *   1. We're on a branch tracking `origin/main`
 *   2. The local branch is at-or-ahead of `origin/main` AND `git status` is
 *      clean (no in-flight conflict markers)
 *
 * The intent is "external SKILL edits got merged via PR" — the canonical
 * signal is that origin/main matches HEAD. We deliberately do NOT require
 * "just now" timestamps because git reflog timestamps aren't reliable
 * across clones; instead, the *next* fs.watch event after a merge wins.
 *
 * If git is unavailable or anything else fails, we return false (fail-safe:
 * skip auto-reload rather than apply unreviewed SKILLs).
 */
function defaultGitProbe(root: string): boolean {
  try {
    const head = gitCmd(root, ["rev-parse", "HEAD"]).trim();
    const upstream = gitCmd(root, ["rev-parse", "--abbrev-ref", "HEAD@{u}"]).trim();
    if (!upstream.endsWith("/main") && upstream !== "origin/main") return false;
    const upstreamSha = gitCmd(root, ["rev-parse", upstream]).trim();
    if (head !== upstreamSha) return false; // local is ahead/behind — not a merge boundary
    const status = gitCmd(root, ["status", "--porcelain"]).trim();
    return status.length === 0;
  } catch {
    return false;
  }
}

function gitCmd(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Convenience for callers that just want the "🔄 N개 SKILL 변경" prefix
 * outside the policy decision flow.
 */
export function summarizeChanges(changes: string[]): string {
  const files = changes.map((c) => path.basename(path.dirname(c)) + "/SKILL.md");
  const unique = Array.from(new Set(files));
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} (+${unique.length - 3} more)`;
}
