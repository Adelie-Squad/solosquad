import fs from "fs";
import path from "path";
import yaml from "js-yaml";
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

/**
 * Pick the default repo slug for *scheduler-driven* cwd resolution
 * (morning brief / signal scan / weekly review — routines that run
 * without user intent and need *some* cwd).
 *
 * v1.0.1: `role=main` lookup removed. Scheduler routines are org-level
 * by nature (briefings + signal scans + weekly reviews) so the choice
 * here is a tie-breaker, not an intent decision. User-driven routing
 * happens at PM level via @<slug> mention + PM SKILL.md clarifying
 * question (see `src/bot/mention-parser.ts`), never through this path.
 *
 * Returns first registered repo, or null if none registered.
 */
function pickDefaultRepoSlug(orgDir: string): string | null {
  const reposDir = path.join(orgDir, "repositories");
  if (!fs.existsSync(reposDir)) return null;
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    return entry.name;
  }
  return null;
}

/**
 * Resolve the cwd to use when spawning Claude for a *scheduler-driven*
 * routine in a given org (morning brief / signal scan / weekly review).
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
 * and `assets/orchestrator/SKILL.md`.
 */
export function resolveOrgCwd(orgDir: string): {
  cwd: string;
  reason: "workflow" | "first-repo" | "legacy-root";
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

  const firstSlug = pickDefaultRepoSlug(orgDir);
  if (firstSlug) {
    return {
      cwd: path.join(orgDir, "repositories", firstSlug),
      reason: "first-repo",
      repoSlug: firstSlug,
    };
  }

  return { cwd: orgDir, reason: "legacy-root" };
}
