import fs from "fs";
import path from "path";
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { watch as chokidarWatch } from "chokidar";
import { createAdapters } from "../messenger/index.js";
import { runClaude } from "../bot/claude-runner.js";
import { resolveOrgCwd } from "../bot/workflow-resolver.js";
import {
  applyWorkspaceDefaults,
  loadMessengerConfig,
  loadProducts,
  loadWorkspaceYaml,
  type WorkspaceYaml,
} from "../util/config.js";
import { getReposBase } from "../util/paths.js";
import {
  CRONS,
  loadCronPrompt,
  isSilentResult,
  timeToDailyCron,
  type CronConfig,
} from "./crons.js";
import { loadCronDefs, deleteCronFiles } from "./cron-def.js";
import { validateCronDef } from "./cron-validate.js";
import { recordCronRun, lastSuccessfulRun } from "./cron-runlog.js";
import { isOverdue } from "./cron-schedule.js";
import { resolveUserCrons } from "./user-crons.js";
import { listUserYamls } from "../bot/user-registry.js";
import { getCronsWriteDir } from "../util/paths.js";
import { saveCronMemory } from "./memory.js";
import { rotateArchive } from "../memory/archive-rotate.js";
import { loadArchiveConfig } from "../util/config.js";
import { rotateLogs } from "../util/logger.js";
import type { MessengerAdapter } from "../messenger/base.js";

let adapters: MessengerAdapter[] = [];
let workspaceTimezone = "Asia/Seoul";

function nowLabel(tz: string = workspaceTimezone): string {
  return new Date()
    .toLocaleString("ko-KR", { timeZone: tz })
    .slice(5);
}

