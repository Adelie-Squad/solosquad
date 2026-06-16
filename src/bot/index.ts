import path from "path";
import { createAdapters } from "../messenger/index.js";
import { RealClaudeProcessFactory } from "./claude-process.js";
import { ChiefRunner, AuthExpiredError } from "./chief-runner.js";
import { SessionStore } from "./session-store.js";
import { FileEventSink, chiefEventsPath } from "./events.js";
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
  loadOrgYaml,
  listOrganizations,
  setDevCapabilityEnabled,
  type Product,
} from "../util/config.js";
import { getOrgDir } from "../util/paths.js";
import type {
  MessageContext,
  MessengerAdapter,
  LiveTaskCardHandle,
} from "../messenger/base.js";
import type { ChiefStageEvent } from "../util/chief-stage-events.js";

/**
 * v1.2 — resolve the org's Chief display name (org.yaml.chief_name)
 * with a "Chief" fallback. Cached lightly by re-reading per turn; the
 * file is tiny and the call is once per Chief reply (low frequency).
 */
function resolveChiefDisplayName(orgSlug: string): string {
  try {
    const org = loadOrgYaml(getOrgDir(orgSlug, workspaceRoot));
    return org?.chief_name?.trim() || "Chief";
  } catch {
    return "Chief";
  }
}

const MAX_MESSAGE_LENGTH = 4000;

