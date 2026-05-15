import fs from "fs";
import os from "os";
import path from "path";

/**
 * v0.7 — concurrent-uninstall guard.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §5.1 precheck + P1 #6.
 *
 * A lockfile at `<workspace>/.solosquad/uninstall.lock` prevents two
 * `solosquad uninstall` invocations from racing each other on the same
 * workspace. The file records the holder's PID and start timestamp, so
 * stale locks (PID dead) are detected and cleared automatically.
 *
 * Atomic acquisition uses `O_CREAT | O_EXCL` (Node `wx` flag), which is
 * race-safe across POSIX and Win32.
 */

export interface LockInfo {
  pid: number;
  startTs: string;
  hostname: string;
}

export interface LockHandle {
  /** Absolute path of the lockfile on disk. */
  path: string;
  /** Release the lock (delete the file). Idempotent. */
  release(): void;
}

export class LockHeldError extends Error {
  constructor(public readonly info: LockInfo, public readonly lockPath: string) {
    super(
      `uninstall already in progress (pid ${info.pid}, started ${info.startTs}, host ${info.hostname}). ` +
      `Lock file: ${lockPath}`,
    );
    this.name = "LockHeldError";
  }
}

/**
 * Cross-platform "is this PID alive?" probe. Uses `process.kill(pid, 0)` —
 * signal 0 sends no signal but throws ESRCH if the process is gone.
 *
 * On Win32, Node implements signal 0 by calling OpenProcess; permission
 * issues throw EPERM, which we treat as "alive but not ours" (still alive).
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EPERM") return true;
    return false;
  }
}

export function readLock(lockPath: string): LockInfo | null {
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = fs.readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as LockInfo;
    if (typeof parsed.pid !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Returns true if the lockfile exists but its holder process is gone.
 * Falsy if the lockfile is absent, or holder is alive, or content is
 * unparseable (in which case treat as held to avoid false-clean).
 */
export function isStaleLock(lockPath: string): boolean {
  const info = readLock(lockPath);
  if (!info) return false;
  // Different host — cannot probe; treat as held (defensive).
  if (info.hostname && info.hostname !== os.hostname()) return false;
  return !isProcessAlive(info.pid);
}

export interface AcquireOptions {
  /** Override pid (tests). */
  pid?: number;
  /** Override hostname (tests). */
  hostname?: string;
  /** Override start ts (tests). */
  startTs?: string;
  /**
   * If true and the existing lockfile is stale (holder dead), silently
   * delete it and proceed. Default true — non-stale locks still throw.
   */
  clearStale?: boolean;
}

/**
 * Acquire the lock or throw `LockHeldError` if a live holder exists. The
 * caller is responsible for invoking `release()` in finally blocks.
 */
export function acquireLock(lockPath: string, options: AcquireOptions = {}): LockHandle {
  const clearStale = options.clearStale !== false;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (fs.existsSync(lockPath)) {
    if (clearStale && isStaleLock(lockPath)) {
      fs.unlinkSync(lockPath);
    } else {
      const existing = readLock(lockPath);
      throw new LockHeldError(
        existing ?? { pid: -1, startTs: "unknown", hostname: "unknown" },
        lockPath,
      );
    }
  }

  const info: LockInfo = {
    pid: options.pid ?? process.pid,
    startTs: options.startTs ?? new Date().toISOString(),
    hostname: options.hostname ?? os.hostname(),
  };

  // wx = O_CREAT | O_EXCL — fail if file exists (race-safe).
  try {
    fs.writeFileSync(lockPath, JSON.stringify(info, null, 2), { flag: "wx" });
  } catch (err) {
    // Another process won the race in between our existsSync and write.
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST") {
      const existing = readLock(lockPath);
      throw new LockHeldError(
        existing ?? { pid: -1, startTs: "unknown", hostname: "unknown" },
        lockPath,
      );
    }
    throw err;
  }

  let released = false;
  return {
    path: lockPath,
    release(): void {
      if (released) return;
      released = true;
      try {
        const current = readLock(lockPath);
        if (current && current.pid === info.pid && current.startTs === info.startTs) {
          fs.unlinkSync(lockPath);
        }
      } catch {
        // ignore — best effort
      }
    },
  };
}

/**
 * Convenience: get the conventional lock path under a workspace.
 */
export function uninstallLockPath(workspace: string): string {
  return path.join(workspace, ".solosquad", "uninstall.lock");
}

export function logoutLockPath(workspace: string): string {
  return path.join(workspace, ".solosquad", "logout.lock");
}
