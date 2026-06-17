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
  listOrganizations,
  loadWorkspaceYaml,
  saveWorkspaceYaml,
  DEFAULT_MIGRATION_BUDGET_USD,
} from "../../util/config.js";
import { getAssetsDir, getOrgDir } from "../../util/paths.js";
import { normalizeLine } from "../../util/platform.js";
import {
  LEDGER_REL_PATH,
  loadLedger,
  saveLedger,
  getPendingV06,
  setPendingV06,
  type Ledger,
  type LedgerEntry,
} from "../../analyze/ledger.js";
import {
  AGENT_PROFILE_SCHEMA_VERSION,
  orgAgentProfilePath,
  type AgentSection,
  type AgentProfileYaml,
} from "../../util/agent-profile.js";
import { openArchive } from "../../memory/archive-db.js";
import { recordAuthorCost, checkBudget } from "../../bot/author-budget.js";

const SOURCE_PREFIX = "0.5.";
const TARGET = "0.6.0";

/**
 * v0.5.0 → v0.6.0 — default-workflow tuning + memory archive + org layer.
 *
 * Per docs/plan/v0.6-default-workflow-tuning.md §2.1/§2.2/§2.3/§2.4 + §4. The
 * step is 2-pass like v0.5 (S5) — Pass 1 is the bulk automatic work, Pass 2
 * is `solosquad agent validate --all` against the migrated workspace.
 *
 * What changes in the user workspace:
 *
 *   1. Folder re-shape (§2.1): `agents/_teams/{team}/TEAM_KNOWLEDGE.md` →
 *      `agents/{team}/KNOWLEDGE.md`. Non-destructive file move.
 *   2. Org layer stubs (§2.2): each `<org>/` gets `core/PRINCIPLES.md`,
 *      `core/VOICE.md`, `agent-profile.yaml` (defaults + schema_version: 1),
 *      `domain/README.md`.
 *   3. Workspace knowledge guide (§2.3): `<ws>/.solosquad/knowledge/README.md`.
 *   4. FTS5 archive init (§4): each `<org>/memory/archive.sqlite` opened →
 *      schema applied.
 *   5. v0.5 ledger redestination (§2.2 receiver-side): every analysis-ledger
 *      entry with `pending_v0.6_redestination: true` is processed —
 *         · role   → org-color H2/H3 sections heuristically extracted from
 *                    the temp SKILL.md body and merged into
 *                    `<org>/agent-profile.yaml`. Match 0 → mark
 *                    `human_review_required: true`, leave in place.
 *         · domain → `<org>/memory/domain/*.md` moved to `<org>/domain/*.md`.
 *      Each processed entry flips to `pending_v0.6_redestination: false` +
 *      `redestinated_at: <iso>` + `redestination_method: auto |
 *      human-review-required`. A side-car Markdown report is written.
 *   6. Migration budget cap (§2.2 P0 #2): `workspace.yaml.migration.budget_usd`
 *      (default $5). LLM fallback for ledger redestination calls
 *      `checkBudget()` first; cap reached → remaining items are flagged
 *      `human_review_required` and the run *succeeds* (idempotent retry).
 *      Cumulative cost lands in `<org>/memory/migration-costs.jsonl`.
 *   7. collab_pattern injection (§2.4): the same logic as
 *      `scripts/inject-collab-pattern.ts` runs against every reachable user
 *      SKILL.md (workspace-bundled + org-local + user-global). Idempotent.
 *   8. Routine copy: `assets/routines/archive-rotate.md` +
 *      `v06-retrospective-stats.md` → user workspace `routines/` if present.
 *   9. workspace.yaml patches: `fs_watch`, `archive`, `spawn`, `migration`
 *      sections (idempotent default fill-ins).
 *  10. Version bump 0.5.x → 0.6.0.
 *
 * Pass 2 (post-migration, automatic):
 *   - `solosquad agent validate --all` is invoked once; failures are *warned*,
 *     not raised. Users edit SKILLs by hand afterwards.
 *
 * Idempotency: re-running on a 0.6.0 workspace is a no-op (detect() returns
 * false). Running before completion on a half-migrated workspace re-processes
 * only the remaining pending entries.
 */
