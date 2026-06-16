import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type MessageComponentInteraction,
  type SendableChannels,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { ChoiceOption, ChoiceRequest } from "./base.js";

/**
 * v1.3.0 Part B — single-select question via buttons (≤5 options) or a select
 * menu (6+), the GUI replacement for free-text choice parsing. Resolves with
 * the chosen option's `value`. Shares the per-message `awaitMessageComponent`
 * pattern with `discord-approval.ts`.
 *
 * Misfire recovery:
 *   ② undo grace — after a *reversible* choice, the card shows "✅ 처리됨 · ↩
 *      되돌리기 (Ns)"; clicking ↩ within the window returns to the question.
 *      Execution is deferred until the window elapses, so the click (intent)
 *      and the action (effect) are separated.
 *   ① 2-step confirm — an *irreversible* option (delete/deploy) opens an
 *      ephemeral "정말?" confirm instead of an undo window.
 *
 * customId scheme (id is caller-supplied, kept colon-free by convention; the
 * option index — not the raw value — is encoded so arbitrary values are safe):
 *   chief:choice:<id>:opt<N>   button for option N
 *   chief:choice:<id>:menu     the select menu
 *   chief:choice:<id>:undo     undo the last reversible choice
 *   chief:choice:<id>:c2       confirm an irreversible choice
 *   chief:choice:<id>:cancel   cancel an irreversible choice
 */

const CHOICE_PREFIX = "chief:choice:";

export function buildChoiceOptId(id: string, index: number): string {
  return `${CHOICE_PREFIX}${id}:opt${index}`;
}
export function buildChoiceMenuId(id: string): string {
  return `${CHOICE_PREFIX}${id}:menu`;
}
export function buildChoiceUndoId(id: string): string {
  return `${CHOICE_PREFIX}${id}:undo`;
}
export function buildChoiceConfirmId(id: string): string {
  return `${CHOICE_PREFIX}${id}:c2`;
}
export function buildChoiceCancelId(id: string): string {
  return `${CHOICE_PREFIX}${id}:cancel`;
}

export type ChoiceAction =
  | { kind: "opt"; index: number }
  | { kind: "menu" }
  | { kind: "undo" }
  | { kind: "confirm" }
  | { kind: "cancel" };

export function parseChoiceId(
  customId: string,
): { id: string; action: ChoiceAction } | null {
  if (!customId.startsWith(CHOICE_PREFIX)) return null;
  const rest = customId.slice(CHOICE_PREFIX.length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0 || idx >= rest.length - 1) return null;
  const id = rest.slice(0, idx);
  const raw = rest.slice(idx + 1);
  let action: ChoiceAction;
  if (raw === "menu") action = { kind: "menu" };
  else if (raw === "undo") action = { kind: "undo" };
  else if (raw === "c2") action = { kind: "confirm" };
  else if (raw === "cancel") action = { kind: "cancel" };
  else if (raw.startsWith("opt")) {
    const n = Number(raw.slice(3));
    if (!Number.isInteger(n) || n < 0) return null;
    action = { kind: "opt", index: n };
  } else return null;
  return { id, action };
}

/** Button row(s) for ≤5 options. */
export function choiceButtonRows(
  req: ChoiceRequest,
  disabled = false,
): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  req.options.forEach((opt, i) => {
    const b = new ButtonBuilder()
      .setCustomId(buildChoiceOptId(req.id, i))
      .setStyle(opt.irreversible ? ButtonStyle.Danger : ButtonStyle.Primary)
      .setLabel(opt.label)
      .setDisabled(disabled);
    if (opt.emoji) b.setEmoji(opt.emoji);
    row.addComponents(b);
  });
  return [row];
}

