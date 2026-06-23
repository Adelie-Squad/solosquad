import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.3.5 → v1.3.6 — version-bump no-op.
 *
 * v1.3.6 is bundle-only: authoring-authority managers + shared `skill-core`,
 * validator alignment + originality gate, pm_conventions/category surfaced,
 * `solosquad validate` promotion, and the squad org restructure (5 teams,
 * agent/skill rename+merge). All of that lives in the *shipped bundle*; user
 * workspace data structures are unchanged. Bundled actor renames don't touch
 * the org-overlay layer where users keep their own actors, so there is nothing
 * to relocate or rewrite — we only stamp the workspace at the new version so
 * the migration chain stays continuous (registry-continuity invariant).
 *
 * Idempotent: detect() matches "1.3.5" only.
 */

const TARGET = "1.3.6";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.5" || version.startsWith("1.3.5.");
}

export const migration: Migration = {
  from: "1.3.5",
  to: TARGET,
  description:
    "v1.3.6 — bundle-only release (authoring authority + shared skill-core, validator/originality alignment, pm_conventions surfaced, `solosquad validate` promotion, squad org restructure). No user-data changes; stamps the workspace at 1.3.6.",

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
        description: "Bump workspace version to 1.3.6 (bundle-only release; no data changes)",
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