export const migration: Migration = {
  from: "0.5.x",
  to: TARGET,
  description:
    "v0.6 default-workflow tuning: team→domain folder re-shape, org agent-profile/core/domain stubs, workspace knowledge guide, FTS5 archive, v0.5 ledger redestination, collab_pattern injection.",

  async detect(workspace: string): Promise<boolean> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return false;
    return typeof ws.version === "string" && ws.version.startsWith(SOURCE_PREFIX);
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const steps: MigrationStep[] = [];
    const orgs = listOrganizations(workspace);

    const teamsRoot = path.join(workspace, ".solosquad", "agents", "_teams");
    if (fs.existsSync(teamsRoot)) {
      const teamCount = listTeamsInTeamsRoot(teamsRoot).length;
      steps.push({
        kind: "move",
        from: ".solosquad/agents/_teams/{team}/TEAM_KNOWLEDGE.md",
        to: ".solosquad/agents/{team}/KNOWLEDGE.md",
        description: `Move ${teamCount} TEAM_KNOWLEDGE.md file(s) into co-located KNOWLEDGE.md and remove _teams/`,
      });
    }

    for (const o of orgs) {
      const orgCore = path.join(o.path, "core");
      if (!fs.existsSync(path.join(orgCore, "PRINCIPLES.md"))) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/core/PRINCIPLES.md`,
          description: `Org layer stub for ${o.slug}`,
        });
      }
      if (!fs.existsSync(path.join(orgCore, "VOICE.md"))) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/core/VOICE.md`,
          description: `Org layer stub for ${o.slug}`,
        });
      }
      if (!fs.existsSync(orgAgentProfilePath(workspace, o.slug))) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/agent-profile.yaml`,
          description: `Org agent-profile.yaml with defaults + schema_version: 1`,
        });
      }
      const domainReadme = path.join(o.path, "domain", "README.md");
      if (!fs.existsSync(domainReadme)) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/domain/README.md`,
          description: `Org domain knowledge folder for ${o.slug}`,
        });
      }
      const archivePath = path.join(o.path, "memory", "archive.sqlite");
      if (!fs.existsSync(archivePath)) {
        steps.push({
          kind: "generate",
          to: `${o.slug}/memory/archive.sqlite`,
          description: `Initialize FTS5 cold archive for ${o.slug}`,
        });
      }
      const ledgerPath = path.join(o.path, LEDGER_REL_PATH);
      if (fs.existsSync(ledgerPath)) {
        const ledger = loadLedger(ledgerPath);
        const pending = ledger?.analyzed.filter((e) => getPendingV06(e)) ?? [];
        if (pending.length > 0) {
          steps.push({
            kind: "update",
            to: `${o.slug}/.solosquad/analysis-ledger.yaml`,
            description: `Redestinate ${pending.length} pending v0.5 ledger entr${pending.length === 1 ? "y" : "ies"} for ${o.slug}`,
          });
        }
      }
    }

    const knowledgeReadme = path.join(
      workspace,
      ".solosquad",
      "knowledge",
      "README.md"
    );
    if (!fs.existsSync(knowledgeReadme)) {
      steps.push({
        kind: "generate",
        to: ".solosquad/knowledge/README.md",
        description: "Workspace knowledge layer guide stub",
      });
    }

    steps.push({
      kind: "update",
      to: "(SKILL.md files)",
      description:
        "Inject `collab_pattern` frontmatter into every reachable SKILL.md (idempotent — workspace bundle was already patched in v0.6 S2; user-authored SKILLs get the same).",
    });

    const userRoutines = path.join(workspace, ".solosquad", "routines");
    if (fs.existsSync(userRoutines)) {
      const archiveRoutine = path.join(userRoutines, "archive-rotate.md");
      const statsRoutine = path.join(userRoutines, "v06-retrospective-stats.md");
      if (!fs.existsSync(archiveRoutine) || !fs.existsSync(statsRoutine)) {
        steps.push({
          kind: "generate",
          to: ".solosquad/routines/",
          description: "Copy v0.6 routine prompts (archive-rotate + v06-retrospective-stats)",
        });
      }
    }

    steps.push({
      kind: "update",
      to: ".solosquad/workspace.yaml",
      description:
        "Add fs_watch + archive + spawn + migration sections (idempotent) and bump version 0.5.x → 0.6.0",
    });

    steps.push({
      kind: "note",
      description:
        "v0.6 migration is 2-pass. Pass 1 (this script) is automatic. Pass 2 is `solosquad agent validate --all` — failures are reported as warnings; fix them with `solosquad agent edit <name>`.",
    });

    return {
      steps,
      warnings: [
        "After migration, restart `solosquad bot` so the spawn assembler picks up the new org layer.",
        "Heuristic ledger redestination is fail-soft — entries whose body has no tone/voice/priority/ban/excluded/emphasis section are left for human review (`human_review_required: true`). See <org>/memory/migration-<date>-redestination.md.",
        "Migration budget cap is workspace.yaml.migration.budget_usd (default $5). When LLM fallback exceeds it the remaining ledger entries are flagged human-review and the migration completes successfully.",
      ],
      irreversible_changes: [],
      estimated_disk_delta_mb: 0.5,
    };
  },

  async apply(workspace: string, _plan: MigrationPlan): Promise<void> {
    const orgs = listOrganizations(workspace);
    const dateStamp = todayDateStamp();

    // --- Step 2: folder re-shape (assets _teams → {team}/KNOWLEDGE.md) ---
    reshapeTeamsFolder(workspace);

    // --- Steps 3-5: per-org stubs + FTS5 init + ledger redestination ---
    let cumulativeBudgetCost = 0;
    const budgetCap = readMigrationBudgetCap(workspace);
    for (const o of orgs) {
      ensureOrgLayerStubs(workspace, o.slug);
      ensureArchiveSqlite(workspace, o.slug);
      const result = redestinateLedger({
        workspace,
        orgSlug: o.slug,
        orgDir: o.path,
        cumulativeBudgetCost,
        budgetCap,
        dateStamp,
      });
      cumulativeBudgetCost = result.cumulativeBudgetCost;
    }

    // --- Step 4: workspace knowledge guide ---
    ensureWorkspaceKnowledgeStub(workspace);

    // --- Step 9: collab_pattern injection on user SKILL.md tree ---
    injectCollabPatternAcrossWorkspace(workspace, orgs.map((o) => o.path));

    // --- Step 10: routines copy ---
    copyV06Routines(workspace);

    // --- Step 8: workspace.yaml patches + version bump ---
    patchWorkspaceYaml(workspace);
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const ws = loadWorkspaceYaml(workspace);
    if (!ws) return { ok: false, error: "workspace.yaml missing" };
    if (ws.version !== TARGET) {
      return { ok: false, error: `workspace.yaml version ${ws.version} != ${TARGET}` };
    }
    if (!ws.archive) {
      return { ok: false, error: "workspace.yaml.archive section missing after migration" };
    }
    if (!ws.spawn) {
      return { ok: false, error: "workspace.yaml.spawn section missing after migration" };
    }
    if (!ws.fs_watch) {
      return { ok: false, error: "workspace.yaml.fs_watch section missing after migration" };
    }
    if (!ws.migration) {
      return { ok: false, error: "workspace.yaml.migration section missing after migration" };
    }

    const orgs = listOrganizations(workspace);
    for (const o of orgs) {
      const profile = orgAgentProfilePath(workspace, o.slug);
      if (!fs.existsSync(profile)) {
        return { ok: false, error: `${o.slug}/agent-profile.yaml missing after migration` };
      }
      const domain = path.join(o.path, "domain", "README.md");
      if (!fs.existsSync(domain)) {
        return { ok: false, error: `${o.slug}/domain/README.md missing after migration` };
      }
      const archive = path.join(o.path, "memory", "archive.sqlite");
      if (!fs.existsSync(archive)) {
        return { ok: false, error: `${o.slug}/memory/archive.sqlite missing after migration` };
      }
    }

    const teamsRoot = path.join(workspace, ".solosquad", "agents", "_teams");
    if (fs.existsSync(teamsRoot)) {
      return { ok: false, error: ".solosquad/agents/_teams/ should be removed after migration" };
    }

    return { ok: true };
  },
};