const workspaceRoot = getWorkspaceDir();
const claude = new RealClaudeProcessFactory();
const sessions = new SessionStore(workspaceRoot);
const chiefRunner = new ChiefRunner({
  claude,
  sessions,
  events: (orgSlug, userId) =>
    new FileEventSink(chiefEventsPath(workspaceRoot, orgSlug, userId)),
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

  // v1.2.8 §A.12 — refuse new turns once the bot has started draining
  // (SIGTERM received, waiting for active turns to finish). The user
  // gets a clear "try again" so they're not silently dropped.
  const { isDraining, enterTurn } = await import("./in-flight.js");
  if (isDraining()) {
    await ctx.reply(
      "🛑 SoloSquad is restarting (migration in progress). Your message wasn't processed — please send it again in a few seconds.",
    );
    return;
  }
  const releaseTurn = enterTurn();
  try {
    await handleCommandInner(userInput, product, ctx);
  } finally {
    releaseTurn();
  }
}

async function handleCommandInner(
  userInput: string,
  product: Product,
  ctx: MessageContext
): Promise<void> {

  // v0.3.0: slash command pre-processing. Unknown slashes get a direct
  // reply from the bot (no PM call). Known slashes are wrapped in a
  // [SLASH /xyz] marker so the PM SKILL.md can parse them deterministically.
  const slashHandling = handleSlashIfAny(userInput);
  // v1.2.9 §D — /cancel aborts the in-flight Chief turn for this user. Handled
  // here (before the session mutex inside handleUserMessage) so it isn't queued
  // behind the very turn it means to cancel.
  if (slashHandling.cancel) {
    const cancelled = chiefRunner.cancelTurn(product.slug, ctx.userId);
    await ctx.reply(
      cancelled
        ? "🛑 진행 중인 작업을 취소했습니다."
        : "취소할 진행 중인 작업이 없습니다.",
    );
    return;
  }
  // v1.2.9 §E — /grant + /revoke flip the workspace dev-capability toggle so
  // agents can (or can't) write files + run git. Bot-side config write; takes
  // effect on the next spawn (current turn's permission flags are already set).
  if (slashHandling.grant !== undefined) {
    const enable = slashHandling.grant;
    try {
      const prev = setDevCapabilityEnabled(enable, workspaceRoot);
      await ctx.reply(
        enable
          ? prev
            ? "✅ dev 권한이 이미 켜져 있습니다."
            : "✅ dev 권한을 켰습니다 — 이제 에이전트가 파일 쓰기·git(push 제외)을 할 수 있습니다. 멈췄던 작업이 있으면 다시 요청해 주세요."
          : prev
            ? "🔒 dev 권한을 껐습니다 — 에이전트가 read-only 로 전환됩니다."
            : "🔒 dev 권한이 이미 꺼져 있습니다.",
      );
    } catch (e) {
      await ctx.reply(`권한 변경 실패: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }

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
    `[Bot] Chief turn: user=${ctx.userId} org=${product.slug} text="${forwardText.slice(0, 60)}${forwardText.length > 60 ? "…" : ""}"`
  );

  // v0.3.0: snapshot memory/ + workflows/ before the turn. PM may make
  // changes; a follow-up snapshot after the turn lets `solosquad rollback`
  // revert just this turn's delta if needed.
  try {
    commitSnapshot(workspaceRoot, product.slug, `before-spawn: ${ctx.userId} ${new Date().toISOString()}`);
  } catch (e) {
    console.log(`[Bot] snapshot (before) skipped: ${e instanceof Error ? e.message : e}`);
  }

  // v1.3.0 Part C (P0) — live works card. On the first projectable stage
  // (DECOMPOSE/DISPATCH/AWAIT) we open a grey ⏳ card + thread and stream
  // narration into it as later stages fire, instead of dumping everything
  // after the turn. The runner calls `onStage` synchronously, so we serialize
  // the async Discord work through a promise chain to keep posts ordered
  // without ever blocking the runner's stream loop. Adapters without
  // `openLiveTaskCard` (Slack, slash fallback) leave `onStage` undefined and
  // fall through to the batch `postTaskCard` path below.
  const chiefName = resolveChiefDisplayName(product.slug);
  let liveCard: LiveTaskCardHandle | null = null;
  let liveCardChain: Promise<void> = Promise.resolve();
  let onStage: ((event: ChiefStageEvent) => void) | undefined;
  if (ctx.openLiveTaskCard) {
    const narrationMod = await import("../messenger/discord-narration.js");
    onStage = (event) => {
      const lines = narrationMod.formatStageEvent(event);
      if (lines.length === 0) return;
      liveCardChain = liveCardChain.then(async () => {
        try {
          if (!liveCard) {
            liveCard = await ctx.openLiveTaskCard!({
              userRequest: forwardText,
              chiefName,
            });
          }
          const card = liveCard;
          for (const line of lines) await card.appendNarration(line.text);
        } catch (e) {
          console.log(
            `[Bot] live task-card narration failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      });
    };
  }

  try {
    const reply = await chiefRunner.handleUserMessage({
      userId: ctx.userId,
      orgSlug: product.slug,
      orgCwd,
      userText: forwardText,
      // v1.2.9 §D — forward the messenger surface so Chief knows it's
      // talking through Discord/Slack (drives no-code-block formatting).
      source: ctx.source,
      // v1.3.0 Part C (P0) — live stage stream (undefined for batch adapters).
      onStage,
    });

    // v1.2.9 §D — turn aborted via /cancel. The cancel handler already told
    // the user it stopped; suppress the partial reply + task card. Still
    // snapshot since a partial spawn may have touched files.
    if (reply.aborted) {
      console.log(`[Bot] Chief turn aborted by /cancel: user=${ctx.userId}`);
      // Flush any in-flight live narration so we don't leave a dangling post
      // promise. The live card stays as-is (grey ⏳); Part B's 🛑 cancel will
      // mark it cancelled explicitly.
      await liveCardChain.catch(() => {});
      try {
        commitSnapshot(workspaceRoot, product.slug, `after-cancel: ${ctx.userId}`);
      } catch (e) {
        console.log(`[Bot] snapshot (after-cancel) skipped: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }

    // v1.3.0 Part C (P0) — flush pending live narration before we either
    // finalize the live card or fall through to the batch path. The re-typed
    // snapshot defeats control-flow narrowing — `liveCard` is only ever
    // assigned inside the onStage closure, so TS otherwise treats it as `null`.
    await liveCardChain.catch(() => {});
    const activeLiveCard = liveCard as LiveTaskCardHandle | null;

    // v1.2 §6.2 — TRIAGE kind branch. `chat` keeps the v1.0 flat reply
    // in the command channel; `workflow` / `schedule` / `goal` post a
    // task card embed in `works-<handle>` + thread carrying the full
    // Chief reply, and the command channel only sees a 1-line announce
    // with the thread link. Adapters that haven't implemented
    // `postTaskCard` (Slack v1.2.x) fall back to a `📋` prefix so the
    // routing intent stays visible.
    if (activeLiveCard) {
      // v1.3.0 Part C (P0) — a live card was opened mid-turn (the turn
      // decomposed/dispatched). Finalize it: recolour the embed to the
      // resolved kind + post the Chief reply into the thread that already
      // streamed the narration. A card-worthy turn that somehow classified as
      // `chat` still dispatched work, so treat it as a workflow.
      const finalKind = reply.kind === "chat" ? "workflow" : reply.kind;
      try {
        const card = await activeLiveCard.finalize({
          kind: finalKind,
          chiefReply: reply.text,
        });
        await ctx.reply(`📋 작업 등록됨 → ${card.threadUrl}`);
      } catch (cardErr) {
        console.log(
          `[Bot] live task-card finalize failed (${reply.kind}): ${
            cardErr instanceof Error ? cardErr.message : String(cardErr)
          } — falling back to flat reply`,
        );
        await ctx.reply(reply.text || `📋 [${reply.kind}]`);
      }
    } else if (
      reply.kind !== "chat" &&
      reply.text.trim().length > 0 &&
      ctx.postTaskCard
    ) {
      // Batch path — no live card was opened (a non-spawning workflow turn, or
      // an adapter without openLiveTaskCard). Build the narration from the
      // jsonl and post the card after the fact, as before.
      try {
        // v1.2 §8 — fetch the stage events emitted during this turn
        // and project DECOMPOSE/DISPATCH/AWAIT into the thread. Pure
        // file read; takes < 5ms on a sane jsonl, no network.
        const narration = await import("../messenger/discord-narration.js").then(
          (m) =>
            m.narrationLinesAsStrings(
              m.buildStageNarration(orgCwd, reply.turnId),
            ),
        );
        const card = await ctx.postTaskCard({
          kind: reply.kind,
          userRequest: forwardText,
          chiefReply: reply.text,
          chiefName,
          narrationLines: narration,
        });
        await ctx.reply(`📋 작업 등록됨 → ${card.threadUrl}`);
      } catch (cardErr) {
        console.log(
          `[Bot] task-card post failed (${reply.kind}): ${
            cardErr instanceof Error ? cardErr.message : String(cardErr)
          } — falling back to flat reply`,
        );
        await ctx.reply(`📋 [${reply.kind}] ${reply.text}`);
      }
    } else if (reply.text) {
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
      `[Bot] Chief turn done: kind=${reply.kind} cost=$${reply.costUsd.toFixed(4)} duration=${reply.durationMs}ms spawns=${reply.spawnCount}${reply.sessionRotated ? " session-rotated" : ""}`
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
    console.log(`[Bot] Chief error: ${err instanceof Error ? err.message : String(err)}`);
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

  // v1.2.8 §A.10 — write PID file so `solosquad migrate --apply` can
  // signal us on upgrade. Released by the graceful-shutdown handler
  // when SIGTERM/SIGINT fires (or by a stale-file sweep on next start).
  try {
    const { writeBotPid } = await import("../util/bot-pidfile.js");
    const file = writeBotPid(workspaceRoot);
    console.log(`[Bot] PID ${process.pid} → ${file}`);
  } catch (err) {
    console.log(
      `[Bot] PID file write failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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
  let stopping = false;
  const stop = async (sig: NodeJS.Signals): Promise<void> => {
    // v1.2.8 §A.12 — re-entry guard. Pressing Ctrl+C twice during a long
    // drain shouldn't kick off two parallel shutdowns. Second signal
    // skips straight to force-exit so the user isn't held hostage.
    if (stopping) {
      console.log(`[Bot] second ${sig} — forcing exit immediately.`);
      process.exit(1);
    }
    stopping = true;

    console.log(`[Bot] received ${sig} — entering drain mode.`);

    // v1.2.8 §A.12 — block new turns + wait for in-flight to finish.
    // Discord messages mid-reply are awaited as part of handleCommand,
    // so the drain wait covers reply send too. Default 120s budget —
    // long enough for typical Chief turns (5-30s) plus a buffer for
    // slow Claude API responses; short enough to not hang migrations.
    try {
      const { startDrain, waitForDrain, inFlight } = await import("./in-flight.js");
      const active = inFlight();
      if (active > 0) {
        console.log(
          `[Bot] draining ${active} active turn(s) — max 120s wait before force exit.`,
        );
      }
      startDrain();
      const result = await waitForDrain(120_000);
      if (!result.drained) {
        console.log(
          `[Bot] drain timeout — ${result.remaining} turn(s) still active. Forcing exit; their replies may be lost.`,
        );
      } else if (active > 0) {
        console.log(`[Bot] drain complete — all turns finished.`);
      }
    } catch (err) {
      console.log(
        `[Bot] drain wait failed (continuing exit): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    console.log(`[Bot] closing SKILL watcher`);
    try {
      await unwatch();
    } catch (err) {
      console.log(
        `[Bot] watcher close error (continuing exit): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // v1.2.8 §A.10 — release the PID file last so migrate / supervise
    // wrappers see the bot as truly gone before respawning.
    try {
      const { clearBotPid } = await import("../util/bot-pidfile.js");
      clearBotPid(workspaceRoot);
    } catch {
      /* best-effort */
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
