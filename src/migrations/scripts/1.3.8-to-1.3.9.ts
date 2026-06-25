import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.3.8 → v1.3.9 — hotfix version-bump no-op.
 *
 * v1.3.9 fixes a defect *inside* the bundled `1.3.2 → 1.3.3` migration (the
 * `moveDir` one-level merge left same-named entries behind when a workspace had
 * both `.solosquad/schedules` and `.solosquad/routines`, failing verify). The
 * fix lives in the migration script that runs during the chain, so any upgrade
 * already executes the corrected code — there is no new workspace data to
 * transform here. See docs/prd/v1.3.9_migration-collision-hotfix.md.
 *
 * We only stamp the workspace at the new version so the migration chain stays
 * continuous (registry-continuity invariant). Idempotent: detect() matches
 * "1.3.8" only.
 */

const TARGET = "1.3.9";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.8" || version.startsWith("1.3.8.");
}

export const migration: Migration = {
  from: "1.3.8",
  to: TARGET,
  description:
    "v1.3.9 — hotfix on 1.3.8 (1.3.2→1.3.3 migration collision fix + 3-segment version model correction). The fix is in the bundled migration code; no new workspace data. Stamps the workspace at 1.3.9.",

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
        description: "Bump workspace version to 1.3.9 (hotfix; no data changes)",
      });
    }
    return { steps, warnings: [], irreversible_changes: [], estimated_disk_delta_mb: 0 };
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