/** Select menu for 6+ options. */
export function choiceMenuRow(
  req: ChoiceRequest,
  disabled = false,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildChoiceMenuId(req.id))
    .setPlaceholder("하나를 선택하세요")
    .setDisabled(disabled)
    .addOptions(
      req.options.slice(0, 25).map((opt, i) => ({
        label: opt.label.slice(0, 100),
        value: String(i),
        description: opt.description?.slice(0, 100),
        emoji: opt.emoji,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function questionEmbed(req: ChoiceRequest, footer?: string): EmbedBuilder {
  const e = new EmbedBuilder().setTitle("❓ 선택").setDescription(req.question).setColor(0x5865f2);
  if (footer) e.setFooter({ text: footer });
  return e;
}

function rowsFor(req: ChoiceRequest, disabled = false) {
  return req.options.length > 5
    ? [choiceMenuRow(req, disabled)]
    : choiceButtonRows(req, disabled);
}

export interface AwaitChoiceOpts {
  /** How long to wait for a selection before rejecting. */
  timeoutMs: number;
  /** Test seam — defaults to setTimeout. */
  delay?: (ms: number) => Promise<void>;
}

const realDelay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Post the question and resolve with the chosen option's `value`. Throws on
 * timeout (no choice made). Reversible choices honour `undoGraceMs` (recovery
 * ②); irreversible options require a 2-step confirm (recovery ①).
 */
export async function awaitChoice(
  channel: SendableChannels,
  req: ChoiceRequest,
  opts: AwaitChoiceOpts,
): Promise<string> {
  const delay = opts.delay ?? realDelay;
  const card = await channel.send({
    embeds: [questionEmbed(req)],
    components: rowsFor(req),
  });

  const matches = (i: MessageComponentInteraction): boolean => {
    const parsed = parseChoiceId(i.customId);
    return parsed !== null && parsed.id === req.id;
  };

  for (;;) {
    const pick = await card.awaitMessageComponent({ filter: matches, time: opts.timeoutMs });
    const action = parseChoiceId(pick.customId)?.action;
    const index =
      action?.kind === "opt"
        ? action.index
        : action?.kind === "menu"
          ? Number((pick as StringSelectMenuInteraction).values[0])
          : -1;
    const option = req.options[index];
    if (!option) {
      // unknown selection — re-await.
      await pick.deferUpdate().catch(() => {});
      continue;
    }

    if (option.irreversible) {
      const confirmed = await confirmIrreversible(pick as ButtonInteraction, req, opts.timeoutMs);
      if (!confirmed) continue; // cancelled — back to the question
      await card
        .edit({ embeds: [questionEmbed(req, `선택: ${option.label}`)], components: [] })
        .catch(() => {});
      return option.value;
    }

    // reversible → undo grace window (recovery ②).
    const grace = req.undoGraceMs ?? 0;
    if (grace <= 0) {
      await pick
        .update({ embeds: [questionEmbed(req, `선택: ${option.label}`)], components: [] })
        .catch(() => {});
      return option.value;
    }

    await pick
      .update({
        embeds: [questionEmbed(req, `✅ ${option.label} · ↩ 되돌리기 (${Math.round(grace / 1000)}s)`)],
        components: [undoRow(req.id)],
      })
      .catch(() => {});

    const undone = await raceUndo(card, req.id, grace, delay);
    if (undone) {
      // restore the question for another pick.
      await card.edit({ embeds: [questionEmbed(req)], components: rowsFor(req) }).catch(() => {});
      continue;
    }
    await card
      .edit({ embeds: [questionEmbed(req, `선택: ${option.label}`)], components: [] })
      .catch(() => {});
    return option.value;
  }
}

function undoRow(id: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildChoiceUndoId(id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("↩ 되돌리기"),
  );
}

/** Wait for an undo click within `graceMs`; true if undone, false if elapsed. */
async function raceUndo(
  card: Awaited<ReturnType<SendableChannels["send"]>>,
  id: string,
  graceMs: number,
  delay: (ms: number) => Promise<void>,
): Promise<boolean> {
  const undoClick = card
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => parseChoiceId(i.customId)?.id === id && parseChoiceId(i.customId)?.action.kind === "undo",
      time: graceMs,
    })
    .then(async (i) => {
      await i.update({ components: [] }).catch(() => {});
      return true;
    })
    .catch(() => false);
  const elapsed = delay(graceMs).then(() => false);
  return Promise.race([undoClick, elapsed]);
}

/** Ephemeral 2-step confirm for an irreversible option (recovery ①). */
async function confirmIrreversible(
  pick: ButtonInteraction,
  req: ChoiceRequest,
  timeoutMs: number,
): Promise<boolean> {
  await pick
    .reply({
      content: "되돌릴 수 없는 선택입니다. 진행할까요?",
      ephemeral: true,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(buildChoiceConfirmId(req.id))
            .setStyle(ButtonStyle.Danger)
            .setLabel("진행"),
          new ButtonBuilder()
            .setCustomId(buildChoiceCancelId(req.id))
            .setStyle(ButtonStyle.Secondary)
            .setLabel("취소"),
        ),
      ],
    })
    .catch(() => {});
  try {
    const reply = await pick.fetchReply();
    const second = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => {
        const p = parseChoiceId(i.customId);
        return p?.id === req.id && (p.action.kind === "confirm" || p.action.kind === "cancel");
      },
      time: timeoutMs,
    });
    const confirmed = parseChoiceId(second.customId)?.action.kind === "confirm";
    await second
      .update({ content: confirmed ? "진행합니다." : "취소했습니다.", components: [] })
      .catch(() => {});
    return confirmed;
  } catch {
    return false; // timeout — treat as cancelled
  }
}
