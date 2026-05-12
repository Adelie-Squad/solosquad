import path from "path";
import { createAdapters } from "../messenger/index.js";
import { RealClaudeProcessFactory } from "./claude-process.js";
import { PmRunner, AuthExpiredError } from "./pm-runner.js";
import { SessionStore } from "./session-store.js";
import { FileEventSink, pmEventsPath } from "./events.js";
import { getReposBase, getWorkspaceDir } from "../util/paths.js";
import { loadEnv, type Product } from "../util/config.js";
import type { MessageContext } from "../messenger/base.js";

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

  // v1.3.0 (PM mode): PM session cwd is fixed at the org root (per
  // docs/plan/v0.3-pm-mode-orchestration.md §3.2.1). target_repo cwd
  // branching happens inside subagent prompts, not by switching PM cwd.
  const orgCwd = path.join(getReposBase(), product.slug);

  console.log(
    `[Bot] PM turn: user=${ctx.userId} org=${product.slug} text="${userInput.slice(0, 60)}${userInput.length > 60 ? "…" : ""}"`
  );

  try {
    const reply = await pmRunner.handleUserMessage({
      userId: ctx.userId,
      orgSlug: product.slug,
      orgCwd,
      userText: userInput,
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

  // v1.3.0: confirm Claude Code is authenticated before listening.
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

  await Promise.all(adapters.map((a) => a.startBot(handleCommand)));
}
