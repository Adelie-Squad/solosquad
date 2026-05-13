import type { Product } from "../util/config.js";

export interface MessageContext {
  reply(text: string): Promise<void>;
  typing(): Promise<void>;
  _agentLabel: string;
  /** v0.3.0 — stable per-user identifier from the messenger platform.
   * Used by PM-runner to key session-store: (userId, orgSlug) → session-id.
   * Discord: message.author.id. Slack: event.user. */
  userId: string;
}

export type CommandHandler = (
  userInput: string,
  product: Product,
  ctx: MessageContext
) => Promise<void>;

export interface MessengerAdapter {
  readonly platform: string;
  readonly channelNames: string[];

  /** Start listening for commands. */
  startBot(onCommand: CommandHandler): Promise<void>;

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

/** System threads created inside #workflow. Background routines post here. */
export const SYSTEM_THREADS = [
  "system-daily-signals",
  "system-experiments",
  "system-weekly-review",
  "system-errors",
];
