import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import type { BackupMeta } from "./types.js";

const BACKUP_ROOT = path.join(os.homedir(), ".solosquad-backups");
const KEEP_N = 5;

function timestampStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function copyDirRecursive(src: string, dest: string, skip: (p: string) => boolean): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (skip(srcPath)) continue;
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, skip);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function removeDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Create a snapshot of the workspace. Returns the backup directory path. */
export function createBackup(workspace: string, sourceVersion: string, targetVersion: string, chain: string[]): string {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  const stamp = timestampStamp();
  const dir = path.join(BACKUP_ROOT, `${stamp}-v${sourceVersion}`);
  fs.mkdirSync(dir, { recursive: true });

  const contentDir = path.join(dir, "workspace");
  copyDirRecursive(workspace, contentDir, (p) => {
    // Skip .git directories (tracked elsewhere) and node_modules (large + reinstallable)
    const base = path.basename(p);
    return base === ".git" || base === "node_modules" || base === ".solosquad-backups";
  });

  const meta: BackupMeta = {
    workspace: path.resolve(workspace),
    source_version: sourceVersion,
    target_version: targetVersion,
    created_at: new Date().toISOString(),
    migration_chain: chain,
  };
  fs.writeFileSync(path.join(dir, ".meta.yaml"), yaml.dump(meta));

  pruneOldBackups();
  return dir;
}

/** Keep the most recent KEEP_N backups; delete older ones. */
function pruneOldBackups(): void {
  if (!fs.existsSync(BACKUP_ROOT)) return;
  const entries = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: path.join(BACKUP_ROOT, e.name) }))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of entries.slice(KEEP_N)) {
    removeDirRecursive(entry.full);
  }
}

export interface BackupEntry {
  id: string;
  path: string;
  meta: BackupMeta;
}

export function listBackups(): BackupEntry[] {
  if (!fs.existsSync(BACKUP_ROOT)) return [];
  const entries = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a));

  const results: BackupEntry[] = [];
  for (const name of entries) {
    const full = path.join(BACKUP_ROOT, name);
    const metaFile = path.join(full, ".meta.yaml");
    if (!fs.existsSync(metaFile)) continue;
    try {
      const meta = yaml.load(fs.readFileSync(metaFile, "utf-8")) as BackupMeta;
      results.push({ id: name, path: full, meta });
    } catch {
      /* skip corrupt */
    }
  }
  return results;
}

/** Restore a workspace from a backup directory (overwrites target). */
export function restoreBackup(backupDir: string, targetWorkspace: string): void {
  const contentDir = path.join(backupDir, "workspace");
  if (!fs.existsSync(contentDir)) {
    throw new Error(`Backup content missing: ${contentDir}`);
  }

  // Clear target (except .git, node_modules, backups)
  if (fs.existsSync(targetWorkspace)) {
    for (const entry of fs.readdirSync(targetWorkspace)) {
      if (entry === ".git" || entry === "node_modules") continue;
      const entryPath = path.join(targetWorkspace, entry);
      try {
        const stat = fs.lstatSync(entryPath);
        if (stat.isDirectory()) {
          removeDirRecursive(entryPath);
        } else {
          fs.unlinkSync(entryPath);
        }
      } catch {
        /* skip */
      }
    }
  } else {
    fs.mkdirSync(targetWorkspace, { recursive: true });
  }

  copyDirRecursive(contentDir, targetWorkspace, () => false);
}

export function deleteBackup(id: string): boolean {
  const dir = path.join(BACKUP_ROOT, id);
  if (!fs.existsSync(dir)) return false;
  removeDirRecursive(dir);
  return true;
}

export function getBackupRoot(): string {
  return BACKUP_ROOT;
}
