import fs from "fs";
import path from "path";
import cron from "node-cron";
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
  ROUTINES,
  loadRoutinePrompt,
  timeToDailyCron,
  weeklyToCron,
  type RoutineConfig,
} from "./routines.js";
import { saveRoutineMemory } from "./memory.js";
import type { MessengerAdapter } from "../messenger/base.js";

let adapters: MessengerAdapter[] = [];
let workspaceTimezone = "Asia/Seoul";

function nowLabel(): string {
  return new Date()
    .toLocaleString("ko-KR", { timeZone: workspaceTimezone })
    .slice(5);
}

async function runRoutineForProduct(
  routine: RoutineConfig,
  product: { name: string; slug: string }
): Promise<void> {
  // v0.2.0+: product.slug == org slug. Routines always run at org level so
  // memory/routine-logs (org scope) is the persistence target — but the Claude
  // session still launches in the active repo to give it real code context.
  const orgDir = path.join(getReposBase(), product.slug);
  const { cwd, reason, repoSlug } = resolveOrgCwd(orgDir);
  const repoLabel = reason === "legacy-root" ? "(org root)" : `(repo: ${repoSlug})`;
  console.log(`[Scheduler] ${product.name} - ${routine.name} starting ${repoLabel}`);

  const prompt = loadRoutinePrompt(routine.id);
  const result = await runClaude(prompt, cwd, 180_000);

  // Auto-save to memory (always at org level, regardless of which repo ran the prompt)
  saveRoutineMemory(result, routine, orgDir);

  // Save routine log
  const logDir = path.join(orgDir, "memory", "routine-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[:-]/g, "")
    .replace("T", "-");
  fs.writeFileSync(
    path.join(logDir, `${routine.id}-${timestamp}.md`),
    `# ${routine.name}\n\n${result}`
  );

  // v0.2.4+: route to #workflow channel; background routines target a system thread
  const title = `${routine.emoji} [${routine.name}] ${product.name} | ${nowLabel()}`;
  for (const adapter of adapters) {
    const config = loadMessengerConfig(orgDir, adapter.platform);
    const sent = await adapter.sendToChannel(
      config,
      routine.channel,
      result,
      title,
      routine.threadName
    );
    if (sent) {
      console.log(
        `[Scheduler] ${product.name} - ${routine.name} → ${adapter.platform}` +
          (routine.threadName ? ` (thread: ${routine.threadName})` : "") +
          " sent"
      );
    } else {
      console.log(
        `[Scheduler] ${product.name} - No ${adapter.platform} config. Saved to file only.`
      );
    }
  }
}

async function runRoutine(routineId: string): Promise<void> {
  const routine = ROUTINES.find((r) => r.id === routineId);
  if (!routine) {
    console.log(`[Scheduler] Unknown routine: ${routineId}`);
    return;
  }

  const products = loadProducts();
  if (!products.length) {
    console.log("[Scheduler] No products registered");
    return;
  }

  await Promise.all(products.map((p) => runRoutineForProduct(routine, p)));
}

interface ResolvedSchedule {
  routine: RoutineConfig;
  cron: string;
  enabled: boolean;
}

/** Map each routine to its effective cron expression from workspace.yaml. */
function resolveSchedules(ws: WorkspaceYaml): ResolvedSchedule[] {
  const merged = applyWorkspaceDefaults(ws);
  const b = merged.briefings!;
  const r = merged.background_routines!;

  return ROUTINES.map((routine): ResolvedSchedule => {
    switch (routine.id) {
      case "morning-brief":
        return {
          routine,
          cron: timeToDailyCron(b.morning!.time),
          enabled: b.morning!.enabled !== false,
        };
      case "evening-brief":
        return {
          routine,
          cron: timeToDailyCron(b.evening!.time),
          enabled: b.evening!.enabled !== false,
        };
      case "signal-scan":
        return {
          routine,
          cron: timeToDailyCron(r.signal_scan!.time),
          enabled: r.signal_scan!.enabled !== false,
        };
      case "experiment-check":
        return {
          routine,
          cron: timeToDailyCron(r.experiment_check!.time),
          enabled: r.experiment_check!.enabled !== false,
        };
      case "weekly-review":
        return {
          routine,
          cron: weeklyToCron(r.weekly_review!.day, r.weekly_review!.time),
          enabled: r.weekly_review!.enabled !== false,
        };
      case "pm-compaction": {
        const pmCfg = merged.pm ?? {};
        const time = pmCfg.compaction_time ?? "23:00";
        return {
          routine,
          cron: timeToDailyCron(time),
          enabled: true,
        };
      }
      default:
        // Unknown routine — disable rather than crash
        return { routine, cron: "0 0 1 1 *", enabled: false };
    }
  });
}

async function sendStartupNotification(schedules: ResolvedSchedule[]): Promise<void> {
  const products = loadProducts();
  const lines = schedules
    .filter((s) => s.enabled)
    .map((s) => `• ${s.routine.emoji} ${s.routine.name}: ${s.cron} (${workspaceTimezone})`);
  const msg = `**SoloSquad Started** (tz: ${workspaceTimezone})\nRoutine schedule:\n${lines.join("\n")}`;

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

  // Resolve effective schedule from workspace.yaml and register cron jobs
  const schedules = resolveSchedules(ws ?? ({ version: "0.2.4", display_name: "", created_at: "" } as WorkspaceYaml));
  for (const s of schedules) {
    if (!s.enabled) {
      console.log(`[Scheduler] Skipped: ${s.routine.name} (disabled)`);
      continue;
    }
    cron.schedule(s.cron, () => runRoutine(s.routine.id), {
      timezone: workspaceTimezone,
    });
    console.log(`[Scheduler] Registered: ${s.routine.name} (${s.cron})`);
  }

  console.log("[Scheduler] Scheduler started");
  await sendStartupNotification(schedules);

  // Keep alive
  await new Promise<void>(() => {});
}
