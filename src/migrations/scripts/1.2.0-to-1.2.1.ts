import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Migration, MigrationPlan, MigrationStep, VerifyResult } from "../types.js";
import { listOrganizations, loadWorkspaceYaml, saveWorkspaceYaml } from "../../util/config.js";

const TARGET = "1.2.1";

/**
 * v1.2.0 → v1.2.1 — no data migration.
 *
 * 1.2.1 adds `add org`, `add repo`, `sync` commands and makes `<org>/repositories/`
 * the canonical home for repos. Existing 1.2.0 workspaces keep working; this
 * step pre-creates the `repositories/` folder for every org (so the first `sync`
 * run is instant) and stamps workspace.yaml with the new version so the
 * startup banner stops firing.
 *
 * Legacy .git at org root is *not* touched here — that cleanup is opt-in via
 * `solosquad sync`.
 */
export const migration: Migration = {
  from: "1.2.0",
  to: TARGET,
  description: "Pre-create repositories/ folders and bump workspace.yaml version",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return ws.version === "1.2.0";
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const steps: MigrationStep[] = [];
    const orgs = listOrganizations(workspace);
    for (const o of orgs) {
      const reposDir = path.join(o.path, "repositories");
      if (!fs.existsSync(reposDir)) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/repositories/`,
          description: `Create ${o.slug}/repositories/ folder`,
        });
      }
    }
    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description: `Bump version: 1.2.0 → ${TARGET}`,
    });
    return {
      steps,
      warnings: [],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string, _plan: MigrationPlan): Promise<void> {
    const orgs = listOrganizations(workspace);
    for (const o of orgs) {
      const reposDir = path.join(o.path, "repositories");
      if (!fs.existsSync(reposDir)) {
        fs.mkdirSync(reposDir, { recursive: true });
      }
    }

    const ws = loadWorkspaceYaml(workspace);
    if (ws) {
      ws.version = TARGET;
      ws.last_migrated_to = TARGET;
      saveWorkspaceYaml(ws, workspace);
    }
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return { ok: false, error: "workspace.yaml missing" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `workspace.yaml version ${ws.version} != ${TARGET}` };
    }
    // Silence unused-var lint when yaml goes unused in some code paths
    void yaml;
    return { ok: true };
  },
};
