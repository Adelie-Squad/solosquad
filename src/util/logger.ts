import fs from "fs";
import path from "path";
import chalk from "chalk";

/**
 * v0.8.3 §5.1 — logger extension.
 *
 * Adds three orthogonal capabilities while keeping every existing call
 * site (`logger.info / warn / error / success / dim`) byte-compatible:
 *
 *   1. Log levels via `SOLOSQUAD_LOG_LEVEL` (error / warn / info / debug)
 *   2. Optional JSON output via `SOLOSQUAD_LOG_FORMAT=json`
 *   3. Optional file mirror via `SOLOSQUAD_LOG_FILE=1` →
 *      `<workspace>/.solosquad/logs/solosquad-YYYY-MM-DD.log` with date
 *      rolling. Retention (14d) is enforced by the daily log-rotate
 *      routine; the logger itself only writes the current day.
 *
 * Env reads happen *per call* (not module load) so tests can flip env
 * vars between scenarios without re-importing.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function activeLevel(): LogLevel {
  const raw = (process.env.SOLOSQUAD_LOG_LEVEL || "").toLowerCase();
  if (raw === "error" || raw === "warn" || raw === "info" || raw === "debug") return raw;
  return "info";
}

function activeFormat(): "text" | "json" {
  return (process.env.SOLOSQUAD_LOG_FORMAT || "").toLowerCase() === "json"
    ? "json"
    : "text";
}

function fileOutputEnabled(): boolean {
  const v = (process.env.SOLOSQUAD_LOG_FILE || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[activeLevel()];
}

function todayStamp(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Resolve the workspace root for log file writes. We avoid importing
 * `getWorkspaceRoot()` to keep this module free of cross-package
 * cycles (paths.ts → migrations/detect → util). Instead we accept an
 * env-override `SOLOSQUAD_LOG_DIR` for tests and otherwise walk up from
 * cwd looking for `.solosquad/`.
 */
function resolveLogDir(): string | null {
  const overrideDir = process.env.SOLOSQUAD_LOG_DIR;
  if (overrideDir) {
    try {
      fs.mkdirSync(overrideDir, { recursive: true });
    } catch {
      return null;
    }
    return overrideDir;
  }
  let current = process.cwd();
  while (true) {
    const candidate = path.join(current, ".solosquad");
    if (fs.existsSync(candidate)) {
      const logDir = path.join(candidate, "logs");
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch {
        return null;
      }
      return logDir;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function currentLogFile(now: Date = new Date()): string | null {
  const dir = resolveLogDir();
  if (!dir) return null;
  return path.join(dir, `solosquad-${todayStamp(now)}.log`);
}

interface LogRecord {
  ts: string;
  level: LogLevel;
  tag?: string;
  message: string;
}

function record(level: LogLevel, message: string, tag?: string): LogRecord {
  return { ts: new Date().toISOString(), level, tag, message };
}

function emitConsole(rec: LogRecord): void {
  const fmt = activeFormat();
  if (fmt === "json") {
    const json = JSON.stringify(rec);
    if (rec.level === "error") {
      console.error(json);
    } else {
      console.log(json);
    }
    return;
  }
  const tagPart = rec.tag ? chalk.dim(`[${rec.tag}] `) : "";
  switch (rec.level) {
    case "error":
      console.error(chalk.red("✗"), tagPart + rec.message);
      break;
    case "warn":
      console.log(chalk.yellow("⚠"), tagPart + rec.message);
      break;
    case "info":
      console.log(tagPart + rec.message);
      break;
    case "debug":
      console.log(chalk.dim(`[debug] ${tagPart}${rec.message}`));
      break;
  }
}

function emitFile(rec: LogRecord): void {
  if (!fileOutputEnabled()) return;
  const file = currentLogFile();
  if (!file) return;
  // Always JSON in file (parseable by `solosquad logs --type runtime`).
  try {
    fs.appendFileSync(file, JSON.stringify(rec) + "\n");
  } catch {
    // best-effort; don't crash callers if disk is full
  }
}

function dispatch(level: LogLevel, message: string, tag?: string): void {
  if (!shouldEmit(level)) return;
  const rec = record(level, message, tag);
  emitConsole(rec);
  emitFile(rec);
}

/**
 * v0.8.3 — file-only convenience for direct log writes (e.g. tests).
 * Skips console entirely. Honors level + format.
 */
export function logRaw(level: LogLevel, message: string, tag?: string): void {
  if (!shouldEmit(level)) return;
  emitFile(record(level, message, tag));
}

export const logger = {
  info(tag: string, message: string): void {
    dispatch("info", message, tag);
  },
  success(message: string): void {
    // success is a stylistic variant of info — emit at info level
    if (!shouldEmit("info")) return;
    const rec = record("info", message);
    if (activeFormat() === "json") {
      console.log(JSON.stringify({ ...rec, kind: "success" }));
    } else {
      console.log(chalk.green("✓"), message);
    }
    emitFile(rec);
  },
  warn(message: string): void {
    dispatch("warn", message);
  },
  error(message: string): void {
    dispatch("error", message);
  },
  dim(message: string): void {
    if (!shouldEmit("info")) return;
    const rec = record("info", message);
    if (activeFormat() === "json") {
      console.log(JSON.stringify({ ...rec, kind: "dim" }));
    } else {
      console.log(chalk.dim(message));
    }
    emitFile(rec);
  },
  debug(message: string, tag?: string): void {
    dispatch("debug", message, tag);
  },
};

/**
 * v0.8.3 — Retention pass for the daily log-rotate routine.
 * Deletes solosquad-YYYY-MM-DD.log files older than `retentionDays`.
 * Returns the list of removed file paths.
 */
export function rotateLogs(opts: { retentionDays?: number; logDir?: string; now?: Date } = {}): string[] {
  const retentionDays = opts.retentionDays ?? 14;
  const dir = opts.logDir ?? resolveLogDir();
  if (!dir || !fs.existsSync(dir)) return [];
  const cutoff = (opts.now ?? new Date()).getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    const m = name.match(/^solosquad-(\d{4}-\d{2}-\d{2})\.log$/);
    if (!m) continue;
    const stamp = m[1];
    const ts = Date.parse(stamp + "T00:00:00Z");
    if (Number.isNaN(ts)) continue;
    if (ts < cutoff) {
      try {
        fs.unlinkSync(path.join(dir, name));
        removed.push(path.join(dir, name));
      } catch {
        // ignore
      }
    }
  }
  return removed;
}

/** Test helper — exposes internal env reads so tests can verify dynamic behavior. */
export const _loggerInternals = {
  activeLevel,
  activeFormat,
  fileOutputEnabled,
  resolveLogDir,
};
