import fs from "fs";
import path from "path";
import {
  ChannelType,
  EmbedBuilder,
  type Guild,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type { TaskCardInput, TaskCardResult } from "./base.js";
import { stopButtonRow } from "./discord-turn-controls.js";

/**
 * v1.2 §6.2 — task card embed in `works-<handle>` + thread on that embed.
 *
 * The embed is the *durable* artifact (Chief title + kind + workflow_id
 * + KST timestamp + 1-line user request). The thread on top of it
 * carries the full Chief reply and every subsequent sub-agent narration
 * (§8.2 — wired by `discord-narration.ts` later in v1.2 Phase B).
 *
 * Thread URL + thread id + works message id are persisted to
 * `<org>/workflows/<workflow-id>/discord-thread.txt` so chief-runner
 * reconcile (§6.3) can resume into the same thread on later turns.
 */

const COLOR_BY_KIND: Record<TaskCardInput["kind"], number> = {
  workflow: 0x5865f2, // blurple
  schedule: 0x57f287, // green
  goal: 0xfee75c, // amber
};

const LABEL_BY_KIND: Record<TaskCardInput["kind"], string> = {
  workflow: "WORKFLOW",
  schedule: "SCHEDULE",
  goal: "GOAL",
};

export interface PostTaskCardInput extends TaskCardInput {
  guild: Guild;
  handle: string;
  orgCwd: string;
}

export async function postTaskCard(
  input: PostTaskCardInput,
): Promise<TaskCardResult> {
  const worksChannel = findWorksChannel(input.guild, input.handle);
  if (!worksChannel) {
    throw new Error(
      `works-${input.handle} channel not found in guild ${input.guild.name}`,
    );
  }

  const workflowId = input.workflowId ?? deriveWorkflowId(input.userRequest);
  const kstNow = kstTimestamp();

  const embed = cardEmbed({
    kind: input.kind,
    userRequest: input.userRequest,
    workflowId,
    kstStarted: kstNow,
    chiefName: input.chiefName,
    status: "completed",
  });

  const cardMessage = await worksChannel.send({ embeds: [embed] });

  const thread = await cardMessage.startThread({
    name: threadNameFor(input.kind, workflowId),
    autoArchiveDuration: 10080, // 7 days
    reason: `SoloSquad ${input.kind} ${workflowId}`,
  });

  // v1.2 §8 — stage narration first (DECOMPOSE / DISPATCH / AWAIT),
  // then the Chief reply text. Order matches the user's mental model:
  // "what did Chief do" → "what does Chief say".
  if (input.narrationLines && input.narrationLines.length > 0) {
    for (const line of input.narrationLines) {
      for (const chunk of chunkForDiscord(line)) {
        await thread.send(chunk);
      }
    }
  }

  if (input.chiefReply.trim().length > 0) {
    for (const chunk of chunkForDiscord(input.chiefReply)) {
      await thread.send(chunk);
    }
  }

  persistThreadRef(input.orgCwd, workflowId, {
    thread_id: thread.id,
    thread_url: threadUrlOf(thread),
    works_message_id: cardMessage.id,
    kind: input.kind,
    started_at: new Date().toISOString(),
  });

  return {
    threadUrl: threadUrlOf(thread),
    workflowId,
  };
}

function findWorksChannel(guild: Guild, handle: string): TextChannel | null {
  const name = `works-${handle}`;
  const ch = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === name,
  );
  return (ch as TextChannel | undefined) ?? null;
}

function deriveWorkflowId(userRequest: string): string {
  const yyyymmdd = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const slug = slugifyForId(userRequest);
  return `wf-${yyyymmdd}-${slug}`;
}

function kstTimestamp(): string {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
}

type CardStatus = "in_progress" | "completed" | "cancelled";

/** Grey while a turn is still running; kind colour once it completes. */
const COLOR_IN_PROGRESS = 0x9b9ba1;
/** Red when the turn was stopped via the 🛑 button or `/cancel`. */
const COLOR_CANCELLED = 0xed4245;

