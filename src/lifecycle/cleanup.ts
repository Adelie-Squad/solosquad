import fs from "fs";
import path from "path";
import os from "os";
import type { ClassifyResult } from "./classify.js";
import type { RepoMetaExtraction } from "./repo-meta.js";
import { repoSolosquadDir } from "./repo-meta.js";
import { JournalWriter, isStageCompleted, readJournal, journalPath } from "./journal.js";

/**
 * v0.7 — cleanup orchestrator.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §5.1 step 3 + §10 #8 +
 * §5.4 keep-workspace matrix + §11.3 journal.
 *
 * Cleanup operates *after* the archive zip has been built and verified.
 * Each stage logs `begin`/`end` to the journal so a crashed run can resume
 * idempotently. Removing a path that no longer exists is a no-op, so
 * resuming is safe even mid-stage.
 *
 * Class matrix:
 *   A   — never touched (excluded from classification's traversal)
 *   A*  — surgical purge of `<repo>/.solosquad/` (only after meta extracted)
 *   B   — delete normally; under --keep-workspace, KEEP on disk
 *   C   — delete normally; sessions/*.json moved to sessions/_archived/ when keep-workspace
 *   D   — always deleted (secrets never linger on disk)
 *   E   — never touched (external resources)
 */

export interface CleanupOptions {
  workspace: string;
  classification: ClassifyResult;
  extractedRepos: RepoMetaExtraction[];
  reposMissingRepoYaml: { orgSlug: string; repoSlug: string; solosquadDir: string }[];
  journal: JournalWriter;
  dryRun: boolean;
  keepWorkspace: boolean;
  alsoPurgeBackups: boolean;
}

export interface CleanupReport {
  removed: string[];
  preserved: string[];
  archivedSessions: string[];
  skipped: string[];
  assertions: RepoAssertion[];
  /** Stages that were skipped because journal showed them already done. */
  resumedSkippedStages: string[];
}

export interface RepoAssertion {
  repoPath: string;
  passed: boolean;
  reason?: string;
}

const STAGE_REPO_META_VERIFY = "cleanup.repo-meta-verify";
const STAGE_REPO_PURGE = "cleanup.repo-solosquad-purge";
const STAGE_ORG_PURGE = "cleanup.org-purge";
const STAGE_WORKSPACE_PURGE = "cleanup.workspace-purge";
const STAGE_PURGE_BACKUPS = "cleanup.purge-backups";

export async function runCleanup(opts: CleanupOptions): Promise<CleanupReport> {
  const report: CleanupReport = {
    removed: [],
    preserved: [],
    archivedSessions: [],
    skipped: [],
    assertions: [],
    resumedSkippedStages: [],
  };

  const journalEntries = readJournal(journalPath(opts.workspace));

  // Stage 1 — verify each extracted repo's archive landing (caller is
  // responsible for the actual archive; we just confirm extractedRepos
  // matches classification's A* expectations).
  if (!isStageCompleted(journalEntries, STAGE_REPO_META_VERIFY, opts.journal.runId)) {
    opts.journal.begin(STAGE_REPO_META_VERIFY);
    verifyExtractedRepos(opts);
    opts.journal.end(STAGE_REPO_META_VERIFY, { count: opts.extractedRepos.length });
  } else {
    report.resumedSkippedStages.push(STAGE_REPO_META_VERIFY);
  }

  // Stage 2 — surgical removal of <repo>/.solosquad/ for each extracted repo
  if (!isStageCompleted(journalEntries, STAGE_REPO_PURGE, opts.journal.runId)) {
    opts.journal.begin(STAGE_REPO_PURGE);
    for (const repo of opts.extractedRepos) {
      const solosquadDir = repoSolosquadDir(opts.workspace, repo.orgSlug, repo.repoSlug);
      const assertion = surgicalRemoveRepoSolosquad(solosquadDir, opts.dryRun);
      report.assertions.push(assertion);
      if (assertion.passed) {
        report.removed.push(solosquadDir);
      } else {
        opts.journal.error(STAGE_REPO_PURGE, { repo: repo.repoSlug, reason: assertion.reason });
        throw new Error(`Surgical repo purge failed for ${solosquadDir}: ${assertion.reason}`);
      }
    }
    opts.journal.end(STAGE_REPO_PURGE, { repos: opts.extractedRepos.length });
  } else {
    report.resumedSkippedStages.push(STAGE_REPO_PURGE);
  }

  // Stage 3 — org-level cleanup (memory, workflows, goals, etc.)
  if (!isStageCompleted(journalEntries, STAGE_ORG_PURGE, opts.journal.runId)) {
    opts.journal.begin(STAGE_ORG_PURGE);
    purgeOrgLevel(opts, report);
    opts.journal.end(STAGE_ORG_PURGE);
  } else {
    report.resumedSkippedStages.push(STAGE_ORG_PURGE);
  }

  // Stage 4 — workspace-level cleanup (.solosquad/, AGENTS.md, knowledge/)
  if (!isStageCompleted(journalEntries, STAGE_WORKSPACE_PURGE, opts.journal.runId)) {
    opts.journal.begin(STAGE_WORKSPACE_PURGE);
    purgeWorkspaceLevel(opts, report);
    opts.journal.end(STAGE_WORKSPACE_PURGE);
  } else {
    report.resumedSkippedStages.push(STAGE_WORKSPACE_PURGE);
  }

  // Stage 5 — optional purge of ~/.solosquad-backups/
  if (opts.alsoPurgeBackups) {
    if (!isStageCompleted(journalEntries, STAGE_PURGE_BACKUPS, opts.journal.runId)) {
      opts.journal.begin(STAGE_PURGE_BACKUPS);
      const backupsDir = path.join(os.homedir(), ".solosquad-backups");
      if (fs.existsSync(backupsDir)) {
        if (!opts.dryRun) fs.rmSync(backupsDir, { recursive: true, force: true });
        report.removed.push(backupsDir);
      } else {
        report.skipped.push(backupsDir);
      }
      opts.journal.end(STAGE_PURGE_BACKUPS);
    } else {
      report.resumedSkippedStages.push(STAGE_PURGE_BACKUPS);
    }
  }

  return report;
}

