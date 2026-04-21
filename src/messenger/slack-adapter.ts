import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getReposBase } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { loadProducts, type Product } from "../util/config.js";
import {
  DEFAULT_CHANNELS,
  type MessengerAdapter,
  type MessageContext,
  type CommandHandler,
} from "./base.js";

const COMMAND_CHANNEL = process.env.SLACK_COMMAND_CHANNEL || "owner-command";

class SlackMessageContext implements MessageContext {
  _agentLabel = "";
  constructor(
    private sayFn: (text: string) => Promise<void>,
    private product: Product
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
      console.log("    - Bot Token scopes: channels:read, chat:write, app_mentions:read, channels:history");
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

      // Check if message is in command channel
      try {
        const channelInfo = await app.client.conversations.info({
          channel: msg.channel as string,
        });
        const channelName = (channelInfo.channel as unknown as Record<string, unknown>)?.name;
        if (channelName !== COMMAND_CHANNEL) return;
      } catch {
        return;
      }

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
      const ctx = new SlackMessageContext(
        async (text: string) => { await say(text); },
        product
      );
      try {
        await onCommand(userText, product, ctx);
      } catch (e) {
        console.log(`[Slack] Command handler error: ${e}`);
      }
    });

    console.log("[Slack Bot] Starting Socket Mode...");
    await app.start();
  }

  async startNotifier(): Promise<void> {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) {
      console.log("[Slack] SLACK_BOT_TOKEN is not set. Check .env (format: xoxb-<n>-<n>-<str>).");
      process.exit(1);
    }

    const { WebClient } = await import("@slack/web-api");
    this.client = new WebClient(botToken);
  }

  async sendToChannel(
    productConfig: Record<string, unknown>,
    channelName: string,
    text: string,
    title?: string
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
      await webClient.chat.postMessage({ channel: channelId, text: content });
      return true;
    } catch (e) {
      console.log(`[Slack] Failed to send to #${channelName}: ${e}`);
      return false;
    }
  }

  async setupChannels(productConfig: Record<string, unknown>): Promise<string[]> {
    if (!this.client) return [];
    const webClient = this.client as import("@slack/web-api").WebClient;

    const existing = await this.listChannels();
    const existingNames = new Set(existing.map((ch) => ch.name));

    const created: string[] = [];
    for (const chName of this.channelNames) {
      if (!existingNames.has(chName)) {
        try {
          await webClient.conversations.create({ name: chName });
          created.push(chName);
        } catch (e) {
          console.log(`[Slack] Failed to create #${chName}: ${e}`);
        }
      }
    }

    if (created.length) {
      console.log(`[Slack] Channels created: ${created.join(", ")}`);
    }
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
