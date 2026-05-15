import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getWorkspaceRoot } from "../util/paths.js";
import { listOrganizations } from "../util/config.js";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.8.3 §5.2 — `solosquad logs` CLI.
 *
 *   solosquad logs [--level X] [--tail N] [--follow] [--since "1 hour ago"]
 *                  [--type runtime|costs|spawn|stop-hook|dev-confirm|migration]
 *                  [--org <slug>]
 *
 * `--type` can be repeated for a multi-stream tail. Each line is parsed
 * (best-effort) as JSON; lines that fail to parse are streamed verbatim.
 * Level + since filters apply only to JSON lines that expose a `level`
 * or `ts` field (the v0.8.3 logger writes both).
 */

export type LogType =
  | "runtime"
  | "costs"
  | "spawn"
  | "stop-hook"
  | "dev-confirm"
  | "migration";

export const LOG_TYPES: LogType[] = [
  "runtime",
  "costs",
  "spawn",
  "stop-hook",
  "dev-confirm",
  "migration",
];

export interface LogsOpts {
  level?: string;
  tail?: string;
  follow?: boolean;
  since?: string;
  /** Repeatable. */
  type?: LogType[];
  org?: string;
}

interface ResolvedSource {
  type: LogType;
  file: string;
  /** label for prefixing rendered lines */
  label: string;
}

const LEVEL_ORDER: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export async function logsCommand(opts: LogsOpts): Promise<void> {
  const workspace = getWorkspaceRoot();
  if (!fs.existsSync(path.join(workspace, ".solosquad"))) {
    console.error(chalk.red("✗ Not inside a SoloSquad workspace."));
    process.exitCode = 1;
    return;
  }

  const types: LogType[] = opts.type && opts.type.length > 0 ? opts.type : ["runtime"];
  for (const t of types) {
    if (!LOG_TYPES.includes(t)) {
      console.error(chalk.red(`✗ Unknown --type: ${t}. One of: ${LOG_TYPES.join(", ")}`));
      process.exitCode = 1;
      return;
    }
  }
  const tail = opts.tail ? Math.max(1, parseInt(opts.tail, 10)) : 50;
  const levelFilter = parseLevelFilter(opts.level);
  if (opts.level && levelFilter === undefined) {
    console.error(chalk.red(`✗ Unknown --level: ${opts.level}. One of: error, warn, info, debug`));
    process.exitCode = 1;
    return;
  }
  const sinceMs = opts.since ? parseSinceHuman(opts.since) : null;
  if (opts.since && sinceMs === null) {
    console.error(chalk.red(`✗ Unparseable --since: "${opts.since}"`));
    process.exitCode = 1;
    return;
  }

  const sources = resolveSources(workspace, types, opts.org);
  if (sources.length === 0) {
    console.log(chalk.yellow("No log files found for the given --type/--org."));
    return;
  }

  // Collect last N lines across all sources, sorted by source then time.
  const initial: RenderedLine[] = [];
  for (const src of sources) {
    const lines = readTailLines(src.file, tail);
    for (const raw of lines) {
      const rendered = filterAndRender(raw, levelFilter, sinceMs, src);
      if (rendered) initial.push(rendered);
    }
  }
  initial.sort((a, b) => a.ts - b.ts);
  for (const line of initial.slice(-tail)) {
    console.log(line.text);
  }

  if (opts.follow) {
    await followSources(sources, levelFilter, sinceMs);
  }
}

interface RenderedLine {
  ts: number;
  text: string;
}

function parseLevelFilter(raw?: string): number | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (!(lower in LEVEL_ORDER)) return undefined;
  return LEVEL_ORDER[lower];
}

/**
 * Tiny chrono-like parser for "1 hour ago", "30 minutes ago", "2 days ago".
 * Falls back to Date.parse() for ISO strings.
 */
