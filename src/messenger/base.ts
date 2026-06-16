import type { Product } from "../util/config.js";

/**
 * v1.2.9 §D — surface the message originates from, threaded from the
 * adapter all the way into Chief's system prompt so Chief knows whether
 * it is talking through a chat messenger (Discord/Slack) or the terminal
 * (`solosquad chat`). Messenger adapters set their own `platform` value;
 * the CLI chat command constructs a `ChiefCall` with `"cli"` directly.
 */
export type ChiefSource = "discord" | "slack" | "cli";

export interface MessageContext {
  reply(text: string): Promise<void>;
  typing(): Promise<void>;
  _agentLabel: string;
  /**
   * v1.2.9 §D — which messenger surface this turn came in on. Set by the
   * adapter (Discord/Slack). The bot dispatcher forwards it into
   * `ChiefCall.source` so Chief can adapt its formatting (e.g. messenger
   * = no code-block-wrapped replies, inline questions).
   */
  source: ChiefSource;
  /** v0.3.0 — stable per-user identifier from the messenger platform.
   * Used by PM-runner to key session-store: (userId, orgSlug) → session-id.
   * Discord: message.author.id. Slack: event.user. */
  userId: string;
  /**
   * v1.2 §6.2 — When Chief's TRIAGE classifies the turn as a work unit
   * (workflow / schedule / goal), the bot/index.ts dispatcher invokes
   * this to post a task card embed in `works-<handle>` + start a thread
   * on that embed. Adapters that haven't implemented v1.2 yet can leave
   * this undefined — the dispatcher falls back to a flat reply with a
   * `📋` prefix in the command channel so the routing intent is still
   * visible to the user.
   */
  postTaskCard?: (input: TaskCardInput) => Promise<TaskCardResult>;
  /**
   * v1.3.0 Part C (P0) — open a *live* works card mid-turn. The dispatcher
   * calls this on the first projectable stage event (DECOMPOSE/DISPATCH/AWAIT),
   * streams narration into the returned handle as later stages fire, and calls
   * `finalize` once the turn returns. Adapters that don't implement it (Slack
   * today, the slash fallback) leave it undefined and the dispatcher uses the
   * batch `postTaskCard` path instead — no behaviour change for them.
   */
  openLiveTaskCard?: (input: LiveTaskCardOpen) => Promise<LiveTaskCardHandle>;
}

export interface LiveTaskCardOpen {
  /** Short user request — drives the embed title + workflow id. */
  userRequest: string;
  /** Chief display name (org.yaml.chief_name or "Chief"). */
  chiefName: string;
}

export interface LiveTaskCardHandle {
  /** Stream one already-formatted narration line into the card's thread. */
  appendNarration(line: string): Promise<void>;
  /**
   * Close the card: recolour to the resolved TRIAGE kind + post the Chief
   * reply into the thread. Returns the same shape as `postTaskCard` so the
   * dispatcher can announce the thread url identically.
   */
  finalize(input: {
    kind: TaskCardInput["kind"];
    chiefReply: string;
  }): Promise<TaskCardResult>;
  /**
   * v1.3.0 Part B — the turn was aborted (🛑 button / `/cancel`). Recolour the
   * card to the cancelled state and drop the button. Best-effort, never throws.
   */
  cancel(): Promise<void>;
}

export interface TaskCardInput {
  /** Chief's TRIAGE kind. Drives embed color + label. */
  kind: "workflow" | "schedule" | "goal";
  /** Short user request (first line of original message, or summary). */
  userRequest: string;
  /** Full Chief reply text — posted as the first thread message. */
  chiefReply: string;
  /** Chief display name (org.yaml.chief_name or "Chief"). */
  chiefName: string;
  /** Stable workflow id when available (e.g. wf-20260528-pmf). */
  workflowId?: string;
  /**
   * v1.2 §8 — Chief 6+1 stage narration. Posted between the task card
   * and the Chief reply so the user sees DISPATCH/AWAIT activity before
   * reading the synthesized response. Built upstream from
   * `chief-stage-events.jsonl`; empty when there are no projectable
   * stages (chat-only turn or DECOMPOSE/DISPATCH not yet emitted).
   */
  narrationLines?: string[];
}

export interface TaskCardResult {
  /** Best-effort URL to the started thread (for the command-channel announce). */
  threadUrl: string;
  /** Resolved workflow id (echoed back; useful when caller didn't supply one). */
  workflowId: string;
}

export type CommandHandler = (
  userInput: string,
  product: Product,
  ctx: MessageContext
) => Promise<void>;

/**
 * v1.3.0 Part B — turn-control hooks the bot wires into an adapter so message
 * components (the live card's 🛑 button, later approval buttons) can drive the
 * runner without the adapter importing chief-runner. The GUI equivalent of the
 * `/cancel` slash.
 */
export interface TurnControls {
  /**
   * Abort the in-flight Chief turn for (orgSlug, userId). Returns true when a
   * turn was actually in flight. Mirrors `ChiefRunner.cancelTurn`.
   */
  cancelTurn(orgSlug: string, userId: string): boolean;
}

export interface MessengerAdapter {
  readonly platform: string;
  readonly channelNames: string[];

  /**
   * Start listening for commands. `controls` (v1.3.0 Part B) lets the adapter
   * wire interactive components back to the runner; adapters that don't render
   * components may ignore it.
   */
  startBot(onCommand: CommandHandler, controls?: TurnControls): Promise<void>;

  /** Connect for sending only (scheduler mode). */
  startNotifier(): Promise<void>;

  /**
   * Send a message to a named channel. If `threadName` is provided, the
   * message is posted inside that named thread (Discord/Slack native threads).
   */
  sendToChannel(
    productConfig: Record<string, unknown>,
    channelName: string,
    text: string,
    title?: string,
    threadName?: string
  ): Promise<boolean>;

  /** Ensure required channels exist. */
  setupChannels(productConfig: Record<string, unknown>): Promise<string[]>;
}

export const DEFAULT_CHANNELS = [
  "owner-command",
  "workflow",
];

/**
 * System threads created inside #workflow. Background routines post here.
 *
 * v0.8.5 — Removed `system-daily-signals`, `system-experiments`,
 * `system-weekly-review` along with their parent analysis routines
 * (signal-scan / experiment-check / weekly-review). `system-errors` retained
 * as a generic error sink — independent of any specific routine.
 */
export const SYSTEM_THREADS = [
  "system-errors",
];
