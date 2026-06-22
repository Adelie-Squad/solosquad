import fs from "fs";
import path from "path";
import { getCronsDir, getCronsWriteDir } from "../util/paths.js";

export type CronKind = "user-brief" | "background";

export interface CronConfig {
  id: string;
  name: string;
  kind: CronKind;
  /**
   * v1.3.4 §F2 — empty = auto-resolve to the org's `works-<handle>` at runtime
   * (there is no shared "#workflow" channel). A non-empty value is an explicit
   * advanced override.
   */
  channel: string;
  /** System thread inside #workflow for background crons. user-brief posts to channel root. */
  threadName?: string;
  emoji: string;
  memoryTargets: string[];
}

/**
 * v0.8.5 cron layout — four entries total:
 *   - 2 user-facing briefs (morning, evening) post to works-<handle>
 *   - 1 PM-compaction (background, context management)
 *   - 1 system-housekeeping (silent infra — archive rotation + log retention)
 *
 * Removed in v0.8.5 (was v0.2.4 background analysis layer): `signal-scan`,
 * `experiment-check`, `weekly-review`, `v06-retrospective-stats`. They were
 * speculative analysis crons that required the user to author a product
 * brief / experiment ledger before producing useful output — friction without
 * payoff. Domain-specific analysis should ship as user-authored workflows or
 * goals, not as default-on cron jobs.
 *
 * Merged in v0.8.5: `archive-rotate` + `log-rotate` → `system-housekeeping`.
 * Both are deterministic midnight cleanup jobs (no LLM, no user notification);
 * a single cron + a single inline dispatch reduces UI clutter without losing
 * isolation (the dispatch wraps each cleanup call in try/catch).
 *
 * Cron times are resolved at scheduler startup from workspace.yaml
 * (`briefings` for morning/evening).
 */
export const CRONS: CronConfig[] = [
  {
    id: "morning-brief",
    name: "Morning Brief",
    kind: "user-brief",
    channel: "",
    emoji: "🌅",
    memoryTargets: [],
  },
  {
    id: "evening-brief",
    name: "Evening Brief",
    kind: "user-brief",
    channel: "",
    emoji: "🌇",
    memoryTargets: ["decisions.jsonl"],
  },
  {
    id: "chief-compaction",
    name: "Chief Compaction",
    kind: "background",
    channel: "",
    threadName: "system-chief-compaction",
    emoji: "🗂",
    memoryTargets: [],
  },
  // v0.8.5 — Unified housekeeping. Daily at 00:00; silent (no user
  // notification — pure background maintenance). Runs:
  //   1. FTS5 cold archive rotation (`rotateArchive`, v0.6 §4)
  //   2. Log retention pass (`rotateLogs`, v0.8.3 §5.3)
  // Each step is try/catch-isolated so one failure doesn't block the other.
  {
    id: "system-housekeeping",
    name: "System Housekeeping",
    kind: "background",
    channel: "",
    threadName: "system-housekeeping",
    emoji: "🧹",
    memoryTargets: [],
  },
];

/**
 * v1.3.3 §C — a run is "silent" when its output is empty or begins with a
 * `[SILENT]` marker (Hermes `[SILENT]` / OpenClaw `NO_REPLY` pattern). The
 * scheduler still logs/records a silent run but does not post it to the channel
 * — lets a cron be a quiet poller that only speaks when it has something to say.
 */
export function isSilentResult(result: string): boolean {
  const t = (result ?? "").trim();
  return t.length === 0 || /^\[SILENT\]/i.test(t);
}

/** Load a cron prompt from `{id}.md`.
 *  - Built-in crons resolve from the bundle/legacy resolver (`getCronsDir`).
 *  - v1.3.5 B-D3: org-scoped user crons live in `<org>/crons/<id>.md`; pass the
 *    org slug to read it there (falling back to the resolver if absent). */
export function loadCronPrompt(cronId: string, orgSlug?: string): string {
  if (orgSlug) {
    const orgPrompt = path.join(getCronsWriteDir(orgSlug), `${cronId}.md`);
    if (fs.existsSync(orgPrompt)) return fs.readFileSync(orgPrompt, "utf-8");
  }
  const promptFile = path.join(getCronsDir(), `${cronId}.md`);
  if (fs.existsSync(promptFile)) {
    return fs.readFileSync(promptFile, "utf-8");
  }
  return `# ${cronId}\n\nPrompt file missing: crons/${cronId}.md`;
}

/** Convert "HH:MM" into a node-cron expression for daily execution. */
export function timeToDailyCron(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Invalid time format: ${hhmm} (expected HH:MM)`);
  }
  return `${m} ${h} * * *`;
}

const DAY_TO_CRON: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Convert ("sunday", "20:00") into a node-cron weekly expression. */
export function weeklyToCron(day: string, hhmm: string): string {
  const d = DAY_TO_CRON[day.toLowerCase()];
  if (d === undefined) {
    throw new Error(`Invalid day: ${day} (expected sunday/monday/.../saturday)`);
  }
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Invalid time format: ${hhmm} (expected HH:MM)`);
  }
  return `${m} ${h} * * ${d}`;
}
