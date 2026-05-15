import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  loadWorkspaceYaml,
  saveWorkspaceYaml,
  listOrganizations,
  type WorkspaceYaml,
} from "../../util/config.js";
import { normalizeLine } from "../../util/platform.js";
import {
  BROADCAST_CHANNEL_DEFAULT,
  type MessengerSection,
} from "../../messenger/broadcast.js";
import {
  deriveChannelNames,
  normalizeHandle,
  userYamlPath,
  type UserYaml,
} from "../../bot/user-registry.js";

/**
 * v0.7.x → v0.8.0 — Multi-User Messenger.
 *
 * Per docs/plan/v0.8-multiuser-messenger.md §6. No legacy channel alias
 * mapping is shipped because the v0.7 user base is the developer alone (§3.7
 * — 박제). The migration only:
 *
 *   1. Bumps `workspace.yaml.version` 0.7.x → 0.8.0
 *   2. Adds `workspace.yaml.messenger` defaults (broadcast off by default)
 *   3. Seeds the first `<org>/.solosquad/users/<handle>.yaml` per org using
 *      the operator's known messenger handle (extracted from .env at apply
 *      time when reachable, otherwise a placeholder handle).
 *   4. Prints the legacy-channel guidance line during verify().
 *
 * Idempotent: re-running on a 0.8.0 workspace is a no-op.
 */

const SOURCE_PREFIX = "0.7.";
const TARGET = "0.8.0";

interface WorkspaceYamlV08 extends WorkspaceYaml {
  messenger?: MessengerSection;
}

function loadEnvFile(workspace: string): Record<string, string> {
  const file = path.join(workspace, ".solosquad", ".env");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of normalizeLine(fs.readFileSync(file, "utf-8")).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

async function fetchDiscordIdentity(
  token: string,
): Promise<{ handle: string; userId: string; appId?: string } | null> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      id?: string;
      username?: string;
      application_id?: string;
    };
    if (!body.username || !body.id) return null;
    return {
      handle: normalizeHandle(body.username),
      userId: body.id,
      appId: body.application_id,
    };
  } catch {
    return null;
  }
}

async function fetchSlackIdentity(
  token: string,
): Promise<{ handle: string; userId: string; appId?: string } | null> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as {
      ok?: boolean;
      user?: string;
      user_id?: string;
      bot_id?: string;
    };
    if (!body.ok || !body.user || !body.user_id) return null;
    return {
      handle: normalizeHandle(body.user),
      userId: body.user_id,
      appId: body.bot_id,
    };
  } catch {
    return null;
  }
}

async function resolveBotIdentity(
  env: Record<string, string>,
): Promise<{
  messenger: "discord" | "slack";
  handle: string;
  userId: string;
  appId?: string;
} | null> {
  const messenger = (env.MESSENGER || "").toLowerCase().split(",")[0].trim();
  if (messenger === "discord") {
    const token = env.DISCORD_TOKEN;
    if (!token) return null;
    const id = await fetchDiscordIdentity(token);
    if (!id) return null;
    return { messenger: "discord", ...id };
  }
  if (messenger === "slack") {
    const token = env.SLACK_BOT_TOKEN;
    if (!token) return null;
    const id = await fetchSlackIdentity(token);
    if (!id) return null;
    return { messenger: "slack", ...id };
  }
  return null;
}

function writeUserYaml(
  workspace: string,
  orgSlug: string,
  doc: UserYaml,
): void {
  const file = userYamlPath(orgSlug, doc.handle, workspace);
  if (fs.existsSync(file)) return; // idempotent
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100 }));
}

function hasAnyUserYaml(workspace: string, orgSlug: string): boolean {
  const dir = path.join(workspace, orgSlug, ".solosquad", "users");
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .some((e) => e.isFile() && e.name.endsWith(".yaml"));
}

