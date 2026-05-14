import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
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
import {
  buildBackfillFrontmatter,
  hasFrontmatter,
  CANONICAL_KEYWORDS,
} from "../skill-frontmatter-backfill.js";
import { normalizeLine } from "../../util/platform.js";

const TARGET = "0.5.0";

/**
 * v0.4.0 → v0.5.0 — workflow-maker + frontmatter-driven routing.
 *
 * Per docs/plan/v0.5-workflow-maker.md §10 — 2-pass strategy:
 *
 *   Pass 1 (this migration, automatic):
 *     a. Prepend frontmatter to every `<org>/.claude/agents/<name>.md` we
 *        own and to any user-owned SKILL.md under the 3-tier search paths.
 *        Frontmatter is derived deterministically: name (folder), team
 *        (parent folder), description (extractDescription), keyword
 *        triggers (CANONICAL_KEYWORDS), stateful: false, explicit: true.
 *     b. Create the 3-tier user/org/analysis directories with READMEs.
 *     c. Add `skill_loader` + `author` sections to workspace.yaml.
 *     d. Bump version 0.4.0 → 0.5.0.
 *
 *   Pass 2 (separate, human-driven):
 *     - `solosquad agent validate --all` — flags any SKILL.md where the
 *       backfill produced an unusable description and human review is
 *       needed. The migration does NOT run Pass 2 automatically; CI does.
 *
 * Non-destructive:
 *   - Original SKILL.md bodies are preserved verbatim; only the frontmatter
 *     block is prepended.
 *   - `~/.solosquad-backups/<ISO>-pre-v0.5/` snapshot (via backup.ts) keeps
 *     a rollback target.
 *   - Idempotent: a SKILL.md that already has frontmatter is left alone.
 *
 * Bundled assets (`assets/agents/.../SKILL.md`) are backfilled out-of-band
 * by `scripts/backfill-bundled-frontmatter.ts` — that's a one-shot the
 * SoloSquad maintainers run; the resulting files are committed and shipped.
 * The migration logic in this file is the same code, applied to user
 * workspaces instead of the bundled assets.
 */
