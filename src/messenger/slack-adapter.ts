import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getReposBase } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { loadProducts, type Product } from "../util/config.js";
import {
  DEFAULT_CHANNELS,
  SYSTEM_THREADS,
  type MessengerAdapter,
  type MessageContext,
  type CommandHandler,
} from "./base.js";
import { parseChannelName } from "../bot/user-registry.js";
import { resolveBotIdentity } from "../bot/channel-bootstrap.js";
import { getWorkspaceRoot } from "../util/paths.js";

const THREAD_STARTER_PREFIX = "🧵";

class SlackMessageContext implements MessageContext {
  _agentLabel = "";
  constructor(
    private sayFn: (text: string) => Promise<void>,
    private product: Product,
    readonly userId: string
  ) {}

  async reply(text: string): Promise<void> {
    const prefix = `*[${this.product.name}${this._agentLabel}]*\n`;
    const chunks = text.match(/.{1,3000}/gs) || [text];
    for (let i = 0; i < chunks.length; i++) {
      const header = i === 0 ? prefix : "";
      await this.sayFn(`${header}\`\`\`\n${chunks[i]}\n\`\`\``);
    }
  }

  async typing(): Promise<void> {
    // Slack shows typing automatically
  }
}

export class SlackAdapter implements MessengerAdapter {
  readonly platform = "slack";
  readonly channelNames = DEFAULT_CHANNELS;
  private client: unknown = null;
  /** Cache of channelId:threadName → thread_ts (parent message timestamp). */
  private threadTsCache = new Map<string, string>();
  /** v0.8 §3.5 — resolved bot user's handle. Null until auth.test succeeds. */
  private ownHandle: string | null = null;
  private ownOrgSlug: string | null = null;
  private ownBotUserId: string | null = null;

