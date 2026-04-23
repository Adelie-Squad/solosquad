import fs from "fs";
import path from "path";
import { saveOrgYaml, saveRepoYaml, type OrgYaml, type RepoYaml } from "./config.js";
import { detectLanguage, getRemoteUrl, isGitRepo, slugFromUrl } from "./git.js";

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
}

/** Create `<workspace>/<slug>/` with .org.yaml + memory/workflows/repositories/<messenger>/ */
export function scaffoldOrg(input: ScaffoldOrgInput): { orgDir: string; orgYaml: OrgYaml } {
  const slug = input.slug ?? slugify(input.name);
  const orgDir = path.join(input.workspace, slug);
  fs.mkdirSync(path.join(orgDir, "memory", "routine-logs"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "workflows"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, "repositories"), { recursive: true });
  fs.mkdirSync(path.join(orgDir, input.messenger), { recursive: true });

  for (const [filename, body] of Object.entries(MEMORY_SCHEMAS)) {
    const p = path.join(orgDir, "memory", filename);
    if (!fs.existsSync(p)) fs.writeFileSync(p, body);
  }

  const orgYaml: OrgYaml = {
    name: input.name,
    slug,
    provider: input.provider,
    remote_url: input.remoteUrl || null,
    homepage: null,
    products: [],
    description: "",
    created_at: new Date().toISOString(),
  };
  saveOrgYaml(orgDir, orgYaml);
  return { orgDir, orgYaml };
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
