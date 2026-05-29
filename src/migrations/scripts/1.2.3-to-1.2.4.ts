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
import { getOrgDir } from "../../util/paths.js";
import { grantClaudeTrustMany } from "../../util/claude-trust.js";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../../util/platform.js";

/**
 * v1.2.3 → v1.2.4 — Onboarding & Vocabulary Polish.
 *
 * v1.2.4 is a pure UX / vocabulary patch — no new schema fields, no new
 * bundle seeds (problem-definition workflow was already shipped in v1.2.3).
 * So this migration's only structural work is:
 *
 *   1. Bump workspace.yaml.version to 1.2.4.
 *   2. **Backfill Claude Code directory trust** (v1.2.4 §A.5) for every
 *      existing org cwd + every registered repo path. Without this, the
 *      bot's first `claude --print` spawn in each path hits the
 *      interactive trust dialog the bot process can't answer. New paths
 *      registered via `add-org` / `add repo` after install are handled
 *      at registration time; this migration covers paths that were
 *      registered *before* the v1.2.4 install.
 *
 * Idempotent. detect() matches "1.2.3" exact (no .x suffix — there's
 * only one usable 1.2.3 release in the registry).
 */

const TARGET = "1.2.4";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.2.3" || version.startsWith("1.2.3.");
}

function collectTrustPaths(workspace: string): string[] {
  const out: string[] = [];
  for (const product of loadProducts(workspace)) {
    const orgRoot = getOrgDir(product.slug, workspace);
    out.push(orgRoot);

    const reposDir = path.join(orgRoot, "repositories");
    if (!fs.existsSync(reposDir)) continue;

    for (const entry of fs.readdirSync(reposDir)) {
      if (!entry.endsWith(".yaml")) continue;
      try {
        const body = fs.readFileSync(path.join(reposDir, entry), "utf-8");
        const doc = yaml.load(normalizeLine(body)) as { path?: string } | null;
        const p = doc?.path;
        if (typeof p === "string" && p.trim().length > 0) {
          out.push(path.resolve(p));
        }
      } catch {
        /* skip unparseable yaml — trust grant is best-effort */
      }
    }
  }
  return out;
}

export const migration: Migration = {
  from: "1.2.3",
  to: TARGET,
  description:
    "v1.2.4 — Onboarding & Vocabulary Polish. Pure UX/vocab patch (no schema fields, no new seeds). Bumps workspace version + backfills Claude Code directory trust for existing org/repo paths.",

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
        description: "Bump workspace version to 1.2.4",
      });
    }

    const trustPaths = collectTrustPaths(workspace);
    if (trustPaths.length > 0) {
      steps.push({
        kind: "update",
        to: `~/.claude.json projects[*].hasTrustDialogAccepted=true (${trustPaths.length} path(s))`,
        description:
          `Backfill Claude Code directory trust for ${trustPaths.length} path(s) — ` +
          `every existing org cwd + every registered repo. Pre-grants the trust ` +
          `dialog so the bot's \`claude --print\` spawn doesn't hit it on first use.`,
      });
    }

    warnings.push(
      "v1.2.4 is a pure UX/vocabulary patch — no new schema fields, no new bundle seeds. Workspace data is untouched.",
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

    try {
      const trustPaths = collectTrustPaths(workspace);
      if (trustPaths.length > 0) {
        grantClaudeTrustMany(trustPaths);
      }
    } catch (err) {
      console.log(
        `[1.2.3→1.2.4] trust backfill skipped: ${(err as Error).message}`,
      );
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
    return { ok: true };
  },
};
