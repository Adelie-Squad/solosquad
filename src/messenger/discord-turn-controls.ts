import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  type Client,
} from "discord.js";
import type { TurnControls } from "./base.js";

/**
 * v1.3.0 Part B — the live works card's 🛑 button. Clicking it aborts the
 * in-flight Chief turn (the GUI equivalent of the `/cancel` slash). The button
 * customId encodes the turn's (orgSlug, userId) so the InteractionCreate
 * handler can route to the right turn without any server-side state.
 *
 * customId shape: `chief:stop:<orgSlug>:<userId>`. orgSlug is a kebab slug (no
 * colons); userId is a Discord snowflake (digits) — so the *last* colon splits
 * them unambiguously even if a slug ever contained one.
 */

const STOP_PREFIX = "chief:stop:";

export function buildStopButtonId(orgSlug: string, userId: string): string {
  return `${STOP_PREFIX}${orgSlug}:${userId}`;
}

export function parseStopButtonId(
  customId: string,
): { orgSlug: string; userId: string } | null {
  if (!customId.startsWith(STOP_PREFIX)) return null;
  const rest = customId.slice(STOP_PREFIX.length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0 || idx >= rest.length - 1) return null;
  return { orgSlug: rest.slice(0, idx), userId: rest.slice(idx + 1) };
}

/** Build the 🛑 button action row, optionally rendered disabled (post-click). */
export function stopButtonRow(
  customId: string,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setStyle(ButtonStyle.Danger)
      .setLabel("🛑 중단")
      .setDisabled(disabled),
  );
}

/**
 * Register the InteractionCreate handler for live-card 🛑 buttons. Safe to call
 * from `Client.on(Events.ClientReady)` alongside `registerOnboarding` — both
 * filter by customId so they coexist on the same gateway. `getControls`
 * resolves the runner hook lazily (it's wired after startBot).
 */
export function registerTurnControls(
  client: Client,
  getControls: () => TurnControls | null,
): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      const parsed = parseStopButtonId(interaction.customId);
      if (!parsed) return; // not our button — onboarding/other handlers own it

      // Only the turn's own user may stop it (the card lives in their private
      // works channel, but guard anyway).
      if (interaction.user.id !== parsed.userId) {
        await interaction
          .reply({ content: "본인 작업만 중단할 수 있습니다.", ephemeral: true })
          .catch(() => {});
        return;
      }

      const cancelled =
        getControls()?.cancelTurn(parsed.orgSlug, parsed.userId) ?? false;

      // Immediate ack (3s rule): disable the button in place, preserving the
      // embed (update with only `components` leaves content/embeds unchanged).
      // The dispatcher's abort path recolours the embed to 🛑 shortly after.
      await interaction
        .update({ components: [stopButtonRow(interaction.customId, true)] })
        .catch(() => interaction.deferUpdate().catch(() => {}));

      if (!cancelled) {
        await interaction
          .followUp({
            content: "이미 끝났거나 중단할 작업이 없습니다.",
            ephemeral: true,
          })
          .catch(() => {});
      }
    } catch (e) {
      console.log(`[Discord turn-controls] stop handler failed: ${e}`);
    }
  });
}