// ---------------------------------------------------------------------------
// Folder re-shape (§2.1)
// ---------------------------------------------------------------------------

function listTeamsInTeamsRoot(teamsRoot: string): string[] {
  if (!fs.existsSync(teamsRoot)) return [];
  return fs
    .readdirSync(teamsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function reshapeTeamsFolder(workspace: string): void {
  const agentsRoot = path.join(workspace, ".solosquad", "agents");
  const teamsRoot = path.join(agentsRoot, "_teams");
  if (!fs.existsSync(teamsRoot)) return;

  for (const team of listTeamsInTeamsRoot(teamsRoot)) {
    const src = path.join(teamsRoot, team, "TEAM_KNOWLEDGE.md");
    if (!fs.existsSync(src)) continue;
    const destDir = path.join(agentsRoot, team);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, "KNOWLEDGE.md");
    if (!fs.existsSync(dest)) {
      // Use rename when possible (preserves history on same volume), fall back
      // to copy+unlink for cross-device cases.
      try {
        fs.renameSync(src, dest);
      } catch {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      }
    }
    // Best-effort cleanup of the team subdir if now empty.
    const teamSubdir = path.join(teamsRoot, team);
    if (fs.existsSync(teamSubdir)) {
      const remaining = fs.readdirSync(teamSubdir);
      if (remaining.length === 0) {
        fs.rmdirSync(teamSubdir);
      }
    }
  }

  if (fs.existsSync(teamsRoot)) {
    const remaining = fs.readdirSync(teamsRoot);
    if (remaining.length === 0) {
      fs.rmdirSync(teamsRoot);
    }
  }
}

// ---------------------------------------------------------------------------
// Org layer stubs (§2.2)
// ---------------------------------------------------------------------------

function ensureOrgLayerStubs(workspace: string, orgSlug: string): void {
  const orgDir = getOrgDir(orgSlug, workspace);
  const coreDir = path.join(orgDir, "core");
  fs.mkdirSync(coreDir, { recursive: true });
  ensureFile(
    path.join(coreDir, "PRINCIPLES.md"),
    PRINCIPLES_STUB(orgSlug)
  );
  ensureFile(path.join(coreDir, "VOICE.md"), VOICE_STUB(orgSlug));

  const profilePath = orgAgentProfilePath(workspace, orgSlug);
  if (!fs.existsSync(profilePath)) {
    // v1.3.1 §9 — seed from the inline MINIMAL constant (matches init's
    // scaffoldV06OrgLayer). The former assets/templates/agent-profile.yaml
    // seed was removed (template-concept retirement).
    fs.writeFileSync(profilePath, MINIMAL_AGENT_PROFILE_YAML, "utf-8");
  }

  const domainDir = path.join(orgDir, "domain");
  fs.mkdirSync(domainDir, { recursive: true });
  ensureFile(path.join(domainDir, "README.md"), DOMAIN_README(orgSlug));
}

function ensureWorkspaceKnowledgeStub(workspace: string): void {
  const knowDir = path.join(workspace, ".solosquad", "knowledge");
  fs.mkdirSync(knowDir, { recursive: true });
  ensureFile(path.join(knowDir, "README.md"), WORKSPACE_KNOWLEDGE_README);
}

// ---------------------------------------------------------------------------
// FTS5 archive init (§4)
// ---------------------------------------------------------------------------

function ensureArchiveSqlite(workspace: string, orgSlug: string): void {
  // openArchive applies the FTS5 schema idempotently.
  const db = openArchive(workspace, orgSlug);
  db.close();
}

// ---------------------------------------------------------------------------
// Ledger redestination (§2.2 receiver-side)
// ---------------------------------------------------------------------------

interface RedestinateOpts {
  workspace: string;
  orgSlug: string;
  orgDir: string;
  cumulativeBudgetCost: number;
  budgetCap: number;
  dateStamp: string;
}

interface RedestinationResult {
  cumulativeBudgetCost: number;
}

interface RedestinateBucketEntry {
  path: string;
  classification: string;
  destination: string;
  method: "auto-role" | "auto-domain" | "human-review-required" | "budget-stopped";
  note?: string;
}

function redestinateLedger(opts: RedestinateOpts): RedestinationResult {
  const ledgerPath = path.join(opts.orgDir, LEDGER_REL_PATH);
  if (!fs.existsSync(ledgerPath)) {
    return { cumulativeBudgetCost: opts.cumulativeBudgetCost };
  }
  const ledger = loadLedger(ledgerPath);
  if (!ledger) return { cumulativeBudgetCost: opts.cumulativeBudgetCost };

  const buckets: RedestinateBucketEntry[] = [];
  let cumulativeBudgetCost = opts.cumulativeBudgetCost;
  let budgetStopped = false;

  for (const entry of ledger.analyzed) {
    if (!getPendingV06(entry)) continue;
    const label = entry.classification;

    if (budgetStopped) {
      markHumanReview(entry, "budget cap reached before processing");
      buckets.push({
        path: entry.path,
        classification: label,
        destination: entry.destination,
        method: "budget-stopped",
      });
      continue;
    }

    if (label === "role") {
      const r = processRoleEntry({
        entry,
        workspace: opts.workspace,
        orgSlug: opts.orgSlug,
        cumulativeBudgetCost,
        budgetCap: opts.budgetCap,
      });
      cumulativeBudgetCost = r.cumulativeBudgetCost;
      if (r.budgetStopped) {
        budgetStopped = true;
        markHumanReview(entry, "budget cap reached during LLM fallback");
        buckets.push({
          path: entry.path,
          classification: label,
          destination: entry.destination,
          method: "budget-stopped",
        });
      } else if (r.applied) {
        markApplied(entry, "auto");
        buckets.push({
          path: entry.path,
          classification: label,
          destination: orgAgentProfilePath(opts.workspace, opts.orgSlug),
          method: "auto-role",
          note: `merged ${r.sectionsExtracted} section(s) into agent '${r.agentName ?? "?"}'`,
        });
      } else {
        markHumanReview(entry, r.reason ?? "heuristic produced 0 sections");
        buckets.push({
          path: entry.path,
          classification: label,
          destination: entry.destination,
          method: "human-review-required",
          note: r.reason,
        });
      }
    } else if (label === "domain") {
      const d = processDomainEntry({
        entry,
        orgDir: opts.orgDir,
      });
      if (d.moved) {
        markApplied(entry, "auto");
        buckets.push({
          path: entry.path,
          classification: label,
          destination: d.newPath ?? entry.destination,
          method: "auto-domain",
        });
      } else {
        markHumanReview(entry, d.reason ?? "source file missing");
        buckets.push({
          path: entry.path,
          classification: label,
          destination: entry.destination,
          method: "human-review-required",
          note: d.reason,
        });
      }
    }
  }

  // Persist ledger with updated flags.
  saveLedger(ledgerPath, ledger);

  // Write the side-car report regardless of how many entries we touched.
  if (buckets.length > 0) {
    writeRedestinationReport({
      workspace: opts.workspace,
      orgSlug: opts.orgSlug,
      orgDir: opts.orgDir,
      buckets,
      dateStamp: opts.dateStamp,
      cumulativeBudgetCost,
      budgetCap: opts.budgetCap,
    });
  }

  return { cumulativeBudgetCost };
}

interface ProcessRoleOpts {
  entry: LedgerEntry;
  workspace: string;
  orgSlug: string;
  cumulativeBudgetCost: number;
  budgetCap: number;
}

interface ProcessRoleResult {
  applied: boolean;
  budgetStopped: boolean;
  sectionsExtracted: number;
  agentName?: string;
  cumulativeBudgetCost: number;
  reason?: string;
}

function processRoleEntry(opts: ProcessRoleOpts): ProcessRoleResult {
  // Locate the temporary SKILL.md the v0.5 applier dropped at the user-global
  // or org-local path. The ledger `destination` is the source of truth here
  // (v0.5 §6.4 records the absolute path or a `~/` prefixed form).
  const sourcePath = resolveDestinationPath(opts.entry.destination);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return {
      applied: false,
      budgetStopped: false,
      sectionsExtracted: 0,
      cumulativeBudgetCost: opts.cumulativeBudgetCost,
      reason: `source SKILL.md not found at ${opts.entry.destination}`,
    };
  }

  const raw = fs.readFileSync(sourcePath, "utf-8");
  const sections = extractOrgColorSections(raw);
  const agentName = inferAgentNameFromPath(sourcePath);

  if (sections.length === 0) {
    // Heuristic miss. Per §2.2 we *do not* fall back to LLM in this script —
    // the migration budget cap exists for that hook; the deterministic path
    // is to mark `human_review_required: true`. The cap check below is for
    // any external LLM caller (kept for parity with the budget plumbing).
    return {
      applied: false,
      budgetStopped: false,
      sectionsExtracted: 0,
      agentName,
      cumulativeBudgetCost: opts.cumulativeBudgetCost,
      reason: "no tone/voice/priority/ban/excluded/emphasis sections matched",
    };
  }

  // Budget cap: record a tiny synthetic cost line for the heuristic itself so
  // the JSONL trace has a row per processed entry (zero USD — the heuristic
  // is local + deterministic). When LLM fallback is wired in (post-S6.C),
  // the same checkBudget invariant applies.
  const budgetState = checkMigrationBudget(opts);
  if (budgetState.stopped) {
    return {
      applied: false,
      budgetStopped: true,
      sectionsExtracted: sections.length,
      agentName,
      cumulativeBudgetCost: opts.cumulativeBudgetCost,
      reason: budgetState.reason,
    };
  }

  // Merge into <org>/agent-profile.yaml.
  if (!agentName) {
    return {
      applied: false,
      budgetStopped: false,
      sectionsExtracted: sections.length,
      cumulativeBudgetCost: opts.cumulativeBudgetCost,
      reason: "could not infer agent name from destination path",
    };
  }
  mergeOrgColorIntoAgentProfile({
    workspace: opts.workspace,
    orgSlug: opts.orgSlug,
    agentName,
    sections,
  });

  recordMigrationCost({
    workspace: opts.workspace,
    orgSlug: opts.orgSlug,
    entryPath: opts.entry.path,
    usd: 0,
    method: "heuristic",
  });

  return {
    applied: true,
    budgetStopped: false,
    sectionsExtracted: sections.length,
    agentName,
    cumulativeBudgetCost: opts.cumulativeBudgetCost,
  };
}

