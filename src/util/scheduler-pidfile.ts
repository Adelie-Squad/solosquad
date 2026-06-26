import fs from "fs";
import path from "path";
import { getSolosquadConfigDir } from "./paths.js";
import { isProcessAlive } from "./bot-pidfile.js";

/**
 * v1.4.1 — Scheduler PID lock (singleton guard).
 *
 * The cron scheduler must run as a SINGLE instance per workspace — two
 * schedulers register the same node-cron jobs and double-fire every cron
 * (duplicate briefs / compaction posts). `solosquad cron start`, `solosquad bot
 * --with-cron`, and `solosquad start` all go through startScheduler(), which
 * acquires this lock first. If another live scheduler already holds it, cron
 * registration is skipped (the running one keeps firing).
 *
 * Unlike the bot PID file (which warns but still starts — a second bot just
 * fights over channels), the scheduler REFUSES to double-register, because
 * double-firing is silently harmful.
 *
 * Path: `<workspace>/.solosquad/scheduler.pid`
 */

function schedulerPidPath(workspace?: string): string {
  return path.join(getSolosquadConfigDir(workspace), "scheduler.pid");
}

/**
 * Read the live scheduler PID, or null when the file is missing/unparseable or
 * the named process is dead (stale file is removed as a side-effect).
 */
export function readSchedulerPid(workspace?: string): number | null {
  const file = schedulerPidPath(workspace);
  if (!fs.existsSync(file)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8").trim();
  } catch {
    return null;
  }
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0 || !isProcessAlive(pid)) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* best-effort */
    }
    return null;
  }
  return pid;
}

/**
 * Try to acquire the scheduler lock for the current process. Returns
 * `{ acquired: true }` after writing our PID, or `{ acquired: false, heldBy }`
 * when another live scheduler already holds it (caller should skip cron
 * registration to avoid double-firing).
 */
export function acquireSchedulerLock(workspace?: string): { acquired: boolean; heldBy?: number } {
  const existing = readSchedulerPid(workspace);
  if (existing !== null && existing !== process.pid) {
    return { acquired: false, heldBy: existing };
  }
  const file = schedulerPidPath(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(process.pid));
  return { acquired: true };
}

/** Remove the lock if it points at the current process. Idempotent. */
export function clearSchedulerPid(workspace?: string): void {
  const file = schedulerPidPath(workspace);
  try {
    if (!fs.existsSync(file)) return;
    const pid = Number.parseInt(fs.readFileSync(file, "utf-8").trim(), 10);
    if (pid === process.pid) fs.unlinkSync(file);
  } catch {
    /* best-effort cleanup */
  }
}