export const migration: Migration = {
  from: "0.7.x",
  to: TARGET,
  description:
    "v0.8 multi-user messenger — version bump 0.7.x → 0.8.0 + workspace.yaml.messenger defaults + first user yaml per org",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return typeof ws.version === "string" && ws.version.startsWith(SOURCE_PREFIX);
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV08 | null;
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 0.8.0",
      });
      if (!ws.messenger) {
        steps.push({
          kind: "update",
          to: "workspace.yaml.messenger",
          description:
            "Add messenger defaults (broadcast_enabled: false, broadcast_owner_handle: null, broadcast_channel: solosquad-broadcast)",
        });
      }
      for (const org of listOrganizations(workspace)) {
        if (!hasAnyUserYaml(workspace, org.slug)) {
          steps.push({
            kind: "generate",
            to: `${org.slug}/.solosquad/users/<handle>.yaml`,
            description:
              `Seed first user yaml for org ${org.slug} (handle extracted from .env at apply time; placeholder used when API unreachable)`,
          });
        }
      }
    }
    return {
      steps,
      warnings: [
        "v0.8 stops listening to legacy #owner-command / #workflow channels.",
        "After migration, the bot creates command-<handle> / works-<handle> on first startup.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const existing = loadWorkspaceYaml(workspace) as WorkspaceYamlV08 | null;
    if (!existing) {
      throw new Error("workspace.yaml missing — migrate aborts");
    }
    existing.version = TARGET;
    existing.messenger = {
      broadcast_enabled: existing.messenger?.broadcast_enabled ?? false,
      broadcast_owner_handle: existing.messenger?.broadcast_owner_handle ?? null,
      broadcast_channel:
        existing.messenger?.broadcast_channel ?? BROADCAST_CHANNEL_DEFAULT,
    };
    saveWorkspaceYaml(existing, workspace);

    const env = loadEnvFile(workspace);
    const ident = await resolveBotIdentity(env);

    const fallbackHandle = normalizeHandle(
      env.OWNER_NAME || "owner",
    ) || "owner";

    for (const org of listOrganizations(workspace)) {
      if (hasAnyUserYaml(workspace, org.slug)) continue;
      const handle = ident?.handle ?? fallbackHandle;
      const userId = ident?.userId ?? `pending-${handle}`;
      const messenger: "discord" | "slack" =
        ident?.messenger ??
        (((env.MESSENGER || "discord").toLowerCase().split(",")[0].trim() ||
          "discord") as "discord" | "slack");
      const channels = deriveChannelNames(handle);
      const doc: UserYaml = {
        schema_version: 1,
        handle,
        display_name: env.OWNER_NAME || undefined,
        messenger,
        bot_application_id: ident?.appId,
        bot_user_id: userId,
        joined_at: new Date().toISOString(),
        workspace_path: workspace,
        channels,
      };
      writeUserYaml(workspace, org.slug, doc);
    }

    // touch a sentinel comment so manual readers can see the bump
    const ymlPath = path.join(workspace, ".solosquad", "workspace.yaml");
    if (fs.existsSync(ymlPath)) {
      const text = fs.readFileSync(ymlPath, "utf-8");
      if (!text.startsWith("# Bumped to 0.8.0")) {
        const stamped = `# Bumped to 0.8.0 — see CHANGELOG.md and docs/plan/v0.8-multiuser-messenger.md\n${text}`;
        fs.writeFileSync(ymlPath, stamped);
      }
    }
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV08 | null;
    if (!ws) return { ok: false, error: "workspace.yaml missing after migration" };
    if (ws.version !== TARGET) {
      return {
        ok: false,
        error: `version still ${ws.version ?? "(unset)"} — expected ${TARGET}`,
      };
    }
    if (!ws.messenger) {
      return { ok: false, error: "messenger defaults missing in workspace.yaml" };
    }
    for (const org of listOrganizations(workspace)) {
      if (!hasAnyUserYaml(workspace, org.slug)) {
        return {
          ok: false,
          error: `org ${org.slug} has no user yaml under .solosquad/users/`,
        };
      }
    }
    // §6.3 — informational notice (verify is best-effort; do not fail on it).
    console.log(
      "  ℹ 기존 #owner-command / #workflow 채널은 봇이 더 이상 listen 하지 않습니다.",
    );
    console.log(
      "    새 채널 command-<handle> / works-<handle>가 첫 봇 startup 시 생성됩니다.",
    );
    console.log(
      "    legacy 채널은 메신저에서 수동 archive 권장.",
    );
    return { ok: true };
  },
};
