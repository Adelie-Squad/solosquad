import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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

const __filename_0_8_3 = fileURLToPath(import.meta.url);
const __dirname_0_8_3 = path.dirname(__filename_0_8_3);

/**
 * v0.8.2.x → v0.8.3 — Onboarding UX + Observability.
 *
 * Per docs/plan/v0.8.3-onboarding-ux-observability.md §11. Small migration
 * — the visible work is in new code paths (`add repo --dry-run`,
 * `solosquad logs`, `solosquad logout` removal) rather than on-disk schema
 * changes. The migration only:
 *
 *   1. Bumps `workspace.yaml.version` 0.8.2.x → 0.8.3
 *   2. Adds `workspace.yaml.trajectory.auto_register` (default `false` until
 *      the v0.6 ROI gate clears — see CHANGELOG §0.8.3 measurement)
 *   3. Copies `assets/routines/log-rotate.md` into the user routines/ dir
 *      when missing (so the daily rotation has a body to point at)
 *   4. Creates `<workspace>/.solosquad/logs/` so the logger's first call
 *      after migration doesn't race on directory creation.
 *
 * Idempotent: re-running on 0.8.3 is a no-op (`detect()` returns false).
 */

const SOURCE_PREFIX = "0.8.2";
const TARGET = "0.8.3";

interface WorkspaceYamlV083 extends WorkspaceYaml {
  trajectory?: {
    auto_register?: boolean;
  };
}

export const migration: Migration = {
  from: "0.8.2.x",
  to: TARGET,
  description:
    "v0.8.3 onboarding UX + observability — version bump 0.8.2 → 0.8.3 + trajectory.auto_register default + log-rotate routine + logs/ dir",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    const v = typeof ws.version === "string" ? ws.version : "";
    return v === SOURCE_PREFIX || v.startsWith(SOURCE_PREFIX + ".");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV083 | null;
    const steps: MigrationStep[] = [];
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 0.8.3",
      });
      if (!ws.trajectory || typeof ws.trajectory.auto_register !== "boolean") {
        steps.push({
          kind: "update",
          to: "workspace.yaml.trajectory.auto_register",
          description:
            "Add trajectory.auto_register flag (default false until v0.6 ROI gate is decided)",
        });
      }
    }
    const routinesDir = path.join(workspace, ".solosquad", "routines");
    const rotateFile = path.join(routinesDir, "log-rotate.md");
    if (!fs.existsSync(rotateFile)) {
      steps.push({
        kind: "generate",
        to: ".solosquad/routines/log-rotate.md",
        description: "Copy bundled log-rotate routine into user routines/",
      });
    }
    const logsDir = path.join(workspace, ".solosquad", "logs");
    if (!fs.existsSync(logsDir)) {
      steps.push({
        kind: "generate",
        to: ".solosquad/logs/",
        description: "Create runtime log directory (logger writes here when SOLOSQUAD_LOG_FILE=1)",
      });
    }
    return {
      steps,
      warnings: [
        "v0.8.3 removes `solosquad logout`. Use Ctrl+C to pause the bot; see master-guide §6/§9.",
        "Pre-existing <workspace>/.solosquad/logout.lock files are now inert and can be deleted manually.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const existing = loadWorkspaceYaml(workspace) as WorkspaceYamlV083 | null;
    if (!existing) {
      throw new Error("workspace.yaml missing — migrate aborts");
    }
    existing.version = TARGET;
    existing.trajectory = {
      auto_register: existing.trajectory?.auto_register ?? false,
    };
    saveWorkspaceYaml(existing as WorkspaceYaml, workspace);

    // Stamp the workspace.yaml so manual readers see the bump.
    const ymlPath = path.join(workspace, ".solosquad", "workspace.yaml");
    if (fs.existsSync(ymlPath)) {
      const text = fs.readFileSync(ymlPath, "utf-8");
      if (!text.startsWith("# Bumped to 0.8.3")) {
        const stamped = `# Bumped to 0.8.3 — see CHANGELOG.md and docs/plan/v0.8.3-onboarding-ux-observability.md\n${text}`;
        fs.writeFileSync(ymlPath, stamped);
      }
    }

    // Copy log-rotate.md from bundled assets when present.
    const routinesDir = path.join(workspace, ".solosquad", "routines");
    fs.mkdirSync(routinesDir, { recursive: true });
    const rotateDest = path.join(routinesDir, "log-rotate.md");
    if (!fs.existsSync(rotateDest)) {
      const bundled = findBundledRoutine("log-rotate.md");
      if (bundled) {
        fs.copyFileSync(bundled, rotateDest);
      } else {
        // Fallback minimal body so the routine path still resolves.
        fs.writeFileSync(
          rotateDest,
          "# Log Rotate (v0.8.3)\n\n매일 00:30 (workspace timezone) 자동 실행. <workspace>/.solosquad/logs/에서 14일 이전 파일 삭제.\n",
        );
      }
    }

    // Ensure the logs/ directory exists.
    const logsDir = path.join(workspace, ".solosquad", "logs");
    fs.mkdirSync(logsDir, { recursive: true });

    void yaml; // reserved for future shape validation
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace) as WorkspaceYamlV083 | null;
    if (!ws) return { ok: false, error: "workspace.yaml missing after migration" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `version still ${ws.version ?? "(unset)"} — expected ${TARGET}` };
    }
    if (typeof ws.trajectory?.auto_register !== "boolean") {
      return { ok: false, error: "trajectory.auto_register missing in workspace.yaml" };
    }
    const rotateFile = path.join(workspace, ".solosquad", "routines", "log-rotate.md");
    if (!fs.existsSync(rotateFile)) {
      return { ok: false, error: "log-rotate routine missing after migration" };
    }
    const logsDir = path.join(workspace, ".solosquad", "logs");
    if (!fs.existsSync(logsDir)) {
      return { ok: false, error: ".solosquad/logs/ directory missing after migration" };
    }
    return { ok: true };
  },
};

/**
 * Locate a routine file in the bundled assets directory. The dist layout
 * places this compiled migration at `dist/src/migrations/scripts/`, so
 * `assets/routines/` is 4 levels up. In dev (`src/migrations/scripts/`
 * via tsx) it's 3 levels up. We try both.
 */
function findBundledRoutine(filename: string): string | null {
  const candidates = [
    path.resolve(__dirname_0_8_3, "..", "..", "..", "..", "assets", "routines", filename),
    path.resolve(__dirname_0_8_3, "..", "..", "..", "assets", "routines", filename),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
