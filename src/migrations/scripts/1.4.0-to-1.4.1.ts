import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.4.0 → v1.4.1 — works-thread chat version bump.
 *
 * v1.4.1 lets Chief read & reply inside `works-<handle>` task threads
 * (docs/prd/v1.4.1_works-thread-chat.md, Approach A): the Discord listener now
 * also accepts threads whose parent is the works channel, looks up the thread's
 * task from discord-thread.txt, injects a `[thread-context]` line, and replies
 * in the thread. Session stays the shared (user,org) Chief session (per-task
 * isolation = follow-up Approach B).
 *
 * **§5.7 spawn-change gate → NO session reset.** The listener extension changes
 * which messages reach Chief and prepends a per-message `[thread-context]` line,
 * but does NOT change the spawn input path / permission model / tool
 * availability / system-prompt structure — an already-resumed transcript is not
 * misleading. Plain version bump preserves continuity.
 *
 * Bundled code; no workspace data to transform. Idempotent: detect() matches
 * "1.4.0" only.
 */

const TARGET = "1.4.1";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.4.0" || version.startsWith("1.4.0.");
}

export const migration: Migration = {
  from: "1.4.0",
  to: TARGET,
  description:
    "v1.4.1 — works-thread chat: Chief reads & replies in works-<handle> task threads (listener extension + thread→task context injection, single shared session). Spawn behaviour unchanged → no session reset (plain bump). Stamps the workspace at 1.4.1.",

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
        description: "Bump workspace version to 1.4.1 (no data changes)",
      });
    }
    return {
      steps,
      warnings: [
        "v1.4.1 — Chief now reads and replies inside works-<handle> task threads (no permission change needed — the invite already grants SendMessagesInThreads + the MessageContent intent). Restart the bot after updating.",
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
