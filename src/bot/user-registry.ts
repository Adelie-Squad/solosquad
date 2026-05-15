import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";
import { getOrgDir } from "../util/paths.js";

/**
 * v0.8 §3.3 — Per-user yaml stored at
 * `<workspace>/<org>/.solosquad/users/<handle>.yaml`. Each user has exactly one
 * yaml per org. The yaml is the durable mapping between a messenger handle and
 * a bot's gateway identity (`bot_user_id`).
 *
 * Spec: docs/plan/v0.8-multiuser-messenger.md §3.3.
 */
export interface UserYaml {
  schema_version: number;
  handle: string;
  display_name?: string;
  messenger: "discord" | "slack";
  bot_application_id?: string;
  bot_user_id: string;
  joined_at: string;
  workspace_path?: string;
  session_id?: string;
  channels: {
    command: string;
    works: string;
  };
}

const HANDLE_RE = /^[a-z0-9_]+$/;

/** Folder that holds all `<handle>.yaml` files for one org. */
export function getUsersDir(orgSlug: string, workspace?: string): string {
  return path.join(getOrgDir(orgSlug, workspace), ".solosquad", "users");
}

export function userYamlPath(
  orgSlug: string,
  handle: string,
  workspace?: string,
): string {
  return path.join(getUsersDir(orgSlug, workspace), `${handle}.yaml`);
}

/**
 * v0.8 §3.1 — Normalize a messenger handle into the channel-naming charset
 * (lowercase a-z, 0-9, underscore). Other characters become `_`. The init
 * flow shows the normalized form to the user for confirmation before saving.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle) && handle.length > 0 && handle.length <= 64;
}

/**
 * v0.8 §3.5 — Handle collision policy is *explicit refusal* (박제). The caller
 * should branch on `exists()` before writing a fresh yaml.
 */
export function userYamlExists(
  orgSlug: string,
  handle: string,
  workspace?: string,
): boolean {
  return fs.existsSync(userYamlPath(orgSlug, handle, workspace));
}

export function loadUserYaml(file: string): UserYaml | null {
  if (!fs.existsSync(file)) return null;
  try {
    const doc = yaml.load(normalizeLine(fs.readFileSync(file, "utf-8"))) as
      | UserYaml
      | null;
    return doc ?? null;
  } catch {
    return null;
  }
}

/** Save a user yaml. Refuses to clobber when `allowOverwrite` is false. */
export function saveUserYaml(
  orgSlug: string,
  doc: UserYaml,
  workspace?: string,
  allowOverwrite = false,
): void {
  if (!isValidHandle(doc.handle)) {
    throw new Error(
      `Invalid handle "${doc.handle}" — only lowercase a-z, 0-9, underscore allowed`,
    );
  }
  const file = userYamlPath(orgSlug, doc.handle, workspace);
  if (!allowOverwrite && fs.existsSync(file)) {
    throw new Error(
      `${doc.handle}은 이미 이 워크스페이스에 등록되어 있습니다. 다른 messenger handle 또는 별도 워크스페이스를 사용하세요.`,
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100 }));
}

/** Enumerate every user yaml registered for an org. */
export function listUserYamls(orgSlug: string, workspace?: string): UserYaml[] {
  const dir = getUsersDir(orgSlug, workspace);
  if (!fs.existsSync(dir)) return [];
  const out: UserYaml[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    const doc = loadUserYaml(path.join(dir, entry.name));
    if (doc && isValidHandle(doc.handle)) out.push(doc);
  }
  return out;
}

/**
 * v0.8 §3.2 — Find the yaml whose `bot_user_id` matches the live gateway ID.
 * Used at bot startup to decide which channel pair to listen on. Returns
 * `null` when no yaml matches — caller should log + guide the user to
 * `solosquad init` or the 0.7→0.8 migration.
 */
export function findUserByBotId(
  orgSlug: string,
  botUserId: string,
  workspace?: string,
): UserYaml | null {
  for (const u of listUserYamls(orgSlug, workspace)) {
    if (u.bot_user_id === botUserId) return u;
  }
  return null;
}

/**
 * Scan every org under the workspace and return all users with their org
 * slug. Used by adapters that need to know "is *any* user in this workspace
 * tied to this bot?".
 */
export function listAllUsers(
  workspace: string,
): Array<{ orgSlug: string; user: UserYaml }> {
  if (!fs.existsSync(workspace)) return [];
  const out: Array<{ orgSlug: string; user: UserYaml }> = [];
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const orgSlug = entry.name;
    for (const u of listUserYamls(orgSlug, workspace)) {
      out.push({ orgSlug, user: u });
    }
  }
  return out;
}

/** Derive the expected channel names from a handle. */
export function deriveChannelNames(handle: string): {
  command: string;
  works: string;
} {
  return {
    command: `command-${handle}`,
    works: `works-${handle}`,
  };
}

/**
 * v0.8 §3.5 — Channel name parser used by author-guard and routing.
 * Returns null for unrelated channels (broadcast, system, etc.).
 */
export function parseChannelName(
  channelName: string,
): { kind: "command" | "works"; handle: string } | null {
  const m = channelName.match(/^(command|works)-(.+)$/);
  if (!m) return null;
  return { kind: m[1] as "command" | "works", handle: m[2] };
}
