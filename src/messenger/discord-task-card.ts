import fs from "fs";
import path from "path";
import {
  ChannelType,
  EmbedBuilder,
  type Guild,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type { TaskCardInput, TaskCardResult } from "./base.js";

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

  const workflowId = input.workflowId ?? deriveWorkflowId(input);
  const title = firstLine(input.userRequest, 80) || workflowId;
  const kstNow = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${LABEL_BY_KIND[input.kind]}: ${title}`)
    .setColor(COLOR_BY_KIND[input.kind])
    .setDescription(
      [
        `**요청** — ${firstLine(input.userRequest, 200)}`,
        `**workflow_id** — \`${workflowId}\``,
        `**시작** — ${kstNow} KST`,
      ].join("\n"),
    )
    .setFooter({ text: `${input.chiefName} · Chief` });

  const cardMessage = await worksChannel.send({ embeds: [embed] });

  const thread = await cardMessage.startThread({
    name: threadNameFor(input.kind, workflowId),
    autoArchiveDuration: 10080, // 7 days
    reason: `SoloSquad ${input.kind} ${workflowId}`,
  });

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

function deriveWorkflowId(input: TaskCardInput): string {
  const yyyymmdd = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const slug = slugifyForId(input.userRequest);
  return `wf-${yyyymmdd}-${slug}`;
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
