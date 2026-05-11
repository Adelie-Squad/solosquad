import fs from "fs";
import path from "path";
import { getRoutinesDir } from "../util/paths.js";

export type RoutineKind = "user-brief" | "background";

export interface RoutineConfig {
  id: string;
  name: string;
  kind: RoutineKind;
  /** Always "workflow" in v1.2.4+. Kept as field for forward extensibility. */
  channel: string;
  /** System thread inside #workflow for background routines. user-brief posts to channel root. */
  threadName?: string;
  emoji: string;
  memoryTargets: string[];
}

/**
 * v1.2.4 routine layout — five entries total:
 *   - 2 user-facing briefs (morning, evening) post to #workflow root
 *   - 3 background routines post to system threads inside #workflow
 *
 * Cron times are not stored here in v1.2.4+. Times are resolved at scheduler
 * startup from workspace.yaml (`briefings`, `background_routines`).
 */
export const ROUTINES: RoutineConfig[] = [
  {
    id: "morning-brief",
    name: "Morning Brief",
    kind: "user-brief",
    channel: "workflow",
    emoji: "🌅",
    memoryTargets: [],
  },
  {
    id: "evening-brief",
    name: "Evening Brief",
    kind: "user-brief",
    channel: "workflow",
    emoji: "🌇",
    memoryTargets: ["decisions.jsonl"],
  },
  {
    id: "signal-scan",
    name: "Signal Scan",
    kind: "background",
    channel: "workflow",
    threadName: "system-daily-signals",
    emoji: "🔍",
    memoryTargets: ["signals.jsonl"],
  },
  {
    id: "experiment-check",
    name: "Experiment Check",
    kind: "background",
    channel: "workflow",
    threadName: "system-experiments",
    emoji: "🧪",
    memoryTargets: ["experiments.jsonl"],
  },
  {
    id: "weekly-review",
    name: "Weekly Review",
    kind: "background",
    channel: "workflow",
    threadName: "system-weekly-review",
    emoji: "📊",
    memoryTargets: ["decisions.jsonl"],
  },
];

/** Load routine prompt from routines/{id}.md */
export function loadRoutinePrompt(routineId: string): string {
  const promptFile = path.join(getRoutinesDir(), `${routineId}.md`);
  if (fs.existsSync(promptFile)) {
    return fs.readFileSync(promptFile, "utf-8");
  }
  return `# ${routineId}\n\nPrompt file missing: routines/${routineId}.md`;
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
