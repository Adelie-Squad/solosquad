import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.2.8 → v1.2.9 — Fix the Discord Application ID source that broke the
 * v1.2.6 invite-URL 1-click onboarding flow since it shipped.
 *
 * `fetchBotIdentity` read `application_id` off `GET /users/@me`, but the
 * bot User object has no such field → `appId` was always undefined → the
 * init invite-URL block was always skipped, no app-ID prompt existed, and
 * `bot_application_id` was never persisted. v1.2.9 resolves the id from
 * `GET /oauth2/applications/@me` (fallback: the bot user id, an identical
 * snowflake), adds an explicit confirmation prompt, and fixes the matching
 * dead field in `doctor --discord` Hop 2.
 *
 * Behavior change is CLI-runtime-only — no workspace data is touched. Pure
 * version bump. Idempotent. detect() matches "1.2.8" exact.
 */

const TARGET = "1.2.9";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.2.8" || version.startsWith("1.2.8.");
}

export const migration: Migration = {
  from: "1.2.8",
  to: TARGET,
  description:
    "v1.2.9 — Fix the Discord Application ID source (use /oauth2/applications/@me) that broke invite-URL 1-click since v1.2.6. Pure runtime fix; no workspace data changes.",

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
    return {
      steps,
      warnings: [
        "v1.2.9 is a runtime fix — restores the Discord invite-URL 1-click onboarding flow (auto-detects the Application ID + adds a confirmation prompt). No workspace data is modified. Re-run `solosquad discord invite-url` to mint your invite URL.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return;
    ws.version = TARGET;
    ws.last_migrated_to = TARGET;
    saveWorkspaceYaml(ws, workspace);
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
    return { ok: true };
  },
};
