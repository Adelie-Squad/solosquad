import fs from "fs";
import os from "os";
import path from "path";
import {
  loadLedger,
  saveLedger,
  setPendingV06,
  type ClassificationLabel,
  type Ledger,
  type LedgerEntry,
} from "./ledger.js";
import { LEDGER_REL_PATH } from "./ledger.js";

/**
 * v0.5 §6.5 — applier. Backup → apply → verify → rollback chain. Reuses
 * the v0.2.3 backup framework conceptually (snapshot a directory tree,
 * restore on failure) but parameterized for *repo-level* onboarding rather
 * than workspace-level migration. The snapshot root is
 * `~/.solosquad-backups/<ISO8601>-repo-onboard/` per spec.
 *
 * Verification calls the injected `verify` hook (the CLI wires it to
 * `rebuildRoutes()` from agent-router.js). On any failure during apply,
 * the backup is restored and the original ledger left intact.
 */

export type MergePolicy = "append" | "override" | "replace";

export interface ApplyOpts {
  repo_root: string;
  org_slug: string;
  workspace_root: string;
  /** Optional override of the user-global agents dir (testing). */
  user_global_dir?: string;
  /** Optional override of the backup root (testing). */
  backup_root?: string;
  /** Merge policy for role-label files landing in user-global agents (§6.5). */
  merge_policy?: MergePolicy;
  /**
   * Injected verifier. Called after applying. If it throws or returns
   * `{ ok: false }`, the applier rolls back automatically.
   */
  verify?: () => { ok: boolean; error?: string };
  /** Override now() for deterministic backup folder names in tests. */
  now?: () => Date;
}

export interface ApplyResult {
  applied_count: number;
  skipped_count: number;
  backup_dir: string;
  destinations: { path: string; destination: string; label: ClassificationLabel }[];
  rolled_back: boolean;
  error?: string;
}

const TEAM_HINTS: Record<string, string> = {
  pmf: "strategy",
  feature: "strategy",
  policy: "strategy",
  data: "engineering",
  business: "strategy",
  idea: "strategy",
  scope: "strategy",
  gtm: "growth",
  content: "growth",
  brand: "growth",
  marketing: "growth",
  research: "experience",
  desk: "experience",
  ux: "experience",
  ui: "experience",
  frontend: "engineering",
  fde: "engineering",
  architect: "engineering",
  backend: "engineering",
  api: "engineering",
  cloud: "engineering",
  qa: "engineering",
  security: "engineering",
};

export function inferTeam(filename: string): string {
  const base = path.basename(filename, path.extname(filename)).toLowerCase();
  for (const [hint, team] of Object.entries(TEAM_HINTS)) {
    if (base.includes(hint)) return team;
  }
  return "strategy";
}

