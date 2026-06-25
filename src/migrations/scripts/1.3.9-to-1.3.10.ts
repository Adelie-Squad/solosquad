import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.3.9 → v1.3.10 — bot permission UX + claude-code `--add-dir` compat fix.
 *
 * v1.3.10 is bundle-only: the bot now feeds the user message as PLAIN TEXT over
 * stdin instead of `--input-format stream-json` (claude 2.1.x ignores `--add-dir`
 * under stream-json input, which blocked Chief from reading registered external
 * repos), feature-branch `git push` is default-allowed (only protected pushes /
 * PR merge·close gate, via the existing approval card), and the Chief system
 * prompt no longer hallucinates a "press 허용" prompt. See
 * docs/prd/v1.3.10_bot-permission-ux-and-add-dir-fix.md.
 *
 * No session rotation is needed: the spawn args are rebuilt every turn, so an
 * already-resumed Chief session picks up the new input path + permissions on its
 * NEXT turn automatically. We only stamp the workspace at the new version so the
 * migration chain stays continuous (registry-continuity invariant).
 *
 * Idempotent: detect() matches "1.3.9" only.
 */

const TARGET = "1.3.10";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.9" || version.startsWith("1.3.9.");
}

export const migration: Migration = {
  from: "1.3.9",
  to: TARGET,
  description:
    "v1.3.10 — bot permission UX + claude-code --add-dir/stream-json compat fix (plain-text stdin input, feature-push default-allow, no hallucinated approval prompt). Spawn args rebuild per turn, so resumed sessions get the fix next turn — no data changes. Stamps the workspace at 1.3.10.",

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
        description: "Bump workspace version to 1.3.10 (bundle-only; no data changes)",
      });
    }
    return {
      steps,
      warnings: [
        "v1.3.10 — registered external repos are now readable by the bot again (the claude-code `--add-dir`/stream-json incompatibility is worked around). Feature-branch `git push` runs without an approval card; only protected-branch pushes and PR merge/close still gate.",
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
