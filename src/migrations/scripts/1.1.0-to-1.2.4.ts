import fs from "fs";
import path from "path";
import yaml from "js-yaml";
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
import { grantClaudeTrustMany } from "../../util/claude-trust.js";
import { normalizeLine } from "../../util/platform.js";

/**
 * v1.1.0 → v1.2.4 — Discord auto-connect + Chief identity + owner-only gate +
 * works-handle task hub + add-org bootstrap + problem-definition workflow seed.
 *
 * Per `docs/prd/v1.2-messenger-connection-discord-first.md` §13.
 *
 * Three concrete actions, all idempotent:
 *
 *   1. **Bump** workspace.yaml.version to 1.2.4.
 *
 *   2. **Seed Discord workspace policy** at `workspace.yaml.messenger.discord`:
 *      - `owner_only: false` — preserves v1.0.2 channel-ACL-only behavior for
 *        upgraded workspaces (fresh installs land `true`). PRD §13.3.
 *      - `install_mode: "byo_manual"` — existing users completed Developer
 *        Portal manually; new users get `oauth_invite` default in init.
 *      - `thread_token_budget: 80000` — §9.2 default.
 *
 *   3. **Seed problem-definition workflow** for every org at
 *      `<org>/workflows/problem-definition/workflow.yaml` (copied from the
 *      bundle if missing). PRD §12 #16. User-customized files are never
 *      overwritten.
 *
 * What this migration does **not** do:
 *   - `org.yaml.chief_name` is *not* auto-set. doctor / init / add-org
 *     prompts it interactively. Runtime fallback is the string "Chief".
 *     PRD §4.1.
 *   - `bot_application_id` is reused (v0.8.0 field, set by 0.7.0-to-0.8.0).
 *     No restructure to a hypothetical `bots.chief.*` nested namespace.
 *   - Existing channels / token / config.yaml / open-questions / ledger
 *     are untouched.
 *
 * Idempotent: detect() returns false on 1.2.4; apply() guards every seed
 * with existsSync.
 */

const TARGET = "1.2.4";

function isFromVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  return version === "1.1.0" || version.startsWith("1.1.0.");
}

function bundleProblemDefinitionWorkflow(): string {
  return path.join(
    getBundleRoot(),
    "skills",
    "workflow-maker",
    "assets",
    "workflows",
    "problem-definition",
    "workflow.yaml",
  );
}

interface WorkflowSeed {
  orgSlug: string;
  dest: string;
  source: string;
  label: string;
}

/**
 * v1.2.4 §A.5 — collect all paths that should be granted Claude Code
 * directory trust on migrate:
 *   - every org cwd (chief-runner spawns `claude --print` with cwd=<org>)
 *   - every registered repo's absolute `path` (read from each
 *     `<org>/repositories/*.yaml`); Chief operates inside these paths
 *     when working on code.
 * Skipped silently when a repo yaml is unparseable or its `path` field
 * is missing — the migration must not abort on user-yaml shape drift.
 */
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
        // skip unparseable yaml — trust grant is best-effort
      }
    }
  }
  return out;
}

function collectWorkflowSeeds(workspace: string): WorkflowSeed[] {
  const products = loadProducts(workspace);
  const source = bundleProblemDefinitionWorkflow();
  return products.map((product) => {
    const orgRoot = getOrgDir(product.slug, workspace);
    return {
      orgSlug: product.slug,
      dest: path.join(orgRoot, "workflows", "problem-definition", "workflow.yaml"),
      source,
      label: `Seed problem-definition workflow for org ${product.slug}`,
    };
  });
}

export const migration: Migration = {
  from: "1.1.0",
  to: TARGET,
  description:
    "v1.2.4 — Discord auto-connect + Chief identity (chief_name) + owner-only gate + works-handle task hub + problem-definition workflow seed. Bumps workspace version, seeds workspace.yaml.messenger.discord defaults (owner_only=false preserves v1.0.2 behavior), and copies problem-definition workflow to each org.",

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

      const hasDiscordCfg = !!ws.messenger?.discord;
      if (!hasDiscordCfg) {
        steps.push({
          kind: "update",
          to: "workspace.yaml.messenger.discord={owner_only:false, install_mode:byo_manual, thread_token_budget:80000}",
          description:
            "Seed Discord workspace policy (owner_only=false preserves v1.0.2 channel-ACL-only mode for upgraded workspaces)",
        });
      }
    }

    const seeds = collectWorkflowSeeds(workspace);
    for (const seed of seeds) {
      if (fs.existsSync(seed.dest)) continue;
      if (!fs.existsSync(seed.source)) {
        warnings.push(
          `Bundle source missing for seed: ${seed.source}. Skipping ${seed.label}.`,
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
      "Chief name (org.yaml.chief_name) is not auto-set. Run `solosquad doctor` or re-run `solosquad init` to set it; runtime fallback is the literal \"Chief\".",
    );
    warnings.push(
      "Discord owner-only gate stays OFF for upgraded workspaces (preserves v1.0.2 mode). To enable strict owner-only, edit workspace.yaml: messenger.discord.owner_only=true. Fresh installs land with owner_only=true by default.",
    );

    // v1.2.4 §A.5 — list trust-backfill paths in the plan output so
    // the user sees what migrate will touch in ~/.claude.json.
    const trustPaths = collectTrustPaths(workspace);
    if (trustPaths.length > 0) {
      steps.push({
        kind: "update",
        to: `~/.claude.json projects[*].hasTrustDialogAccepted=true (${trustPaths.length} path(s))`,
        description:
          `Backfill Claude Code directory trust for ${trustPaths.length} path(s) — ` +
          `every existing org cwd + every registered repo. Pre-grants the trust dialog so the bot's ` +
          `\`claude --print\` spawn doesn't hit it on first use.`,
      });
    }

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

    if (!ws.messenger) ws.messenger = {};
    if (!ws.messenger.discord) {
      ws.messenger.discord = {
        owner_only: false,
        install_mode: "byo_manual",
        thread_token_budget: 80_000,
      };
    }

    const seeds = collectWorkflowSeeds(workspace);
    for (const seed of seeds) {
      if (fs.existsSync(seed.dest)) continue;
      if (!fs.existsSync(seed.source)) continue;
      fs.mkdirSync(path.dirname(seed.dest), { recursive: true });
      fs.copyFileSync(seed.source, seed.dest);
    }

    // v1.2.4 §A.5 — backfill Claude Code directory trust for every
    // existing org dir + every registered repo path. Without this,
    // workspaces created before v1.2.4 keep hitting the interactive
    // trust dialog on first `claude --print` spawn in each path.
    // Best-effort: a missing ~/.claude.json (Claude not yet run on
    // this machine) logs and skips. Idempotent — re-running migrate
    // on a now-trusted workspace is a no-op.
    try {
      const trustPaths = collectTrustPaths(workspace);
      if (trustPaths.length > 0) {
        grantClaudeTrustMany(trustPaths);
      }
    } catch (err) {
      console.log(
        `[1.1.0→1.2.4] trust backfill skipped: ${(err as Error).message}`,
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
    if (!ws.messenger?.discord) {
      return {
        ok: false,
        error: "workspace.yaml.messenger.discord block missing after apply",
      };
    }

    const bundleSrc = bundleProblemDefinitionWorkflow();
    if (!fs.existsSync(bundleSrc)) {
      return {
        ok: false,
        error: `Bundle resource missing — package is incomplete: ${bundleSrc}`,
      };
    }

    return { ok: true };
  },
};
