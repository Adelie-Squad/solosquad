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
 * v0.8.7.x → v0.9.1 — Workspace ↔ Repository relationship redesign (model B).
 *
 * Per `docs/plan/v0.9.1-workspace-repo-relationship.md`. v0.9.1 ships:
 * - `repo.yaml.path?: string` field (path-reference mode)
 * - `resolveRepoCwd` external-path branch
 * - `solosquad add repo --path <external>` + cwd auto-detect
 * - `solosquad init` Step 5.1 path-reference prompt
 * - `solosquad doctor` external-path existence check
 * - `docs/manual/` → top-level `manual/` (npm-published)
 * - master-guide §4.2 Step 1 prerequisites 보강 (gh CLI · pwsh · env vars 종합)
 *
 * Note: 0.9.0 was published-then-unpublished on 2026-05-20 and its version
 * number is burned per npm policy. 0.9.1 is the first installable release
 * of the Model-B path-reference design.
 *
 * On-disk schema change: none for existing workspaces. Legacy
 * `<workspace>/<org>/repositories/<slug>/` trees keep working (model A
 * permanently coexists). New repos can opt into path-reference via `--path`
 * or the cwd auto-detect.
 *
 * The migration only bumps `workspace.yaml.version`.
 *
 * Idempotent: re-running on 0.9.1 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "0.8.7";
const TARGET = "0.9.1";

export const migration: Migration = {
  from: "0.8.7.x",
  to: TARGET,
  description:
    "v0.9.1 workspace↔repo redesign (model B path-reference) — version bump only (no schema changes)",

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
        description: "Bump workspace version to 0.9.1",
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