/* -------------------------------------------------------------------------- */
/* Stages                                                                     */
/* -------------------------------------------------------------------------- */

function verifyExtractedRepos(opts: CleanupOptions): void {
  // Cross-check the classifier's A* roots against extractedRepos. Any
  // repo that classifier saw as having a .solosquad dir but isn't in
  // extractedRepos (and isn't in reposMissingRepoYaml) must block.
  const expected = new Set<string>();
  for (const e of opts.classification.entries) {
    if (e.cls === "A*" && e.kind === "directory" && e.orgSlug && e.repoSlug) {
      expected.add(`${e.orgSlug}/${e.repoSlug}`);
    }
  }
  const extracted = new Set(opts.extractedRepos.map((r) => `${r.orgSlug}/${r.repoSlug}`));
  const missing = new Set(opts.reposMissingRepoYaml.map((r) => `${r.orgSlug}/${r.repoSlug}`));

  for (const slug of expected) {
    if (!extracted.has(slug) && !missing.has(slug)) {
      throw new Error(
        `Repo ${slug} has .solosquad/ but archive extraction did not register it. ` +
        `Aborting to avoid touching a repo whose meta was not safely archived.`,
      );
    }
  }
}

function surgicalRemoveRepoSolosquad(solosquadDir: string, dryRun: boolean): RepoAssertion {
  const repoRoot = path.dirname(solosquadDir);
  if (!fs.existsSync(solosquadDir)) {
    return { repoPath: repoRoot, passed: true, reason: "already absent (idempotent)" };
  }
  // Snapshot every path under repoRoot *excluding* .solosquad/
  const beforeSnapshot = snapshotRepoExcludingSolosquad(repoRoot);
  if (!dryRun) {
    fs.rmSync(solosquadDir, { recursive: true, force: true });
  }
  // Compare snapshot
  const afterSnapshot = dryRun
    ? beforeSnapshot
    : snapshotRepoExcludingSolosquad(repoRoot);
  if (!snapshotsEqual(beforeSnapshot, afterSnapshot)) {
    return {
      repoPath: repoRoot,
      passed: false,
      reason: "files outside .solosquad/ changed during surgical removal",
    };
  }
  return { repoPath: repoRoot, passed: true };
}

interface PathSnapshot {
  relPath: string;
  size: number;
  mtimeMs: number;
}

function snapshotRepoExcludingSolosquad(repoRoot: string): PathSnapshot[] {
  const out: PathSnapshot[] = [];
  function walk(dir: string): void {
    let list: fs.Dirent[];
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const child = path.join(dir, e.name);
      const rel = path.relative(repoRoot, child).split(path.sep).join("/");
      if (rel === ".solosquad" || rel.startsWith(".solosquad/")) continue;
      if (e.isDirectory()) {
        walk(child);
      } else if (e.isFile()) {
        try {
          const stat = fs.statSync(child);
          out.push({ relPath: rel, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // ignore
        }
      }
    }
  }
  walk(repoRoot);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

function snapshotsEqual(a: PathSnapshot[], b: PathSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].relPath !== b[i].relPath) return false;
    if (a[i].size !== b[i].size) return false;
    if (a[i].mtimeMs !== b[i].mtimeMs) return false;
  }
  return true;
}

