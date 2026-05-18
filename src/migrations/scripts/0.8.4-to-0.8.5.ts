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
 * v0.8.4.x → v0.8.5 — Onboarding QA & Release-Gate.
 *
 * Per `docs/plan/v0.8.5-onboarding-qa.md` §1. v0.8.5 ships no on-disk schema
 * changes — the work is a bug fix (init.ts hardcoded version) plus wizard
 * UX polish and master-guide backfill. The migration only bumps
 * `workspace.yaml.version` so the doctor's CLI↔workspace mismatch banner
 * stays accurate.
 *
 * Idempotent: re-running on 0.8.5 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "0.8.4";
const TARGET = "0.8.5";

export const migration: Migration = {
  from: "0.8.4.x",
  to: TARGET,
  description:
    "v0.8.5 onboarding QA — version bump only (no schema changes)",

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
        description: "Bump workspace version to 0.8.5",
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
