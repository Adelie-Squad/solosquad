import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

/**
 * v0.7 — WAL-safe SQLite backup for `<org>/memory/archive.sqlite` (v0.6 FTS5).
 * Per docs/plan/v0.7-uninstall-lifecycle.md §10 #4.
 *
 * Uses better-sqlite3's `.backup()` method, which wraps SQLite's Online
 * Backup API. This produces a consistent snapshot even if another process
 * (PM session, scheduler) is currently writing — pages are copied with
 * coordination via SQLite's locking, so the destination file is byte-level
 * valid at the end.
 *
 * Returns `BackupResult` with bytes/pages so the caller (archive writer)
 * can record provenance in the manifest.
 */

export interface BackupResult {
  /** Number of source bytes copied. */
  bytes: number;
  /** Number of pages copied (page_size from PRAGMA). */
  pages: number;
  /** Destination path on disk. */
  destPath: string;
}

/**
 * Copy `srcPath` to `destPath` using SQLite's online backup. Throws if the
 * source does not exist. The destination directory is created if missing.
 *
 * The source database is opened read-only to be defensive: nothing in the
 * lifecycle pipeline should mutate the live FTS5 archive.
 */
export async function backupSqlite(srcPath: string, destPath: string): Promise<BackupResult> {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`SQLite source not found: ${srcPath}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const src = new Database(srcPath, { readonly: true, fileMustExist: true });
  try {
    // better-sqlite3 v12 `db.backup` returns Promise<BackupMetadata>.
    const meta = await src.backup(destPath);
    const stats = fs.statSync(destPath);
    return {
      bytes: stats.size,
      pages: meta.totalPages ?? 0,
      destPath,
    };
  } finally {
    src.close();
  }
}

/**
 * Sanity check that the destination is a valid SQLite database after backup.
 * Returns `true` if the file opens and `PRAGMA integrity_check` returns `ok`.
 */
export function verifyBackup(destPath: string): boolean {
  if (!fs.existsSync(destPath)) return false;
  const db = new Database(destPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.pragma("integrity_check", { simple: true }) as string;
    return row === "ok";
  } catch {
    return false;
  } finally {
    db.close();
  }
}
