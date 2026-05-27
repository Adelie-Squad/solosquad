import fs from "fs";
import path from "path";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import {
  loadProducts,
  loadWorkspaceYaml,
  saveWorkspaceYaml,
} from "../../util/config.js";
import { getBundleRoot, getOrgDir } from "../../util/paths.js";
import { KNOWN_TEAMS } from "../../util/composition.js";

/**
 * v1.0.x → v1.1.0 — Multi-agent team architecture (Chief + 4 main + 20
 * specialist + flat skills/teams). Per `docs/prd/v1.1-multi-agent-team-
 * architecture.md` §15.
 *
 * This migration is conservative — it does **not** touch user-owned data.
 * It only:
 *   1. Bumps `workspace.yaml.version` to 1.1.0.
 *   2. Seeds new per-org resources that v1.1 needs to function:
 *      - `<org>/agents/main/chief/SKILL.md` (copied from bundle if missing
 *        so the founder can domain-customize it).
 *      - `<org>/teams/<team>/OKR.md` × 4 (Chief writes OKRs here; the
 *        bundle ship templates as a starting point).
 *      - `<org>/memory/open-questions/` (PM↔Chief async batched query
 *        protocol, §6.3).
 *      - `<org>/memory/ledger/` (per-task event ledger, §13.2).
 *
 * What this migration does **not** do (handled in separate phases):
 *   - Specialist folder merges (backend+api→backend-engineer, etc.) —
 *     bundle-level operation, not user workspace.
 *   - SKILL.md frontmatter v1→v2 conversion — runtime parser handles
 *     missing v2 fields with defaults.
 *   - assets/ directory deletion — bundle stays during transition.
 *
 * Idempotent: re-running on 1.1.0 is a no-op (detect returns false). The
 * seed step uses `fs.existsSync` checks so user-customized files are
 * never overwritten.
 */

const TARGET = "1.1.0";

/**
 * Versions that should trigger this migration. v1.1.0 chains from 1.0.4
 * (the last patch on the 1.0.x line) so the per-patch chain
 * 1.0.2→1.0.3→1.0.4→1.1.0 is deterministic.
 */
function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.0.4" || version.startsWith("1.0.4.");
}

function bundleChiefTemplate(): string {
  return path.join(getBundleRoot(), "agents", "main", "chief", "SKILL.md");
}

function bundleTeamOkr(team: string): string {
  return path.join(getBundleRoot(), "teams", team, "OKR.md");
}

interface SeedTarget {
  orgSlug: string;
  /** Absolute path inside the org. */
  dest: string;
  /** Source file path, or null for directory-only seeds. */
  source: string | null;
  /** Human-readable label for the migration plan step. */
  label: string;
}

function collectSeeds(workspace: string): SeedTarget[] {
  const products = loadProducts(workspace);
  const seeds: SeedTarget[] = [];
  for (const product of products) {
    const orgRoot = getOrgDir(product.slug, workspace);
    seeds.push({
      orgSlug: product.slug,
      dest: path.join(orgRoot, "agents", "main", "chief", "SKILL.md"),
      source: bundleChiefTemplate(),
      label: `Seed chief SKILL.md template for org ${product.slug}`,
    });
    for (const team of KNOWN_TEAMS) {
      seeds.push({
        orgSlug: product.slug,
        dest: path.join(orgRoot, "teams", team, "OKR.md"),
        source: bundleTeamOkr(team),
        label: `Seed ${team} team OKR.md for org ${product.slug}`,
      });
    }
    seeds.push({
      orgSlug: product.slug,
      dest: path.join(orgRoot, "memory", "open-questions"),
      source: null,
      label: `Create memory/open-questions/ for org ${product.slug}`,
    });
    seeds.push({
      orgSlug: product.slug,
      dest: path.join(orgRoot, "memory", "ledger"),
      source: null,
      label: `Create memory/ledger/ for org ${product.slug}`,
    });
  }
  return seeds;
}

export const migration: Migration = {
  from: "1.0.4.x",
  to: TARGET,
  description:
    "v1.1.0 — Multi-agent team architecture. Bumps workspace version and seeds new per-org resources (chief SKILL.md template, team OKR.md, memory/open-questions, memory/ledger). User data is untouched.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return isFromVersion(typeof ws.version === "string" ? ws.version : "");
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const ws = loadWorkspaceYaml(workspace);
    const steps: MigrationStep[] = [];
    const warnings: string[] = [];

    if (ws) {
      steps.push({
        kind: "update",
        from: `workspace.yaml.version=${ws.version ?? "(unset)"}`,
        to: `workspace.yaml.version=${TARGET}`,
        description: "Bump workspace version to 1.1.0",
      });
    }

    const seeds = collectSeeds(workspace);
    for (const seed of seeds) {
      if (fs.existsSync(seed.dest)) {
        // Skipped — user already has a customized copy.
        continue;
      }
      if (seed.source && !fs.existsSync(seed.source)) {
        warnings.push(
          `Bundle source missing for seed: ${seed.source}. Skipping ${seed.label}.`
        );
        continue;
      }
      steps.push({
        kind: "generate",
        to: seed.dest,
        description: seed.label,
      });
    }

    warnings.push(
      "Specialist folder merges (backend-developer+api-developer → backend-engineer; data-collector+data-engineer → data-engineer; idea-refiner+scope-estimator → idea-scoper; user-researcher+desk-researcher → researcher) and paid-marketer → performance-marketer rename are handled at the bundle level — not in this migration. Your workspace is unaffected."
    );
    warnings.push(
      "agent-profile.yaml frontmatter v1 → v2 (collaborators, skills_used, pm_conventions, category, tier fields) is read tolerantly by the runtime parser — missing fields default sensibly. No conversion needed."
    );

    return {
      steps,
      warnings,
      irreversible_changes: [],
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string): Promise<void> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return;

    const seeds = collectSeeds(workspace);
    for (const seed of seeds) {
      if (fs.existsSync(seed.dest)) continue;
      fs.mkdirSync(path.dirname(seed.dest), { recursive: true });
      if (seed.source === null) {
        // Directory-only seed.
        fs.mkdirSync(seed.dest, { recursive: true });
        continue;
      }
      if (!fs.existsSync(seed.source)) continue;
      fs.copyFileSync(seed.source, seed.dest);
    }

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

    // Verify per-org seeded resources exist (bundle source presence).
    const seeds = collectSeeds(workspace);
    const blocking: string[] = [];
    for (const seed of seeds) {
      if (seed.source && !fs.existsSync(seed.source)) {
        blocking.push(`bundle missing: ${seed.source}`);
      }
    }
    if (blocking.length > 0) {
      return {
        ok: false,
        error: `Bundle resources missing — package is incomplete: ${blocking.join(
          "; "
        )}`,
      };
    }

    return { ok: true };
  },
};