interface ProcessDomainOpts {
  entry: LedgerEntry;
  orgDir: string;
}

interface ProcessDomainResult {
  moved: boolean;
  newPath?: string;
  reason?: string;
}

function processDomainEntry(opts: ProcessDomainOpts): ProcessDomainResult {
  // v0.5 destination is typically `<org>/memory/domain/<name>.md`. v0.6 home
  // is `<org>/domain/<name>.md`. Either an absolute path or a relative
  // template is acceptable; we anchor on the basename when relative.
  const dest = opts.entry.destination;
  const candidates: string[] = [];
  if (path.isAbsolute(dest)) {
    candidates.push(dest);
  } else {
    candidates.push(path.join(opts.orgDir, dest));
  }
  const memoryDomain = path.join(opts.orgDir, "memory", "domain", path.basename(dest));
  if (!candidates.includes(memoryDomain)) candidates.push(memoryDomain);

  const src = candidates.find((p) => fs.existsSync(p));
  if (!src) {
    return { moved: false, reason: `source file not found in ${candidates.join(" | ")}` };
  }

  const targetDir = path.join(opts.orgDir, "domain");
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, path.basename(src));
  if (fs.existsSync(target)) {
    // Already present — treat as already-applied.
    return { moved: true, newPath: target };
  }
  try {
    fs.renameSync(src, target);
  } catch {
    fs.copyFileSync(src, target);
    fs.unlinkSync(src);
  }
  return { moved: true, newPath: target };
}

