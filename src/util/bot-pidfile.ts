import fs from "fs";
import path from "path";
import { getSolosquadConfigDir } from "./paths.js";

/**
 * v1.2.8 §A.10 — Bot PID file.
 *
 * Written by `solosquad bot` at startup, removed on graceful exit.
 * `solosquad migrate --apply` reads it to signal the running bot so
 * the user doesn't have to manually Ctrl+C and re-run after every
 * migration. Cloud process managers (PM2 / systemd / Docker) auto-
 * restart on SIGTERM. Local users running `solosquad bot --supervise`
 * also auto-restart. Plain local users still re-run manually, but
 * at least the bot dies cleanly instead of leaving stale state.
 *
 * Path: `<workspace>/.solosquad/bot.pid`
 * Format: one line, the integer PID. No metadata — keep it simple,
 * the only thing migrate needs is `kill <pid>`.
 *
 * Concurrency: multiple bot processes from the same workspace are not
 * supported. The bot already assumes a single instance per workspace
 * (channel-binding, session store). If a stale PID file exists when
 * `solosquad bot` starts, we check if the process is still alive
 * before overwriting — keeps a real running bot from getting silently
 * orphaned.
 */

function pidFilePath(workspace?: string): string {
  return path.join(getSolosquadConfigDir(workspace), "bot.pid");
}

/**
 * Returns true iff a process with `pid` is alive. Cross-platform via
 * `process.kill(pid, 0)` which is the standard liveness check — sends
 * the null signal which is just a permission probe.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ESRCH = no such process. EPERM = exists but we lack permission
    // (still counts as alive). Anything else: treat as not alive.
    if (code === "EPERM") return true;
    return false;
  }
}

/**
 * Read the PID file. Returns the integer PID, or null when:
 *   - file missing
 *   - file empty / unparseable
 *   - PID parses but the named process is dead (stale file)
 *
 * When a stale file is detected, it's removed as a side-effect so the
 * caller doesn't have to clean it up.
 */
export function readBotPid(workspace?: string): number | null {
  const file = pidFilePath(workspace);
  if (!fs.existsSync(file)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8").trim();
  } catch {
    return null;
  }
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* best-effort */
    }
    return null;
  }
  if (!isProcessAlive(pid)) {
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
 * Write the current process's PID to the file. Replaces any prior
 * content. Logs a warning if a stale PID file pointed at a different
 * still-alive PID — that means another bot is running in this
 * workspace, which is unsupported. The new bot still proceeds (we
 * don't refuse to start) but the user gets a visible hint.
 *
 * Returns the path written, for the caller's log line.
 */
export function writeBotPid(workspace?: string): string {
  const file = pidFilePath(workspace);
  const existing = readBotPid(workspace);
  if (existing !== null && existing !== process.pid) {
    console.log(
      `[Bot] WARNING: bot.pid already held PID ${existing} (still alive). ` +
        `Two bots in one workspace is unsupported — channel binding + session ` +
        `store will fight. Stopping the other first is recommended.`,
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(process.pid));
  return file;
}

/**
 * Remove the PID file if it points at the current process. Idempotent:
 * if the file is missing or points at someone else, we leave it alone.
 * Caller is the bot's own exit handler.
 */
export function clearBotPid(workspace?: string): void {
  const file = pidFilePath(workspace);
  try {
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    if (pid === process.pid) {
      fs.unlinkSync(file);
    }
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Send SIGTERM to the bot listed in the PID file. Returns:
 *   "signaled"  — PID was alive, signal sent (cross-platform). Caller
 *                 may want to give it a moment before exiting.
 *   "not-running" — no PID file or PID is dead/orphaned.
 *   "error"     — signal failed (e.g. permission denied).
 *
 * On Windows the same `process.kill(pid, "SIGTERM")` call dispatches a
 * native terminate — Node's runtime maps it to TerminateProcess. The
 * bot's SIGTERM handler runs as expected on POSIX; on Windows the
 * process exits abruptly but cleanly enough for the migration purpose.
 */
export function signalBotRestart(
  workspace?: string,
): { kind: "signaled" | "not-running" | "error"; pid?: number; message?: string } {
  const pid = readBotPid(workspace);
  if (pid === null) return { kind: "not-running" };
  try {
    process.kill(pid, "SIGTERM");
    return { kind: "signaled", pid };
  } catch (err) {
    return {
      kind: "error",
      pid,
      message: (err as Error).message,
    };
  }
}
