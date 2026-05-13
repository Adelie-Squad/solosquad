import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { getOrgDir } from "../util/paths.js";

/**
 * v1.2.5 — automatic git snapshots around subagent spawns.
 *
 * Scope: only the `memory/` and `workflows/` trees under each org. The user's
 * actual code repos live under `<org>/repositories/<repo>/` with their own
 * `.git` — we deliberately do NOT touch those.
 *
 * On `solosquad bot` startup, we ensure each org has an internal git repo at
 * `<org>/.solosquad/snapshot.git` (bare) plus a working-tree config that
 * tracks `<org>/memory/` and `<org>/workflows/`. Then around every
 * subagent spawn we commit before + after so `solosquad rollback --workflow
 * <id>` can revert just that delta.
 *
 * Per docs/plan/v0.3-pm-mode-orchestration.md §5.2 (sufurry guardrail).
 */

export interface SnapshotPaths {
  gitDir: string;
  workTree: string;
}

function snapshotPaths(workspace: string, orgSlug: string): SnapshotPaths {
  return {
    gitDir: path.join(getOrgDir(orgSlug, workspace), ".solosquad", "snapshot.git"),
    workTree: getOrgDir(orgSlug, workspace),
  };
}

function gitArgs(paths: SnapshotPaths): string[] {
  return ["--git-dir", paths.gitDir, "--work-tree", paths.workTree];
}

function runGit(paths: SnapshotPaths, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("git", [...gitArgs(paths), ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string };
    const stderr = e.stderr ? String(e.stderr) : "";
    return { code: e.status ?? 1, out: stderr };
  }
}

/** Idempotent init. Creates the bare repo + .gitignore-like inclusion gate. */
export function ensureSnapshotRepo(workspace: string, orgSlug: string): void {
  const paths = snapshotPaths(workspace, orgSlug);
  if (fs.existsSync(paths.gitDir)) return;
  fs.mkdirSync(paths.gitDir, { recursive: true });
  execFileSync("git", ["--git-dir", paths.gitDir, "init", "--bare", "--quiet"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  // Initial commit so HEAD exists.
  runGit(paths, [
    "-c",
    "user.email=solosquad@local",
    "-c",
    "user.name=solosquad-bot",
    "commit",
    "--allow-empty",
    "-m",
    "init: solosquad snapshot repo",
  ]);
}

/**
 * Commit the current state of `<org>/memory/` and `<org>/workflows/`. Returns
 * the new commit SHA (or null if there was nothing to commit).
 */
export function commitSnapshot(
  workspace: string,
  orgSlug: string,
  message: string
): string | null {
  ensureSnapshotRepo(workspace, orgSlug);
  const paths = snapshotPaths(workspace, orgSlug);

  // Add only the two trees we care about.
  for (const tree of ["memory", "workflows"]) {
    const treePath = path.join(paths.workTree, tree);
    if (fs.existsSync(treePath)) {
      runGit(paths, ["add", "--", tree]);
    }
  }

  // diff --cached --quiet returns 0 when there's nothing staged → skip commit.
  const diff = runGit(paths, ["diff", "--cached", "--quiet"]);
  if (diff.code === 0) return null;

  const commit = runGit(paths, [
    "-c",
    "user.email=solosquad@local",
    "-c",
    "user.name=solosquad-bot",
    "commit",
    "-m",
    message,
  ]);
  if (commit.code !== 0) return null;
  const rev = runGit(paths, ["rev-parse", "HEAD"]);
  return rev.code === 0 ? rev.out.trim() : null;
}

export interface SnapshotEntry {
  sha: string;
  ts: string;
  subject: string;
}

/** Return the most recent N commits, newest first. */
export function listSnapshots(
  workspace: string,
  orgSlug: string,
  limit: number = 20
): SnapshotEntry[] {
  const paths = snapshotPaths(workspace, orgSlug);
  if (!fs.existsSync(paths.gitDir)) return [];
  const log = runGit(paths, [
    "log",
    `-n${limit}`,
    "--pretty=format:%H%x09%cI%x09%s",
  ]);
  if (log.code !== 0 || !log.out.trim()) return [];
  return log.out
    .trim()
    .split("\n")
    .map((line) => {
      const [sha, ts, subject] = line.split("\t");
      return { sha, ts, subject };
    });
}

/**
 * Revert the snapshot tree to a specific commit. Affects only memory/ and
 * workflows/, leaving the user's actual repos untouched.
 *
 * Implementation: `git checkout <sha> -- memory workflows` then a follow-up
 * commit recording the revert.
 */
export function revertToSnapshot(
  workspace: string,
  orgSlug: string,
  targetSha: string,
  reason: string = "rollback"
): { ok: boolean; newSha?: string; error?: string } {
  ensureSnapshotRepo(workspace, orgSlug);
  const paths = snapshotPaths(workspace, orgSlug);

  // Verify the SHA exists in this repo.
  const verify = runGit(paths, ["cat-file", "-e", `${targetSha}^{commit}`]);
  if (verify.code !== 0) {
    return { ok: false, error: `commit not found: ${targetSha}` };
  }

  // Checkout each tracked tree separately so that an empty (never-committed)
  // tree doesn't cause "pathspec did not match" on the whole revert.
  let anyCheckedOut = false;
  for (const tree of ["memory", "workflows"]) {
    // Check if the tree exists in the target commit
    const lsTree = runGit(paths, ["ls-tree", "--name-only", targetSha, "--", tree]);
    if (lsTree.code !== 0 || !lsTree.out.trim()) continue;
    const checkout = runGit(paths, ["checkout", targetSha, "--", tree]);
    if (checkout.code !== 0) {
      return { ok: false, error: `checkout failed for ${tree}: ${checkout.out}` };
    }
    anyCheckedOut = true;
  }
  if (!anyCheckedOut) {
    return { ok: false, error: `no tracked trees in ${targetSha} — nothing to revert` };
  }

  const commit = runGit(paths, [
    "-c",
    "user.email=solosquad@local",
    "-c",
    "user.name=solosquad-bot",
    "commit",
    "-m",
    `rollback to ${targetSha.slice(0, 8)}: ${reason}`,
  ]);
  if (commit.code !== 0) {
    return { ok: false, error: `commit failed: ${commit.out}` };
  }
  const rev = runGit(paths, ["rev-parse", "HEAD"]);
  return { ok: true, newSha: rev.code === 0 ? rev.out.trim() : undefined };
}