/**
 * Single source of truth for the works task-card embed. The batch path
 * (`postTaskCard`) renders it already-completed; the live path
 * (`LiveTaskCard`) opens it `in_progress` (grey + ⏳) and re-renders it
 * `completed` (kind colour + ✅) at finalize.
 */
function cardEmbed(opts: {
  kind: TaskCardInput["kind"];
  userRequest: string;
  workflowId: string;
  kstStarted: string;
  chiefName: string;
  status: CardStatus;
}): EmbedBuilder {
  const title = firstLine(opts.userRequest, 80) || opts.workflowId;
  const icon =
    opts.status === "in_progress"
      ? "⏳"
      : opts.status === "cancelled"
        ? "🛑"
        : "📋";
  const color =
    opts.status === "in_progress"
      ? COLOR_IN_PROGRESS
      : opts.status === "cancelled"
        ? COLOR_CANCELLED
        : COLOR_BY_KIND[opts.kind];
  const statusText =
    opts.status === "in_progress"
      ? "⏳ 진행 중…"
      : opts.status === "cancelled"
        ? "🛑 중단됨"
        : "✅ 완료";
  return new EmbedBuilder()
    .setTitle(`${icon} ${LABEL_BY_KIND[opts.kind]}: ${title}`)
    .setColor(color)
    .setDescription(
      [
        `**요청** — ${firstLine(opts.userRequest, 200)}`,
        `**workflow_id** — \`${opts.workflowId}\``,
        `**시작** — ${opts.kstStarted} KST`,
        `**상태** — ${statusText}`,
      ].join("\n"),
    )
    .setFooter({ text: `${opts.chiefName} · Chief` });
}

function slugifyForId(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s가-힣]+/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-");
  return base.slice(0, 32) || "task";
}

function threadNameFor(kind: TaskCardInput["kind"], workflowId: string): string {
  return `${kind}-${workflowId}`;
}

function firstLine(text: string, max: number): string {
  const line = (text.split(/\r?\n/)[0] ?? "").trim();
  if (line.length <= max) return line;
  return line.slice(0, max - 1) + "…";
}

function chunkForDiscord(text: string): string[] {
  const max = 1900; // Discord 2000 char limit with safety margin
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + max));
    i += max;
  }
  return chunks;
}

function threadUrlOf(thread: ThreadChannel): string {
  const guildId = thread.guildId ?? thread.guild.id;
  return `https://discord.com/channels/${guildId}/${thread.id}`;
}

interface ThreadRefRecord {
  thread_id: string;
  thread_url: string;
  works_message_id: string;
  kind: TaskCardInput["kind"];
  started_at: string;
}

/**
 * v1.3.0 Part C (P0) — live works card. Opened on the first projectable stage
 * of a turn (grey ⏳ embed + thread); narration lines stream into the thread as
 * stages fire; `finalize` recolours the embed to the resolved kind and posts
 * the Chief reply. Replaces the batch `postTaskCard` for turns that actually
 * decompose/dispatch — chat turns and non-spawning turns keep the batch path.
 */
export interface OpenLiveTaskCardInput {
  guild: Guild;
  handle: string;
  orgCwd: string;
  userRequest: string;
  chiefName: string;
  /**
   * v1.3.0 Part B — customId for the 🛑 button (see `buildStopButtonId`).
   * Encodes (orgSlug, userId) so the InteractionCreate handler can cancel the
   * right turn.
   */
  stopButtonId: string;
}

export class LiveTaskCard {
  private constructor(
    private readonly cardMessage: Message,
    private readonly thread: ThreadChannel,
    private readonly workflowId: string,
    private readonly orgCwd: string,
    private readonly userRequest: string,
    private readonly chiefName: string,
    private readonly kstStarted: string,
  ) {}

