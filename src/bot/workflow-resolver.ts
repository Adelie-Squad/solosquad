import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";
import { resolveRepoCwd } from "../util/paths.js";

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

/**
 * Pick the default repo slug for *scheduler-driven* cwd resolution
 * (morning brief / signal scan / weekly review — crons that run
 * without user intent and need *some* cwd).
 *
 * v1.0.1: `role=main` lookup removed. Scheduler crons are org-level
 * by nature (briefings + signal scans + weekly reviews) so the choice
 * here is a tie-breaker, not an intent decision. User-driven routing
 * happens at PM level via @<slug> mention + PM SKILL.md clarifying
 * question (see `src/bot/mention-parser.ts`), never through this path.
 *
 * Returns first registered repo, or null if none registered.
 *
 * v1.4.0 (S-1): recognises BOTH layouts — path-reference mode stores repos as
 * `repositories/<slug>.yaml` files (v0.9.1+ default), legacy tree mode as
 * `repositories/<slug>/` directories. Previously only directories were picked,
 * so external-path workspaces (the v1.0+ default) returned null → org-root.
 */
function pickDefaultRepoSlug(orgDir: string): string | null {
  const reposDir = path.join(orgDir, "repositories");
  if (!fs.existsSync(reposDir)) return null;
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    // path-reference mode (v0.9.1+): repositories/<slug>.yaml
    if (entry.isFile() && entry.name.endsWith(".yaml")) {
      return entry.name.slice(0, -".yaml".length);
    }
    // legacy tree mode: repositories/<slug>/
    if (entry.isDirectory()) return entry.name;
  }
  return null;
}

/**
 * Resolve the cwd to use when spawning Claude for a *scheduler-driven*
 * cron in a given org (morning brief / signal scan / weekly review).
 *
 * Priority:
 *   1. Active workflow stage's `target_repo` (if the corresponding folder exists)
 *   2. First registered repo (tie-breaker — pre-v1.0.1 used role=main)
 *   3. Org root itself (no repos registered yet, or legacy `.git` at org root)
 *
 * v1.0.1: User-driven routing does NOT flow through this function. PM
 * session cwd is fixed at org root and target_repo is decided inside
 * the spawn prompt — by `@<slug>` mention (mention-parser.ts), workflow
 * stage `target_repo`, or PM clarifying question. See `src/bot/index.ts`
 * and `agents/main/chief/SKILL.md`.
 */
export function resolveOrgCwd(orgDir: string): {
  cwd: string;
  reason: "workflow" | "first-repo" | "legacy-root";
  workflowId?: string;
  repoSlug?: string;
} {
  // v1.4.0 (S-1): route through resolveRepoCwd so external-path repos
  // (`repositories/<slug>.yaml` with a `path:` field, the v1.0+ default) are
  // resolved to their real absolute path. resolveRepoCwd returns the org root
  // as its fallback, so `cwd !== orgDir` means a real repo dir was resolved.
  const orgSlug = path.basename(orgDir);
  const workspace = path.dirname(orgDir);

  const active = resolveActiveStage(orgDir);
  if (active?.stage.target_repo) {
    const cwd = resolveRepoCwd(orgSlug, active.stage.target_repo, workspace);
    if (cwd !== orgDir) {
      return {
        cwd,
        reason: "workflow",
        workflowId: active.workflowId,
        repoSlug: active.stage.target_repo,
      };
    }
  }

  const firstSlug = pickDefaultRepoSlug(orgDir);
  if (firstSlug) {
    const cwd = resolveRepoCwd(orgSlug, firstSlug, workspace);
    if (cwd !== orgDir) {
      return { cwd, reason: "first-repo", repoSlug: firstSlug };
    }
  }

  return { cwd: orgDir, reason: "legacy-root" };
}
