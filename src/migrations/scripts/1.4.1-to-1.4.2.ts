import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.4.1 → v1.4.2 — `solosquad start` bot-startup hotfix version bump.
 *
 * v1.4.1's `solosquad start` / `bot --with-cron` awaited startScheduler() before
 * startBot(), but startScheduler() keeps itself alive forever — so the bot never
 * started. v1.4.2 adds a keepAlive option so the embedded scheduler returns and
 * the bot starts (docs/prd/v1.4.2_start-cron-blocking-hotfix.md).
 *
 * Bundled code; a startup-ordering fix with no workspace data and no spawn
 * change → plain version bump, no session reset. Idempotent: detect() matches
 * "1.4.1" only.
 */

const TARGET = "1.4.2";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.4.1" || version.startsWith("1.4.1.");
}

export const migration: Migration = {
  from: "1.4.1",
  to: TARGET,
  description:
    "v1.4.2 — hotfix: `solosquad start` / `bot --with-cron` now actually starts the bot (the embedded scheduler no longer blocks on its keep-alive). Bundled code; no data changes, no session reset. Stamps the workspace at 1.4.2.",

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
        description: "Bump workspace version to 1.4.2 (no data changes)",
      });
    }
    return {
      steps,
      warnings: [
        "v1.4.2 — `solosquad start` (bot + cron, supervised) now starts the bot correctly (1.4.1 only started the scheduler). Restart the bot after updating.",
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
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return { ok: false, error: "workspace.yaml missing after apply" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `workspace.yaml.version is ${ws.version}, expected ${TARGET}` };
    }
    return { ok: true };
  },
};
