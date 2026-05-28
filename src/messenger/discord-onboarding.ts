import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  type TextChannel,
} from "discord.js";
import { loadOrgYaml } from "../util/config.js";
import { getOrgDir, getWorkspaceRoot } from "../util/paths.js";
import { listUserYamls } from "../bot/user-registry.js";

/**
 * v1.2 §5 — guildCreate onboarding embed + button handler.
 *
 * When the Chief bot is invited to a fresh guild, post a welcome embed to
 * the systemChannel (or first writable text channel) with two buttons:
 *   - "Auto-create channels" → invokes ensureChannels + sends a first
 *     greeting in #command-<handle>.
 *   - "Manual choose" → asks the user to mention an existing channel as
 *     the command channel (rare; we keep it simple — they can ignore the
 *     embed and run `solosquad doctor --discord` later).
 *
 * Idempotency:
 *   - Channel creation goes through ensureChannels (already idempotent).
 *   - Embed dedupe: scans the last 50 messages in the target channel for
 *     a prior welcome embed authored by this bot before sending.
 *   - First greeting dedupe: the caller (post-button handler) checks
 *     `#command-<handle>` for any prior bot message before posting.
 */

const ONBOARD_AUTO_CUSTOM_ID = "chief:onboard:auto";
const ONBOARD_MANUAL_CUSTOM_ID = "chief:onboard:manual";
const EMBED_DEDUPE_MARKER = "chief-onboard-embed:v1.2";

export interface OnboardingContext {
  workspace: string;
  /** The bot's bound org slug (post-clientReady). */
  ownOrgSlug: string | null;
  /** The bot's bound handle (post-clientReady). */
  ownHandle: string | null;
  /** Async hook the adapter exposes — must run ensureChannels for one guild. */
  ensureChannels: (guild: Guild) => Promise<string[]>;
}

/**
 * Register both the guildCreate handler (welcome embed) and the
 * InteractionCreate handler (button clicks). Safe to call from
 * `Client.on(Events.ClientReady)` — the listeners persist for the
 * lifetime of the client.
 */
export function registerOnboarding(
  client: Client,
  getContext: () => OnboardingContext,
): void {
  client.on(Events.GuildCreate, async (guild) => {
    try {
      await sendOnboardingEmbed(guild, getContext());
    } catch (e) {
      console.log(`[Discord onboarding] guildCreate handler failed: ${e}`);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      if (
        interaction.customId !== ONBOARD_AUTO_CUSTOM_ID &&
        interaction.customId !== ONBOARD_MANUAL_CUSTOM_ID
      ) {
        return;
      }
      await handleOnboardingButton(interaction, getContext());
    } catch (e) {
      console.log(`[Discord onboarding] button handler failed: ${e}`);
    }
  });
}

export async function sendOnboardingEmbed(
  guild: Guild,
  ctx: OnboardingContext,
): Promise<void> {
  const target = pickOnboardingChannel(guild);
  if (!target) {
    console.log(
      `[Discord onboarding] no writable text channel in ${guild.name} — DMing owner as fallback`,
    );
    await dmOwnerFallback(guild, ctx);
    return;
  }

  if (await embedAlreadySent(target, guild.client.user!.id)) {
    return;
  }

  const chiefName = resolveChiefName(ctx);
  const ownerMessengerId = resolveOwnerMessengerUserId(ctx);
  const ownerMention = ownerMessengerId ? `<@${ownerMessengerId}>` : "the workspace owner";
  const handle = ctx.ownHandle ?? "<handle>";

  const embed = new EmbedBuilder()
    .setTitle(`안녕하세요, ${chiefName} 입니다 🫡`)
    .setDescription(
      [
        "저는 이 조직의 Chief 로, 사용자 ↔ Chief ↔ sub-agent 오케스트레이션을 합니다.",
        `다음 채널을 자동으로 만들까요? \`#command-${handle}\` (지시) + \`#works-${handle}\` (작업 등록 + 진행 thread).`,
        `짧은 대화는 \`#command-${handle}\` 에서, workflow/schedule/goal 은 \`#works-${handle}\` 에 자동 등록됩니다.`,
        `저는 ${ownerMention} 의 지시만 받습니다.`,
        "",
        `_${EMBED_DEDUPE_MARKER}_`,
      ].join("\n"),
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ONBOARD_AUTO_CUSTOM_ID)
      .setStyle(ButtonStyle.Success)
      .setLabel("✓ Auto-create channels"),
    new ButtonBuilder()
      .setCustomId(ONBOARD_MANUAL_CUSTOM_ID)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("⚙ Manual choose"),
  );

  await target.send({ embeds: [embed], components: [row] });
  console.log(
    `[Discord onboarding] welcome embed sent in ${guild.name} #${target.name}`,
  );
}