export const migration: Migration = {
  from: "0.4.0",
  to: TARGET,
  description:
    "Workflow maker: SKILL.md frontmatter backfill (25 specialists + user SKILLs), 3-tier dirs, workspace.yaml skill_loader + author sections.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return ws.version === "0.4.0";
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const steps: MigrationStep[] = [];
    const orgs = listOrganizations(workspace);
    const userAgentsRoot = userAgentsDir();

    const targets = collectBackfillTargets(workspace, orgs);
    if (targets.length > 0) {
      steps.push({
        kind: "update",
        to: "(SKILL.md files)",
        description: `Prepend frontmatter to ${targets.length} SKILL.md file(s) under workspace agent search paths`,
      });
    }

    if (!fs.existsSync(userAgentsRoot)) {
      steps.push({
        kind: "generate",
        to: userAgentsRoot,
        description: "Create user-global agents dir (~/.solosquad/agents/) with README",
      });
    }

    for (const o of orgs) {
      const orgAgents = path.join(o.path, ".agents");
      if (!fs.existsSync(orgAgents)) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/.agents/`,
          description: `Create org-local agents dir for ${o.slug} (3-tier top priority)`,
        });
      }
      const analysisDir = path.join(o.path, ".solosquad", "analysis");
      if (!fs.existsSync(analysisDir)) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/.solosquad/analysis/`,
          description: `Create analysis output dir for ${o.slug}`,
        });
      }
    }

    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description: "Add skill_loader + author sections (idempotent)",
    });
    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description: `Bump version: 0.4.0 → ${TARGET}`,
    });
    steps.push({
      kind: "note",
      description:
        "v0.5 introduces frontmatter-driven routing. The legacy AGENT_ROUTES map is gone; keyword routing now lives in each SKILL.md's `triggers.keyword`. Run `solosquad agent validate --all` after migration for any human polish needed (Pass 2).",
    });

    return {
      steps,
      warnings: [
        "After migration, restart `solosquad bot` so the router rebuilds against the new SKILL.md frontmatter.",
        "Run `solosquad agent validate --all` to confirm backfill produced usable descriptions. Edit any SKILL.md the validator flags.",
        "AGENTS.md line ~131 — human-edit the 'Legacy keyword routing' paragraph per docs/plan/v0.5-agents-md-patch.md before merging this release.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0.02,
    };
  },

  async apply(workspace: string, _plan: MigrationPlan): Promise<void> {
    // --- Pass 1a: backfill frontmatter on every reachable SKILL.md ---
    const orgs = listOrganizations(workspace);
    const targets = collectBackfillTargets(workspace, orgs);
    for (const target of targets) {
      backfillOne(target);
    }

    // --- Pass 1b: create 3-tier dirs + READMEs ---
    const userRoot = userAgentsDir();
    ensureDirWithReadme(userRoot, USER_AGENTS_README);

    for (const o of orgs) {
      ensureDirWithReadme(path.join(o.path, ".agents"), ORG_AGENTS_README);
      ensureDirWithReadme(
        path.join(o.path, ".solosquad", "analysis"),
        ORG_ANALYSIS_README,
      );
    }

    // --- Pass 1c: patch workspace.yaml ---
    const ws = loadWorkspaceYaml(workspace);
    if (ws) {
      if (ws.skill_loader === undefined) {
        ws.skill_loader = { tiers: ["org", "user", "bundle"] };
      }
      if (ws.author === undefined) {
        ws.author = {
          budget: { daily_usd: 10, weekly_usd: 50 },
          on_cap_action: "pause",
        };
      }
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

    if (ws.skill_loader === undefined) {
      return { ok: false, error: "workspace.yaml.skill_loader section missing" };
    }
    if (ws.author === undefined) {
      return { ok: false, error: "workspace.yaml.author section missing" };
    }

    const orgs = listOrganizations(workspace);
    for (const o of orgs) {
      const orgAgents = path.join(o.path, ".agents");
      if (!fs.existsSync(orgAgents)) {
        return { ok: false, error: `${o.slug}/.agents/ missing after migration` };
      }
      const analysisDir = path.join(o.path, ".solosquad", "analysis");
      if (!fs.existsSync(analysisDir)) {
        return {
          ok: false,
          error: `${o.slug}/.solosquad/analysis/ missing after migration`,
        };
      }
    }

    // Self-check — every reachable SKILL.md now has frontmatter.
    const stillMissing: string[] = [];
    for (const t of collectAllSkillTargets(workspace, orgs)) {
      const raw = fs.readFileSync(t.skill_path, "utf-8");
      if (!hasFrontmatter(raw)) stillMissing.push(t.skill_path);
    }
    if (stillMissing.length > 0) {
      return {
        ok: false,
        error: `${stillMissing.length} SKILL.md still missing frontmatter after backfill (first: ${stillMissing[0]})`,
      };
    }

    return { ok: true };
  },
};

// ---------------------------------------------------------------------------
// Backfill targets — agent SKILL.md files reachable from the workspace
// ---------------------------------------------------------------------------

interface BackfillTarget {
  skill_path: string;
  team: string;
  agent: string;
  /** Provenance — what tier this came from (debug only). */
  tier: "workspace-bundled" | "org-local" | "user-global";
}

/**
 * SKILL.md files we should consider rewriting. Excludes any file that
 * already has frontmatter (idempotency).
 */
function collectBackfillTargets(
  workspace: string,
  orgs: { slug: string; path: string }[],
): BackfillTarget[] {
  return collectAllSkillTargets(workspace, orgs).filter((t) => {
    const raw = fs.readFileSync(t.skill_path, "utf-8");
    return !hasFrontmatter(raw);
  });
}

/** All SKILL.md files reachable from the workspace, regardless of state. */
function collectAllSkillTargets(
  workspace: string,
  orgs: { slug: string; path: string }[],
): BackfillTarget[] {
  const out: BackfillTarget[] = [];

  // Tier 3 (lowest priority): <workspace>/.solosquad/agents/{team}/{agent}/SKILL.md
  const bundled = path.join(workspace, ".solosquad", "agents");
  if (fs.existsSync(bundled)) {
    out.push(...scanAgentsRoot(bundled, "workspace-bundled"));
  }

  // Tier 2: ~/.solosquad/agents/{team}/{agent}/SKILL.md
  const userRoot = userAgentsDir();
  if (fs.existsSync(userRoot)) {
    out.push(...scanAgentsRoot(userRoot, "user-global"));
  }

  // Tier 1 (highest priority): <workspace>/<org>/.agents/{team}/{agent}/SKILL.md
  for (const o of orgs) {
    const orgRoot = path.join(o.path, ".agents");
    if (fs.existsSync(orgRoot)) {
      out.push(...scanAgentsRoot(orgRoot, "org-local"));
    }
  }

  return out;
}

