import {
  Client,
  GatewayIntentBits,
  ChannelType,
  type Message,
  type Guild,
  type TextChannel,
} from "discord.js";
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

class DiscordMessageContext implements MessageContext {
  _agentLabel = "";
  constructor(
    private message: Message,
    private product: Product
  ) {}

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

  async startBot(onCommand: CommandHandler): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      console.log("[Discord] Cannot start — DISCORD_TOKEN is not set.");
      console.log("  Required in .env:");
      console.log("    DISCORD_TOKEN  format: <base64>.<base64>.<base64>  (the Bot Token, NOT the Client Secret)");
      console.log("  Also verify in discord.com/developers:");
      console.log("    - Bot → Privileged Gateway Intents → MESSAGE CONTENT: enabled");
      console.log("    - OAuth2 scopes: bot, applications.commands");
      console.log("    - Bot permissions: View Channels, Send Messages, Read Message History");
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

    client.on("ready", async () => {
      console.log(`[Discord Bot] Logged in: ${client.user?.tag}`);
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
      if ((message.channel as TextChannel).name !== "owner-command") return;

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
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await this.client.login(token);
  }

  async sendToChannel(
    productConfig: Record<string, unknown>,
    channelName: string,
    text: string,
    title?: string
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
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
      return true;
    } catch (e) {
      console.log(`[Discord] Failed to send to #${channelName}: ${e}`);
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
    for (const chName of this.channelNames) {
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
    return created;
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