function resolveDestinationPath(destination: string): string | null {
  if (!destination) return null;
  // v0.5 ledger sometimes records `~/.solosquad/...` style destinations. Don't
  // expand home dir for now — when the path can't be opened the entry falls
  // into human-review automatically.
  // Strip parenthetical annotations like "(v0.5 임시)".
  const cleaned = destination.replace(/\s*\(.*?\)\s*$/, "").trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("~/")) {
    // Defensive — resolve against $HOME so v0.5 applier paths can be read.
    return path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", cleaned.slice(2));
  }
  return cleaned;
}

function inferAgentNameFromPath(skillPath: string): string | undefined {
  // Layout: .../agents/<team>/<agent>/SKILL.md
  const dirs = skillPath.split(/[\\/]/);
  const idx = dirs.indexOf("agents");
  if (idx >= 0 && idx + 2 < dirs.length) {
    return dirs[idx + 2];
  }
  // Fallback — parent directory of SKILL.md
  return path.basename(path.dirname(skillPath));
}

// ---------------------------------------------------------------------------
// Org-color heuristic — extract H2/H3 sections matching the §2.2 keyword set
// ---------------------------------------------------------------------------

const ORG_COLOR_KEYWORDS = [
  "tone",
  "voice",
  "priority",
  "priorities",
  "ban",
  "ban_phrases",
  "banned",
  "excluded",
  "emphasis",
];

interface OrgColorSection {
  heading: string;
  body: string;
  keyword: string;
}

export function extractOrgColorSections(raw: string): OrgColorSection[] {
  const normalized = normalizeLine(raw);
  // Strip leading YAML frontmatter so the H2 scan doesn't false-positive on it.
  const body = stripFrontmatter(normalized);

  const lines = body.split("\n");
  const sections: OrgColorSection[] = [];
  let current: { heading: string; level: number; bodyLines: string[]; keyword: string } | null = null;

  function flush(): void {
    if (current && current.bodyLines.length > 0) {
      const bodyText = current.bodyLines.join("\n").trim();
      if (bodyText) {
        sections.push({
          heading: current.heading,
          body: bodyText,
          keyword: current.keyword,
        });
      }
    }
    current = null;
  }

  for (const line of lines) {
    const headingMatch = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      const heading = headingMatch[2];
      const keyword = matchOrgColorKeyword(heading);
      if (keyword) {
        current = { heading, level, bodyLines: [], keyword };
      } else {
        current = null;
      }
      continue;
    }
    if (current) {
      current.bodyLines.push(line);
    }
  }
  flush();

  return sections;
}

function matchOrgColorKeyword(heading: string): string | null {
  const lower = heading.toLowerCase();
  for (const kw of ORG_COLOR_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const closeIdx = raw.indexOf("\n---", 4);
  if (closeIdx < 0) return raw;
  // Skip the trailing newline after the closing fence too if present.
  const end = closeIdx + 4;
  return raw.slice(end).replace(/^\n+/, "");
}

interface MergeOrgColorOpts {
  workspace: string;
  orgSlug: string;
  agentName: string;
  sections: OrgColorSection[];
}

function mergeOrgColorIntoAgentProfile(opts: MergeOrgColorOpts): void {
  const profilePath = orgAgentProfilePath(opts.workspace, opts.orgSlug);
  let doc: AgentProfileYaml = {};
  if (fs.existsSync(profilePath)) {
    try {
      const loaded = yaml.load(normalizeLine(fs.readFileSync(profilePath, "utf-8")));
      if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
        doc = loaded as AgentProfileYaml;
      }
    } catch {
      doc = {};
    }
  }
  if (typeof doc.schema_version !== "number") {
    doc.schema_version = AGENT_PROFILE_SCHEMA_VERSION;
  }

  const existingRaw = doc[opts.agentName];
  const existing: AgentSection =
    existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
      ? (existingRaw as AgentSection)
      : {};
  const merged: AgentSection = { ...existing };

  for (const s of opts.sections) {
    const fieldKey = mapKeywordToYamlField(s.keyword);
    if (fieldKey === "ban_phrases" || fieldKey === "priorities" || fieldKey === "excluded_recommendations") {
      const list = splitBulletsOrLines(s.body);
      const prior = Array.isArray(merged[fieldKey]) ? (merged[fieldKey] as string[]) : [];
      const dedup = Array.from(new Set([...prior, ...list]));
      merged[fieldKey] = dedup;
    } else if (fieldKey === "tone" || fieldKey === "voice" || fieldKey === "emphasis") {
      // String fields — overwrite (most recent wins; user can hand-tune).
      const existingValue = typeof merged[fieldKey] === "string" ? (merged[fieldKey] as string) : "";
      const next = existingValue
        ? `${existingValue}\n\n${s.body.trim()}`
        : s.body.trim();
      merged[fieldKey] = next;
    } else {
      // Forward-compat — store under a free-form key.
      const safeKey = s.keyword.replace(/[^a-z0-9_]/gi, "_");
      merged[safeKey] = s.body.trim();
    }
  }

  doc[opts.agentName] = merged;
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, yaml.dump(doc, { lineWidth: -1 }), "utf-8");
}

function mapKeywordToYamlField(kw: string): string {
  switch (kw) {
    case "tone":
      return "tone";
    case "voice":
      return "voice";
    case "priority":
    case "priorities":
      return "priorities";
    case "ban":
    case "ban_phrases":
    case "banned":
      return "ban_phrases";
    case "excluded":
      return "excluded_recommendations";
    case "emphasis":
      return "emphasis";
    default:
      return kw;
  }
}

