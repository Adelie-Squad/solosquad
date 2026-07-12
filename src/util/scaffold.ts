import fs from "fs";
import path from "path";
import { saveOrgYaml, saveRepoYaml, type OrgYaml, type RepoYaml } from "./config.js";
import { detectLanguage, getRemoteUrl, isGitRepo, slugFromUrl } from "./git.js";
import { getBundleRoot } from "./paths.js";
import { grantClaudeTrust } from "./claude-trust.js";

export const MEMORY_SCHEMAS: Record<string, string> = {
  "hypotheses.jsonl":
    '{"_schema":"hypothesis","fields":["id","statement","risk","method","status","date"]}\n',
  "experiments.jsonl":
    '{"_schema":"experiment","fields":["id","hypothesis_id","method","result","signal_strength","date","next_action"]}\n',
  "decisions.jsonl":
    '{"_schema":"decision","fields":["date","decision","alternatives","reasoning","emotion_weight"]}\n',
  "signals.jsonl":
    '{"_schema":"signal","fields":["date","source","type","content","relevance","action"]}\n',
};

/**
 * v1.1.0 §5 — Teams that ship with the bundle. Each gets OKR.md +
 * KNOWLEDGE.md + composition.yaml copied into `<org>/teams/<name>/`.
 * Kept in sync with `src/util/composition.ts:KNOWN_TEAMS`.
 */
export const SCAFFOLD_TEAMS = ["core", "product", "engineering", "business", "brand"] as const;

/**
 * Workflows seeded automatically on org creation. v1.3.7 §3.6 retired the
 * legacy templates (discovery-cycle, pmf-validation, autoplan-pm, weekly-retro)
 * and dissolved the monolithic `problem-definition` chain into selectable
 * problem-definition workflows (scqa/five-whys/tdcc; mece/xyz-hypothesis remain
 * skills). The full planning set is seeded so the two mains (new-build,
 * improvement) resolve their `_workflow/` sub-references out of the box.
 */
export const SCAFFOLD_WORKFLOWS = [
  "research",
  "new-build",
  "improvement",
  "idea-refinement",
  "requirements-analysis",
  "market-research",
  "hypothesis",
  "kpi-check",
  "data-analysis",
  "scqa",
  "five-whys",
  "tdcc",
] as const;

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export interface ScaffoldOrgInput {
  workspace: string;
  name: string;
  slug?: string;
  provider: OrgYaml["provider"];
  remoteUrl?: string | null;
  messenger: string;
  /**
   * v1.2 §4.1 — org-level Chief display name. When omitted, `.org.yaml`
   * is written without `chief_name` and runtime falls back to "Chief".
   */
  chiefName?: string;
}

/**
 * Create `<workspace>/<slug>/` with the full v1.1.0 + v1.2 layout:
 *   .org.yaml
 *   memory/{cron-logs,open-questions,ledger}/ + 4 schema JSONLs
 *   workflows/{new-build,improvement,…}/workflow.yaml  (v1.3.7 §3.6 planning set)
 *   repositories/
 *   <messenger>/
 *   agents/main/chief/SKILL.md                  (copied from bundle)
 *   teams/{product,engineering,design,marketing}/{OKR.md, KNOWLEDGE.md, composition.yaml}
 *   knowledge/
 *
 * All bundle-source seeds are idempotent — existing files are not
 * overwritten so re-running on a customized org is safe. Missing bundle
 * sources (rare — only happens in fresh dev checkouts before the v1.1
 * release files land) are silently skipped.
 */
