import path from "path";
import { createAdapters } from "../messenger/index.js";
import { RealClaudeProcessFactory } from "./claude-process.js";
import { ChiefRunner, AuthExpiredError } from "./chief-runner.js";
import { SessionStore } from "./session-store.js";
import { FileEventSink, pmEventsPath } from "./events.js";
import { WorkflowReconciler, type PendingDelivery } from "./workflow-reconciler.js";
import { handleSlashIfAny } from "./slash-commands.js";
import { parseMentions } from "./mention-parser.js";
import { listOrgRepoSlugs } from "./repo-registry.js";
import { rebuildRoutes } from "./agent-router.js";
import { commitSnapshot } from "./git-snapshot.js";
import { startSkillWatcher, type Unwatch } from "./fs-watcher.js";
import { applyReloadPolicy } from "./reload-policy.js";
import { getReposBase, getWorkspaceDir } from "../util/paths.js";
import {
  loadEnv,
  loadFsWatchConfig,
  loadMessengerConfig,
  listOrganizations,
  type Product,
} from "../util/config.js";
import type { MessageContext, MessengerAdapter } from "../messenger/base.js";

const MAX_MESSAGE_LENGTH = 4000;

const workspaceRoot = getWorkspaceDir();
const claude = new RealClaudeProcessFactory();
const sessions = new SessionStore(workspaceRoot);
const chiefRunner = new ChiefRunner({
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

  // v1.0.1: `@<slug>` mention pre-processing. Resolves repo slugs from
  // the user's message against the org's registered repos and injects a
  // [target_repo:<slug>] marker so PM SKILL.md can route deterministically
  // without LLM inference. Replaces the deprecated role=main lookup as the
  // primary multi-repo intent channel.
  const orgCwd = path.join(getReposBase(), product.slug);
  const registeredSlugs = listOrgRepoSlugs(orgCwd);
  const mention = parseMentions(slashHandling.forwardText, registeredSlugs);
  const forwardText = mention.forwardText;
  if (mention.mentioned.length > 0) {
    console.log(
      `[Bot] mention → target_repo${mention.mentioned.length > 1 ? "s" : ""}: ${mention.mentioned.join(", ")}`
    );
  }

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
    const reply = await chiefRunner.handleUserMessage({
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

  // v0.6 §10 — start SKILL fs.watch hot-reload after adapters are live so
  // policy notifications have somewhere to land. The reload-policy module
  // decides what to do per `workspace.yaml.fs_watch.mode`.
  const fsWatchCfg = loadFsWatchConfig(workspaceRoot);
  const unwatch = startSkillWatcher({
    workspace: workspaceRoot,
    mode: fsWatchCfg.mode,
    gitOnly: fsWatchCfg.git_only,
    onReload: (changedPaths) => {
      void onSkillChange(adapters, changedPaths, fsWatchCfg);
    },
  });
  console.log(
    `[Bot] SKILL fs.watch active (mode=${fsWatchCfg.mode}${fsWatchCfg.git_only ? ", git_only" : ""})`,
  );

  installGracefulShutdown(unwatch);
}

async function onSkillChange(
  adapters: MessengerAdapter[],
  changedPaths: string[],
  cfg: { mode: "auto" | "prompt" | "manual"; git_only: boolean },
): Promise<void> {
  try {
    const decision = await applyReloadPolicy({
      mode: cfg.mode,
      changes: changedPaths,
      gitOnly: cfg.git_only,
      gitRoot: workspaceRoot,
    });
    if (!decision.notice) return;
    console.log(`[Bot] SKILL reload (${decision.outcome}) — ${decision.notice}`);
    await broadcastToOwnerCommand(adapters, decision.notice);
  } catch (err) {
    console.log(
      `[Bot] SKILL reload policy failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function broadcastToOwnerCommand(
  adapters: MessengerAdapter[],
  text: string,
): Promise<void> {
  const orgs = listOrganizations(workspaceRoot);
  for (const org of orgs) {
    const orgDir = path.join(getReposBase(), org.slug);
    for (const adapter of adapters) {
      try {
        const cfg = loadMessengerConfig(orgDir, adapter.platform);
        await adapter.sendToChannel(cfg, "owner-command", text);
      } catch {
        // Channel might not exist for every org/platform — fine to skip.
      }
    }
  }
}

let shutdownInstalled = false;

/**
 * Graceful shutdown for the fs-watcher. Installed once per process — SIGINT
 * (Ctrl-C in the terminal) and SIGTERM (orchestrator stop signal) both
 * close the watcher before letting the default handler exit the process.
 */
function installGracefulShutdown(unwatch: Unwatch): void {
  if (shutdownInstalled) return;
  shutdownInstalled = true;
  const stop = async (sig: NodeJS.Signals): Promise<void> => {
    console.log(`[Bot] received ${sig} — closing SKILL watcher`);
    try {
      await unwatch();
    } catch (err) {
      console.log(
        `[Bot] watcher close error (continuing exit): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
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
