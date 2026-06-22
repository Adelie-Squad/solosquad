import fs from "fs";
import path from "path";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadWorkspaceYaml, saveWorkspaceYaml, listOrganizations } from "../../util/config.js";
import { getLegacyCronsWriteDir, getCronsWriteDir } from "../../util/paths.js";

/**
 * v1.3.4 → v1.3.5 — relocate user crons from the workspace-global legacy dir
 * (`.solosquad/crons/`) to **per-org** dirs (`<org>/crons/`), per PRD
 * v1.3.5 §3.9 B-D3. Crons join workflow (`<org>/workflows/`) and goal
 * (`<org>/goals/`) as org-scoped assets, so a cron now fires only for its own
 * org instead of every product.
 *
 * Relocation rule:
 *   - 0 orgs  → nothing to move (just bump the version).
 *   - 1 org   → move every entry into that org's `crons/`.
 *   - N orgs  → move into the first org + warn (a human picks the real home;
 *               nothing is dropped, and re-running is a no-op once the legacy
 *               dir is empty).
 *
 * Never clobbers an existing destination file. Idempotent: detect() matches
 * "1.3.4" only, and apply() skips entries already moved.
 */

const TARGET = "1.3.5";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.3.4" || version.startsWith("1.3.4.");
}

/** Entries (files + `_archived/`) in the legacy global cron dir, if any. */
function legacyCronEntries(workspace: string): string[] {
  const dir = getLegacyCronsWriteDir(workspace);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

/** The org slug that legacy crons relocate into (first org), or null if none. */
function targetOrgSlug(workspace: string): string | null {
  const orgs = listOrganizations(workspace);
  return orgs.length > 0 ? orgs[0].slug : null;
}

export const migration: Migration = {
  from: "1.3.4",
  to: TARGET,
  description:
    "v1.3.5 — relocate user crons from `.solosquad/crons/` (workspace-global) to `<org>/crons/` (org-scoped, B-D3), so a cron fires only for its own org. Moves yaml/md/_archived entries into the (first) org and bumps the workspace version.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return isFromVersion(typeof ws.version === "string" ? ws.version : "");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace);
    const steps: MigrationStep[] = [];
    const entries = legacyCronEntries(workspace);
    const org = targetOrgSlug(workspace);
    const warnings: string[] = [];

    if (entries.length > 0 && org) {
      steps.push({
        kind: "move",
        from: getLegacyCronsWriteDir(workspace),
        to: getCronsWriteDir(org, workspace),
        description: `Move ${entries.length} cron entr(y/ies) to ${org}/crons/`,
      });
      const orgCount = listOrganizations(workspace).length;
      if (orgCount > 1) {
        warnings.push(
          `Multiple orgs detected — user crons were moved into "${org}" (the first org). ` +
            `Move any that belong elsewhere with \`solosquad cron delete\` + \`cron new --org <slug>\`.`,
        );
      }
    }
    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 1.3.5",
      });
    }
    return { steps, warnings, irreversible_changes: [], estimated_disk_delta_mb: 0 };
  },

  async apply(workspace: string): Promise<void> {
    const legacyDir = getLegacyCronsWriteDir(workspace);
    const org = targetOrgSlug(workspace);
    const entries = legacyCronEntries(workspace);

    if (entries.length > 0 && org) {
      const destDir = getCronsWriteDir(org, workspace);
      fs.mkdirSync(destDir, { recursive: true });
      for (const name of entries) {
        const src = path.join(legacyDir, name);
        const dest = path.join(destDir, name);
        if (fs.existsSync(dest)) continue; // never clobber
        fs.renameSync(src, dest);
      }
      // Remove the legacy dir if it's now empty (best-effort).
      try {
        if (fs.readdirSync(legacyDir).length === 0) fs.rmdirSync(legacyDir);
      } catch {
        /* leave a non-empty dir in place */
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
    if (!ws) return { ok: false, error: "workspace.yaml missing after apply" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `workspace.yaml.version is ${ws.version}, expected ${TARGET}` };
    }
    // Drained-dir is the happy path, but a destination collision legitimately
    // leaves the legacy duplicate in place (never clobber). Only fail if a
    // leftover has **no** colliding destination — that means a real move failed.
    const org = targetOrgSlug(workspace);
    if (org) {
      const destDir = getCronsWriteDir(org, workspace);
      const unmoved = legacyCronEntries(workspace).filter(
        (name) => !fs.existsSync(path.join(destDir, name)),
      );
      if (unmoved.length > 0) {
        return {
          ok: false,
          error: `legacy .solosquad/crons still has un-migrated entr(y/ies): ${unmoved.join(", ")}`,
        };
      }
    }
    return { ok: true };
  },
};
