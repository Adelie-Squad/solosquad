import chalk from "chalk";
import { listOrganizations } from "../util/config.js";
import { getWorkspaceRoot } from "../util/paths.js";
import { searchArchive, getStats, type SearchResult } from "../memory/archive-search.js";
import { isEventType, type EventType } from "../memory/archive-db.js";

/**
 * v0.6 — `solosquad memory` group.
 *
 * `memory search <query>` and `memory stats [--disk]` per §4.5 #6 + §4.7.
 */

interface MemorySearchOpts {
  org?: string;
  limit?: string;
  eventType?: string;
}

interface MemoryStatsOpts {
  org?: string;
  disk?: boolean;
}

export async function memorySearchCommand(query: string, opts: MemorySearchOpts): Promise<void> {
  if (!query || !query.trim()) {
    console.error(chalk.red("Query must not be empty."));
    process.exitCode = 1;
    return;
  }

  const orgs = pickOrgs(opts.org);
  if (!orgs.length) {
    console.log(chalk.yellow("No organizations registered."));
    return;
  }

  const limit = opts.limit ? Math.max(1, parseInt(opts.limit, 10)) : 10;
  const eventType = parseEventType(opts.eventType);
  if (opts.eventType && !eventType) {
    console.error(chalk.red(`Unknown --event-type: ${opts.eventType}`));
    process.exitCode = 1;
    return;
  }

  const workspace = getWorkspaceRoot();
  let total = 0;
  for (const org of orgs) {
    const hits = searchArchive({
      workspace,
      orgSlug: org,
      query,
      limit,
      eventType,
    });
    if (!hits.length) {
      console.log(chalk.dim(`[${org}] no matches`));
      continue;
    }
    console.log(chalk.bold(`\n[${org}] ${hits.length} match${hits.length === 1 ? "" : "es"}`));
    for (const h of hits) {
      printHit(h);
    }
    total += hits.length;
  }
  if (!total && opts.org) process.exitCode = 1;
}

export async function memoryStatsCommand(opts: MemoryStatsOpts): Promise<void> {
  const orgs = pickOrgs(opts.org);
  if (!orgs.length) {
    console.log(chalk.yellow("No organizations registered."));
    return;
  }

  const workspace = getWorkspaceRoot();
  for (const org of orgs) {
    const stats = getStats({ workspace, orgSlug: org });
    console.log(chalk.bold(`\n[${org}] archive stats`));
    console.log(`  rows         : ${stats.totalRows}`);
    console.log(`  oldest       : ${stats.oldestIso ?? "—"}`);
    console.log(`  newest       : ${stats.newestIso ?? "—"}`);
    const eventLines = Object.entries(stats.perEventType)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${k}=${v}`);
    console.log(`  event_type   : ${eventLines.length ? eventLines.join(", ") : "—"}`);
    if (opts.disk) {
      console.log(`  disk bytes   : ${stats.diskBytes} (${humanBytes(stats.diskBytes)})`);
    }
  }
}

function pickOrgs(filter: string | undefined): string[] {
  const orgs = listOrganizations().map((o) => o.slug);
  if (filter) return orgs.filter((s) => s === filter);
  return orgs;
}

function parseEventType(raw: string | undefined): EventType | undefined {
  if (!raw) return undefined;
  return isEventType(raw) ? raw : undefined;
}

function printHit(h: SearchResult): void {
  const date = h.timestamp.slice(0, 10);
  const head = chalk.cyan(`${date}`) + chalk.dim(`  ${h.event_type}/${h.source_routine}`);
  const meta = h.agent ? chalk.dim(`  agent=${h.agent}`) : "";
  console.log(`  ${head}${meta}`);
  const snippetTrim = h.snippet.length > 180 ? h.snippet.slice(0, 180) + "…" : h.snippet;
  console.log(`    ${snippetTrim}`);
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Re-export for tests that don't want to spawn the CLI process.
export { searchArchive, getStats };