async function handleOnboardingButton(
  interaction: ButtonInteraction,
  ctx: OnboardingContext,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Onboarding works inside a guild only.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === ONBOARD_AUTO_CUSTOM_ID) {
    await interaction.deferReply({ ephemeral: true });
    const created = await ctx.ensureChannels(interaction.guild);
    const handle = ctx.ownHandle ?? "<handle>";
    const commandChannel = interaction.guild.channels.cache.find(
      (c) => c.name === `command-${handle}` && c.type === ChannelType.GuildText,
    ) as TextChannel | undefined;

    if (commandChannel) {
      const chiefName = resolveChiefName(ctx);
      await sendFirstGreetingIfMissing(commandChannel, chiefName);
    }

    const summary = created.length
      ? `✓ Created: ${created.join(", ")}. Head to <#${commandChannel?.id ?? ""}> to give your first goal.`
      : `✓ Channels already present. Head to <#${commandChannel?.id ?? ""}> to give your first goal.`;
    await interaction.editReply(summary);
    return;
  }

  if (interaction.customId === ONBOARD_MANUAL_CUSTOM_ID) {
    await interaction.reply({
      content:
        `Mention the channel you'd like to use as \`command-${ctx.ownHandle ?? "<handle>"}\` (e.g. <#1234567890>). ` +
        "If you prefer to skip the embed entirely, you can also just talk to me in a channel I have access to — " +
        "I'll log the auto-create failure and you can re-invite me with the right permissions later.",
      ephemeral: true,
    });
    return;
  }
}

function pickOnboardingChannel(guild: Guild): TextChannel | null {
  const me = guild.members.me;
  if (!me) return null;

  const system = guild.systemChannel;
  if (
    system &&
    system.type === ChannelType.GuildText &&
    system.permissionsFor(me)?.has("SendMessages")
  ) {
    return system;
  }

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    const perms = (channel as TextChannel).permissionsFor(me);
    if (perms?.has("SendMessages")) return channel as TextChannel;
  }
  return null;
}

async function embedAlreadySent(
  channel: TextChannel,
  botUserId: string,
): Promise<boolean> {
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    for (const msg of recent.values()) {
      if (msg.author.id !== botUserId) continue;
      for (const embed of msg.embeds) {
        if (embed.description?.includes(EMBED_DEDUPE_MARKER)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function sendFirstGreetingIfMissing(
  channel: TextChannel,
  chiefName: string,
): Promise<void> {
  try {
    const recent = await channel.messages.fetch({ limit: 10 });
    const botMessage = recent.find((m) => m.author.id === channel.guild.client.user!.id);
    if (botMessage) return;
  } catch {
    // fetch failure → still try to send (idempotency is best-effort).
  }
  await channel.send(
    `**${chiefName}** here — ready when you are. Try:\n` +
      "  • 이번 주 PMF 가설 검증 루틴 설계\n" +
      "  • 신규 기능 PRD 초안 만들기\n" +
      "  • [경쟁사 X] 변화 모니터링 routine 등록",
  );
}

async function dmOwnerFallback(
  guild: Guild,
  ctx: OnboardingContext,
): Promise<void> {
  const ownerMessengerId = resolveOwnerMessengerUserId(ctx);
  if (!ownerMessengerId) return;
  try {
    const member = await guild.members.fetch(ownerMessengerId);
    const dm = await member.createDM();
    await dm.send(
      `I was added to **${guild.name}** but lack write access to any channel. ` +
        "Re-invite me with the `Manage Channels` + `Send Messages` permissions, " +
        "or grant access to an existing channel — then I can auto-create `command-<handle>` / `works-<handle>`.",
    );
  } catch (e) {
    console.log(`[Discord onboarding] DM fallback failed: ${e}`);
  }
}

function resolveChiefName(ctx: OnboardingContext): string {
  if (!ctx.ownOrgSlug) return "Chief";
  const org = loadOrgYaml(getOrgDir(ctx.ownOrgSlug, ctx.workspace ?? getWorkspaceRoot()));
  return org?.chief_name?.trim() || "Chief";
}

function resolveOwnerMessengerUserId(ctx: OnboardingContext): string | null {
  if (!ctx.ownOrgSlug || !ctx.ownHandle) return null;
  const users = listUserYamls(ctx.ownOrgSlug, ctx.workspace ?? getWorkspaceRoot());
  const owner = users.find((u) => u.handle === ctx.ownHandle);
  return owner?.messenger_user_id ?? null;
}
