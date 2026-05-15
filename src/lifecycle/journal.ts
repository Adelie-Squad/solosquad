import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.7 — stage progress journal for `solosquad uninstall`.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §11.3 + P0 #4.
 *
 * Each cleanup stage logs a `begin` entry, then an `end` entry on success.
 * If a stage crashes between begin and end, the journal will show an
 * orphan `begin`, and the next invocation can detect this to resume from
 * the appropriate point (each cleanup step is itself idempotent).
 *
 * The journal lives at `<workspace>/.solosquad/uninstall.journal.jsonl`
 * and is append-only. It is moved into the archive (as `last-journal.jsonl`)
 * after a successful uninstall and then deleted from the workspace.
 */

export type StageStatus = "begin" | "end" | "error";

export interface JournalEntry {
  ts: string;
  stage: string;
  status: StageStatus;
  runId: string;
  detail?: Record<string, unknown>;
}

export class JournalWriter {
  constructor(public readonly filePath: string, public readonly runId: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  begin(stage: string, detail?: Record<string, unknown>): void {
    this.append({ stage, status: "begin", detail });
  }

  end(stage: string, detail?: Record<string, unknown>): void {
    this.append({ stage, status: "end", detail });
  }

  error(stage: string, detail?: Record<string, unknown>): void {
    this.append({ stage, status: "error", detail });
  }

  private append(partial: { stage: string; status: StageStatus; detail?: Record<string, unknown> }): void {
    const entry: JournalEntry = {
      ts: new Date().toISOString(),
      stage: partial.stage,
      status: partial.status,
      runId: this.runId,
      ...(partial.detail ? { detail: partial.detail } : {}),
    };
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
  }
}

export function newRunId(): string {
  return randomUUID();
}

/**
 * Read the journal file. Returns an empty array if the file is missing.
 * Malformed lines are skipped (defensive — the file is append-only and
 * could be truncated by a crash).
 */
export function readJournal(filePath: string): JournalEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = normalizeLine(fs.readFileSync(filePath, "utf-8"));
  const out: JournalEntry[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as JournalEntry;
      if (typeof parsed.stage === "string" && typeof parsed.status === "string") {
        out.push(parsed);
      }
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Stages that have a `begin` but no `end` (potentially interrupted).
 * Filtered by runId when supplied — useful when checking the current run.
 */
export function findIncompleteStages(entries: JournalEntry[], runId?: string): string[] {
  const beganAt = new Map<string, number>();
  const endedAt = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (runId && e.runId !== runId) continue;
    if (e.status === "begin") beganAt.set(e.stage, i);
    if (e.status === "end") endedAt.set(e.stage, i);
  }
  const incomplete: string[] = [];
  for (const [stage, beginIdx] of beganAt) {
    const endIdx = endedAt.get(stage);
    if (endIdx === undefined || endIdx < beginIdx) {
      incomplete.push(stage);
    }
  }
  return incomplete;
}

/**
 * Has the named stage finished successfully in the most recent attempt?
 * If runId is supplied, scoped to that run only.
 */
export function isStageCompleted(entries: JournalEntry[], stage: string, runId?: string): boolean {
  let begun = false;
  let ended = false;
  for (const e of entries) {
    if (e.stage !== stage) continue;
    if (runId && e.runId !== runId) continue;
    if (e.status === "begin") {
      begun = true;
      ended = false;
    } else if (e.status === "end") {
      ended = true;
    } else if (e.status === "error") {
      ended = false;
    }
  }
  return begun && ended;
}

export function journalPath(workspace: string): string {
  return path.join(workspace, ".solosquad", "uninstall.journal.jsonl");
}

/**
 * v0.8.1 — `solosquad import` journal path. Reuses the same JSONL writer
 * + readers as the uninstall journal so resume semantics are identical.
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §4.4.
 *
 * Stages: `import.verify`, `import.unpack`, `import.merge-org`,
 * `import.verify-post`. Each is idempotent — re-running over an already
 * extracted file SHA-verifies and skips.
 */
export function importJournalPath(workspace: string): string {
  return path.join(workspace, ".solosquad", "import.journal.jsonl");
}
