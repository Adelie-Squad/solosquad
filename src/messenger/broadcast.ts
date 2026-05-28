import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  loadWorkspaceYaml,
  saveWorkspaceYaml,
  type MessengerWorkspaceConfig,
  type WorkspaceYaml,
} from "../util/config.js";
import { getWorkspaceYamlPath } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.8 §3.6 — Broadcast channel (`#solosquad-broadcast`).
 *
 * Opt-in. When `workspace.yaml.messenger.broadcast_enabled === true` exactly
 * one bot (the `broadcast_owner_handle`) is allowed to push morning/evening
 * briefs and weekly review summaries. Every other bot in the workspace must
 * push briefs to its own `works-<handle>` channel only — otherwise N bots
 * post the same brief N times.
 */

export const BROADCAST_CHANNEL_DEFAULT = "solosquad-broadcast";

/**
 * @deprecated v1.2 — kept as a type alias for backward compatibility with
 * call sites that imported `MessengerSection`. The canonical type lives in
 * `src/util/config.ts` as `MessengerWorkspaceConfig` (covers broadcast +
 * discord + slack subsections).
 */
export type MessengerSection = MessengerWorkspaceConfig;

export function loadMessengerSection(workspace?: string): MessengerWorkspaceConfig {
  const ws = loadWorkspaceYaml(workspace);
  return ws?.messenger ?? {};
}

export function broadcastEnabled(workspace?: string): boolean {
  return loadMessengerSection(workspace).broadcast_enabled === true;
}

export function broadcastChannelName(workspace?: string): string {
  return (
    loadMessengerSection(workspace).broadcast_channel ?? BROADCAST_CHANNEL_DEFAULT
  );
}

export function broadcastOwnerHandle(workspace?: string): string | null {
  return loadMessengerSection(workspace).broadcast_owner_handle ?? null;
}

/**
 * Predicate every push site (scheduler briefs, weekly review) uses to decide
 * whether the current bot may send to the broadcast channel.
 *
 * Returns true only when:
 *   1. `broadcast_enabled: true`, AND
 *   2. `broadcast_owner_handle === currentHandle`
 *
 * Any other bot must push to its own `works-<handle>` instead.
 */
export function isDesignatedBroadcaster(
  currentHandle: string,
  workspace?: string,
): boolean {
  const sec = loadMessengerSection(workspace);
  if (sec.broadcast_enabled !== true) return false;
  return (sec.broadcast_owner_handle ?? null) === currentHandle;
}

export interface HandoverInput {
  toHandle: string;
  workspace?: string;
  /** When true, set `broadcast_enabled: true` along with the handover. */
  enable?: boolean;
}

export interface HandoverResult {
  previous: string | null;
  next: string;
  enabled: boolean;
}

/**
 * v0.8 §3.6 — `solosquad messenger broadcast-handover --to <handle>`.
 *
 * Idempotent. The caller (CLI) is responsible for sanity-checking that the
 * target handle has a corresponding user yaml; this function only mutates
 * `workspace.yaml.messenger.broadcast_owner_handle`.
 */
export function handoverBroadcast(input: HandoverInput): HandoverResult {
  const file = getWorkspaceYamlPath(input.workspace);
  if (!fs.existsSync(file)) {
    throw new Error("workspace.yaml not found — run `solosquad init` first.");
  }
  const raw = yaml.load(normalizeLine(fs.readFileSync(file, "utf-8"))) as
    | WorkspaceYaml
    | null;
  if (!raw) throw new Error("workspace.yaml is empty or unreadable");

  const section: MessengerSection = raw.messenger ?? {};
  const previous = section.broadcast_owner_handle ?? null;

  section.broadcast_owner_handle = input.toHandle;
  if (input.enable) section.broadcast_enabled = true;
  if (section.broadcast_enabled === undefined) section.broadcast_enabled = false;
  if (!section.broadcast_channel) section.broadcast_channel = BROADCAST_CHANNEL_DEFAULT;

  raw.messenger = section;
  saveWorkspaceYaml(raw, input.workspace);

  return {
    previous,
    next: input.toHandle,
    enabled: section.broadcast_enabled === true,
  };
}

/**
 * Helper used by adapters: should the bot create / claim the broadcast
 * channel at startup? Only the designated bot does — others are read-only or
 * skip the channel entirely.
 */
export function shouldCreateBroadcastChannel(
  currentHandle: string,
  workspace?: string,
): boolean {
  const sec = loadMessengerSection(workspace);
  if (sec.broadcast_enabled !== true) return false;
  return (sec.broadcast_owner_handle ?? null) === currentHandle;
}

/** Re-export the workspace.yaml path for callers that want to stamp directly. */
export { getWorkspaceYamlPath };

/** Touch helper kept for tests that need an empty messenger section. */
export function ensureMessengerSectionPresent(workspace?: string): void {
  const file = getWorkspaceYamlPath(workspace);
  if (!fs.existsSync(file)) return;
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const raw = yaml.load(normalizeLine(fs.readFileSync(file, "utf-8"))) as
    | WorkspaceYaml
    | null;
  if (!raw) return;
  if (!raw.messenger) {
    raw.messenger = {
      broadcast_enabled: false,
      broadcast_owner_handle: null,
      broadcast_channel: BROADCAST_CHANNEL_DEFAULT,
    };
    saveWorkspaceYaml(raw, workspace);
  }
}
