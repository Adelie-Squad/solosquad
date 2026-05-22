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
 * v1.0.0 → v1.0.1 — Discord `ready` → `clientReady` deprecation hotfix.
 *
 * Per `docs/plan/v1.0.1-discord-ready-deprecation.md`. v1.0.0 emitted a
 * Node DeprecationWarning on every bot start because discord.js v14.26
 * renamed `Client#event:ready` to `clientReady` (the original name
 * collided with the gateway READY opcode) and will remove the `ready`
 * alias in v15. v1.0.1 swaps the listener to `Events.ClientReady`.
 *
 * No schema change. Migration is `workspace.yaml.version` bump only.
 * Idempotent: re-running on 1.0.1 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "1.0.0";
const TARGET = "1.0.1";

export const migration: Migration = {
  from: "1.0.0.x",
  to: TARGET,
  description:
    "v1.0.1 — Discord ready→clientReady deprecation hotfix. Version bump only (no schema changes).",

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
        description: "Bump workspace version to 1.0.1",
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
