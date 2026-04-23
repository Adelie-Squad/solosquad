import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { loadRepoYaml } from "../util/config.js";
import { normalizeLine } from "../util/platform.js";

export interface WorkflowStage {
  id: string;
  team?: string;
  agents?: string[];
  target_repo?: string;
  status?: "pending" | "in_progress" | "completed" | "needs_revision";
  depends_on?: string[];
  upstream_handoff?: string;
}

export interface StatusYaml {
  workflow_id: string;
  project?: string;
  created_at?: string;
  stages: WorkflowStage[];
}

/** List workflow subdirectories of an org (each dir has a `_status.yaml`). */
function listWorkflowDirs(orgDir: string): { id: string; dir: string; status: StatusYaml }[] {
  const workflowsRoot = path.join(orgDir, "workflows");
  if (!fs.existsSync(workflowsRoot)) return [];
  const out: { id: string; dir: string; status: StatusYaml }[] = [];
  for (const entry of fs.readdirSync(workflowsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(workflowsRoot, entry.name);
    const statusFile = path.join(dir, "_status.yaml");
    if (!fs.existsSync(statusFile)) continue;
    try {
      const doc = yaml.load(normalizeLine(fs.readFileSync(statusFile, "utf-8"))) as StatusYaml;
      if (doc && Array.isArray(doc.stages)) {
        out.push({ id: entry.name, dir, status: doc });
      }
    } catch {
      /* ignore malformed status files */
    }
  }
  return out;
}

/**
 * Find the first workflow in an org that has a stage currently in_progress
 * (or ready to run, i.e. pending with all deps completed). Returns the stage,
 * or null if none found.
 */
export function resolveActiveStage(orgDir: string): { workflowId: string; stage: WorkflowStage } | null {
  const workflows = listWorkflowDirs(orgDir);
  for (const w of workflows) {
    const inProgress = w.status.stages.find((s) => s.status === "in_progress");
    if (inProgress) return { workflowId: w.id, stage: inProgress };
  }
  for (const w of workflows) {
    const completed = new Set(
      w.status.stages.filter((s) => s.status === "completed").map((s) => s.id)
    );
    const ready = w.status.stages.find(
      (s) => s.status === "pending" && (s.depends_on ?? []).every((d) => completed.has(d))
    );
    if (ready) return { workflowId: w.id, stage: ready };
  }
  return null;
}

/** Pick the "main" repo slug from an org, or the first repo if none flagged main. */
function pickMainRepoSlug(orgDir: string): string | null {
  const reposDir = path.join(orgDir, "repositories");
  if (!fs.existsSync(reposDir)) return null;
  const candidates: { slug: string; role?: string }[] = [];
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const repoYaml = loadRepoYaml(path.join(reposDir, entry.name));
    candidates.push({ slug: entry.name, role: repoYaml?.role });
  }
  const main = candidates.find((c) => c.role === "main");
  if (main) return main.slug;
  return candidates[0]?.slug ?? null;
}

/**
 * Resolve the cwd to use when spawning Claude for a message in a given org.
 *
 * Priority:
 *   1. Active workflow stage's `target_repo` (if the corresponding folder exists)
 *   2. The org's "main" repo (role=main in repo.yaml), or first repo
 *   3. Org root itself (legacy: `.git` at org root, or no repos yet)
 */
export function resolveOrgCwd(orgDir: string): {
  cwd: string;
  reason: "workflow" | "main-repo" | "legacy-root";
  workflowId?: string;
  repoSlug?: string;
} {
  const active = resolveActiveStage(orgDir);
  if (active?.stage.target_repo) {
    const candidate = path.join(orgDir, "repositories", active.stage.target_repo);
    if (fs.existsSync(candidate)) {
      return {
        cwd: candidate,
        reason: "workflow",
        workflowId: active.workflowId,
        repoSlug: active.stage.target_repo,
      };
    }
  }

  const mainSlug = pickMainRepoSlug(orgDir);
  if (mainSlug) {
    return {
      cwd: path.join(orgDir, "repositories", mainSlug),
      reason: "main-repo",
      repoSlug: mainSlug,
    };
  }

  return { cwd: orgDir, reason: "legacy-root" };
}