function purgeOrgLevel(opts: CleanupOptions, report: CleanupReport): void {
  const orgRoots = new Set<string>();
  for (const e of opts.classification.entries) {
    if (e.orgSlug) {
      orgRoots.add(path.join(opts.workspace, e.orgSlug));
    }
  }

  for (const e of opts.classification.entries) {
    if (e.cls === "A" || e.cls === "A*" || e.cls === "E") continue;
    if (!e.orgSlug) continue; // workspace-level entries handled separately
    if (e.kind === "directory") continue; // delete files; directories cleaned via rmSync below

    const keepOnDisk = opts.keepWorkspace && shouldKeepUnderKeepWorkspace(e.cls, e.relPath);
    if (keepOnDisk) {
      report.preserved.push(e.absPath);
      continue;
    }

    // Special: sessions/*.json under --keep-workspace → move to _archived/
    if (
      opts.keepWorkspace &&
      e.cls === "C" &&
      /(?:^|\/)(\.solosquad\/)?sessions\/[^/]+\.json$/.test(e.relPath)
    ) {
      const archivedDir = path.join(path.dirname(e.absPath), "_archived");
      if (!opts.dryRun) {
        fs.mkdirSync(archivedDir, { recursive: true });
        fs.renameSync(e.absPath, path.join(archivedDir, path.basename(e.absPath)));
      }
      report.archivedSessions.push(e.absPath);
      continue;
    }

    if (!fs.existsSync(e.absPath)) {
      report.skipped.push(e.absPath);
      continue;
    }
    if (!opts.dryRun) fs.rmSync(e.absPath, { force: true });
    report.removed.push(e.absPath);
  }

  // Remove empty directories left over from file removals (only directories
  // we know are SoloSquad-owned — never user-owned).
  if (!opts.dryRun) {
    for (const e of [...opts.classification.entries].reverse()) {
      if (e.cls === "A" || e.cls === "A*" || e.cls === "E") continue;
      if (e.kind !== "directory") continue;
      if (!e.orgSlug) continue;
      if (opts.keepWorkspace && shouldKeepUnderKeepWorkspace(e.cls, e.relPath)) continue;
      try {
        fs.rmdirSync(e.absPath);
        report.removed.push(e.absPath);
      } catch {
        // not empty or doesn't exist — that's fine
      }
    }
  }

  // Finally, if an entire org directory is empty (no repos, no SoloSquad
  // assets) and the user didn't say --keep-workspace, remove it.
  if (!opts.dryRun && !opts.keepWorkspace) {
    for (const orgRoot of orgRoots) {
      if (!fs.existsSync(orgRoot)) continue;
      // Never remove if repositories/ has children (user code present).
      const reposDir = path.join(orgRoot, "repositories");
      if (fs.existsSync(reposDir) && fs.readdirSync(reposDir).length > 0) continue;
      try {
        if (fs.readdirSync(orgRoot).length === 0) {
          fs.rmdirSync(orgRoot);
          report.removed.push(orgRoot);
        }
      } catch {
        // ignore
      }
    }
  }
}

function purgeWorkspaceLevel(opts: CleanupOptions, report: CleanupReport): void {
  for (const e of opts.classification.entries) {
    if (e.cls === "A" || e.cls === "A*" || e.cls === "E") continue;
    if (e.orgSlug) continue; // org entries handled above
    if (e.kind === "directory") continue;

    const keepOnDisk = opts.keepWorkspace && shouldKeepUnderKeepWorkspace(e.cls, e.relPath);
    if (keepOnDisk) {
      report.preserved.push(e.absPath);
      continue;
    }

    if (!fs.existsSync(e.absPath)) {
      report.skipped.push(e.absPath);
      continue;
    }
    if (!opts.dryRun) fs.rmSync(e.absPath, { force: true });
    report.removed.push(e.absPath);
  }

  // Empty workspace-level directories last (workspace-level only)
  if (!opts.dryRun) {
    for (const e of [...opts.classification.entries].reverse()) {
      if (e.cls === "A" || e.cls === "A*" || e.cls === "E") continue;
      if (e.orgSlug) continue;
      if (e.kind !== "directory") continue;
      if (opts.keepWorkspace && shouldKeepUnderKeepWorkspace(e.cls, e.relPath)) continue;
      try {
        fs.rmdirSync(e.absPath);
        report.removed.push(e.absPath);
      } catch {
        // not empty — fine
      }
    }
  }
}

/**
 * Decide whether a class B/C entry should remain on disk under
 * `--keep-workspace`. Per §5.4 matrix:
 *   - B always kept on disk (preserved for re-install)
 *   - C: workspace.yaml + .org.yaml are deleted (re-init regenerates).
 *     Other C entries (.solosquad/agents/, docker-compose.yml, etc.) are
 *     also deleted since re-init regenerates them. sessions/*.json get
 *     special handling above.
 *   - D always deleted.
 */
function shouldKeepUnderKeepWorkspace(cls: string, relPath: string): boolean {
  if (cls === "B") return true;
  if (cls === "C") {
    // Knowledge/core embedded in .solosquad/ under workspace are class B
    // already in classify.ts (they live inside .solosquad/knowledge etc.).
    // The remaining class-C entries are operational metadata — delete.
    return false;
  }
  if (cls === "D") return false;
  return false;
}

export const _cleanupInternals = {
  surgicalRemoveRepoSolosquad,
  snapshotRepoExcludingSolosquad,
  snapshotsEqual,
  shouldKeepUnderKeepWorkspace,
};
