import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  loadWorkspaceYaml,
  saveWorkspaceYaml,
} from "../../util/config.js";

/**
 * v1.0.2 → v1.0.3 — Discord 5-bug fix.
 *
 * Per `docs/plan/v1.0.3-discord-triple-bug-fix.md`. Five fixes:
 *   (A) `versionMatches` slice arithmetic — patch-level migrations no longer
 *       silently skipped (the bug that blocked anyone at workspace 1.0.0
 *       from migrating after a CLI update).
 *   (B) `npmGlobalInstallCmd` prefix-permission check — nvm / Homebrew /
 *       fnm / asdf users no longer get spurious `sudo` prepended.
 *   (D) Discord `syncGuildProductMapping` uses `ownOrgSlug` directly — drops
 *       the v0.1.x "guild.name must contain product slug" heuristic that
 *       false-negatived whenever the Discord server name didn't include
 *       the SoloSquad internal slug.
 *   (E) `solosquad update` post-install branch surfaces the next-step
 *       `solosquad migrate --apply` when workspace lags CLI, instead of
 *       relying on a follow-up `doctor` round-trip.
 *   (F) Discord channel category renamed `"AI Team Reports"` → `"solosquad"`
 *       for new installs; existing categories are matched and reused (no
 *       forced rename, no orphaned channel tree).
 *
 * No schema change. Migration is `workspace.yaml.version` bump only.
 * Idempotent: re-running on 1.0.3 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "1.0.2";
const TARGET = "1.0.3";

export const migration: Migration = {
  from: "1.0.2",
  to: TARGET,
  description:
    "v1.0.3 — Discord 5-bug fix (migrate · sudo · guild-org binding · update next-step · category rename). Version bump only (no schema changes).",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    const v = typeof ws.version === "string" ? ws.version : "";
    return v === SOURCE_PREFIX || v.startsWith(SOURCE_PREFIX + ".");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace);
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 1.0.3",
      });
    }
    return {
      steps,
      warnings: [],
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
