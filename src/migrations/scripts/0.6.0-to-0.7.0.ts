import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  loadWorkspaceYaml,
  saveWorkspaceYaml,
  type WorkspaceYaml,
} from "../../util/config.js";

const SOURCE_PREFIX = "0.6.";
const TARGET = "0.7.0";

/**
 * v0.6.x → v0.7.0 — uninstall lifecycle infrastructure.
 *
 * Per docs/plan/v0.7-uninstall-lifecycle.md §10 #17.
 *
 * v0.7 is intentionally a *small* migration. The uninstall lifecycle is
 * inert until the user invokes `solosquad uninstall` / `solosquad logout`;
 * no on-disk layout changes are required, no data is rewritten, no agent
 * profiles are touched. The migration only:
 *
 *   1. Bumps `workspace.yaml.version` 0.6.x → 0.7.0
 *   2. Ensures `workspace.yaml.uninstall` defaults exist (optional knobs:
 *      `default_archive_dir`, `scrub_content_default: false`, plus the
 *      surfaces tracked in §5.4 keep-workspace matrix).
 *
 * Idempotent: re-running on a 0.7.0 workspace is a no-op (`detect()`
 * returns false).
 */

interface WorkspaceYamlV07 {
  version?: string;
  uninstall?: {
    default_archive_dir?: string;
    scrub_content_default?: boolean;
  };
  [k: string]: unknown;
}

export const migration: Migration = {
  from: "0.6.x",
  to: TARGET,
  description:
    "v0.7 uninstall lifecycle — version bump 0.6.x → 0.7.0 + workspace.yaml.uninstall defaults",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return typeof ws.version === "string" && ws.version.startsWith(SOURCE_PREFIX);
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV07 | null;
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 0.7.0",
      });
      if (!ws.uninstall) {
        steps.push({
          kind: "update",
          to: "workspace.yaml.uninstall",
          description:
            "Add uninstall defaults (default_archive_dir: ~/, scrub_content_default: false)",
        });
      }
    }
    return {
      steps,
      warnings: [
        "v0.7 adds `solosquad uninstall` and `solosquad logout` — read the manual before invoking.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const existing = loadWorkspaceYaml(workspace) as (WorkspaceYaml & WorkspaceYamlV07) | null;
    if (!existing) {
      throw new Error("workspace.yaml missing — migrate aborts");
    }
    existing.version = TARGET;
    existing.uninstall = {
      default_archive_dir: existing.uninstall?.default_archive_dir ?? "~/",
      scrub_content_default: existing.uninstall?.scrub_content_default ?? false,
    };
    saveWorkspaceYaml(existing, workspace);
    // touch a sentinel comment so manual readers can see the bump
    const ymlPath = path.join(workspace, ".solosquad", "workspace.yaml");
    if (fs.existsSync(ymlPath)) {
      const text = fs.readFileSync(ymlPath, "utf-8");
      if (!text.startsWith("# Bumped to 0.7.0")) {
        const stamped = `# Bumped to 0.7.0 — see CHANGELOG.md and docs/plan/v0.7-uninstall-lifecycle.md\n${text}`;
        fs.writeFileSync(ymlPath, stamped);
      }
    }
    void yaml; // silence unused — kept for future shape-validation additions
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV07 | null;
    if (!ws) return { ok: false, error: "workspace.yaml missing after migration" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `version still ${ws.version ?? "(unset)"} — expected ${TARGET}` };
    }
    if (!ws.uninstall) {
      return { ok: false, error: "uninstall defaults missing in workspace.yaml" };
    }
    return { ok: true };
  },
};
