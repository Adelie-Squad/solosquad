/**
 * open_questions[] protocol — PM↔Chief async batched user query (v1.1).
 *
 * Per v1.1 PRD §6.3 + Appendix B. PM (and any specialist running deep
 * work) writes questions it can't resolve from context to
 * `<org>/memory/open-questions/<task-id>.json`. Chief reads pending
 * blocking questions, batches them into a single user message, and
 * writes the user's answers back into the same file. PM is then
 * re-dispatched with the resolved set.
 *
 * Why a file (not a queue or DB): keeps the protocol observable in the
 * filesystem, replayable (git, backup), and survives process restarts
 * without infra. Atomicity is per-file: callers should hold a per-task
 * lock or use the in-process mutex in chief-runner if concurrent writes
 * are possible.
 */

import fs from "fs";
import path from "path";

export type QuestionType =
  | "user_segment"
  | "metric_threshold"
  | "preference"
  | "constraint"
  | "data_request";

export type TaskStatus = "pending" | "resolved" | "partial";

export interface OpenQuestion {
  id: string;
  /** Producing skill stage, e.g. "problem-definition.P4" or "hypothesis-design". */
  stage: string;
  type: QuestionType;
  /** Sentence to show the user verbatim. */
  question: string;
  /** Why this question arose (PM evidence trail). */
  context: string;
  /** Multiple-choice options, or null for free-form. */
  candidates: string[] | null;
  /** True = blocks the originating skill; false = nice-to-have. */
  blocking: boolean;
  /** Default value to assume if the user defers; null = no default. */
  default?: string | null;
}

export interface ResolvedAnswer {
  id: string;
  answer: string;
  /** ISO 8601 timestamp. */
  answered_at: string;
}

export interface OpenQuestionTask {
  task_id: string;
  /** "pm" or a specialist name. */
  from: string;
  /** Always "chief" in v1.1. */
  to: string;
  /** ISO 8601. */
  created_at: string;
  questions: OpenQuestion[];
  resolved: ResolvedAnswer[] | null;
  status: TaskStatus;
}

export interface OpenQuestionsDirOpts {
  /** Org root, e.g. `<workspace>/<org>/`. */
  orgRoot: string;
}

function dirOf(opts: OpenQuestionsDirOpts): string {
  return path.join(opts.orgRoot, "memory", "open-questions");
}

function pathOf(opts: OpenQuestionsDirOpts, taskId: string): string {
  return path.join(dirOf(opts), `${taskId}.json`);
}

function ensureDir(opts: OpenQuestionsDirOpts): void {
  fs.mkdirSync(dirOf(opts), { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Write a new open-questions task to disk. Overwrites any prior file with
 * the same `task_id`. Use {@link appendQuestion} to add to an existing
 * task instead.
 */
export function createTask(
  opts: OpenQuestionsDirOpts,
  task: Omit<OpenQuestionTask, "created_at" | "status" | "resolved"> &
    Partial<Pick<OpenQuestionTask, "created_at" | "status" | "resolved">>
): OpenQuestionTask {
  ensureDir(opts);
  const full: OpenQuestionTask = {
    task_id: task.task_id,
    from: task.from,
    to: task.to,
    created_at: task.created_at ?? nowIso(),
    questions: task.questions,
    resolved: task.resolved ?? null,
    status: task.status ?? "pending",
  };
  fs.writeFileSync(pathOf(opts, task.task_id), JSON.stringify(full, null, 2));
  return full;
}

/** Load a task by id. Returns null if absent or malformed. */
export function loadTask(
  opts: OpenQuestionsDirOpts,
  taskId: string
): OpenQuestionTask | null {
  const filePath = pathOf(opts, taskId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<OpenQuestionTask>;
    if (
      typeof parsed.task_id !== "string" ||
      typeof parsed.from !== "string" ||
      typeof parsed.to !== "string" ||
      !Array.isArray(parsed.questions)
    ) {
      return null;
    }
    return {
      task_id: parsed.task_id,
      from: parsed.from,
      to: parsed.to,
      created_at: parsed.created_at ?? nowIso(),
      questions: parsed.questions,
      resolved: parsed.resolved ?? null,
      status: parsed.status ?? "pending",
    };
  } catch {
    return null;
  }
}

/** Append one or more new questions to an existing task. */
export function appendQuestions(
  opts: OpenQuestionsDirOpts,
  taskId: string,
  newQuestions: OpenQuestion[]
): OpenQuestionTask | null {
  const task = loadTask(opts, taskId);
  if (!task) return null;
  task.questions.push(...newQuestions);
  if (task.status === "resolved") task.status = "partial";
  fs.writeFileSync(pathOf(opts, taskId), JSON.stringify(task, null, 2));
  return task;
}

/**
 * Record user answers for one or more questions on a task. Updates
 * `resolved` and recomputes `status` (resolved if every blocking
 * question now has an answer, otherwise partial).
 */
export function markResolved(
  opts: OpenQuestionsDirOpts,
  taskId: string,
  answers: Array<{ id: string; answer: string }>
): OpenQuestionTask | null {
  const task = loadTask(opts, taskId);
  if (!task) return null;
  const ts = nowIso();
  const prior = task.resolved ?? [];
  const merged = [...prior];
  for (const a of answers) {
    const existing = merged.findIndex((r) => r.id === a.id);
    const entry: ResolvedAnswer = {
      id: a.id,
      answer: a.answer,
      answered_at: ts,
    };
    if (existing >= 0) merged[existing] = entry;
    else merged.push(entry);
  }
  task.resolved = merged;
  task.status = computeStatus(task);
  fs.writeFileSync(pathOf(opts, taskId), JSON.stringify(task, null, 2));
  return task;
}

function computeStatus(task: OpenQuestionTask): TaskStatus {
  const resolvedIds = new Set((task.resolved ?? []).map((r) => r.id));
  const blocking = task.questions.filter((q) => q.blocking);
  if (blocking.length === 0) {
    return resolvedIds.size > 0 ? "resolved" : "pending";
  }
  const allBlockingDone = blocking.every((q) => resolvedIds.has(q.id));
  if (allBlockingDone) return "resolved";
  return resolvedIds.size > 0 ? "partial" : "pending";
}

/**
 * List all tasks in the org's open-questions directory, optionally
 * filtered by status. Returns tasks in filename order (which lets
 * callers sort by task-id prefix conventions like task-YYYY-MM-DD-NNN).
 */
export function listTasks(
  opts: OpenQuestionsDirOpts,
  filter?: { status?: TaskStatus }
): OpenQuestionTask[] {
  const dir = dirOf(opts);
  if (!fs.existsSync(dir)) return [];
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const out: OpenQuestionTask[] = [];
  for (const entry of entries) {
    const taskId = entry.replace(/\.json$/, "");
    const task = loadTask(opts, taskId);
    if (!task) continue;
    if (filter?.status && task.status !== filter.status) continue;
    out.push(task);
  }
  return out;
}

/**
 * Return the subset of blocking questions on a task that don't yet have a
 * resolved answer. Empty array means the task is ready to advance.
 */
export function pendingBlocking(task: OpenQuestionTask): OpenQuestion[] {
  const resolvedIds = new Set((task.resolved ?? []).map((r) => r.id));
  return task.questions.filter((q) => q.blocking && !resolvedIds.has(q.id));
}
