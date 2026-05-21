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
 * v0.9.1.x → v0.9.2 — hotfix: uninstall precheck self-match (PowerShell).
 *
 * No on-disk schema change. The bug was confined to `src/lifecycle/precheck.ts`
 * detectLivePids() on Windows — its WMI query matched the powershell.exe
 * process running the query itself (because the -Command argument contained
 * both 'solosquad' and '(bot|schedule|run-routine)' as literals).
 *
 * Symptom (pre-fix): `solosquad uninstall` reported phantom
 * "bot/schedule appears to be running (pid X, Y)" with different PIDs on
 * each invocation. Workaround was `--force`.
 *
 * Fix: added `$_.Name -eq 'node.exe'` to the Where-Object clause so
 * powershell.exe is excluded before the regex match runs.
 *
 * The migration only bumps `workspace.yaml.version`. Idempotent.
 */

const SOURCE_PREFIX = "0.9.1";
const TARGET = "0.9.2";

export const migration: Migration = {
  from: "0.9.1.x",
  to: TARGET,
  description:
    "v0.9.2 uninstall precheck self-match hotfix — version bump only (no schema changes)",

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
        description: "Bump workspace version to 0.9.2",
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
