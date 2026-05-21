import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { IS_WINDOWS } from "../util/platform.js";
import { classifyWorkspace } from "./classify.js";
import {
  isStaleLock,
  readLock,
  uninstallLockPath,
  type LockInfo,
} from "./lockfile.js";
import {
  findIncompleteStages,
  journalPath,
  readJournal,
  type JournalEntry,
} from "./journal.js";

/**
 * v0.7 — `solosquad uninstall` precheck.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §5.1 step 0 + P0 #5 + P1 #6/#7/#9.
 *
 * Read-only — does not mutate the workspace, does not acquire the lock
 * itself (the caller does, after this report is approved). Surfaces:
 *
 *   - Workspace + repositories paths (the "not-touched" notice)
 *   - Stale lockfile detection (caller may auto-clear)
 *   - Journal resume hints (incomplete stages from prior run)
 *   - Live PM/scheduler PIDs (`--force` required to bypass)
 *   - Uncommitted/unpushed git changes in repositories
 *   - Workspace itself being a git working tree
 *   - Archive path writable + free space × 1.5 sanity check
 */

export interface PrecheckResult {
  /** True if no blockers. Warnings may still exist. */
  ok: boolean;
  /** Soft notes (sortable in CLI). */
  warnings: string[];
  /** Hard blockers — uninstall must not proceed unless --force or fixed. */
  blockers: string[];
  /** Untouched repository absolute paths (display to user). */
  protectedRepoPaths: string[];
  /** Existing lock holder, if any. */
  existingLock: { info: LockInfo | null; isStale: boolean; path: string };
  /** Stages from a previous run that began but did not end. */
  incompleteStages: string[];
  /** Journal entries (caller may render). */
  journalEntries: JournalEntry[];
  /** Detected live solosquad bot/schedule PIDs. */
  livePids: number[];
  /** Repos with uncommitted or unpushed changes. */
  reposWithGitDrift: string[];
  /** True if `<workspace>/.git` exists. */
  workspaceIsGitTree: boolean;
  /** Estimated archive size (bytes). */
  estimatedArchiveBytes: number;
  /** Disk free at archive destination (bytes). */
  archiveDestFreeBytes: number;
}

export interface PrecheckOptions {
  workspace: string;
  /** Where the archive zip will go (defaults to `~/`). */
  archivePath: string;
  /** Override PID detection (tests). */
  livePidsOverride?: number[];
  /** Override disk free (tests). */
  freeBytesOverride?: number;
  /** Bypass PM/scheduler PID + git-drift blockers. */
  force?: boolean;
}

export async function precheck(opts: PrecheckOptions): Promise<PrecheckResult> {
  const warnings: string[] = [];
  const blockers: string[] = [];

  // 1. Classification + protected repos
  const classification = classifyWorkspace(opts.workspace);
  const protectedRepoPaths = classification.untraversedRepoRoots.slice();

  // 2. Lockfile
  const lockPath = uninstallLockPath(opts.workspace);
  const lockInfo = readLock(lockPath);
  const lockStale = lockInfo ? isStaleLock(lockPath) : false;
  if (lockInfo && !lockStale) {
    blockers.push(
      `Another uninstall is in progress (pid ${lockInfo.pid}, started ${lockInfo.startTs}). ` +
      `If you are certain it has crashed, remove ${lockPath} manually.`,
    );
  } else if (lockInfo && lockStale) {
    warnings.push(`Stale uninstall.lock detected (pid ${lockInfo.pid} not alive); will be cleared on acquire.`);
  }

  // 3. Journal
  const journal = journalPath(opts.workspace);
  const journalEntries = readJournal(journal);
  const incompleteStages = findIncompleteStages(journalEntries);
  if (incompleteStages.length > 0) {
    warnings.push(
      `Previous uninstall stopped mid-stage: [${incompleteStages.join(", ")}]. ` +
      `This run will resume idempotently.`,
    );
  }

  // 4. PM/scheduler PID detection
  const livePids = opts.livePidsOverride ?? detectLivePids();
  if (livePids.length > 0 && !opts.force) {
    blockers.push(
      `solosquad bot/schedule appears to be running (pid ${livePids.join(", ")}). ` +
      `Stop these processes first, or rerun with --force.`,
    );
  } else if (livePids.length > 0) {
    warnings.push(`--force overrides ${livePids.length} live solosquad process(es) (pid ${livePids.join(", ")}).`);
  }

  // 5. Repo git drift
  const reposWithGitDrift: string[] = [];
  for (const repo of protectedRepoPaths) {
    const drift = detectGitDrift(repo);
    if (drift) reposWithGitDrift.push(repo);
  }
  if (reposWithGitDrift.length > 0 && !opts.force) {
    warnings.push(
      `Repositories with uncommitted or unpushed changes: ` +
      reposWithGitDrift.map((p) => `\n  - ${p}`).join("") +
      `\n  Recommended: commit/push before uninstall. (Their files are still untouched.)`,
    );
  }

  // 6. Workspace itself a git working tree?
  const workspaceIsGitTree = fs.existsSync(path.join(opts.workspace, ".git"));
  if (workspaceIsGitTree && !opts.force) {
    blockers.push(
      `<workspace>/.git exists — workspace itself is a git working tree. ` +
      `Uninstall will not modify workspace-root git files. Pass --force to acknowledge.`,
    );
  }

  // 7. Disk space
  const estimatedArchiveBytes = estimateArchiveBytes(classification);
  let archiveDestFreeBytes = opts.freeBytesOverride ?? -1;
  if (archiveDestFreeBytes < 0) {
    archiveDestFreeBytes = diskFreeBytes(path.dirname(opts.archivePath));
  }
  const required = Math.ceil(estimatedArchiveBytes * 1.5);
  if (archiveDestFreeBytes > 0 && archiveDestFreeBytes < required) {
    blockers.push(
      `Archive destination has ${humanBytes(archiveDestFreeBytes)} free but needs ~${humanBytes(required)} ` +
      `(estimated archive ${humanBytes(estimatedArchiveBytes)} × 1.5). Free up space or change --archive-path.`,
    );
  }

  // 8. Archive path writable?
  const archiveDir = path.dirname(opts.archivePath);
  if (!isDirWritable(archiveDir)) {
    blockers.push(`Archive destination directory is not writable: ${archiveDir}`);
  }

  return {
    ok: blockers.length === 0,
    warnings,
    blockers,
    protectedRepoPaths,
    existingLock: { info: lockInfo, isStale: lockStale, path: lockPath },
    incompleteStages,
    journalEntries,
    livePids,
    reposWithGitDrift,
    workspaceIsGitTree,
    estimatedArchiveBytes,
    archiveDestFreeBytes,
  };
}

