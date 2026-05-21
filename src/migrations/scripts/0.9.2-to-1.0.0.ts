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
 * v0.9.2.x → v1.0.0 — Formal launch.
 *
 * Per `docs/plan/v1.0-formal-launch.md`. v1.0 is the milestone where:
 * - `api-stability.md`'s 6 `schema_version` surfaces become a public promise
 * - `v0.8.4-cli-surface-reduction.md` §11 — 42-command CLI surface is frozen
 * - Repo registration unifies to *path-reference only* (URL clone +
 *   Move-into-workspace removed from `solosquad init` Step 5.1 and
 *   `solosquad add repo`)
 * - `solosquad init` Step 1.5 absorbs Claude Code authentication —
 *   the wizard detects `claude auth status` and runs `claude login` for
 *   the user if needed
 * - Messenger backend = Discord (Slack adapter still ships in the codebase
 *   but is outside the v1.0 SemVer promise — post-v1.0 slot)
 *
 * The migration only bumps `workspace.yaml.version`. On-disk schemas are
 * unchanged:
 * - Legacy `<workspace>/<org>/repositories/<slug>/` trees keep resolving
 *   via `resolveRepoCwd` legacy branch.
 * - Path-reference yamls already created in v0.9.1+ stay valid.
 * - `.solosquad/.env` Slack tokens still load; the Slack adapter keeps
 *   working for v0.9.x users who already configured it.
 *
 * Idempotent: re-running on 1.0.0 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "0.9.2";
const TARGET = "1.0.0";

export const migration: Migration = {
  from: "0.9.2.x",
  to: TARGET,
  description:
    "v1.0.0 formal launch — api-stability activation + repo registration unified to path-reference only + Claude login absorbed into init wizard. Version bump only (no schema changes).",

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
        description: "Bump workspace version to 1.0.0",
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
