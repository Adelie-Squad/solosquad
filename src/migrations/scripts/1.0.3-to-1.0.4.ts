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
 * v1.0.3 → v1.0.4 — Discord config.yaml auto-create + Slack author-guard
 * removal.
 *
 * Per `docs/plan/v1.0.4-messenger-config-auto-create.md`. Two fixes:
 *   (G) `discord-adapter.ts:syncGuildProductMapping` no longer silently
 *       returns when `<org>/discord/config.yaml` is missing. The file is
 *       auto-created at bot startup using info the bot already has
 *       (ownOrgSlug + guild). Fixes the v1.0.3 residual where Discord
 *       messages produced "No product linked to this server" because the
 *       config.yaml had never been scaffolded by `solosquad init`.
 *   (H) `slack-adapter.ts` author-guard call removed, `src/bot/author-guard.ts`
 *       + `test/author-guard.test.ts` deleted entirely. Same rationale as
 *       v1.0.2 Discord side (string-comparison gate on a free-form messenger
 *       username can't meaningfully add defense above the messenger ACL).
 *
 * No schema change. Migration is `workspace.yaml.version` bump only.
 * Idempotent: re-running on 1.0.4 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "1.0.3";
const TARGET = "1.0.4";

export const migration: Migration = {
  from: "1.0.3",
  to: TARGET,
  description:
    "v1.0.4 — Discord config.yaml auto-create (G) + Slack author-guard removal (H). Version bump only (no schema changes).",

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
        description: "Bump workspace version to 1.0.4",
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
