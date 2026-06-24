import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.3.6 → v1.3.7 — version-bump no-op.
 *
 * v1.3.7 is bundle-only: workflow/goal/cron authoring internalization (shared
 * `skill-core/primitive-core.md`, draft-anchored interview 4-mode, manager
 * authority格上), the bundled-workflow restructure (legacy workflows + the
 * monolithic problem-definition chain retired; scqa/five-whys/tdcc promoted to
 * workflows; mece/xyz-hypothesis stay skills), the goal validator, and the
 * planning bias guards. All of that lives in the *shipped bundle*; user
 * workspace data structures are unchanged. Bundled actor/workflow changes don't
 * touch the org-overlay layer where users keep their own actors, and seeded org
 * workflows (e.g. a previously-seeded problem-definition) are user data — left
 * untouched. We only stamp the workspace at the new version so the migration
 * chain stays continuous (registry-continuity invariant).
 *
 * Idempotent: detect() matches "1.3.6" only.
 */

const TARGET = "1.3.7";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.6" || version.startsWith("1.3.6.");
}

export const migration: Migration = {
  from: "1.3.6",
  to: TARGET,
  description:
    "v1.3.7 — bundle-only release (workflow/goal/cron authoring internalization + shared primitive-core, draft-anchored interview, bundled-workflow restructure, goal validator, planning bias guards). No user-data changes; stamps the workspace at 1.3.7.",

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
        description: "Bump workspace version to 1.3.7 (bundle-only release; no data changes)",
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