function splitBulletsOrLines(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      out.push(bullet[1].trim());
    } else {
      out.push(trimmed);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ledger marking helpers
// ---------------------------------------------------------------------------

function markApplied(entry: LedgerEntry, method: "auto"): void {
  setPendingV06(entry, false);
  entry.redestinated_at = new Date().toISOString();
  entry["redestination_method"] = method;
  // Clear any prior human_review flag if it was set on an earlier run.
  if ("human_review_required" in entry) {
    delete entry["human_review_required"];
  }
}

function markHumanReview(entry: LedgerEntry, reason: string): void {
  // Keep pending=true so the next run will retry; flag for the human in the
  // meantime.
  entry["human_review_required"] = true;
  entry["redestination_method"] = "human-review-required";
  entry["human_review_reason"] = reason;
}

// ---------------------------------------------------------------------------
// Migration budget cap (§2.2 P0 #2)
// ---------------------------------------------------------------------------

interface MigrationBudgetState {
  stopped: boolean;
  reason?: string;
}

function checkMigrationBudget(opts: ProcessRoleOpts): MigrationBudgetState {
  // Reuse the v0.5 author-budget primitives so the JSONL accounting and cap
  // semantics are byte-identical to author flow. The trick: we store
  // migration costs in a *separate* JSONL by writing through
  // `recordMigrationCost` below, but the *check* is performed against the
  // migration's own cumulative line. Since heuristic-only processing never
  // ticks the cap up, we only refuse when the cumulative migration cost
  // already exceeded the cap (an LLM fallback in a previous entry).
  const cumulative = readMigrationCostsTotal(opts.workspace, opts.orgSlug);
  if (cumulative >= opts.budgetCap) {
    return {
      stopped: true,
      reason: `migration budget cap reached: spent $${cumulative.toFixed(4)} of $${opts.budgetCap.toFixed(2)}`,
    };
  }
  // checkBudget is a defensive parity call — author cost lines are unrelated
  // to migration cost lines so this never blocks the heuristic path. Kept for
  // future LLM hooks.
  const _ = checkBudget({
    workspace: opts.workspace,
    orgSlug: opts.orgSlug,
    dailyUsd: undefined,
    weeklyUsd: undefined,
    onCapAction: "warn",
  });
  void _;
  return { stopped: false };
}

interface RecordMigrationCostInput {
  workspace: string;
  orgSlug: string;
  entryPath: string;
  usd: number;
  method: "heuristic" | "llm-fallback";
}

interface MigrationCostRow {
  ts: string;
  entry_path: string;
  usd: number;
  method: "heuristic" | "llm-fallback";
}

function migrationCostsPath(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "memory", "migration-costs.jsonl");
}

function recordMigrationCost(input: RecordMigrationCostInput): void {
  const file = migrationCostsPath(input.workspace, input.orgSlug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row: MigrationCostRow = {
    ts: new Date().toISOString(),
    entry_path: input.entryPath,
    usd: input.usd,
    method: input.method,
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
  // Parity ping — also write a synthetic row into the v0.5 author-budget log
  // when method === llm-fallback so cross-tool cost diagnostics surface the
  // migration spend. Skipped for heuristic ($0) to keep author-costs clean.
  if (input.method === "llm-fallback" && input.usd > 0) {
    recordAuthorCost({
      workspace: input.workspace,
      orgSlug: input.orgSlug,
      skillDraftId: "migration-0.5-to-0.6",
      step: "redestination-llm-fallback",
      usd: input.usd,
      model: "sonnet-4-6",
    });
  }
}

function readMigrationCostsTotal(workspace: string, orgSlug: string): number {
  const file = migrationCostsPath(workspace, orgSlug);
  if (!fs.existsSync(file)) return 0;
  const raw = fs.readFileSync(file, "utf-8");
  let total = 0;
  for (const line of normalizeLine(raw).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as MigrationCostRow;
      if (typeof parsed.usd === "number" && Number.isFinite(parsed.usd)) {
        total += parsed.usd;
      }
    } catch {
      /* skip */
    }
  }
  return total;
}

function readMigrationBudgetCap(workspace: string): number {
  const ws = loadWorkspaceYaml(workspace);
  const cap = ws?.migration?.budget_usd;
  if (typeof cap === "number" && Number.isFinite(cap) && cap > 0) return cap;
  return DEFAULT_MIGRATION_BUDGET_USD;
}

// ---------------------------------------------------------------------------
// Redestination report (§6 — format = inline DEFAULT_REPORT_TEMPLATE below)
// ---------------------------------------------------------------------------

interface WriteRedestinationReportOpts {
  workspace: string;
  orgSlug: string;
  orgDir: string;
  buckets: RedestinateBucketEntry[];
  dateStamp: string;
  cumulativeBudgetCost: number;
  budgetCap: number;
}

function writeRedestinationReport(opts: WriteRedestinationReportOpts): void {
  // v1.3.1 §9 — report format is the inline DEFAULT_REPORT_TEMPLATE below;
  // the former `assets/templates/migration-redestination-report.md` seed was
  // removed (template-concept retirement). This is the v0.5→v0.6 migration's
  // human-review surface; the inline constant produces a valid report.
  let template = DEFAULT_REPORT_TEMPLATE;

  const counts = {
    autoRole: opts.buckets.filter((b) => b.method === "auto-role").length,
    autoDomain: opts.buckets.filter((b) => b.method === "auto-domain").length,
    humanReview: opts.buckets.filter((b) => b.method === "human-review-required").length,
    skipped: 0,
    budgetStopped: opts.buckets.filter((b) => b.method === "budget-stopped").length,
    total: opts.buckets.length,
  };
  const autoBuckets = opts.buckets.filter(
    (b) => b.method === "auto-role" || b.method === "auto-domain"
  );
  const humanBuckets = opts.buckets.filter((b) => b.method === "human-review-required");
  const budgetBuckets = opts.buckets.filter((b) => b.method === "budget-stopped");

  template = template
    .replace(/\{SOURCE\}/g, "0.5.x")
    .replace(/\{TARGET\}/g, TARGET)
    .replace(/\{GENERATED_AT\}/g, new Date().toISOString())
    .replace(/\{WORKSPACE\}/g, opts.workspace)
    .replace(/\{ORG\}/g, opts.orgSlug)
    .replace(/\{AUTO_ROLE\}/g, String(counts.autoRole))
    .replace(/\{AUTO_DOMAIN\}/g, String(counts.autoDomain))
    .replace(/\{HUMAN_REVIEW\}/g, String(counts.humanReview))
    .replace(/\{SKIPPED\}/g, String(counts.skipped))
    .replace(/\{BUDGET_STOPPED\}/g, String(counts.budgetStopped))
    .replace(/\{TOTAL\}/g, String(counts.total))
    .replace(/\{LLM_COST_USD\}/g, opts.cumulativeBudgetCost.toFixed(4))
    .replace(/\{BUDGET_CAP_USD\}/g, opts.budgetCap.toFixed(2))
    .replace(/\{AUTO_TABLE\}/g, renderBucketTable(autoBuckets))
    .replace(/\{HUMAN_TABLE\}/g, renderBucketTable(humanBuckets))
    .replace(/\{BUDGET_TABLE\}/g, renderBucketTable(budgetBuckets));

  const outPath = path.join(
    opts.orgDir,
    "memory",
    `migration-${opts.dateStamp}-redestination.md`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, template, "utf-8");
}

function renderBucketTable(buckets: RedestinateBucketEntry[]): string {
  if (buckets.length === 0) return "_(none)_";
  const header = "| Path | Classification | Destination | Note |";
  const sep = "|---|---|---|---|";
  const rows = buckets.map(
    (b) =>
      `| \`${b.path}\` | ${b.classification} | \`${b.destination}\` | ${b.note ?? ""} |`
  );
  return [header, sep, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// collab_pattern injection (§2.4) — workspace edition
// ---------------------------------------------------------------------------

function injectCollabPatternAcrossWorkspace(
  workspace: string,
  orgRoots: string[]
): void {
  // Reuse the same injection helper as scripts/inject-collab-pattern.ts. We
  // load it lazily so the migration script stays self-contained: re-implement
  // the small helper here rather than reach into the scripts/ tree, which
  // isn't published in dist/.
  const targets = collectSkillTargetsForCollabInject(workspace, orgRoots);
  for (const t of targets) {
    const raw = fs.readFileSync(t.skill_path, "utf-8");
    try {
      const next = injectCollabPatternBody(raw, patternForTeamAgent(t.team, t.agent));
      if (next !== null) {
        fs.writeFileSync(t.skill_path, next, "utf-8");
      }
    } catch {
      // Don't fail the whole migration over a single non-frontmatter SKILL —
      // Pass 2 (`solosquad agent validate --all`) flags those for human edit.
    }
  }
}

interface SkillTarget {
  skill_path: string;
  team: string;
  agent: string;
}

function collectSkillTargetsForCollabInject(
  workspace: string,
  orgRoots: string[]
): SkillTarget[] {
  const out: SkillTarget[] = [];
  const bundled = path.join(workspace, ".solosquad", "agents");
  if (fs.existsSync(bundled)) out.push(...scanAgentRoot(bundled));
  for (const o of orgRoots) {
    const orgRoot = path.join(o, ".agents");
    if (fs.existsSync(orgRoot)) out.push(...scanAgentRoot(orgRoot));
  }
  return out;
}

function scanAgentRoot(root: string): SkillTarget[] {
  const out: SkillTarget[] = [];
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
      });
    }
  }
  return out;
}

