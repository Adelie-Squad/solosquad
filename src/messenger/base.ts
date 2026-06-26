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
  /**
   * Post a reply. `opts.sessionStart` (v1.4.0) prepends a "🆕 세션 시작" marker
   * before the Chief name on the first chunk — shown when this turn opened a
   * new Chief session (brand-new, or after `chief reset` / rotation). Adapters
   * that don't render a Chief name may ignore it.
   */
  reply(text: string, opts?: { sessionStart?: boolean }): Promise<void>;
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
   * (workflow / cron / goal), the bot/index.ts dispatcher invokes
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
  /**
   * v1.3.0 Part B — ask the user to approve/reject an action via message
   * components (Discord buttons), resolving with their verdict. Used for
   * in-turn approvals; the dev-confirm gate (Part A) posts to command-<handle>
   * out-of-turn via the adapter directly. Adapters that don't render components
   * (Slack today) leave it undefined — callers fall back to a text prompt.
   */
  askApproval?: (req: ApprovalRequest) => Promise<ApprovalVerdict>;
  /**
   * v1.3.0 Part B — ask the user to pick one option via buttons (≤5) or a
   * select menu (6+), resolving with the chosen option's value. Undefined on
   * adapters without component support (text fallback).
   */
  askChoice?: (req: ChoiceRequest) => Promise<string>;
  /**
   * v1.3.0 Part C (P1) — file a long Chief output to `<org>/artifacts/` and
   * surface it in chat as a card + file attachment instead of a wall of
   * chunked text. Adapters without file upload leave it undefined — callers
   * fall back to a plain chunked `reply`.
   */
  attachArtifact?: (input: ArtifactInput) => Promise<ArtifactRef>;
}

/** v1.3.0 Part C (P1) — an output to persist + surface as an attachment. */
export interface ArtifactInput {
  /** Human title (drives the filename slug + card heading). */
  title: string;
  /** Full content to file. */
  content: string;
  /** File extension without the dot. Default "md". */
  ext?: string;
}

/** v1.3.0 Part C (P1) — where a filed artifact landed. */
export interface ArtifactRef {
  /** Bare filename of the saved artifact. */
  fileName: string;
  /** Absolute path on disk. */
  absPath: string;
}

/** v1.3.0 Part B — the user's verdict on an approval request. */
export type ApprovalVerdict = "y" | "n";

/**
 * v1.3.0 Part B — an action awaiting the user's ✅/❌. `command` is the literal
 * thing being approved (e.g. the git push); `details` render as extra lines on
 * the card (branch, repo, commit range).
 */
export interface ApprovalRequest {
  /** Stable correlation id (the dev-confirm id) — encoded into the button. */
  id: string;
  /** Short card title, e.g. "git push 승인 요청". */
  title: string;
  /** The command/action text being approved. */
  command: string;
  /** Optional context lines rendered under the command. */
  details?: string[];
}

/** v1.3.0 Part B — one selectable option in an `askChoice` request. */
export interface ChoiceOption {
  /** Value returned by `askChoice` when this option is chosen. */
  value: string;
  /** Display label (button text / menu row title). */
  label: string;
  /** Optional emoji prefix. */
  emoji?: string;
  /** Optional one-line description (shown in select menus). */
  description?: string;
  /**
   * When true, choosing this option is irreversible (delete/deploy/reject) →
   * the adapter asks a 2-step ephemeral confirmation before resolving
   * (misfire-recovery ①). Reversible options instead get an undo grace window
   * (misfire-recovery ②).
   */
  irreversible?: boolean;
}

/** v1.3.0 Part B — a single-select question posed to the user. */
export interface ChoiceRequest {
  /** Stable correlation id — encoded into component customIds. */
  id: string;
  /** The question prompt. */
  question: string;
  /** 2–25 options. ≤5 render as buttons; 6+ as a select menu. */
  options: ChoiceOption[];
  /**
   * Undo grace window (ms) offered after a reversible choice (recovery ②).
   * 0/undefined disables it. Ignored for `irreversible` options (those use the
   * 2-step confirm instead).
   */
  undoGraceMs?: number;
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
  kind: "workflow" | "cron" | "goal";
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
  /**
   * v1.3.0 Part A — fired once when the adapter binds to its org + handle
   * (after gateway-ready), so the bot can start the dev-confirm bridge for the
   * right org's pending-confirms dir. Adapters that never bind (Slack today,
   * unbound legacy) leave it uncalled.
   */
  onBound?: (info: { orgSlug: string; handle: string }) => void;
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
 * System threads created inside #workflow. Background crons post here.
 *
 * v0.8.5 — Removed `system-daily-signals`, `system-experiments`,
 * `system-weekly-review` along with their parent analysis crons
 * (signal-scan / experiment-check / weekly-review). `system-errors` retained
 * as a generic error sink — independent of any specific cron.
 */
export const SYSTEM_THREADS = [
  "system-errors",
];
