import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type ButtonInteraction,
  type SendableChannels,
} from "discord.js";
import type { ApprovalRequest, ApprovalVerdict } from "./base.js";

/**
 * v1.3.0 Part B — the ✅승인 / ❌거절 approval card, the GUI replacement for the
 * dev-confirm gate's text `y/n`. Posted by the bridge into command-<handle>
 * (Part A) and reusable for any in-turn `askApproval`.
 *
 * Built on the proven onboarding/turn-controls component pattern
 * (`discord-onboarding.ts`, `discord-turn-controls.ts`) but resolves via a
 * per-message `awaitMessageComponent` collector rather than a global
 * InteractionCreate handler — the caller awaits the verdict inline, so no
 * server-side routing state is needed.
 *
 * Misfire recovery:
 *   ① 2-step confirm — ❌거절 opens an ephemeral "정말 거절?" confirm so a
 *      mis-tap doesn't irreversibly block the push; [취소] returns to the card.
 *   ③ disable-after-click — buttons are disabled on resolve so the decision
 *      can't be double-submitted.
 *
 * customId scheme (id is base36, contains no colon — see makeConfirmId):
 *   chief:confirm:<id>:y        approve
 *   chief:confirm:<id>:n        reject (→ 2-step confirm)
 *   chief:confirm:<id>:n2       confirmed reject (ephemeral)
 *   chief:confirm:<id>:cancel   cancel the reject (ephemeral)
 */

const APPROVAL_PREFIX = "chief:confirm:";

export type ApprovalAction = "y" | "n" | "n2" | "cancel";

export function buildApprovalId(id: string, action: ApprovalAction): string {
  return `${APPROVAL_PREFIX}${id}:${action}`;
}

export function parseApprovalId(
  customId: string,
): { id: string; action: ApprovalAction } | null {
  if (!customId.startsWith(APPROVAL_PREFIX)) return null;
  const rest = customId.slice(APPROVAL_PREFIX.length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0 || idx >= rest.length - 1) return null;
  const id = rest.slice(0, idx);
  const action = rest.slice(idx + 1);
  if (action !== "y" && action !== "n" && action !== "n2" && action !== "cancel") {
    return null;
  }
  return { id, action };
}

/** The ✅승인 / ❌거절 row, optionally rendered disabled (post-click). */
export function approvalRow(
  id: string,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildApprovalId(id, "y"))
      .setStyle(ButtonStyle.Success)
      .setLabel("✅ 승인")
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(buildApprovalId(id, "n"))
      .setStyle(ButtonStyle.Danger)
      .setLabel("❌ 거절")
      .setDisabled(disabled),
  );
}

/** The ephemeral 2-step "정말 거절?" row (recovery ①). */
export function confirmRejectRow(
  id: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildApprovalId(id, "n2"))
      .setStyle(ButtonStyle.Danger)
      .setLabel("확정 거절"),
    new ButtonBuilder()
      .setCustomId(buildApprovalId(id, "cancel"))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("취소"),
  );
}

const COLOR_PENDING = 0xfee75c; // amber — awaiting decision
const COLOR_APPROVED = 0x57f287; // green
const COLOR_REJECTED = 0xed4245; // red

function approvalEmbed(
  req: ApprovalRequest,
  status: "pending" | "approved" | "rejected",
): EmbedBuilder {
  const icon =
    status === "approved" ? "✅" : status === "rejected" ? "🛑" : "⚠️";
  const color =
    status === "approved"
      ? COLOR_APPROVED
      : status === "rejected"
        ? COLOR_REJECTED
        : COLOR_PENDING;
  const statusText =
    status === "approved"
      ? "✅ 승인됨"
      : status === "rejected"
        ? "🛑 거절됨"
        : "⌛ 승인 대기";
  const lines = [
    `\`\`\`\n${req.command}\n\`\`\``,
    ...(req.details ?? []).map((d) => `• ${d}`),
    `**상태** — ${statusText}`,
  ];
  return new EmbedBuilder()
    .setTitle(`${icon} ${req.title}`)
    .setColor(color)
    .setDescription(lines.join("\n"));
}

export interface AwaitApprovalOpts {
  /** How long to wait for the first decision before resolving "n". */
  timeoutMs: number;
}

/**
 * Post the approval card to `channel` and resolve with the user's verdict.
 * Never throws — a Discord failure or timeout resolves "n" (fail-safe: no
 * explicit approval ⇒ block). The authoritative gate timeout still lives in the
 * dev-confirm controller; this inner timeout is a backstop.
 */
export async function awaitApproval(
  channel: SendableChannels,
  req: ApprovalRequest,
  opts: AwaitApprovalOpts,
): Promise<ApprovalVerdict> {
  let card;
  try {
    card = await channel.send({
      embeds: [approvalEmbed(req, "pending")],
      components: [approvalRow(req.id)],
    });
  } catch {
    return "n"; // can't even post — block
  }

  const matches = (i: ButtonInteraction): boolean => {
    const parsed = parseApprovalId(i.customId);
    return parsed !== null && parsed.id === req.id;
  };

  // Loop so a cancelled reject (recovery ①) returns to awaiting the card.
  for (;;) {
    let click: ButtonInteraction;
    try {
      click = await card.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: matches,
        time: opts.timeoutMs,
      });
    } catch {
      // timeout — disable + mark rejected, block.
      await card
        .edit({ embeds: [approvalEmbed(req, "rejected")], components: [] })
        .catch(() => {});
      return "n";
    }

    const action = parseApprovalId(click.customId)?.action;

    if (action === "y") {
      await click
        .update({ embeds: [approvalEmbed(req, "approved")], components: [] })
        .catch(() => {});
      return "y";
    }

    // ❌거절 → ephemeral 2-step confirm (recovery ①).
    await click
      .reply({
        content: "정말 거절할까요? 거절하면 이 작업은 차단됩니다.",
        components: [confirmRejectRow(req.id)],
        ephemeral: true,
      })
      .catch(() => {});

    // The confirm buttons live on the *ephemeral reply*, a different message
    // than `card` — so the collector must await on that reply, not the card.
    let second: ButtonInteraction;
    try {
      const ephemeral = await click.fetchReply();
      second = await ephemeral.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => {
          const p = parseApprovalId(i.customId);
          return p?.id === req.id && (p.action === "n2" || p.action === "cancel");
        },
        time: opts.timeoutMs,
      });
    } catch {
      await card
        .edit({ embeds: [approvalEmbed(req, "rejected")], components: [] })
        .catch(() => {});
      return "n";
    }

    if (parseApprovalId(second.customId)?.action === "n2") {
      await second
        .update({ content: "🛑 거절했습니다.", components: [] })
        .catch(() => {});
      await card
        .edit({ embeds: [approvalEmbed(req, "rejected")], components: [] })
        .catch(() => {});
      return "n";
    }

    // cancel → dismiss the ephemeral, keep the card live, loop back to await.
    await second
      .update({ content: "거절을 취소했습니다. 다시 선택하세요.", components: [] })
      .catch(() => {});
  }
}