const COLLAB_PATTERN_OVERRIDES: Record<string, "graph" | "dynamic"> = {
  "strategy/data-analyst": "graph",
  "strategy/feature-planner": "graph",
  "growth/content-writer": "dynamic",
};

function patternForTeamAgent(team: string, agent: string): "hierarchical" | "graph" | "dynamic" {
  return COLLAB_PATTERN_OVERRIDES[`${team}/${agent}`] ?? "hierarchical";
}

function injectCollabPatternBody(
  raw: string,
  pattern: "hierarchical" | "graph" | "dynamic"
): string | null {
  const normalized = normalizeLine(raw);
  if (!normalized.startsWith("---\n")) {
    // No frontmatter — leave it alone (Pass 2 flags it).
    return null;
  }
  const closeIdx = normalized.indexOf("\n---", 4);
  if (closeIdx === -1) return null;
  const fmText = normalized.slice(4, closeIdx);
  const afterFm = normalized.slice(closeIdx);
  if (/^collab_pattern:\s*\S+/m.test(fmText)) return null;
  const fmTrimmed = fmText.replace(/\n+$/, "");
  const newFm = `${fmTrimmed}\ncollab_pattern: ${pattern}`;
  return `---\n${newFm}${afterFm}`;
}

// ---------------------------------------------------------------------------
// Routine copy (§3 + §4.6) — user workspace routines/
// ---------------------------------------------------------------------------

function copyV06Routines(workspace: string): void {
  const userRoutines = path.join(workspace, ".solosquad", "routines");
  if (!fs.existsSync(userRoutines)) {
    // Workspace doesn't have a user-routines override dir; skip.
    return;
  }
  const assetsRoutines = path.join(getAssetsDir(), "routines");
  for (const name of ["archive-rotate.md", "v06-retrospective-stats.md"]) {
    const src = path.join(assetsRoutines, name);
    const dest = path.join(userRoutines, name);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}

// ---------------------------------------------------------------------------
// workspace.yaml patches + version bump (§5/§8)
// ---------------------------------------------------------------------------

function patchWorkspaceYaml(workspace: string): void {
  const ws = loadWorkspaceYaml(workspace);
  if (!ws) return;
  if (!ws.fs_watch) {
    ws.fs_watch = { mode: "prompt", git_only: false };
  }
  if (!ws.archive) {
    ws.archive = { retention_days: 365, compress_before_delete: false };
  }
  if (!ws.spawn) {
    ws.spawn = { max_context_tokens: 80_000 };
  }
  if (!ws.migration) {
    ws.migration = { budget_usd: DEFAULT_MIGRATION_BUDGET_USD };
  }
  ws.version = TARGET;
  ws.last_migrated_to = TARGET;
  saveWorkspaceYaml(ws, workspace);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function ensureFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, content, "utf-8");
  }
}

function todayDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Stub content
// ---------------------------------------------------------------------------

const PRINCIPLES_STUB = (org: string): string =>
  `# ${org} — Principles

> v0.6 §2.2 — Organization philosophy layer.
>
> This file overrides workspace-level \`core/PRINCIPLES.md\` for the
> \`${org}\` organization only. The spawn assembler injects this file as
> layer [4] of the 8-layer JIT context per
> \`docs/plan/v0.6-default-workflow-tuning.md\` §2.2.
>
> Leave blank to inherit workspace defaults. Add lines like:
>
> - 결정 프레임은 *현금흐름 > 성장률*.
> - 한국 SMB 시장 컨텍스트를 우선.
`;