function scanAgentsRoot(
  root: string,
  tier: BackfillTarget["tier"],
): BackfillTarget[] {
  const out: BackfillTarget[] = [];
  for (const teamEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!teamEntry.isDirectory()) continue;
    if (teamEntry.name.startsWith("_")) continue;
    const teamDir = path.join(root, teamEntry.name);
    for (const agentEntry of fs.readdirSync(teamDir, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const skillPath = path.join(teamDir, agentEntry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;
      out.push({
        skill_path: skillPath,
        team: teamEntry.name,
        agent: agentEntry.name,
        tier,
      });
    }
  }
  return out;
}

function backfillOne(target: BackfillTarget): void {
  const raw = fs.readFileSync(target.skill_path, "utf-8");
  if (hasFrontmatter(raw)) return; // belt-and-suspenders

  const key = `${target.team}/${target.agent}`;
  // User-authored SKILLs that don't appear in the canonical map still get
  // backfilled with an empty keyword list — explicit: true keeps them
  // PM-callable; the user can later add keywords manually.
  const keywords = CANONICAL_KEYWORDS[key] ?? [];

  const frontmatter = buildBackfillFrontmatter({
    name: target.agent,
    team: target.team,
    body: raw,
    keywords,
  });
  const newContent = `---\n${frontmatter}\n---\n${normalizeLine(raw)}`;
  fs.writeFileSync(target.skill_path, newContent, "utf-8");
}

// ---------------------------------------------------------------------------
// 3-tier directory bookkeeping
// ---------------------------------------------------------------------------

function userAgentsDir(): string {
  return path.join(os.homedir(), ".solosquad", "agents");
}

function ensureDirWithReadme(dir: string, readme: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const readmePath = path.join(dir, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, readme, "utf-8");
  }
}

const USER_AGENTS_README = `# ~/.solosquad/agents/

User-global agent overrides — Tier 2 of the v0.5 3-tier search path.

Drop a SKILL.md here to override the bundled version (Tier 3, in
\`<workspace>/.solosquad/agents/\`) for *every* workspace this user runs.
Org-local agents under \`<workspace>/<org>/.agents/\` (Tier 1) still win.

Layout:

\`\`\`
~/.solosquad/agents/
  <team>/
    <agent>/
      SKILL.md
\`\`\`

See \`docs/plan/v0.5-workflow-maker.md\` §7 for the resolution rules.
`;

const ORG_AGENTS_README = `# <org>/.agents/

Org-local agent overrides — Tier 1 (top priority) of the v0.5 3-tier
search path.

Drop a SKILL.md here to override the user-global (Tier 2) or bundled
(Tier 3) version for *this organization only*. The messenger author loop
writes new SKILLs here by default.

Layout:

\`\`\`
<org>/.agents/
  <team>/
    <agent>/
      SKILL.md
\`\`\`

See \`docs/plan/v0.5-workflow-maker.md\` §7.
`;

const ORG_ANALYSIS_README = `# <org>/.solosquad/analysis/

Output store for \`solosquad analyze repo\` — v0.5 §6.

Each analysis run writes a Markdown report + ledger JSON here. The ledger
lets re-runs skip already-classified files (target: 0 LLM calls on the
second invocation).
`;

// ---------------------------------------------------------------------------
// Self-check helper (for tests / scripts that want a summary without going
// through the full Migration runner)
// ---------------------------------------------------------------------------

export interface BackfillSummary {
  total: number;
  backfilled: number;
  already_present: number;
  per_path: { path: string; action: "backfilled" | "skipped" }[];
}

/**
 * Run only Pass 1a (frontmatter backfill) on a workspace and return a
 * summary. Useful for `solosquad migrate --dry-run` style introspection.
 */
export function runFrontmatterBackfill(workspace: string): BackfillSummary {
  const orgs = listOrganizations(workspace);
  const all = collectAllSkillTargets(workspace, orgs);
  const summary: BackfillSummary = {
    total: all.length,
    backfilled: 0,
    already_present: 0,
    per_path: [],
  };
  for (const t of all) {
    const raw = fs.readFileSync(t.skill_path, "utf-8");
    if (hasFrontmatter(raw)) {
      summary.already_present++;
      summary.per_path.push({ path: t.skill_path, action: "skipped" });
      continue;
    }
    backfillOne(t);
    summary.backfilled++;
    summary.per_path.push({ path: t.skill_path, action: "backfilled" });
  }
  return summary;
}

// Reserved for future inline yaml writes that bypass `saveWorkspaceYaml`.
void yaml;
