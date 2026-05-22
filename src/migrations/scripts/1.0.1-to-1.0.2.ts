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
 * v1.0.1 → v1.0.2 — Discord author-guard removal + init wizard reorder.
 *
 * Per `docs/plan/v1.0.2-discord-author-guard-decoupling.md`. The Discord
 * adapter no longer compares `message.author.username` against the
 * channel-derived handle — that comparison universally false-positived on
 * any user whose Discord username diverged from their SoloSquad handle
 * (e.g. `seungw1n.` with a trailing dot can never equal a handle in
 * `[a-z0-9_]` charset). Discord channel ACL is now the sole permission
 * boundary; author identity is logged (events.jsonl) for audit but never
 * gated against.
 *
 * The migration only bumps `workspace.yaml.version`. On-disk schemas are
 * unchanged: `UserYaml` shape is identical; existing user yamls keep
 * working without touching them.
 *
 * Idempotent: re-running on 1.0.2 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "1.0.1";
const TARGET = "1.0.2";

export const migration: Migration = {
  from: "1.0.1.x",
  to: TARGET,
  description:
    "v1.0.2 — Discord author-guard removal + init wizard reorder (handle prompt moved next to messenger token entry). Version bump only (no schema changes).",

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
        description: "Bump workspace version to 1.0.2",
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
