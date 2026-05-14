import path from "path";
import { createAdapters } from "../messenger/index.js";
import { RealClaudeProcessFactory } from "./claude-process.js";
import { PmRunner, AuthExpiredError } from "./pm-runner.js";
import { SessionStore } from "./session-store.js";
import { FileEventSink, pmEventsPath } from "./events.js";
import { WorkflowReconciler, type PendingDelivery } from "./workflow-reconciler.js";
import { handleSlashIfAny } from "./slash-commands.js";
import { rebuildRoutes } from "./agent-router.js";
import { commitSnapshot } from "./git-snapshot.js";
import { getReposBase, getWorkspaceDir } from "../util/paths.js";
import { loadEnv, loadMessengerConfig, type Product } from "../util/config.js";
import type { MessageContext, MessengerAdapter } from "../messenger/base.js";

const MAX_MESSAGE_LENGTH = 4000;

const workspaceRoot = getWorkspaceDir();
const claude = new RealClaudeProcessFactory();
const sessions = new SessionStore(workspaceRoot);
const pmRunner = new PmRunner({
  claude,
  sessions,
  events: (orgSlug, userId) =>
    new FileEventSink(pmEventsPath(workspaceRoot, orgSlug, userId)),
});

async function handleCommand(
  userInput: string,
  product: Product,
  ctx: MessageContext
): Promise<void> {
  if (!userInput || userInput.trim().length === 0) return;
  if (userInput.length > MAX_MESSAGE_LENGTH) {
    await ctx.reply(`Message too long (${userInput.length} chars). Max: ${MAX_MESSAGE_LENGTH}.`);
    return;
  }

  // v0.3.0: slash command pre-processing. Unknown slashes get a direct
  // reply from the bot (no PM call). Known slashes are wrapped in a
  // [SLASH /xyz] marker so the PM SKILL.md can parse them deterministically.
  const slashHandling = handleSlashIfAny(userInput);
  if (slashHandling.shortCircuit) {
    if (slashHandling.directReply) await ctx.reply(slashHandling.directReply);
    return;
  }
  const forwardText = slashHandling.forwardText;

  // v0.3.0 (PM mode): PM session cwd is fixed at the org root (per
  // docs/plan/v0.3-pm-mode-orchestration.md §3.2.1). target_repo cwd
  // branching happens inside subagent prompts, not by switching PM cwd.
  const orgCwd = path.join(getReposBase(), product.slug);

  console.log(
    `[Bot] PM turn: user=${ctx.userId} org=${product.slug} text="${forwardText.slice(0, 60)}${forwardText.length > 60 ? "…" : ""}"`
  );

  // v0.3.0: snapshot memory/ + workflows/ before the turn. PM may make
  // changes; a follow-up snapshot after the turn lets `solosquad rollback`
  // revert just this turn's delta if needed.
  try {
    commitSnapshot(workspaceRoot, product.slug, `before-spawn: ${ctx.userId} ${new Date().toISOString()}`);
  } catch (e) {
    console.log(`[Bot] snapshot (before) skipped: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const reply = await pmRunner.handleUserMessage({
      userId: ctx.userId,
      orgSlug: product.slug,
      orgCwd,
      userText: forwardText,
    });
    if (reply.text) {
      await ctx.reply(reply.text);
    } else {
      await ctx.reply("(no reply generated — please try again or check `solosquad doctor`)");
    }
    if (reply.rateLimited) {
      await ctx.reply(
        "⚠️ Claude Code reported a rate-limit constraint. Subsequent calls may be deferred."
      );
    }
    console.log(
      `[Bot] PM turn done: cost=$${reply.costUsd.toFixed(4)} duration=${reply.durationMs}ms spawns=${reply.spawnCount}${reply.sessionRotated ? " session-rotated" : ""}`
    );
    try {
      commitSnapshot(workspaceRoot, product.slug, `after-spawn: ${ctx.userId} cost=$${reply.costUsd.toFixed(4)} spawns=${reply.spawnCount}`);
    } catch (e) {
      console.log(`[Bot] snapshot (after) skipped: ${e instanceof Error ? e.message : e}`);
    }
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      await ctx.reply(
        "🔐 Claude Code is not logged in. Run `claude login` on the host running this bot, then try again."
      );
      return;
    }
    console.log(`[Bot] PM error: ${err instanceof Error ? err.message : String(err)}`);
    await ctx.reply(
      `An error occurred while processing your message: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

function resolveMessengerSource(): { value: string; source: string } {
  const fromEnv = process.env.MESSENGER;
  if (!fromEnv) return { value: "discord", source: "default" };

  const fileEnv = loadEnv(getWorkspaceDir());
  const fileValue = fileEnv.MESSENGER;
  if (fileValue && fileValue === fromEnv) return { value: fromEnv, source: ".env" };
  if (fileValue && fileValue !== fromEnv) return { value: fromEnv, source: "shell (overrides .env)" };
  return { value: fromEnv, source: "shell" };
}

export async function startBot(): Promise<void> {
  const { value, source } = resolveMessengerSource();
  console.log(`[Bot] MESSENGER=${value} (from ${source})`);

  // v0.3.0: confirm Claude Code is authenticated before listening.
  const auth = await claude.authStatus();
  if (!auth.loggedIn) {
    console.log(
      "[Bot] ⚠ Claude Code is not logged in. The bot will start and reply with login instructions for every command. Run `claude login` to fix."
    );
  } else {
    console.log(
      `[Bot] Claude Code authenticated (${auth.authMethod ?? "?"}, ${auth.subscriptionType ?? "?"})`
    );
  }

  const adapters = await createAdapters();
  const platforms = adapters.map((a) => a.platform);
  console.log(`[Bot] Starting with adapters: ${platforms.join(", ")}`);

  // v0.5 §7 — seed the frontmatter-driven route index. S3 author loop will
  // call rebuildRoutes() again after writing a new SKILL.md. Atomic swap
  // means in-flight handlers keep serving from the previous index until
  // the new one is fully built.
  const initialRoutes = rebuildRoutes();
  const routeCount =
    Object.keys(initialRoutes.slash).length +
    Object.keys(initialRoutes.keyword).length +
    Object.keys(initialRoutes.explicit).length +
    initialRoutes.freq.length;
  console.log(`[Bot] Routes loaded: ${routeCount} triggers across SKILLs`);

  // v0.3.0: reconcile any in-flight stage / undelivered PM message left over
  // from a prior crash. Run before adapters start so the recovery deliveries
  // land in #owner-command after the bot is connected.
  const reconciler = new WorkflowReconciler(workspaceRoot, sessions);
  const report = await reconciler.reconcileAll();
  console.log(
    `[Bot] Reconcile: workflows=${report.scannedWorkflows} sessions=${report.scannedSessions} ` +
      `stages_flipped=${report.recoveredStages.length} pending_deliveries=${report.pendingDeliveries.length}`
  );

  await Promise.all(adapters.map((a) => a.startBot(handleCommand)));

  // Deliver any recovered messages now that adapters are connected.
  if (report.pendingDeliveries.length > 0) {
    await deliverRecoveredMessages(adapters, report.pendingDeliveries);
  }
}

async function deliverRecoveredMessages(
  adapters: MessengerAdapter[],
  deliveries: PendingDelivery[]
): Promise<void> {
  for (const d of deliveries) {
    const orgDir = path.join(getReposBase(), d.orgSlug);
    const header =
      d.source === "cc-jsonl"
        ? `🔁 Recovered reply (bot restarted before delivery, for <@${d.userId}>):`
        : `🔁 Bot restart notice (for <@${d.userId}>):`;
    for (const adapter of adapters) {
      const config = loadMessengerConfig(orgDir, adapter.platform);
      const sent = await adapter.sendToChannel(
        config,
        "owner-command",
        d.text,
        header
      );
      if (sent) {
        console.log(
          `[Bot] Recovered message delivered for ${d.userId} via ${adapter.platform} (source=${d.source})`
        );
      }
    }
  }
}
