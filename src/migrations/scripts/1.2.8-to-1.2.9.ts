import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml, listOrganizations } from "../../util/config.js";
import { listUserYamls, saveUserYaml } from "../../bot/user-registry.js";

/**
 * v1.2.8 → v1.2.9 — two bundled changes:
 *
 * Part A (runtime fix): `fetchBotIdentity` read `application_id` off
 * `GET /users/@me`, but the bot User object has no such field → `appId` was
 * always undefined → the invite-URL block was skipped. v1.2.9 resolves the
 * id from `GET /oauth2/applications/@me` (fallback: the bot user id). No
 * workspace data is touched by Part A.
 *
 * Part B (data migration — `git-<handle>` VCS event channel): inject
 * `channels.git = git-<handle>` into every `<org>/.solosquad/users/<handle>.yaml`
 * and bump its `schema_version` 1 → 2. The actual Discord channel is created
 * idempotently by the next bot boot's `ensureChannels`; this step only
 * updates the yaml source-of-truth. (B.3.4 — integrated into this single
 * pre-publish script since 1.2.9 is unreleased.)
 *
 * Idempotent: re-running skips users that already have `channels.git`.
 * detect() matches "1.2.8" exact.
 */

const TARGET = "1.2.9";
const USER_SCHEMA_TARGET = 2;

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.2.8" || version.startsWith("1.2.8.");
}

/** Users that still need the git channel / schema bump. */
function pendingUserCount(workspace: string): number {
  let n = 0;
  for (const org of listOrganizations(workspace)) {
    for (const u of listUserYamls(org.slug, workspace)) {
      if (!u.channels.git || (u.schema_version ?? 1) < USER_SCHEMA_TARGET) n++;
    }
  }
  return n;
}

export const migration: Migration = {
  from: "1.2.8",
  to: TARGET,
  description:
    "v1.2.9 — Part A: fix the Discord Application ID source (use /oauth2/applications/@me) that broke invite-URL 1-click since v1.2.6. Part B: inject the git-<handle> VCS event channel into user yamls (schema_version 1→2).",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return isFromVersion(typeof ws.version === "string" ? ws.version : "");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace);
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 1.2.9",
      });
    }
    const pending = pendingUserCount(workspace);
    if (pending > 0) {
      steps.push({
        kind: "update",
        from: "user.yaml schema_version=1 (no git channel)",
        to: `user.yaml schema_version=${USER_SCHEMA_TARGET} + channels.git=git-<handle>`,
        description: `Part B — add git-<handle> channel to ${pending} user yaml(s)`,
      });
    }
    return {
      steps,
      warnings: [
        "v1.2.9 Part A restores the Discord invite-URL 1-click onboarding flow (auto-detects the Application ID + adds a confirmation prompt). Re-run `solosquad discord invite-url` to mint your invite URL.",
        "v1.2.9 Part B adds a `git-<handle>` channel; it is created on next bot boot. (Push notifications into it are wired but inert until the dev-confirm gate goes live — see the v1.3.0 plan.)",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const ws = loadWorkspaceYaml(workspace);
    if (ws) {
      ws.version = TARGET;
      ws.last_migrated_to = TARGET;
      saveWorkspaceYaml(ws, workspace);
    }
    // Part B — inject channels.git + bump user schema_version. Idempotent:
    // users that already have channels.git are left untouched.
    for (const org of listOrganizations(workspace)) {
      for (const u of listUserYamls(org.slug, workspace)) {
        let dirty = false;
        if (!u.channels.git) {
          u.channels.git = `git-${u.handle}`;
          dirty = true;
        }
        if ((u.schema_version ?? 1) < USER_SCHEMA_TARGET) {
          u.schema_version = USER_SCHEMA_TARGET;
          dirty = true;
        }
        if (dirty) saveUserYaml(org.slug, u, workspace, true);
      }
    }
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return { ok: false, error: "workspace.yaml missing after apply" };
    if (ws.version !== TARGET) {
      return {
        ok: false,
        error: `workspace.yaml.version is ${ws.version}, expected ${TARGET}`,
      };
    }
    for (const org of listOrganizations(workspace)) {
      for (const u of listUserYamls(org.slug, workspace)) {
        if (!u.channels.git) {
          return {
            ok: false,
            error: `user ${u.handle} (org ${org.slug}) missing channels.git after migration`,
          };
        }
        if ((u.schema_version ?? 1) < USER_SCHEMA_TARGET) {
          return {
            ok: false,
            error: `user ${u.handle} (org ${org.slug}) schema_version is ${u.schema_version}, expected ${USER_SCHEMA_TARGET}`,
          };
        }
      }
    }
    return { ok: true };
  },
};