  static async open(input: OpenLiveTaskCardInput): Promise<LiveTaskCard> {
    const worksChannel = findWorksChannel(input.guild, input.handle);
    if (!worksChannel) {
      throw new Error(
        `works-${input.handle} channel not found in guild ${input.guild.name}`,
      );
    }
    const workflowId = deriveWorkflowId(input.userRequest);
    const kstStarted = kstTimestamp();
    // The resolved TRIAGE kind isn't known until the turn returns; default the
    // live label to `workflow` (a projectable stage means the turn is
    // decomposing, which is never a chat turn) and recolour at finalize.
    const embed = cardEmbed({
      kind: "workflow",
      userRequest: input.userRequest,
      workflowId,
      kstStarted,
      chiefName: input.chiefName,
      status: "in_progress",
    });
    const cardMessage = await worksChannel.send({
      embeds: [embed],
      components: [stopButtonRow(input.stopButtonId)],
    });
    const thread = await cardMessage.startThread({
      name: threadNameFor("workflow", workflowId),
      autoArchiveDuration: 10080, // 7 days
      reason: `SoloSquad live ${workflowId}`,
    });
    return new LiveTaskCard(
      cardMessage,
      thread,
      workflowId,
      input.orgCwd,
      input.userRequest,
      input.chiefName,
      kstStarted,
    );
  }

  /** Stream one narration line into the thread as its stage fires. */
  async appendNarration(line: string): Promise<void> {
    for (const chunk of chunkForDiscord(line)) {
      await this.thread.send(chunk);
    }
  }

  /**
   * Close the live card: recolour the embed to the resolved kind + completed
   * status and post the Chief reply into the thread. Note we do NOT rename the
   * thread to the resolved kind — Discord rate-limits thread renames hard, and
   * the embed already carries the kind.
   */
  async finalize(input: {
    kind: TaskCardInput["kind"];
    chiefReply: string;
  }): Promise<TaskCardResult> {
    try {
      await this.cardMessage.edit({
        embeds: [
          cardEmbed({
            kind: input.kind,
            userRequest: this.userRequest,
            workflowId: this.workflowId,
            kstStarted: this.kstStarted,
            chiefName: this.chiefName,
            status: "completed",
          }),
        ],
        components: [], // turn is done — drop the 🛑 button
      });
    } catch (err) {
      // Best-effort — a failed embed edit must not drop the reply below.
      console.log(
        `[Discord task-card] live embed finalize failed for ${this.workflowId}: ${
          (err as Error).message
        }`,
      );
    }

    if (input.chiefReply.trim().length > 0) {
      for (const chunk of chunkForDiscord(input.chiefReply)) {
        await this.thread.send(chunk);
      }
    }

    persistThreadRef(this.orgCwd, this.workflowId, {
      thread_id: this.thread.id,
      thread_url: threadUrlOf(this.thread),
      works_message_id: this.cardMessage.id,
      kind: input.kind,
      started_at: new Date().toISOString(),
    });

    return {
      threadUrl: threadUrlOf(this.thread),
      workflowId: this.workflowId,
    };
  }

  /**
   * v1.3.0 Part B — the turn was aborted (🛑 button or `/cancel`). Recolour the
   * embed to the cancelled state and drop the button. Best-effort; never
   * throws (the abort path must not fail on a Discord edit).
   */
  async cancel(): Promise<void> {
    try {
      await this.cardMessage.edit({
        embeds: [
          cardEmbed({
            kind: "workflow",
            userRequest: this.userRequest,
            workflowId: this.workflowId,
            kstStarted: this.kstStarted,
            chiefName: this.chiefName,
            status: "cancelled",
          }),
        ],
        components: [],
      });
    } catch (err) {
      console.log(
        `[Discord task-card] live embed cancel failed for ${this.workflowId}: ${
          (err as Error).message
        }`,
      );
    }
  }
}

function persistThreadRef(
  orgCwd: string,
  workflowId: string,
  record: ThreadRefRecord,
): void {
  try {
    const dir = path.join(orgCwd, "workflows", workflowId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "discord-thread.txt");
    const body = [
      `thread_id=${record.thread_id}`,
      `thread_url=${record.thread_url}`,
      `works_message_id=${record.works_message_id}`,
      `kind=${record.kind}`,
      `started_at=${record.started_at}`,
      "",
    ].join("\n");
    fs.writeFileSync(file, body);
  } catch (err) {
    console.log(
      `[Discord task-card] failed to persist thread ref for ${workflowId}: ${
        (err as Error).message
      }`,
    );
  }
}