export function inferAgentSlug(filename: string): string {
  return path
    .basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Compute the destination path for one ledger entry per §6.5 / §6.2 v0.5
 * temporary column. Note: codebase-fact returns `null` because the file
 * stays in the repo and no move is needed.
 */
export function destinationFor(
  entry: LedgerEntry,
  ctx: { workspace_root: string; org_slug: string; user_global_dir: string }
): string | null {
  switch (entry.classification) {
    case "codebase-fact":
      return null;
    case "role": {
      const team = inferTeam(entry.path);
      const agent = inferAgentSlug(entry.path);
      return path.join(ctx.user_global_dir, team, agent, "SKILL.md");
    }
    case "workflow": {
      return path.join(
        ctx.workspace_root,
        ctx.org_slug,
        "workflows",
        path.basename(entry.path)
      );
    }
    case "domain": {
      return path.join(
        ctx.workspace_root,
        ctx.org_slug,
        "memory",
        "domain",
        path.basename(entry.path)
      );
    }
  }
}

interface BackupSnapshot {
  dir: string;
  copies: { absolute: string; original_existed: boolean; original_body?: Buffer }[];
}

export async function applyReport(opts: ApplyOpts): Promise<ApplyResult> {
  const now = opts.now ?? (() => new Date());
  const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const userGlobal =
    opts.user_global_dir ?? path.join(os.homedir(), ".solosquad", "agents");
  const backupRoot =
    opts.backup_root ?? path.join(os.homedir(), ".solosquad-backups");
  const backupDir = path.join(backupRoot, `${stamp}-repo-onboard`);
  const mergePolicy: MergePolicy = opts.merge_policy ?? "append";

  const ledgerPath = path.join(opts.repo_root, LEDGER_REL_PATH);
  const ledger = loadLedger(ledgerPath);
  if (!ledger) {
    throw new Error(
      `analysis ledger missing — run \`solosquad analyze repo ${opts.repo_root}\` first`
    );
  }

  fs.mkdirSync(backupDir, { recursive: true });
  // Snapshot the ledger itself + any files we may overwrite.
  const snapshot: BackupSnapshot = { dir: backupDir, copies: [] };
  recordBackup(snapshot, ledgerPath);

  const result: ApplyResult = {
    applied_count: 0,
    skipped_count: 0,
    backup_dir: backupDir,
    destinations: [],
    rolled_back: false,
  };

  try {
    for (const entry of ledger.analyzed) {
      if (entry.applied) {
        result.skipped_count++;
        continue;
      }
      const dest = destinationFor(entry, {
        workspace_root: opts.workspace_root,
        org_slug: opts.org_slug,
        user_global_dir: userGlobal,
      });
      if (dest === null) {
        // codebase-fact stays in the repo, but still mark applied.
        entry.applied = true;
        result.applied_count++;
        result.destinations.push({
          path: entry.path,
          destination: "(repo)",
          label: entry.classification,
        });
        continue;
      }

      const sourceAbs = path.join(
        opts.repo_root,
        entry.path.split("/").join(path.sep)
      );
      if (!fs.existsSync(sourceAbs)) {
        throw new Error(
          `source file vanished between analyze and apply: ${entry.path}`
        );
      }
      recordBackup(snapshot, dest);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      writeMerged(sourceAbs, dest, mergePolicy);

      entry.applied = true;
      // v0.5 §6.2 — role + domain wait for v0.6 receiver-side migration.
      setPendingV06(
        entry,
        entry.classification === "role" || entry.classification === "domain"
      );
      result.applied_count++;
      result.destinations.push({
        path: entry.path,
        destination: dest,
        label: entry.classification,
      });
    }

    // Persist updated ledger.
    saveLedger(ledgerPath, ledger);

    // Verify (caller usually rebuildRoutes()).
    if (opts.verify) {
      const v = opts.verify();
      if (!v.ok) {
        throw new Error(`verify failed: ${v.error ?? "unknown"}`);
      }
    }

    return result;
  } catch (e) {
    result.rolled_back = true;
    result.error = (e as Error).message;
    rollback(snapshot);
    // Reload original ledger to drop any in-memory mutations.
    try {
      const original = loadLedger(ledgerPath);
      if (original) saveLedger(ledgerPath, original);
    } catch {
      /* best effort */
    }
    return result;
  }
}

function recordBackup(snapshot: BackupSnapshot, absolute: string): void {
  if (snapshot.copies.some((c) => c.absolute === absolute)) return;
  const exists = fs.existsSync(absolute);
  const entry: BackupSnapshot["copies"][number] = {
    absolute,
    original_existed: exists,
  };
  if (exists) {
    entry.original_body = fs.readFileSync(absolute);
    // Mirror under backup dir for human inspection.
    const mirror = path.join(snapshot.dir, encodeAbs(absolute));
    fs.mkdirSync(path.dirname(mirror), { recursive: true });
    fs.writeFileSync(mirror, entry.original_body);
  }
  snapshot.copies.push(entry);
}

function rollback(snapshot: BackupSnapshot): void {
  for (const c of snapshot.copies) {
    try {
      if (c.original_existed && c.original_body) {
        fs.mkdirSync(path.dirname(c.absolute), { recursive: true });
        fs.writeFileSync(c.absolute, c.original_body);
      } else if (fs.existsSync(c.absolute)) {
        fs.unlinkSync(c.absolute);
      }
    } catch {
      /* best effort */
    }
  }
}

function encodeAbs(p: string): string {
  // Make absolute paths safe filenames for the backup mirror tree.
  return p.replace(/[:\\/]/g, "_");
}

function writeMerged(source: string, dest: string, policy: MergePolicy): void {
  const body = fs.readFileSync(source, "utf-8");
  if (!fs.existsSync(dest) || policy === "replace") {
    fs.writeFileSync(dest, body, "utf-8");
    return;
  }
  if (policy === "override") {
    fs.writeFileSync(dest, body, "utf-8");
    return;
  }
  // append: place a divider + the incoming body at the end.
  const existing = fs.readFileSync(dest, "utf-8");
  const merged =
    existing.trimEnd() +
    "\n\n<!-- v0.5 analyze applier — appended from " +
    path.basename(source) +
    " -->\n" +
    body;
  fs.writeFileSync(dest, merged, "utf-8");
}

export function rollbackBackup(backupDir: string): void {
  // For external callers — replays the snapshot from disk. The backup
  // directory contains mirrored originals named by encoded absolute path.
  if (!fs.existsSync(backupDir)) {
    throw new Error(`backup not found: ${backupDir}`);
  }
  for (const entry of fs.readdirSync(backupDir)) {
    const mirror = path.join(backupDir, entry);
    if (!fs.statSync(mirror).isFile()) continue;
    const absolute = decodeAbs(entry);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.copyFileSync(mirror, absolute);
  }
}

function decodeAbs(name: string): string {
  // Reverse of encodeAbs — naive: replace first `_` after drive letter back
  // to `:`, then split underscores into separators. Only used by the
  // optional rollbackBackup() entry point.
  if (/^[A-Za-z]_/.test(name)) {
    return name[0] + ":" + name.slice(1).replace(/_/g, path.sep);
  }
  return path.sep + name.replace(/_/g, path.sep);
}