export function parseSinceHuman(raw: string): number | null {
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;
  const m = raw.trim().match(/^(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks)\s+ago$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const multipliers: Record<string, number> = {
    second: 1000,
    seconds: 1000,
    minute: 60_000,
    minutes: 60_000,
    hour: 3_600_000,
    hours: 3_600_000,
    day: 86_400_000,
    days: 86_400_000,
    week: 7 * 86_400_000,
    weeks: 7 * 86_400_000,
  };
  return Date.now() - n * multipliers[unit];
}

function resolveSources(workspace: string, types: LogType[], orgFilter?: string): ResolvedSource[] {
  const out: ResolvedSource[] = [];

  // runtime is workspace-level
  if (types.includes("runtime")) {
    const dir = path.join(workspace, ".solosquad", "logs");
    if (fs.existsSync(dir)) {
      const files = fs
        .readdirSync(dir)
        .filter((n) => /^solosquad-\d{4}-\d{2}-\d{2}\.log$/.test(n))
        .sort();
      for (const file of files) {
        out.push({ type: "runtime", file: path.join(dir, file), label: `runtime/${file}` });
      }
    }
  }

  // Other types are per-org. Pick orgs explicitly or all.
  const orgs = orgFilter
    ? listOrganizations(workspace).filter((o) => o.slug === orgFilter)
    : listOrganizations(workspace);

  for (const org of orgs) {
    const orgMem = path.join(workspace, org.slug, "memory");
    for (const t of types) {
      if (t === "runtime") continue;
      const file = jsonlFileForType(orgMem, t);
      if (file && fs.existsSync(file)) {
        out.push({ type: t, file, label: `${t}/${org.slug}` });
      }
    }
  }

  return out;
}

function jsonlFileForType(orgMemoryDir: string, type: LogType): string | null {
  switch (type) {
    case "costs":
      return path.join(orgMemoryDir, "agent-costs.jsonl");
    case "spawn":
      return path.join(orgMemoryDir, "spawn-decisions.jsonl");
    case "stop-hook":
      return path.join(orgMemoryDir, "stop-hook-events.jsonl");
    case "dev-confirm":
      return path.join(orgMemoryDir, "dev-confirmations.jsonl");
    case "migration":
      return path.join(orgMemoryDir, "migration-costs.jsonl");
    default:
      return null;
  }
}

function readTailLines(file: string, n: number): string[] {
  try {
    const body = fs.readFileSync(file, "utf-8");
    const lines = normalizeLine(body).split("\n").filter((l) => l.length > 0);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

function filterAndRender(
  raw: string,
  levelFilter: number | undefined,
  sinceMs: number | null,
  src: ResolvedSource,
): RenderedLine | null {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // non-JSON line — pass through
  }
  let tsMs = Date.now();
  if (parsed && typeof parsed.ts === "string") {
    const t = Date.parse(parsed.ts);
    if (!Number.isNaN(t)) tsMs = t;
  }
  if (sinceMs !== null && tsMs < sinceMs) return null;
  if (levelFilter !== undefined && parsed && typeof parsed.level === "string") {
    const rank = LEVEL_ORDER[parsed.level.toLowerCase()];
    if (rank === undefined || rank > levelFilter) return null;
  }
  const text = renderLine(raw, parsed, src);
  return { ts: tsMs, text };
}

function renderLine(raw: string, parsed: Record<string, unknown> | null, src: ResolvedSource): string {
  const tag = chalk.dim(`[${src.label}]`);
  if (!parsed) return `${tag} ${raw}`;
  const ts = typeof parsed.ts === "string" ? parsed.ts : "";
  const level = typeof parsed.level === "string" ? parsed.level : "";
  const message = typeof parsed.message === "string" ? parsed.message : raw;
  const lvlPart = level ? colorizeLevel(level) + " " : "";
  return `${tag} ${chalk.dim(ts)} ${lvlPart}${message}`;
}

function colorizeLevel(level: string): string {
  switch (level.toLowerCase()) {
    case "error":
      return chalk.red("error");
    case "warn":
      return chalk.yellow("warn");
    case "debug":
      return chalk.dim("debug");
    default:
      return chalk.cyan("info");
  }
}

/**
 * Poll-mode follow. Each source remembers its last byte offset; new
 * content is read on every tick (1s default). Quits on SIGINT.
 */
async function followSources(
  sources: ResolvedSource[],
  levelFilter: number | undefined,
  sinceMs: number | null,
): Promise<void> {
  const offsets = new Map<string, number>();
  for (const src of sources) {
    try {
      const stat = fs.statSync(src.file);
      offsets.set(src.file, stat.size);
    } catch {
      offsets.set(src.file, 0);
    }
  }
  console.log(chalk.dim("\n— following (Ctrl+C to stop) —"));

  await new Promise<void>((resolve) => {
    const stopOnce = (): void => {
      clearInterval(timer);
      resolve();
    };
    process.once("SIGINT", stopOnce);
    process.once("SIGTERM", stopOnce);

    const timer = setInterval(() => {
      for (const src of sources) {
        const offset = offsets.get(src.file) ?? 0;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(src.file);
        } catch {
          continue;
        }
        if (stat.size <= offset) continue;
        try {
          const fd = fs.openSync(src.file, "r");
          const buf = Buffer.alloc(stat.size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offsets.set(src.file, stat.size);
          const chunk = normalizeLine(buf.toString("utf-8"));
          for (const raw of chunk.split("\n")) {
            if (!raw.trim()) continue;
            const rendered = filterAndRender(raw, levelFilter, sinceMs, src);
            if (rendered) console.log(rendered.text);
          }
        } catch {
          // ignore — retry next tick
        }
      }
    }, 1000);
  });
}
