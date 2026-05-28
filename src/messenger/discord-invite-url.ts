import { spawn } from "child_process";
import { IS_LINUX, IS_MACOS, IS_WINDOWS } from "../util/platform.js";

/**
 * v1.2 §3.1 / §4.2 — Discord OAuth Invite URL synthesis + browser-open.
 *
 * The bot owner runs `solosquad discord invite-url` (or it is auto-invoked
 * by `init` / `add-org` Step 4). The URL is composed deterministically from
 * the application's client_id and the v1.2 §4.2 permissions bitfield, so
 * the result is the same every run for a given workspace — the user can
 * paste it into a guild owner's hands without re-deriving anything.
 *
 * No external `open` / `clipboardy` dependency is added — we shell out to
 * the OS-default URL handler. If the handler is missing or returns an
 * error, callers see the URL printed and can copy it manually.
 */

/**
 * Permissions enumerated in v1.2 PRD §4.2. Stored as a `Record<string,
 * bigint>` because Discord permission bits are 64-bit and several entries
 * (Send Messages in Threads, Use Application Commands, etc.) exceed
 * Number.MAX_SAFE_INTEGER's relevance for sum stability — bigint keeps
 * the math exact.
 *
 * Excluded (Discord verification trigger): Administrator, Manage Guild,
 * Manage Roles, Kick/Ban, Mention Everyone.
 */
export const DEFAULT_PERMISSIONS: Readonly<Record<string, bigint>> =
  Object.freeze({
    ManageChannels: 16n,
    ViewChannels: 1024n,
    SendMessages: 2048n,
    EmbedLinks: 16384n,
    AttachFiles: 32768n,
    ReadMessageHistory: 65536n,
    ManageThreads: 17179869184n,
    CreatePublicThreads: 34359738368n,
    SendMessagesInThreads: 274877906944n,
    UseApplicationCommands: 2147483648n,
  });

/** Sum of DEFAULT_PERMISSIONS — invite URL `permissions` param. */
export const DEFAULT_PERMISSIONS_BITFIELD: bigint = Object.values(
  DEFAULT_PERMISSIONS,
).reduce((a, b) => a + b, 0n);

export interface InviteUrlInput {
  applicationClientId: string;
  /** Override the default bitfield (rare — testing only). */
  permissions?: bigint;
  /** Discord OAuth scopes. Default: ["bot", "applications.commands"]. */
  scopes?: string[];
}

/**
 * Build the invite URL deterministically. Pure function — no side effects.
 */
export function buildInviteUrl(input: InviteUrlInput): string {
  const clientId = input.applicationClientId.trim();
  if (!/^\d{10,25}$/.test(clientId)) {
    throw new Error(
      `Invalid Discord application_client_id: "${clientId}" — expected 10–25 digits.`,
    );
  }
  const permissions = (input.permissions ?? DEFAULT_PERMISSIONS_BITFIELD).toString();
  const scope = (input.scopes ?? ["bot", "applications.commands"]).join("+");
  return (
    "https://discord.com/oauth2/authorize" +
    `?client_id=${clientId}` +
    `&scope=${scope}` +
    `&permissions=${permissions}`
  );
}

/**
 * Attempt to open `url` in the OS default browser. Returns `true` when the
 * spawn was issued successfully — note this does not guarantee the user
 * actually saw the page (e.g. headless CI). Callers should always print the
 * URL as the canonical signal regardless of return value.
 */
export function openInBrowser(url: string): boolean {
  try {
    if (IS_WINDOWS) {
      // `cmd /c start "" "<url>"` — the empty string is the window title arg
      // so the URL is parsed as the target, not as a title.
      const child = spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    if (IS_MACOS) {
      const child = spawn("open", [url], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    }
    if (IS_LINUX) {
      const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
