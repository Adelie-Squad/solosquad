import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.3.11 → v1.4.0 — session-orchestration (re-scoped subset) version bump.
 *
 * v1.4.0 ships the low-risk subset of the session-orchestration PRD
 * (docs/prd/v1.4.0-session-orchestration.md): S-1 (resolveOrgCwd resolves
 * external-path repos for scheduler crons), S-2a (passive chief.usage token
 * telemetry — observation only), §5.5 (opt-in leading-indicator cron preset),
 * §5.7 (archiveOrgChiefSessions migration helper), S-3 (_log.md durable-file
 * convention + 3-layer memory docs), and a "🆕 세션 시작" messenger marker.
 * Deferred to v1.4.x: session 교대 (S-2b) and GC destructive deletion (S-3b).
 *
 * **§5.7 spawn-change gate → NO session reset.** None of the above changes how
 * the bot *spawns* Chief (input path, permission model, tool availability,
 * system-prompt structure): S-1 is scheduler cwd, S-2a only reads usage, the
 * session marker only changes reply *rendering*. An already-resumed Chief
 * session's transcript is NOT misleading after this release, so we do NOT call
 * archiveOrgChiefSessions — a plain version bump preserves continuity.
 *
 * All changes live in bundled code that runs every turn — no workspace data to
 * transform. We only stamp the workspace at the new version (registry-continuity
 * invariant). Idempotent: detect() matches "1.3.11" only.
 */

const TARGET = "1.4.0";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.11" || version.startsWith("1.3.11.");
}

export const migration: Migration = {
  from: "1.3.11",
  to: TARGET,
  description:
    "v1.4.0 — session-orchestration (re-scoped): S-1 external-path repo cwd for crons, S-2a passive chief.usage telemetry, §5.5 leading-indicator cron preset, §5.7 session-reset migration helper, S-3 _log.md convention, 🆕 session-start marker. Session 교대 (S-2b) + GC deletion (S-3b) deferred to v1.4.x. Spawn behaviour unchanged → no session reset (plain bump). Stamps the workspace at 1.4.0.",

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
        description: "Bump workspace version to 1.4.0 (no data changes)",
      });
    }
    return {
      steps,
      warnings: [
        "v1.4.0 — Chief now emits a 🆕 session-start marker on a new/reset session, scheduler crons can read external-path repos, and chief.usage token telemetry is recorded. Enable the leading-indicator preset with `solosquad cron preset leading-indicator`. Restart the bot after updating.",
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
      return { ok: false, error: `workspace.yaml.version is ${ws.version}, expected ${TARGET}` };
    }
    return { ok: true };
  },
};
