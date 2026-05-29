import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.2.6 → v1.2.8 — Bot spawn passes `--add-dir <path>` for every
 * registered repo so Chief can read/write the actual repo paths outside
 * the org cwd.
 *
 * Pure runtime fix — no workspace data shape changes. Only structural
 * action is bumping `workspace.yaml.version` so the CLI mismatch advisor
 * stops nagging on `solosquad doctor`. The `--add-dir` flag is applied
 * by `chief-runner.invokeWithSessionRecovery` reading
 * `<org>/repositories/*.yaml` at spawn time; no migration-time config
 * is involved.
 *
 * Idempotent. detect() matches "1.2.6" exact.
 */

const TARGET = "1.2.8";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.2.6" || version.startsWith("1.2.6.");
}

export const migration: Migration = {
  from: "1.2.6",
  to: TARGET,
  description:
    "v1.2.8 — Bot spawn passes --add-dir for registered repos (so Chief can access repos outside the org cwd). Workspace shape unchanged; version bump only.",

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
        description: "Bump workspace version to 1.2.8",
      });
    }
    return {
      steps,
      warnings: [
        "v1.2.8 is a runtime fix — adds `--add-dir` to claude spawn so Chief can access repos registered under `<org>/repositories/`. No workspace data is modified.",
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