export function scaffoldOrg(input: ScaffoldOrgInput): { orgDir: string; orgYaml: OrgYaml } {
  const slug = input.slug ?? slugify(input.name);
  const orgDir = path.join(input.workspace, slug);

  fs.mkdirSync(path.join(orgDir, "memory", "cron-logs"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "memory", "open-questions"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "memory", "ledger"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "workflows"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "repositories"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "knowledge"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "reports"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, input.messenger), { recursive: true });

  for (const [filename, body] of Object.entries(MEMORY_SCHEMAS)) {
    const p = path.join(orgDir, "memory", filename);
    if (!fs.existsSync(p)) fs.writeFileSync(p, body);
  }

  // v1.1.0 — Chief SKILL.md (org-customizable) + 5 team folders.
  const bundleRoot = getBundleRoot();
  copyBundleFile(
    path.join(bundleRoot, "agents", "main", "chief", "SKILL.md"),
    path.join(orgDir, "agents", "main", "chief", "SKILL.md"),
  );
  for (const team of SCAFFOLD_TEAMS) {
    for (const file of ["OKR.md", "KNOWLEDGE.md", "composition.yaml"]) {
      copyBundleFile(
        path.join(bundleRoot, "teams", team, file),
        path.join(orgDir, "teams", team, file),
      );
    }
  }

  // v1.3.7 §3.6 — seed the bundled planning workflow set (mains + sub-workflows)
  // so new-build/improvement resolve their `_workflow/` references in the org.
  for (const workflow of SCAFFOLD_WORKFLOWS) {
    copyBundleFile(
      path.join(
        bundleRoot,
        "skills",
        "workflow-manager",
        "assets",
        "workflows",
        workflow,
        "workflow.yaml",
      ),
      path.join(orgDir, "workflows", workflow, "workflow.yaml"),
    );
  }

  const orgYaml: OrgYaml = {
    name: input.name,
    slug,
    provider: input.provider,
    remote_url: input.remoteUrl || null,
    homepage: null,
    products: [],
    description: "",
    ...(input.chiefName ? { chief_name: input.chiefName } : {}),
    created_at: new Date().toISOString(),
  };
  saveOrgYaml(orgDir, orgYaml);

  // v1.2.4 §A.5 — pre-grant Claude Code's directory trust for the new
  // org cwd. chief-runner.invokeStreaming spawns `claude --print` with
  // cwd=<org>; without trust pre-granted, the first turn would block on
  // an interactive trust dialog the bot can't answer. Best-effort: a
  // missing ~/.claude.json (fresh Claude install) is logged and skipped.
  try {
    grantClaudeTrust(orgDir, { quiet: true });
  } catch {
    /* trust grant is best-effort — see src/util/claude-trust.ts */
  }

  return { orgDir, orgYaml };
}

/**
 * Copy a single bundle file into the org tree. Idempotent — never
 * overwrites an existing destination (user customizations are sacred).
 * Missing source paths are skipped silently so dev checkouts that haven't
 * built the bundle yet don't break scaffolding.
 */
function copyBundleFile(source: string, dest: string): void {
  if (fs.existsSync(dest)) return;
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

export interface ScaffoldRepoInput {
  orgDir: string;
  orgSlug: string;
  repoDir: string;
  name?: string;
  slug?: string;
  role?: RepoYaml["role"];
  notes?: string;
  products?: string[];
}

/**
 * Write `<repo>/.solosquad/repo.yaml`. Auto-derives slug/name from folder name
 * and remote_url/language from the repo when not provided.
 */
export function scaffoldRepoYaml(input: ScaffoldRepoInput): RepoYaml {
  const slug = input.slug ?? path.basename(input.repoDir);
  const name = input.name ?? slug;
  const remoteUrl = isGitRepo(input.repoDir) ? getRemoteUrl(input.repoDir) : null;
  const language = detectLanguage(input.repoDir);

  const doc: RepoYaml = {
    slug,
    name,
    role: input.role ?? "unknown",
    language,
    linked_org: input.orgSlug,
    remote_url: remoteUrl,
    products: input.products ?? [],
    notes: input.notes,
    registered_at: new Date().toISOString(),
  };
  saveRepoYaml(input.repoDir, doc);
  return doc;
}

/** Given a clone URL, derive a filesystem-safe slug. */
export function slugFromCloneUrl(url: string): string {
  return slugFromUrl(url);
}