async function runCronForProduct(
  cron: CronConfig,
  product: { name: string; slug: string },
  /** v1.3.3 §B — per-user override: deliver to a specific channel + label in
   *  that user's timezone (used by personalized briefs). */
  overrides: { channel?: string; tz?: string } = {}
): Promise<void> {
  // v0.2.0+: product.slug == org slug. Crons always run at org level so
  // memory/cron-logs (org scope) is the persistence target — but the Claude
  // session still launches in the active repo to give it real code context.
  const orgDir = path.join(getReposBase(), product.slug);
  const { cwd, reason, repoSlug } = resolveOrgCwd(orgDir);
  const repoLabel = reason === "legacy-root" ? "(org root)" : `(repo: ${repoSlug})`;
  console.log(`[Scheduler] ${product.name} - ${cron.name} starting ${repoLabel}`);

  // v0.8.5 — Unified deterministic housekeeping (no LLM). Runs archive
  // rotation + log retention sequentially, isolated so one failure can't
  // block the other. Workspace-level log cleanup runs once and is a no-op
  // for subsequent products in the same tick (directory already pruned).
  if (cron.id === "system-housekeeping") {
    try {
      const archiveCfg = loadArchiveConfig();
      const stats = rotateArchive({
        workspace: getReposBase(),
        orgSlug: product.slug,
        retentionDays: archiveCfg.retention_days,
        compressBeforeDelete: archiveCfg.compress_before_delete,
      });
      console.log(
        `[Scheduler] ${product.name} - housekeeping[archive] archived=${stats.archived_rows} deleted=${stats.deleted_by_retention}`
      );
    } catch (err) {
      console.error(
        `[Scheduler] ${product.name} - housekeeping[archive] failed:`,
        (err as Error).message
      );
    }
    try {
      const removed = rotateLogs({ retentionDays: 14 });
      console.log(
        `[Scheduler] ${product.name} - housekeeping[logs] removed=${removed.length}`
      );
    } catch (err) {
      console.error(
        `[Scheduler] ${product.name} - housekeeping[logs] failed:`,
        (err as Error).message
      );
    }
    // v1.3.3 §C — dead-man's-switch: report enabled user crons that are overdue
    // (no successful run within 2× their estimated cadence). Quiet when all healthy.
    try {
      const overdue = loadCronDefs()
        .filter((d) => d.enabled)
        .filter((d) => isOverdue(lastSuccessfulRun(orgDir, d.id)?.finishedAt ?? null, d.cron));
      if (overdue.length > 0) {
        const lines = overdue.map((d) => {
          const last = lastSuccessfulRun(orgDir, d.id)?.finishedAt;
          return `• ${d.emoji} ${d.name} (${d.id}) — last ok: ${last ? new Date(last).toLocaleString() : "never"}`;
        });
        const msg = `⚠️ **Cron dead-man's-switch** — ${overdue.length} overdue:\n${lines.join("\n")}`;
        for (const adapter of adapters) {
          const config = loadMessengerConfig(orgDir, adapter.platform);
          await adapter.sendToChannel(config, "workflow", msg, undefined, "system-housekeeping");
        }
        console.log(`[Scheduler] ${product.name} - dead-man's-switch: ${overdue.length} overdue cron(s)`);
      }
    } catch (err) {
      console.error(`[Scheduler] ${product.name} - dead-man's-switch check failed:`, (err as Error).message);
    }
    return;
  }

  const prompt = loadCronPrompt(cron.id);
  const startedAt = new Date();
  let result: string;
  try {
    result = await runClaude(prompt, cwd, 180_000);
  } catch (err) {
    const finishedAt = new Date();
    recordCronRun(orgDir, {
      id: cron.id, name: cron.name,
      startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
      status: "error", ms: finishedAt.getTime() - startedAt.getTime(),
      error: (err as Error).message,
    });
    console.error(`[Scheduler] ${product.name} - ${cron.name} → error: ${(err as Error).message}`);
    return;
  }
  const finishedAt = new Date();
  recordCronRun(orgDir, {
    id: cron.id, name: cron.name,
    startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
    status: isSilentResult(result) ? "silent" : "ok",
    ms: finishedAt.getTime() - startedAt.getTime(),
  });

  // Auto-save to memory (always at org level, regardless of which repo ran the prompt)
  saveCronMemory(result, cron, orgDir);

  // Save cron log
  const logDir = path.join(orgDir, "memory", "cron-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[:-]/g, "")
    .replace("T", "-");
  fs.writeFileSync(
    path.join(logDir, `${cron.id}-${timestamp}.md`),
    `# ${cron.name}\n\n${result}`
  );

  // v1.3.3 §C — silent runs (empty / [SILENT]) are logged but not posted.
  if (isSilentResult(result)) {
    console.log(`[Scheduler] ${product.name} - ${cron.name} → silent (not posted)`);
    return;
  }

  // v0.2.4+: route to #workflow channel; background crons target a system
  // thread. v1.3.3 §B — personalized briefs override the channel (works-<handle>)
  // and label in the user's timezone.
  const channel = overrides.channel ?? cron.channel;
  const threadName = overrides.channel ? undefined : cron.threadName;
  const title = `${cron.emoji} [${cron.name}] ${product.name} | ${nowLabel(overrides.tz)}`;
  for (const adapter of adapters) {
    const config = loadMessengerConfig(orgDir, adapter.platform);
    const sent = await adapter.sendToChannel(
      config,
      channel,
      result,
      title,
      threadName
    );
    if (sent) {
      console.log(
        `[Scheduler] ${product.name} - ${cron.name} → ${adapter.platform}` +
          (cron.threadName ? ` (thread: ${cron.threadName})` : "") +
          " sent"
      );
    } else {
      console.log(
        `[Scheduler] ${product.name} - No ${adapter.platform} config. Saved to file only.`
      );
    }
  }
}

async function runCron(cronId: string): Promise<void> {
  const cron = CRONS.find((r) => r.id === cronId);
  if (!cron) {
    console.log(`[Scheduler] Unknown cron: ${cronId}`);
    return;
  }

  const products = loadProducts();
  if (!products.length) {
    console.log("[Scheduler] No products registered");
    return;
  }

  await Promise.all(products.map((p) => runCronForProduct(cron, p)));
}

/** Run a user-defined cron (not in CRONS) across all products. */
async function runCronDef(def: CronConfig): Promise<void> {
  const products = loadProducts();
  if (!products.length) {
    console.log("[Scheduler] No products registered");
    return;
  }
  await Promise.all(products.map((p) => runCronForProduct(def, p)));
}

interface ResolvedCron {
  cron: CronConfig;
  /** node-cron expression resolved from workspace.yaml. */
  expr: string;
  enabled: boolean;
}

/** Map each built-in cron to its effective cron expression from workspace.yaml. */
function resolveCrons(ws: WorkspaceYaml): ResolvedCron[] {
  const merged = applyWorkspaceDefaults(ws);
  const b = merged.briefings!;

  return CRONS.map((cron): ResolvedCron => {
    switch (cron.id) {
      case "morning-brief":
        return {
          cron,
          expr: timeToDailyCron(b.morning!.time),
          enabled: b.morning!.enabled !== false,
        };
      case "evening-brief":
        return {
          cron,
          expr: timeToDailyCron(b.evening!.time),
          enabled: b.evening!.enabled !== false,
        };
      case "pm-compaction": {
        const pmCfg = merged.pm ?? {};
        const time = pmCfg.compaction_time ?? "23:00";
        return {
          cron,
          expr: timeToDailyCron(time),
          enabled: true,
        };
      }
      case "system-housekeeping":
        // v0.8.5 — fixed 00:00 nightly. Runs archive rotation + log retention
        // pass back-to-back. Archive tuning lives in workspace.yaml.archive
        // (retention_days, compress_before_delete); log retention is fixed at
        // 14 days inside `rotateLogs()`.
        return {
          cron,
          expr: timeToDailyCron("00:00"),
          enabled: true,
        };
      default:
        // Unknown cron — disable rather than crash
        return { cron, expr: "0 0 1 1 *", enabled: false };
    }
  });
}

async function sendStartupNotification(crons: ResolvedCron[]): Promise<void> {
  const products = loadProducts();
  const lines = crons
    .filter((s) => s.enabled)
    .map((s) => `• ${s.cron.emoji} ${s.cron.name}: ${s.expr} (${workspaceTimezone})`);
  const msg = `**SoloSquad Started** (tz: ${workspaceTimezone})\nCron schedule:\n${lines.join("\n")}`;

  const workspace = getReposBase();
  for (const adapter of adapters) {
    for (const product of products) {
      const orgDir = path.join(workspace, product.slug);
      const config = loadMessengerConfig(orgDir, adapter.platform);
      await adapter.sendToChannel(config, "workflow", msg);
    }
  }
}

export async function startScheduler(): Promise<void> {
  const ws = loadWorkspaceYaml();
  if (ws) {
    const merged = applyWorkspaceDefaults(ws);
    workspaceTimezone = merged.timezone ?? "Asia/Seoul";
  }

  adapters = await createAdapters();
  const platforms = adapters.map((a) => a.platform);
  console.log(`[Scheduler] Using adapters: ${platforms.join(", ")}`);
  console.log(`[Scheduler] Timezone: ${workspaceTimezone}`);

  // Start notifier mode for all adapters
  for (const adapter of adapters) {
    await adapter.startNotifier();
    console.log(`[Scheduler] ${adapter.platform} notifier started`);
  }

  // Resolve effective cron from workspace.yaml and register cron jobs
  const crons = resolveCrons(ws ?? ({ version: "0.2.4", display_name: "", created_at: "" } as WorkspaceYaml));
  for (const s of crons) {
    if (!s.enabled) {
      console.log(`[Scheduler] Skipped: ${s.cron.name} (disabled)`);
      continue;
    }
    cron.schedule(s.expr, () => runCron(s.cron.id), {
      timezone: workspaceTimezone,
    });
    console.log(`[Scheduler] Registered: ${s.cron.name} (${s.expr})`);
  }

  // v1.3.2 §8 — additive user-defined crons (crons/<id>.yaml). Built-in
  // crons above are untouched; these register on top. v1.3.3 §C — registration
  // is reconcilable + live: an fs-watcher re-applies on create/edit/enable/
  // disable/delete so `solosquad cron …` takes effect without a daemon restart.
  reconcileUserCrons();
  startCronWatcher();

  // v1.3.3 §B — personalized briefs: opt-in users get their own briefs in
  // works-<handle> at their own timezone (additive to the org-level briefs).
  registerUserBriefs(ws ? applyWorkspaceDefaults(ws) : undefined);

  console.log("[Scheduler] Scheduler started");
  await sendStartupNotification(crons);

  // Keep alive
  await new Promise<void>(() => {});
}

/**
 * v1.3.3 §B — register per-user personalized brief crons. Read at startup
 * (a user.yaml change needs a daemon restart, like the built-in brief times).
 */
function registerUserBriefs(ws?: WorkspaceYaml): void {
  const merged = ws ?? applyWorkspaceDefaults({ version: "0", display_name: "", created_at: "" } as WorkspaceYaml);
  const defaults = {
    tz: merged.timezone ?? workspaceTimezone,
    times: {
      "morning-brief": merged.briefings?.morning?.time ?? "08:00",
      "evening-brief": merged.briefings?.evening?.time ?? "18:00",
    } as Record<string, string>,
  };
  const orgs = loadProducts().map((p) => ({ slug: p.slug, users: listUserYamls(p.slug) }));
  const resolved = resolveUserCrons(orgs, defaults);
  for (const uc of resolved) {
    const builtin = CRONS.find((c) => c.id === uc.cronId);
    if (!builtin) continue;
    cron.schedule(
      uc.expr,
      () => runCronForProduct(builtin, { name: uc.orgSlug, slug: uc.orgSlug }, { channel: uc.channel, tz: uc.timezone }),
      { name: `userbrief:${uc.orgSlug}:${uc.handle}:${uc.cronId}`, noOverlap: true, timezone: uc.timezone },
    );
    console.log(`[Scheduler] Registered user brief: ${uc.handle}/${uc.cronId} → ${uc.channel} (${uc.expr} ${uc.timezone})`);
  }
  console.log(`[Scheduler] Personalized briefs: ${resolved.length}`);
}

/** Live handles for recurring user-cron tasks + one-shot timers, keyed by id. */
const userCronTasks = new Map<string, ScheduledTask>();
const oneShotTimers = new Map<string, NodeJS.Timeout>();
const MAX_TIMER_MS = 2_147_483_647; // setTimeout ceiling (~24.8 days)

/**
 * v1.3.3 §C — (re)apply the on-disk user crons to the live scheduler. Idempotent:
 * tears down every registered task/timer, then re-arms the valid + enabled defs.
 * Recurring defs use node-cron; one-shot defs (`at`) use a setTimeout that runs
 * once then deletes the def (delete-after-run). Built-in crons are never touched.
 */
export function reconcileUserCrons(): void {
  for (const [, task] of userCronTasks) {
    try { void task.destroy(); } catch { /* ignore */ }
  }
  userCronTasks.clear();
  for (const [, timer] of oneShotTimers) clearTimeout(timer);
  oneShotTimers.clear();

  const builtinIds = new Set(CRONS.map((r) => r.id));
  const cronsDir = getCronsWriteDir();
  for (const def of loadCronDefs(cronsDir)) {
    const result = validateCronDef(def, {
      reservedIds: builtinIds,
      promptExists: (id) => fs.existsSync(path.join(cronsDir, `${id}.md`)),
    });
    if (!result.ok) {
      console.log(`[Scheduler] Skipped user cron "${def.id}" — ${result.errors.map((e) => e.code).join(", ")}`);
      continue;
    }
    if (!def.enabled) {
      console.log(`[Scheduler] Paused: ${def.name} (disabled)`);
      continue;
    }

    // One-shot (`at`): run once at the target time, then delete-after-run.
    if (def.at) {
      const delay = Date.parse(def.at) - Date.now();
      if (Number.isNaN(delay)) continue;
      if (delay <= 0) {
        // Past one-shot — never ran (or stale def): clean it up, don't fire.
        console.log(`[Scheduler] One-shot "${def.id}" is past — archiving (not run)`);
        try { deleteCronFiles(def.id, cronsDir); } catch { /* ignore */ }
        continue;
      }
      if (delay > MAX_TIMER_MS) {
        console.log(`[Scheduler] One-shot "${def.id}" is >24d out — will arm on a later restart`);
        continue;
      }
      const timer = setTimeout(() => {
        void (async () => {
          await runCronDef(def);
          try { deleteCronFiles(def.id, cronsDir); } catch { /* ignore */ }
          oneShotTimers.delete(def.id);
        })();
      }, delay);
      oneShotTimers.set(def.id, timer);
      console.log(`[Scheduler] Armed one-shot: ${def.name} at ${def.at}`);
      continue;
    }

    const task = cron.schedule(def.cron, () => runCronDef(def), {
      name: `user:${def.id}`,
      noOverlap: true,
      timezone: workspaceTimezone,
    });
    userCronTasks.set(def.id, task);
    console.log(`[Scheduler] Registered user cron: ${def.name} (${def.cron})`);
  }
  console.log(`[Scheduler] User crons live: ${userCronTasks.size} recurring, ${oneShotTimers.size} one-shot`);
}

let cronWatcher: import("chokidar").FSWatcher | null = null;

/** Watch `crons/` and reconcile on any change (debounced). */
function startCronWatcher(): void {
  if (cronWatcher) return;
  const dir = getCronsWriteDir();
  let timer: NodeJS.Timeout | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      console.log("[Scheduler] crons/ changed — reconciling user crons");
      reconcileUserCrons();
    }, 300);
  };
  cronWatcher = chokidarWatch(dir, { ignoreInitial: true, depth: 0 })
    .on("add", debounced)
    .on("change", debounced)
    .on("unlink", debounced);
  console.log(`[Scheduler] Watching ${dir} for live cron changes`);
}
