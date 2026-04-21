import { loadProducts, type Product } from "../util/config.js";
import {
  DEFAULT_CHANNELS,
  type MessengerAdapter,
  type MessageContext,
  type CommandHandler,
} from "./base.js";

class TelegramMessageContext implements MessageContext {
  _agentLabel = "";
  constructor(
    private bot: import("node-telegram-bot-api"),
    private chatId: number,
    private product: Product
  ) {}

  async reply(text: string): Promise<void> {
    const prefix = `*[${this.product.name}${this._agentLabel}]*\n`;
    const chunks = text.match(/.{1,3800}/gs) || [text];
    for (let i = 0; i < chunks.length; i++) {
      const header = i === 0 ? prefix : "";
      await this.bot.sendMessage(this.chatId, `${header}\`\`\`\n${chunks[i]}\n\`\`\``, {
        parse_mode: "Markdown",
      });
    }
  }

  async typing(): Promise<void> {
    await this.bot.sendChatAction(this.chatId, "typing");
  }
}

export class TelegramAdapter implements MessengerAdapter {
  readonly platform = "telegram";
  readonly channelNames = DEFAULT_CHANNELS;
  private bot: import("node-telegram-bot-api") | null = null;

  async startBot(onCommand: CommandHandler): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.log("[Telegram] Cannot start — missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID.");
      console.log("  Required in .env:");
      console.log("    TELEGRAM_BOT_TOKEN  format: <n>:<str>  (from @BotFather → /newbot)");
      console.log("    TELEGRAM_CHAT_ID    integer for DM/group (may be negative), or @channelname for channels");
      console.log("  To obtain chat_id:");
      console.log("    1. Send any message to the bot (or add it to a group)");
      console.log("    2. Open https://api.telegram.org/bot<TOKEN>/getUpdates");
      console.log("    3. Copy the numeric chat.id field");
      console.log("  For groups with all-messages read, disable Privacy Mode in @BotFather.");
      process.exit(1);
    }

    const TelegramBot = (await import("node-telegram-bot-api")).default;
    this.bot = new TelegramBot(token, { polling: true });

    const products = loadProducts();
    const product = products[0] || null;

    this.bot.on("message", async (msg) => {
      if (String(msg.chat.id) !== chatId) return;
      if (!msg.text || !product) return;

      const ctx = new TelegramMessageContext(this.bot!, msg.chat.id, product);
      try {
        await onCommand(msg.text.trim(), product, ctx);
      } catch (e) {
        console.log(`[Telegram] Command handler error: ${e}`);
      }
    });

    console.log("[Telegram Bot] Polling started...");
  }

  async startNotifier(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.log("[Telegram] TELEGRAM_BOT_TOKEN is not set. Check .env.");
      process.exit(1);
    }

    const TelegramBot = (await import("node-telegram-bot-api")).default;
    this.bot = new TelegramBot(token);
  }

  async sendToChannel(
    productConfig: Record<string, unknown>,
    _channelName: string,
    text: string,
    title?: string
  ): Promise<boolean> {
    if (!this.bot) return false;

    const chatId = (productConfig.chat_id as string) || process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return false;

    const content = title ? `*${title}*\n\n${text}` : text;
    try {
      const chunks = content.match(/.{1,3800}/gs) || [content];
      for (const chunk of chunks) {
        await this.bot.sendMessage(chatId, chunk, { parse_mode: "Markdown" });
      }
      return true;
    } catch (e) {
      console.log(`[Telegram] Failed to send: ${e}`);
      return false;
    }
  }

  async setupChannels(): Promise<string[]> {
    // Telegram doesn't have channel creation via bot
    return [];
  }
}
