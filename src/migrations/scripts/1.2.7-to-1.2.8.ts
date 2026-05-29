import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

/**
 * v1.2.7 → v1.2.8 — Fix the silent ESM `require()` bug in chief-runner
 * that broke the v1.2.7 `--add-dir` wiring.
 *
 * v1.2.7 added two helpers (`collectRegisteredRepoPaths`,
 * `resolveRepoCloneDefault`) that used `require("fs"|"path"|"js-yaml")`
 * to lazy-load the standard library + js-yaml. The package ships as
 * `"type": "module"` (ESM), so `require` is undefined in those
 * function bodies → the helpers threw → the outer try/catch silently
 * swallowed the error → `addDirs` came back empty → spawn never got
 * the `--add-dir <path>` flags → Chief reported "haven't granted it
 * yet" for every external repo even though the v1.2.6 trust grants
 * were correctly present in `~/.claude.json`.
 *
 * v1.2.8 converts those `require()` calls to top-level ESM imports
 * (`import fs from "fs"`, `import path from "path"`, `import yamlLib
 * from "js-yaml"`). Behavior change is runtime-only — no workspace
 * data is touched.
 *
 * Pure version bump. Idempotent. detect() matches "1.2.7" exact.
 */

const TARGET = "1.2.8";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.2.7" || version.startsWith("1.2.7.");
}

export const migration: Migration = {
  from: "1.2.7",
  to: TARGET,
  description:
    "v1.2.8 — Fix the silent ESM require() bug in chief-runner that broke v1.2.7 --add-dir. Pure runtime fix; no workspace data changes.",

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
        description: "Bump workspace version to 1.2.8",
      });
    }
    return {
      steps,
      warnings: [
        "v1.2.8 is a runtime fix — fixes the ESM `require()` bug that silently broke v1.2.7's `--add-dir` wiring. No workspace data is modified.",
      ],
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