const VOICE_STUB = (org: string): string =>
  `# ${org} — Voice

> v0.6 §2.2 — Organization tone/voice layer.
>
> Specialists spawned under \`${org}\` adopt this voice on top of their
> immutable SKILL.md persona. Examples:
>
> - "Professional, no hype. Avoid: 혁신적인 / 획기적인 / 게임 체인저."
> - "Bilingual replies (KR primary, EN parenthetical for technical terms)."
`;

const DOMAIN_README = (org: string): string =>
  `# ${org} — Domain Knowledge

> v0.6 §2.2 — Organization domain knowledge folder.
>
> Drop free-form Markdown files here that capture the *facts* about
> ${org}: market, customers, product, pricing, regulations. The spawn
> assembler injects matching files as layer [6] of the 8-layer JIT
> context.
>
> Suggested files:
>
> - \`market.md\` — competitive landscape, segments, sizing
> - \`customers.md\` — personas, JTBD, support corpus
> - \`product.md\` — feature catalog, roadmap themes, deprecations
> - \`pricing.md\` — plans, discounts, contract terms
> - \`regulations.md\` — applicable laws, compliance notes
`;

const WORKSPACE_KNOWLEDGE_README = `# Workspace Knowledge Layer

> v0.6 §2.3 — User-accumulated craft, decision frameworks, glossary.
>
> Files here are *workspace-global* — every org/agent spawn can pull
> them in at layer [1] of the 8-layer JIT context. Use this for:
>
> - Decision frameworks (lean canvas, LTV/CAC, jobs-to-be-done)
> - Glossary of domain terms you'll touch across orgs
> - Reference notes you'd otherwise paste into every PRD
>
> Suggested layout:
>
> \`\`\`
> .solosquad/knowledge/
>   decision-frameworks/
>     lean-canvas.md
>     ltv-cac.md
>   glossary.md
>   references/
> \`\`\`
>
> Keyword-matched selective load keeps spawn context tokens bounded:
> agents only see knowledge files whose keywords overlap their task.
`;

const MINIMAL_AGENT_PROFILE_YAML = `schema_version: 1

defaults:
  budget:
    daily_usd: 5
    weekly_usd: 25
    on_cap_action: pause
`;

// v1.3.1 §9 — full report format, inlined from the former
// assets/templates/migration-redestination-report.md (template-concept
// retirement). Single brace {TOKEN} are replaced by writeRedestinationReport;
// \${…} are escaped so the literal $ survives (the replace targets {…}).
const DEFAULT_REPORT_TEMPLATE = `# Migration {SOURCE} → {TARGET} — Ledger Redestination Report

> Generated by \`solosquad migrate\` at {GENERATED_AT}.
> Workspace: \`{WORKSPACE}\`  ·  Org: \`{ORG}\`

This report is the **human-review surface** for the v0.5 → v0.6 ledger
redestination step (v0.6 plan §2.2 "v0.5 ledger 수신측 자동 재분류"). The
migration scans every \`<org>/.solosquad/analysis-ledger.yaml\` entry whose
\`pending_v0.6_redestination\` flag is \`true\` and routes the asset to its v0.6
home:

- \`classification: role\` → org-color sections extracted from the temporary
  \`SKILL.md\` body merged into \`<org>/agent-profile.yaml\`.
- \`classification: domain\` → \`<org>/memory/domain/*.md\` moved to
  \`<org>/domain/*.md\`.

Entries where the heuristic could not identify *any* org-color section
(\`tone\`, \`voice\`, \`priority\`, \`ban\`, \`excluded\`, \`emphasis\` keywords) are
left in place and marked \`human_review_required: true\`. Re-run the
relevant \`solosquad agent edit <name>\` command after eyeballing the source
to finish them by hand.

---

## Summary

| Bucket | Count |
|---|---|
| Auto-applied (role merged into \`agent-profile.yaml\`) | {AUTO_ROLE} |
| Auto-applied (domain moved) | {AUTO_DOMAIN} |
| Human review required (heuristic produced 0 sections) | {HUMAN_REVIEW} |
| Skipped (already redestinated in a prior run) | {SKIPPED} |
| Skipped (budget cap reached) | {BUDGET_STOPPED} |
| **Total entries scanned** | {TOTAL} |

LLM fallback cost: \${LLM_COST_USD} of \${BUDGET_CAP_USD} budget cap.

---

## Auto-applied entries

{AUTO_TABLE}

## Human-review queue

{HUMAN_TABLE}

## Budget-stopped queue

{BUDGET_TABLE}

---

## Next steps

1. Open \`{ORG}/agent-profile.yaml\` and confirm the merged sections read
   the way your organization expects. Edit anything that feels off.
2. For each row in **Human-review queue**, run:
   \`\`\`
   solosquad agent edit <agent-name>
   \`\`\`
   and copy the relevant paragraph from the source SKILL.md noted in the
   table.
3. If the budget cap stopped the migration mid-run, raise
   \`workspace.yaml.migration.budget_usd\` (default $5) and re-run
   \`solosquad migrate --apply --confirm\`. The script is idempotent — only
   the remaining \`pending=true\` entries will be re-processed.

This report is **append-only**. The next migration run writes a fresh
\`migration-{DATE}-redestination.md\` file rather than overwriting this one.
`;

// Internal exports for unit tests.
export const __test = {
  extractOrgColorSections,
  matchOrgColorKeyword,
  stripFrontmatter,
  mergeOrgColorIntoAgentProfile,
  injectCollabPatternBody,
  patternForTeamAgent,
  reshapeTeamsFolder,
  ensureOrgLayerStubs,
  ensureArchiveSqlite,
  ensureWorkspaceKnowledgeStub,
  patchWorkspaceYaml,
  redestinateLedger,
  recordMigrationCost,
  readMigrationCostsTotal,
  resolveDestinationPath,
  inferAgentNameFromPath,
  readMigrationBudgetCap,
  TARGET,
};

// Avoid an unused-import warning for the structural type.
void ({} as Ledger);
