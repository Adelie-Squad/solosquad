import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getOrgDir, resolveRepoCwd } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { FileEventSink, workflowEventsPath, type AnyEvent } from "./events.js";

/**
 * v1.4.1 — reverse-lookup a Discord works-thread id → its workflow id, by
 * scanning each `<orgCwd>/workflows/<id>/discord-thread.txt` (key=value, written
 * by discord-task-card `persistThreadRef`). Returns null if no thread matches.
 *
 * A linear scan is fine for now — an org has few active workflows. A thread_id→
 * workflow index is a future optimisation (PRD v1.4.1 §결정 2).
 */
export function resolveWorkflowIdByThread(orgCwd: string, threadId: string): string | null {
  const wfRoot = path.join(orgCwd, "workflows");
  if (!fs.existsSync(wfRoot)) return null;
  for (const entry of fs.readdirSync(wfRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = path.join(wfRoot, entry.name, "discord-thread.txt");
    if (!fs.existsSync(file)) continue;
    try {
      for (const line of normalizeLine(fs.readFileSync(file, "utf-8")).split("\n")) {
        const m = line.match(/^thread_id=(.+)$/);
        if (m && m[1].trim() === threadId) return entry.name;
      }
    } catch {
      // skip unreadable discord-thread.txt
    }
  }
  return null;
}

/**
 * v0.3.0 — workspace metadata helper.
 *
 * Shared utilities used by:
 *   - workflow CLI (`solosquad workflow list / show`)
 *   - workflow-reconciler.ts (which workflows exist, what state)
 *   - PM SKILL.md (target_repo path resolution at spawn time)
 *
 * Phase B intentionally does NOT inject this into the PM prompt at
 * spawn time — PM is encouraged to read these files via its own
 * Read/Glob tools so the context stays small. workspace-meta just
 * exposes a typed read API for the CLIs.
 */

export interface StageSummary {
  id: string;
  status: string;
  agent?: string;
  target_repo?: string | null;
  depends_on?: string[];
}

export interface WorkflowSummary {
  workflowId: string;
  title?: string;
  orgSlug: string;
  path: string;
  createdAt?: string;
  stages: StageSummary[];
  /** Quick rollups computed from stages. */
  totalStages: number;
  completedStages: number;
  pendingStages: number;
  inProgressStages: number;
  needsRevisionStages: number;
  recentEventCount: number;
  lastEventTs?: string;
}

interface StatusYaml {
  workflow_id?: string;
  title?: string;
  created_at?: string;
  stages?: StageSummary[];
}

/** List every workflow directory under `<org>/workflows/`. */
export function listWorkflows(workspace: string, orgSlug: string): WorkflowSummary[] {
  const wfRoot = path.join(getOrgDir(orgSlug, workspace), "workflows");
  if (!fs.existsSync(wfRoot)) return [];

  const out: WorkflowSummary[] = [];
  for (const entry of fs.readdirSync(wfRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const summary = loadWorkflowSummary(workspace, orgSlug, entry.name);
    if (summary) out.push(summary);
  }
  // Newest first by createdAt (fallback: directory name lexical).
  out.sort((a, b) => {
    const aT = a.createdAt ?? a.workflowId;
    const bT = b.createdAt ?? b.workflowId;
    return bT.localeCompare(aT);
  });
  return out;
}

export function loadWorkflowSummary(
  workspace: string,
  orgSlug: string,
  workflowId: string
): WorkflowSummary | null {
  const wfPath = path.join(getOrgDir(orgSlug, workspace), "workflows", workflowId);
  if (!fs.existsSync(wfPath)) return null;

  const statusPath = path.join(wfPath, "_status.yaml");
  let doc: StatusYaml = {};
  if (fs.existsSync(statusPath)) {
    try {
      doc = yaml.load(fs.readFileSync(statusPath, "utf-8")) as StatusYaml;
    } catch {
      doc = {};
    }
  }

  const stages = Array.isArray(doc.stages) ? doc.stages : [];
  const summary: WorkflowSummary = {
    workflowId,
    title: doc.title,
    orgSlug,
    path: wfPath,
    createdAt: doc.created_at,
    stages,
    totalStages: stages.length,
    completedStages: stages.filter((s) => s.status === "completed").length,
    pendingStages: stages.filter((s) => s.status === "pending").length,
    inProgressStages: stages.filter((s) => s.status === "in_progress").length,
    needsRevisionStages: stages.filter((s) => s.status === "needs_revision").length,
    recentEventCount: 0,
  };

  const events = readEvents(workspace, orgSlug, workflowId);
  summary.recentEventCount = events.length;
  if (events.length > 0) summary.lastEventTs = events[events.length - 1].ts;

  return summary;
}

export function readEvents(
  workspace: string,
  orgSlug: string,
  workflowId: string
): AnyEvent[] {
  const p = workflowEventsPath(workspace, orgSlug, workflowId);
  if (!fs.existsSync(p)) return [];
  return new FileEventSink(p).list();
}

/**
 * Resolve a target_repo slug to its absolute path (or fall back to the
 * org root). Used by the PM SKILL.md when building Task prompts.
 */
export function resolveTargetRepoPath(
  workspace: string,
  orgSlug: string,
  repoSlug: string | null | undefined
): string {
  if (!repoSlug) return getOrgDir(orgSlug, workspace);
  return resolveRepoCwd(orgSlug, repoSlug, workspace);
}

/** Path to the PRD.md of a workflow (may not exist yet). */
export function prdPath(workspace: string, orgSlug: string, workflowId: string): string {
  return path.join(getOrgDir(orgSlug, workspace), "workflows", workflowId, "PRD.md");
}

/** Path to the most recent stage's handoff. Used by `workflow show`. */
export function latestHandoffPath(
  workspace: string,
  orgSlug: string,
  workflowId: string
): string | null {
  const wfPath = path.join(getOrgDir(orgSlug, workspace), "workflows", workflowId);
  if (!fs.existsSync(wfPath)) return null;
  let best: { path: string; mtimeMs: number } | null = null;
  for (const entry of fs.readdirSync(wfPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("stage-")) continue;
    const candidate = path.join(wfPath, entry.name, "_handoff.md");
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (!best || stat.mtimeMs > best.mtimeMs) {
      best = { path: candidate, mtimeMs: stat.mtimeMs };
    }
  }
  return best?.path ?? null;
}
