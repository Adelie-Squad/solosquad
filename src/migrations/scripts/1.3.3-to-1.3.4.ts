import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.3.3 → v1.3.4 — chain-completion (version bump, no on-disk data transform).
 *
 * What v1.3.4 changed to a workspace:
 *   - Cron reliability (§A–§F): channel auto-resolves to works-<handle>,
 *     failure reporting, tz/jitter/preview guards — all runtime/code behavior;
 *     no stored state to seed at migrate time.
 *   - §E5 cron id rename pm-compaction → chief-compaction: the cron is a
 *     hardcoded built-in (not a user file), so nothing on disk is stranded.
 *     Historical `cron-runs.jsonl` records under the old id stay as history;
 *     the system thread `system-pm-compaction` is an external (Discord) artifact
 *     and a fresh `system-chief-compaction` thread is created on next run. The
 *     workspace.yaml `pm` config block key is intentionally kept (the pm→chief
 *     key rename remains a separate dedicated migration).
 *
 * So this only advances the version stamp (+ last_migrated_to) so the chain can
 * continue past 1.3.3. Idempotent: detect() matches "1.3.3" only.
 */

const TARGET = "1.3.4";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.3" || version.startsWith("1.3.3.");
}

export const migration: Migration = {
  from: "1.3.3",
  to: TARGET,
  description:
    "v1.3.4 — chain-completion version bump (1.3.3 → 1.3.4). Cron reliability + the pm-compaction → chief-compaction rename are code-only (built-in cron; no stranded user file). Advances the version stamp.",

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
        description: "Bump workspace version to 1.3.4",
      });
    }
    return {
      steps,
      warnings: [
        "v1.3.4 cron delivery: built-in/user crons now post to your works-<handle> channel (the old #workflow target never existed and was silently dropped). Failures are reported to that channel with the reason.",
        "v1.3.4 renamed the compaction cron id pm-compaction → chief-compaction. Trigger it manually with `solosquad cron run chief-compaction`. The workspace.yaml `pm` config block is unchanged.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
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
      return {
        ok: false,
        error: `workspace.yaml.version is ${ws.version}, expected ${TARGET}`,
      };
    }
    return { ok: true };
  },
};
