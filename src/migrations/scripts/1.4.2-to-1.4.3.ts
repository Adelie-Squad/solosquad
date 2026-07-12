import fs from "fs";
import path from "path";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  listOrganizations,
  loadWorkspaceYaml,
  saveWorkspaceYaml,
} from "../../util/config.js";

/**
 * v1.4.2 → v1.4.3 — Research Workflow: reports move to org-level.
 *
 * v1.3.8 seeded per-org reports under `<org>/docs/reports/`, but `docs/` is an
 * internal docs layer (not a first-class deliverable location). Final
 * deliverables — market-research reports, papers, prototypes — belong at the
 * org top level so they are front-and-center. This migration moves each org's
 * `docs/reports/` contents up to `<org>/reports/` and drops the stale seed
 * INDEX. Data-preserving (class A): files are moved, not deleted; existing
 * `reports/` files are never overwritten.
 * (docs/prd/v1.4.3_research-workflow-implementation.md §2.4)
 */

const TARGET = "1.4.3";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.4.2" || version.startsWith("1.4.2.");
}

function oldReportsDir(orgPath: string): string {
  return path.join(orgPath, "docs", "reports");
}
function newReportsDir(orgPath: string): string {
  return path.join(orgPath, "reports");
}

/** Move docs/reports/* -> reports/*; drop the stale docs-oriented INDEX seed;
 *  remove docs/reports if it ends up empty. Returns count of moved files. */
function moveOrgReports(orgPath: string): number {
  const src = oldReportsDir(orgPath);
  if (!fs.existsSync(src)) return 0;
  const dst = newReportsDir(orgPath);
  fs.mkdirSync(dst, { recursive: true });
  let moved = 0;
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    // Drop the v1.3.8 seed INDEX — reports is no longer a docs layer.
    if (name === "INDEX.md") {
      try { fs.rmSync(from, { force: true }); } catch { /* ignore */ }
      continue;
    }
    const to = path.join(dst, name);
    if (fs.existsSync(to)) continue; // never overwrite user files
    fs.renameSync(from, to);
    moved++;
  }
  try {
    if (fs.readdirSync(src).length === 0) fs.rmdirSync(src);
  } catch { /* leave non-empty dir as-is */ }
  return moved;
}

export const migration: Migration = {
  from: "1.4.2",
  to: TARGET,
  description:
    "v1.4.3 — Research Workflow: move each org's reports from `docs/reports/` up to org-level `reports/` (deliverables are first-class, not buried in docs). Files are moved (class A preserved), the stale seed INDEX is dropped. Stamps the workspace at 1.4.3.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return isFromVersion(typeof ws.version === "string" ? ws.version : "");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const steps: MigrationStep[] = [];
    for (const o of listOrganizations(workspace)) {
      const src = oldReportsDir(o.path);
      if (fs.existsSync(src)) {
        steps.push({
          kind: "move",
          from: `${o.slug}/docs/reports/`,
          to: `${o.slug}/reports/`,
          description: `Move ${o.slug} reports to org-level reports/ (drop stale INDEX)`,
        });
      }
    }
    const ws = loadWorkspaceYaml(workspace);
    steps.push({
      kind: "update",
      from: `workspace.yaml.version=${ws?.version ?? "(unset)"}`,
      to: `workspace.yaml.version=${TARGET}`,
      description: "Bump workspace version to 1.4.3",
    });
    return {
      steps,
      warnings: [
        "v1.4.3 — reports moved from `<org>/docs/reports/` to `<org>/reports/`. Update any bookmarks; the market-research skill now writes there.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    for (const o of listOrganizations(workspace)) {
      moveOrgReports(o.path);
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
    if (!ws) return { ok: false, error: "workspace.yaml missing after apply" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `workspace.yaml.version is ${ws.version}, expected ${TARGET}` };
    }
    return { ok: true };
  },
};