  async startBot(onCommand: CommandHandler): Promise<void> {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;

    if (!botToken || !appToken) {
      console.log("[Slack] Cannot start — missing tokens.");
      console.log("  Required in .env:");
      console.log("    SLACK_BOT_TOKEN  format: xoxb-<n>-<n>-<str>  (NOT xoxp-, that's a user token)");
      console.log("    SLACK_APP_TOKEN  format: xapp-1-<str>-<n>-<str>  (NOT the Signing Secret)");
      console.log("  Also verify in api.slack.com/apps:");
      console.log("    - Socket Mode: Enabled");
      console.log("    - App-Level Token scope: connections:write");
      console.log("    - Bot Token scopes: channels:read, channels:manage, chat:write, app_mentions:read, channels:history");
      console.log("    - Event Subscriptions: message.channels");
      console.log("    - Install/Reinstall workspace after scope changes");
      process.exit(1);
    }

    const { App } = await import("@slack/bolt");

    const app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
    });

    app.error(async (err) => {
      console.log(`[Slack] Bolt error: ${err.message || err}`);
      if ((err as Error & { code?: string }).code) {
        console.log(`[Slack] code: ${(err as Error & { code?: string }).code}`);
      }
    });

    this.client = app.client;

    app.message(/.*/s, async ({ message, say }) => {
      const msg = message as unknown as Record<string, unknown>;
      if (msg.subtype) return; // skip edits, joins, etc.

      // v0.8 §3.1 — Resolve channel name and apply the `(command|works)-<handle>`
      // gate. Only `command-<handle>` channels accept input; everything else
      // (works, broadcast, system, legacy) is ignored at the listener boundary.
      let channelName: string | undefined;
      try {
        const channelInfo = await app.client.conversations.info({
          channel: msg.channel as string,
        });
        channelName = (
          channelInfo.channel as unknown as Record<string, unknown>
        )?.name as string | undefined;
      } catch {
        return;
      }
      if (!channelName) return;
      const parsed = parseChannelName(channelName);
      if (!parsed || parsed.kind !== "command") return;

      // v0.8 §3.5 — only act on this bot's own command channel.
      const ownHandle = this.ownHandle;
      if (!ownHandle || ownHandle !== parsed.handle) return;

      // v1.0.4 — author-guard removed (Slack adapter). Same rationale as the
      // Discord adapter in v1.0.2: comparing the Slack `user.name` against
      // the channel-derived handle universally false-positives for users
      // whose Slack username diverged from their SoloSquad handle (different
      // charset, separate identities). Slack channel ACL is the canonical
      // permission boundary; SoloSquad does not own it and cannot meaningfully
      // layer a 2nd defense. Log author identity for post-hoc audit only.
      const slackAuthorId = (msg.user as string) || "?";
      console.log(
        `[Slack Bot] message in ${channelName} from author id=${slackAuthorId}`,
      );

      // Determine product
      let product = this.getProductForChannel(msg.channel as string);
      if (!product) {
        const products = loadProducts();
        product = products[0] || null;
      }
      if (!product) {
        await say("No product configured. Run `solosquad init` first.");
        return;
      }

      const userText = ((msg.text as string) || "").trim();
      const userId = (msg.user as string) || "anonymous";
      const ctx = new SlackMessageContext(
        async (text: string) => { await say(text); },
        product,
        userId
      );
      try {
        await onCommand(userText, product, ctx);
      } catch (e) {
        console.log(`[Slack] Command handler error: ${e}`);
      }
    });

    console.log("[Slack Bot] Starting Socket Mode...");
    await app.start();

    // v0.8 §3.5 — bind this gateway connection to a user yaml via auth.test.
    try {
      const auth = await app.client.auth.test();
      const botUserId = (auth.user_id as string) || "";
      const botHandle = (auth.user as string) || "";
      if (botUserId) {
        this.ownBotUserId = botUserId;
        const identity = resolveBotIdentity({
          workspace: getWorkspaceRoot(),
          botUserId,
        });
        if (identity) {
          this.ownHandle = identity.user.handle;
          this.ownOrgSlug = identity.orgSlug;
          console.log(
            `[Slack Bot] Bound to handle=${identity.user.handle} org=${identity.orgSlug} ` +
              `(channels: ${identity.channels.command} / ${identity.channels.works})`,
          );
        } else {
          console.log(
            `[Slack Bot] No user yaml matches bot_user_id=${botUserId} (auth.user=${botHandle}). ` +
              `Run \`solosquad init\` or \`solosquad migrate --apply\` to register this bot.`,
          );
        }
      }
    } catch (e) {
      console.log(`[Slack Bot] auth.test failed: ${e}`);
    }

    // v0.2.4+: ensure default channels and system threads exist (symmetry with Discord)
    await this.ensureChannelsForAllProducts();
  }

  async startNotifier(): Promise<void> {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) {
      console.log("[Slack] SLACK_BOT_TOKEN is not set. Check .env (format: xoxb-<n>-<n>-<str>).");
      process.exit(1);
    }

    const { WebClient } = await import("@slack/web-api");
    this.client = new WebClient(botToken);
    // v0.2.4+: notifier-side setup ensures #workflow exists before scheduler fires
    await this.ensureChannelsForAllProducts();
  }

  async sendToChannel(
    productConfig: Record<string, unknown>,
    channelName: string,
    text: string,
    title?: string,
    threadName?: string
  ): Promise<boolean> {
    if (!this.client) return false;
    const webClient = this.client as import("@slack/web-api").WebClient;

    const channelKey = channelName.replace(/-/g, "_");
    const channels = (productConfig.channels || {}) as Record<string, string>;
    let channelId = channels[channelKey];

    if (!channelId) {
      channelId = (await this.findChannelByName(channelName)) || "";
      if (!channelId) return false;
    }

    const content = title ? `*${title}*\n\n${text}` : text;

    try {
      let threadTs: string | undefined;
      if (threadName) {
        threadTs = await this.resolveThreadTs(channelId, threadName);
      }
      await webClient.chat.postMessage({
        channel: channelId,
        text: content,
        thread_ts: threadTs,
      });
      return true;
    } catch (e) {
      console.log(`[Slack] Failed to send to #${channelName}${threadName ? `/${threadName}` : ""}: ${e}`);
      return false;
    }
  }

  async setupChannels(productConfig: Record<string, unknown>): Promise<string[]> {
    if (!this.client) return [];
    const webClient = this.client as import("@slack/web-api").WebClient;

    const existing = await this.listChannels();
    const existingNames = new Set(existing.map((ch) => ch.name));

    // v0.8 §3.5 — per-user channel pair when the bot is bound to a handle.
    const targets = this.ownHandle
      ? [`command-${this.ownHandle}`, `works-${this.ownHandle}`]
      : this.channelNames;

    const created: string[] = [];
    for (const chName of targets) {
      if (!existingNames.has(chName)) {
        try {
          // v0.8 §3.1 — private (is_private: true) channels for per-user pairs.
          const isPerUser =
            this.ownHandle !== null && parseChannelName(chName) !== null;
          await webClient.conversations.create({
            name: chName,
            is_private: isPerUser,
          });
          created.push(chName);
        } catch (e) {
          console.log(`[Slack] Failed to create #${chName}: ${e}`);
        }
      }
    }

    if (created.length) {
      console.log(`[Slack] Channels created: ${created.join(", ")}`);
    }

    // v0.2.4+: ensure system threads exist inside #workflow
    const workflowId = await this.findChannelByName("workflow");
    if (workflowId) {
      // Auto-join (otherwise chat.postMessage may fail in private/new channels)
      try {
        await webClient.conversations.join({ channel: workflowId });
      } catch {
        // ignore — bot may already be member
      }
      for (const tName of SYSTEM_THREADS) {
        await this.resolveThreadTs(workflowId, tName);
      }
    }

    // Persist channel ID mapping back to config.yaml for the matched product
    await this.persistChannelMapping(productConfig);

    return created;
  }

  // -- Internal --

  private async listChannels(): Promise<Array<{ name: string; id: string }>> {
    if (!this.client) return [];
    const webClient = this.client as import("@slack/web-api").WebClient;
    try {
      const result = await webClient.conversations.list({
        types: "public_channel,private_channel",
        limit: 1000,
      });
      return ((result.channels || []) as Array<{ name: string; id: string }>);
    } catch {
      return [];
    }
  }

  private async findChannelByName(name: string): Promise<string | null> {
    const channels = await this.listChannels();
    const found = channels.find((ch) => ch.name === name);
    return found?.id || null;
  }

  private async ensureChannelsForAllProducts(): Promise<void> {
    const products = loadProducts();
    const reposBase = getReposBase();
    for (const p of products) {
      const orgDir = path.join(reposBase, p.slug);
      const configFile = path.join(orgDir, "slack", "config.yaml");
      let config: Record<string, unknown> = {};
      if (fs.existsSync(configFile)) {
        try {
          config = (yaml.load(normalizeLine(fs.readFileSync(configFile, "utf-8"))) as Record<string, unknown>) || {};
        } catch {
          config = {};
        }
      }
      try {
        await this.setupChannels(config);
      } catch (e) {
        console.log(`[Slack] setupChannels for ${p.slug} failed: ${e}`);
      }
    }
  }

  /**
   * Find or create the starter message for a named thread inside a channel.
   * Returns the thread_ts (parent message timestamp).
   */
  private async resolveThreadTs(
    channelId: string,
    threadName: string
  ): Promise<string> {
    const cacheKey = `${channelId}:${threadName}`;
    const cached = this.threadTsCache.get(cacheKey);
    if (cached) return cached;

    const webClient = this.client as import("@slack/web-api").WebClient;

    // Look for an existing starter message
    try {
      const history = await webClient.conversations.history({
        channel: channelId,
        limit: 200,
      });
      const starter = (history.messages || []).find((m) => {
        const text = (m as { text?: string }).text || "";
        return text.startsWith(`${THREAD_STARTER_PREFIX} [${threadName}]`);
      });
      if (starter && starter.ts) {
        this.threadTsCache.set(cacheKey, starter.ts);
        return starter.ts;
      }
    } catch (e) {
      console.log(`[Slack] conversations.history failed: ${e}`);
    }

    // Otherwise create a new starter
    const created = await webClient.chat.postMessage({
      channel: channelId,
      text: `${THREAD_STARTER_PREFIX} [${threadName}] Initialized by SoloSquad. Background routines post here.`,
    });
    const ts = (created.ts as string) || "";
    if (ts) this.threadTsCache.set(cacheKey, ts);
    return ts;
  }

  private async persistChannelMapping(productConfig: Record<string, unknown>): Promise<void> {
    const products = loadProducts();
    const reposBase = getReposBase();
    const allChannels = await this.listChannels();

    for (const p of products) {
      const configFile = path.join(reposBase, p.slug, "slack", "config.yaml");
      if (!fs.existsSync(configFile)) continue;
      try {
        const config = (yaml.load(normalizeLine(fs.readFileSync(configFile, "utf-8"))) as Record<string, unknown>) || {};
        const mapping = (config.channels || {}) as Record<string, string>;
        let touched = false;
        for (const ch of allChannels) {
          if (this.channelNames.includes(ch.name)) {
            const key = ch.name.replace(/-/g, "_");
            if (mapping[key] !== ch.id) {
              mapping[key] = ch.id;
              touched = true;
            }
          }
        }
        config.channels = mapping;
        if (touched) {
          fs.writeFileSync(configFile, yaml.dump(config));
          console.log(`[Slack] Persisted channel mapping for ${p.slug}`);
        }
      } catch (e) {
        console.log(`[Slack] Failed to persist mapping for ${p.slug}: ${e}`);
      }
    }
    void productConfig; // signature compat
  }

  private getProductForChannel(channelId: string): Product | null {
    const products = loadProducts();
    const reposBase = getReposBase();

    for (const p of products) {
      const configFile = path.join(reposBase, p.slug, "slack", "config.yaml");
      if (!fs.existsSync(configFile)) continue;
      const config = yaml.load(normalizeLine(fs.readFileSync(configFile, "utf-8"))) as Record<string, unknown>;
      const channels = (config.channels || {}) as Record<string, string>;
      if (Object.values(channels).includes(channelId)) return p;
    }
    return null;
  }
}
