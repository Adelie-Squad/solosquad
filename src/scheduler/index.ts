import fs from "fs";
import path from "path";
import cron from "node-cron";
import { createAdapters } from "../messenger/index.js";
import { runClaude } from "../bot/claude-runner.js";
import { resolveOrgCwd } from "../bot/workflow-resolver.js";
import { loadProducts, loadMessengerConfig } from "../util/config.js";
import { getReposBase } from "../util/paths.js";
import { ROUTINES, loadRoutinePrompt, type RoutineConfig } from "./routines.js";
import { saveRoutineMemory } from "./memory.js";
import type { MessengerAdapter } from "../messenger/base.js";

let adapters: MessengerAdapter[] = [];

function now(): string {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }).slice(5);
}

async function runRoutineForProduct(
  routine: RoutineConfig,
  product: { name: string; slug: string }
): Promise<void> {
  // v1.2.0+: product.slug == org slug. Routines always run at org level so
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
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "-");
  fs.writeFileSync(
    path.join(logDir, `${routine.id}-${timestamp}.md`),
    `# ${routine.name}\n\n${result}`
  );

  // Send to all connected messengers
  const title = `${routine.emoji} [${routine.name}] ${product.name} | ${now()}`;
  for (const adapter of adapters) {
    const config = loadMessengerConfig(orgDir, adapter.platform);
    const sent = await adapter.sendToChannel(config, routine.channel, result, title);
    if (sent) {
      console.log(`[Scheduler] ${product.name} - ${routine.name} → ${adapter.platform} sent`);
    } else {
      console.log(`[Scheduler] ${product.name} - No ${adapter.platform} config. Saved to file only.`);
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

async function sendStartupNotification(): Promise<void> {
  const products = loadProducts();
  const msg =
    "**AI Assistant System Started**\nRoutine schedule:\n" +
    ROUTINES.map((r) => `• ${r.emoji} ${r.name}: ${r.cron}`).join("\n");

  const workspace = getReposBase();
  for (const adapter of adapters) {
    for (const product of products) {
      const orgDir = path.join(workspace, product.slug);
      const config = loadMessengerConfig(orgDir, adapter.platform);
      await adapter.sendToChannel(config, "daily-brief", msg);
    }
  }
}

export async function startScheduler(): Promise<void> {
  adapters = await createAdapters();
  const platforms = adapters.map((a) => a.platform);
  console.log(`[Scheduler] Using adapters: ${platforms.join(", ")}`);

  // Start notifier mode for all adapters
  for (const adapter of adapters) {
    await adapter.startNotifier();
    console.log(`[Scheduler] ${adapter.platform} notifier started`);
  }

  // Register cron jobs
  for (const routine of ROUTINES) {
    cron.schedule(routine.cron, () => runRoutine(routine.id), {
      timezone: "Asia/Seoul",
    });
    console.log(`[Scheduler] Registered: ${routine.name} (${routine.cron})`);
  }

  console.log("[Scheduler] Scheduler started");
  await sendStartupNotification();

  // Keep alive
  await new Promise<void>(() => {});
}
