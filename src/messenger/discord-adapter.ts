import {
  Client,
  Events,
  GatewayIntentBits,
  ChannelType,
  type Message,
  type Guild,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
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
import {
  isAuthorizedAuthor,
  unauthorizedAuthorMessage,
} from "../bot/author-guard.js";
import { resolveBotIdentity } from "../bot/channel-bootstrap.js";
import { getWorkspaceRoot } from "../util/paths.js";

class DiscordMessageContext implements MessageContext {
  _agentLabel = "";
  readonly userId: string;
  constructor(
    private message: Message,
    private product: Product
  ) {
    this.userId = message.author.id;
  }

  async reply(text: string): Promise<void> {
    const chunks = text.match(/.{1,1900}/gs) || [text];
    for (let i = 0; i < chunks.length; i++) {
      const prefix = i === 0 ? `**[${this.product.name}${this._agentLabel}]**\n` : "";
      try {
        await this.message.reply(`${prefix}\`\`\`\n${chunks[i]}\n\`\`\``);
      } catch (e) {
        console.log(`[Discord] Failed to reply: ${e}`);
      }
    }
  }

  async typing(): Promise<void> {
    if ("sendTyping" in this.message.channel) {
      await (this.message.channel as TextChannel).sendTyping();
    }
  }
}

export class DiscordAdapter implements MessengerAdapter {
  readonly platform = "discord";
  readonly channelNames = DEFAULT_CHANNELS;
  private client: Client | null = null;
  /** v0.8 §3.5 — resolved bot user's handle. Null until `clientReady` fires. */
  private ownHandle: string | null = null;
  private ownOrgSlug: string | null = null;

  async startBot(onCommand: CommandHandler): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      console.log("[Discord] Cannot start — DISCORD_TOKEN is not set.");
      console.log("  Required in .env:");
      console.log("    DISCORD_TOKEN  format: <base64>.<base64>.<base64>  (the Bot Token, NOT the Client Secret)");
      console.log("  Also verify in discord.com/developers:");
      console.log("    - Bot → Privileged Gateway Intents → MESSAGE CONTENT: enabled");
      console.log("    - OAuth2 scopes: bot, applications.commands");
      console.log("    - Bot permissions: View Channels, Send Messages, Read Message History, Create Public Threads");
      console.log("    - Invite the bot to a server whose name contains the product name/slug");
      process.exit(1);
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.client = client;

    // v1.0.1 — discord.js v14.26 deprecated the `ready` alias in favor of
    // `clientReady` (renamed to disambiguate from the gateway READY opcode;
    // `ready` is removed in v15). Use the typed Events.ClientReady enum.
    client.on(Events.ClientReady, async () => {
      console.log(`[Discord Bot] Logged in: ${client.user?.tag}`);

      // v0.8 §3.5 — match this gateway connection to a user yaml so we know
      // which `command-<handle>` / `works-<handle>` pair to own. When no
      // yaml matches, log and continue — adapter stays connected but the
      // messageCreate listener will short-circuit (other-user channel).
      const botUserId = client.user?.id ?? "";
      if (botUserId) {
        const identity = resolveBotIdentity({
          workspace: getWorkspaceRoot(),
          botUserId,
        });
        if (identity) {
          this.ownHandle = identity.user.handle;
          this.ownOrgSlug = identity.orgSlug;
          console.log(
            `[Discord Bot] Bound to handle=${identity.user.handle} org=${identity.orgSlug} ` +
              `(channels: ${identity.channels.command} / ${identity.channels.works})`,
          );
        } else {
          console.log(
            `[Discord Bot] No user yaml matches bot_user_id=${botUserId}. ` +
              `Run \`solosquad init\` or \`solosquad migrate --apply\` to register this bot.`,
          );
        }
      }

      for (const guild of client.guilds.cache.values()) {
        await this.ensureChannels(guild);
      }
      this.syncGuildProductMapping();
      console.log(`[Discord Bot] Ready. Connected to ${client.guilds.cache.size} server(s)`);
    });

    client.on("guildCreate", async (guild) => {
      await this.ensureChannels(guild);
      this.syncGuildProductMapping();
    });

    client.on("messageCreate", async (message) => {
      if (message.author.bot) return;
      const channelName = (message.channel as TextChannel).name ?? "";

      // v0.8 §3.1 — Only `command-<handle>` channels accept commands. Other
      // channels (works-<handle>, broadcast, system, legacy) are ignored at
      // the listener boundary. The legacy `owner-command` is no longer
      // recognized — operators are expected to migrate via §6.
      const parsed = parseChannelName(channelName);
      if (!parsed || parsed.kind !== "command") return;

      // v0.8 §3.5 — Only act on channels belonging to *this* bot's user.
      // Other users' command channels in the same guild are silently
      // ignored (a different bot process owns them).
      const ownHandle = this.ownHandle;
      if (!ownHandle || ownHandle !== parsed.handle) return;

      // v0.8 §3.4 — author-guard: defense in depth on top of ACL.
      const authorHandle = (message.author.username ?? "").toLowerCase();
      if (!isAuthorizedAuthor(channelName, authorHandle)) {
        try {
          await message.author
            .send(unauthorizedAuthorMessage(channelName, authorHandle))
            .catch(() => undefined);
        } catch {
          // DM may fail (privacy settings) — best effort.
        }
        return;
      }

      const product = this.getProductByGuild(message.guild!.id);
      if (!product) {
        await message.channel.send("No product linked to this server. Re-run `solosquad init`.");
        return;
      }

      const ctx = new DiscordMessageContext(message, product);
      await message.channel.sendTyping();
      try {
        await onCommand(message.content.trim(), product, ctx);
      } catch (e) {
        console.log(`[Discord] Command handler error: ${e}`);
      }
    });

    await client.login(token);
  }

  async startNotifier(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      console.log("[Discord] DISCORD_TOKEN is not set. Check .env.");
      process.exit(1);
    }
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    await this.client.login(token);
  }

  async sendToChannel(
    productConfig: Record<string, unknown>,
    channelName: string,
    text: string,
    title?: string,
    threadName?: string
  ): Promise<boolean> {
    if (!this.client?.isReady()) return false;

    const guildId = productConfig.guild_id as string | undefined;
    if (!guildId) return false;

    const channelKey = channelName.replace(/-/g, "_");
    const channels = (productConfig.channels || {}) as Record<string, string>;
    const channelId = channels[channelKey];
    if (!channelId) return false;

    const channel = this.client.channels.cache.get(channelId) as TextChannel | undefined;
    if (!channel) return false;

    const content = title ? `**${title}**\n\n${text}` : text;
    const chunks = content.match(/.{1,1900}/gs) || [content];

    try {
      const target: TextChannel | ThreadChannel = threadName
        ? await this.ensureThread(channel, threadName)
        : channel;

      for (const chunk of chunks) {
        await target.send(chunk);
      }
      return true;
    } catch (e) {
      console.log(`[Discord] Failed to send to #${channelName}${threadName ? `/${threadName}` : ""}: ${e}`);
      return false;
    }
  }

  async setupChannels(productConfig: Record<string, unknown>): Promise<string[]> {
    if (!this.client) return [];
    const guildId = productConfig.guild_id as string | undefined;
    if (!guildId) return [];
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return [];
    return this.ensureChannels(guild);
  }

  getClient(): Client | null {
    return this.client;
  }

  // -- Internal --

  private async ensureChannels(guild: Guild): Promise<string[]> {
    const existing = new Set(guild.channels.cache.map((ch) => ch.name));

    let category = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && ch.name === "AI Team Reports"
    );
    if (!category) {
      category = await guild.channels.create({
        name: "AI Team Reports",
        type: ChannelType.GuildCategory,
      });
    }

    const created: string[] = [];

    // v0.8 §3.5 — when this bot has been bound to a handle, create the per-user
    // channel pair `command-<handle>` / `works-<handle>`. Otherwise fall back
    // to the legacy DEFAULT_CHANNELS list (no-op once migrated workspaces
    // never reach this branch).
    const targets = this.ownHandle
      ? [`command-${this.ownHandle}`, `works-${this.ownHandle}`]
      : this.channelNames;

    for (const chName of targets) {
      if (!existing.has(chName)) {
        await guild.channels.create({
          name: chName,
          type: ChannelType.GuildText,
          parent: category.id,
        });
        created.push(chName);
      }
    }

    if (created.length) {
      console.log(`[Discord] ${guild.name}: channels created → ${created.join(", ")}`);
    }

    // v0.2.4+: ensure system threads exist inside #workflow (only when the
    // legacy `workflow` channel is present — kept for back-compat during the
    // transition; new installs use per-user works-<handle> instead).
    await this.ensureSystemThreads(guild);
    return created;
  }

  private async ensureSystemThreads(guild: Guild): Promise<void> {
    const workflowChannel = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildText && ch.name === "workflow"
    ) as TextChannel | undefined;
    if (!workflowChannel) return;

    try {
      const active = await workflowChannel.threads.fetchActive();
      const existing = new Set(active.threads.map((t) => t.name));
      for (const tName of SYSTEM_THREADS) {
        if (!existing.has(tName)) {
          const thread = await workflowChannel.threads.create({
            name: tName,
            autoArchiveDuration: 10080, // 7 days
            reason: "SoloSquad system thread",
          });
          await thread.send(`Initialized: \`${tName}\` thread. Background routines post here.`);
          console.log(`[Discord] ${guild.name}: thread created → ${tName}`);
        }
      }
    } catch (e) {
      console.log(`[Discord] ensureSystemThreads failed: ${e}`);
    }
  }

  private async ensureThread(
    channel: TextChannel,
    threadName: string
  ): Promise<ThreadChannel> {
    const active = await channel.threads.fetchActive();
    const found = active.threads.find((t) => t.name === threadName);
    if (found) return found;
    return channel.threads.create({
      name: threadName,
      autoArchiveDuration: 10080,
      reason: "SoloSquad routine thread",
    });
  }

  private syncGuildProductMapping(): void {
    if (!this.client) return;
    const products = loadProducts();
    const reposBase = getReposBase();

    for (const guild of this.client.guilds.cache.values()) {
      for (const product of products) {
        if (guild.name.includes(product.name) || guild.name.toLowerCase().includes(product.slug)) {
          const configFile = path.join(reposBase, product.slug, "discord", "config.yaml");
          if (!fs.existsSync(configFile)) continue;

          const config = yaml.load(normalizeLine(fs.readFileSync(configFile, "utf-8"))) as Record<string, unknown>;
          if (config.guild_id !== guild.id) {
            config.guild_id = guild.id;
            const channels = (config.channels || {}) as Record<string, string>;
            for (const ch of guild.channels.cache.values()) {
              if (this.channelNames.includes(ch.name)) {
                channels[ch.name.replace(/-/g, "_")] = ch.id;
              }
            }
            config.channels = channels;
            fs.writeFileSync(configFile, yaml.dump(config));
            console.log(`[Discord] Mapped: ${guild.name} ↔ ${product.name}`);
          }
        }
      }
    }
  }

  private getProductByGuild(guildId: string): Product | null {
    const products = loadProducts();
    const reposBase = getReposBase();

    for (const p of products) {
      const configFile = path.join(reposBase, p.slug, "discord", "config.yaml");
      if (!fs.existsSync(configFile)) continue;
      const config = yaml.load(normalizeLine(fs.readFileSync(configFile, "utf-8"))) as Record<string, unknown>;
      if (config.guild_id === guildId) return p;
    }
    return null;
  }
}