/* -------------------------------------------------------------------------- */
/* PID detection — best effort, cross-platform                                */
/* -------------------------------------------------------------------------- */

function detectLivePids(): number[] {
  try {
    if (IS_WINDOWS) {
      // v0.9.2 hotfix: the Where-Object clause must include `Name -eq 'node.exe'`
      // because the powershell.exe process running this very query has both
      // 'solosquad' and '(bot|schedule|run-routine)' as literals in its own
      // CommandLine (the -Command argument). Without the Name guard, the query
      // matches itself and returns phantom PIDs that change every invocation.
      const out = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'solosquad' -and $_.CommandLine -match '(bot|schedule|run-routine)' } | Select-Object -ExpandProperty ProcessId"`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out
        .split(/\r?\n/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
    } else {
      const out = execSync(
        `pgrep -f "solosquad (bot|schedule|run-routine)" || true`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], shell: "/bin/sh" },
      );
      return out
        .split("\n")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
    }
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Git drift                                                                  */
/* -------------------------------------------------------------------------- */

function detectGitDrift(repoPath: string): boolean {
  if (!fs.existsSync(path.join(repoPath, ".git"))) return false;
  try {
    const status = execSync("git status --porcelain", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (status.trim().length > 0) return true;
    // Unpushed commits?
    try {
      const unpushed = execSync('git log --branches --not --remotes --oneline', {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (unpushed.trim().length > 0) return true;
    } catch {
      // no remote tracking — treat as clean for this purpose
    }
    return false;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Disk / writable                                                            */
/* -------------------------------------------------------------------------- */

function diskFreeBytes(dir: string): number {
  try {
    fs.mkdirSync(dir, { recursive: true });
    type StatFs = { bsize: number; bavail: number };
    const stat = (fs as unknown as { statfsSync?: (p: string) => StatFs }).statfsSync;
    if (!stat) return Number.MAX_SAFE_INTEGER;
    const s = stat(dir);
    return s.bavail * s.bsize;
  } catch {
    return -1;
  }
}

function isDirWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.solosquad-write-probe-${process.pid}`);
    fs.writeFileSync(probe, "x");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Archive size estimate                                                      */
/* -------------------------------------------------------------------------- */

function estimateArchiveBytes(c: ReturnType<typeof classifyWorkspace>): number {
  // Archive contains classes A* (tiny), B (largest), C (small metadata).
  // D goes in as masked template — negligible. E is excluded.
  return c.totals["A*"].bytes + c.totals["B"].bytes + c.totals["C"].bytes;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const _precheckInternals = {
  detectLivePids,
  detectGitDrift,
  diskFreeBytes,
  isDirWritable,
  estimateArchiveBytes,
};
