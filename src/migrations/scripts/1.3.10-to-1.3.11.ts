import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.3.10 → v1.3.11 — Windows `--add-dir` hotfix version-bump no-op.
 *
 * v1.3.11 fixes a Windows-only spawn defect: the Chief `--append-system-prompt`
 * value contains newlines, and the bot spawns claude with `shell: true` building
 * a command STRING — the newline broke cmd.exe parsing and dropped every flag
 * after it, including `--add-dir`, so Chief lost access to registered repos. The
 * fix routes the system prompt through `--append-system-prompt-file` (in
 * claude-process.ts). See docs/prd/v1.3.11_windows-add-dir-prompt-newline-hotfix.md.
 *
 * The fix lives in bundled code that runs every turn — no workspace data to
 * transform. We only stamp the workspace at the new version (registry-continuity
 * invariant). Idempotent: detect() matches "1.3.10" only.
 */

const TARGET = "1.3.11";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.10" || version.startsWith("1.3.10.");
}

export const migration: Migration = {
  from: "1.3.10",
  to: TARGET,
  description:
    "v1.3.11 — Windows --add-dir hotfix: Chief system prompt routes through --append-system-prompt-file so its newlines don't break the shell:true command string and drop --add-dir. Bundled code; no data changes. Stamps the workspace at 1.3.11.",

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
        description: "Bump workspace version to 1.3.11 (hotfix; no data changes)",
      });
    }
    return {
      steps,
      warnings: [
        "v1.3.11 — Windows fix: registered external repos are readable by the bot again (1.3.10 still dropped --add-dir on Windows because a newline in --append-system-prompt broke the shell command). Restart the bot after updating.",
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
