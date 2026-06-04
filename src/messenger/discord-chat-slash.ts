import {
  Events,
  SlashCommandBuilder,
  type Client,
  type ChatInputCommandInteraction,
  type Guild,
} from "discord.js";
import type { Product } from "../util/config.js";
import type { CommandHandler, MessageContext } from "./base.js";

/**
 * v1.2 §7.4 — `/chat <message>` slash command. Registered at guild
 * scope (immediate reflection, no global 1-hour propagation). The
 * runtime contract: when MESSAGE_CONTENT privileged intent is denied
 * (Discord verification edge case, or 100-guild threshold reached),
 * users can still talk to Chief via the slash command.
 *
 * Currently registered as a passive fallback — the default routing is
 * still `messageCreate` in `command-<handle>`. When ops decide to flip
 * to slash-first (e.g. >100 guilds), the messageCreate listener can be
 * disabled with one flag and this path takes over.
 */

const COMMAND_NAME = "chat";

const COMMAND_BUILDER = new SlashCommandBuilder()
  .setName(COMMAND_NAME)
  .setDescription("Talk to your Chief — fallback when message content intent is denied")
  .addStringOption((opt) =>
    opt
      .setName("message")
      .setDescription("Your message to Chief")
      .setRequired(true)
      .setMaxLength(2000),
  );

export interface ChatSlashContext {
  /** Resolve the (handle, org) bound to this bot at the time of invocation. */
  ownHandle: string | null;
  ownOrgSlug: string | null;
  /** Lookup product for the interaction's guild — same logic as messageCreate. */
  getProductByGuild: (guildId: string) => Product | null;
}

/**
 * Register the `/chat` command in every guild the bot is currently in,
 * and wire the interaction listener that routes the user text through
 * `onCommand`. Idempotent — Discord's `set` API replaces previously-
 * registered guild commands with the same name.
 */
export async function registerChatSlash(
  client: Client,
  onCommand: CommandHandler,
  getContext: () => ChatSlashContext,
): Promise<void> {
  const body = COMMAND_BUILDER.toJSON();
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set([body]);
    } catch (e) {
      console.log(
        `[Discord /chat] register failed for ${guild.name}: ${(e as Error).message}`,
      );
    }
  }
  // Also catch-up for guilds joined later — sendOnboardingEmbed runs
  // on GuildCreate; reuse the same hook for slash registration.
  client.on(Events.GuildCreate, async (guild: Guild) => {
    try {
      await guild.commands.set([body]);
    } catch (e) {
      console.log(
        `[Discord /chat] register on GuildCreate failed for ${guild.name}: ${(e as Error).message}`,
      );
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== COMMAND_NAME) return;
    await handleChat(interaction, onCommand, getContext());
  });
}

async function handleChat(
  interaction: ChatInputCommandInteraction,
  onCommand: CommandHandler,
  ctx: ChatSlashContext,
): Promise<void> {
  const text = interaction.options.getString("message", true);
  const product = interaction.guild
    ? ctx.getProductByGuild(interaction.guild.id)
    : null;
  if (!product) {
    await interaction.reply({
      content:
        "This guild isn't bound to a SoloSquad org yet. Try `solosquad doctor --discord` to diagnose.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const msgCtx: MessageContext = {
    _agentLabel: "",
    source: "discord",
    userId: interaction.user.id,
    async reply(reply: string): Promise<void> {
      const chunks = reply.match(/.{1,1900}/gs) ?? [reply];
      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await interaction.editReply(chunks[i]);
        } else {
          await interaction.followUp({ content: chunks[i] });
        }
      }
    },
    async typing(): Promise<void> {
      /* slash interaction defers are the typing equivalent — no-op */
    },
    // postTaskCard intentionally omitted — slash fallback uses the flat
    // reply path. Workflow registration via /chat should rewrite the
    // request as a `command-<handle>` message anyway.
  };

  try {
    await onCommand(text, product, msgCtx);
  } catch (e) {
    console.log(`[Discord /chat] handler error: ${e}`);
    try {
      await interaction.editReply(
        `An error occurred while processing your message: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      );
    } catch {
      /* deferReply may have expired by now */
    }
  }
}
