// Task (2026-11-07): what the agents did and what people still have to do, on one screen.
// The groups are decided here, from the engine's lists, so the screen and the dashboard agree.
import type { ApprovalItem, Artifact, WorkEntry } from '../api/types.gen';

export interface TaskGroups {
  /** Approval cards this person may answer, then work products waiting to be checked. */
  mine: { approvals: ApprovalItem[]; reviews: Artifact[] };
  /** Cards someone else answers (another team, or the owner) — shown with the reason. */
  others: ApprovalItem[];
  /** Work the agents are on now (a waiting approval keeps the run here). */
  running: WorkEntry[];
  /** Work that ended — done, failed or stopped. */
  done: WorkEntry[];
}

const OPEN = new Set<WorkEntry['status']>(['pending', 'running', 'interrupted']);

export function groupTasks(approvals: ApprovalItem[], reviews: Artifact[], work: WorkEntry[]): TaskGroups {
  return {
    mine: { approvals: approvals.filter((a) => a.can_approve), reviews: reviews.filter((r) => r.needs_review) },
    others: approvals.filter((a) => !a.can_approve),
    running: work.filter((w) => OPEN.has(w.status)),
    done: work.filter((w) => !OPEN.has(w.status)),
  };
}

export type Period = 'today' | 'week' | 'month' | 'all';
export type WorkKind = 'all' | 'chat' | 'workflow' | 'artifact';

export interface DoneFilter {
  period: Period;
  /** An agent id, or '' for every agent. */
  agent: string;
  kind: WorkKind;
}

/** Start of the local day, in epoch seconds. */
export function startOfDay(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

export function periodStart(period: Period, now: Date): number {
  if (period === 'all') return 0;
  const today = startOfDay(now);
  return period === 'today' ? today : today - (period === 'week' ? 6 : 29) * 86400;
}

/** When a finished item ended (its newest run), for the period filter and the list. */
export const endedAt = (w: WorkEntry) => w.ended ?? w.created;

export function filterDone(items: WorkEntry[], f: DoneFilter, now: Date): WorkEntry[] {
  const from = periodStart(f.period, now);
  return items.filter(
    (w) =>
      endedAt(w) >= from &&
      (!f.agent || w.agents.includes(f.agent)) &&
      (f.kind === 'all' || (f.kind === 'artifact' ? w.artifacts.length > 0 : w.source === f.kind)),
  );
}

/** Every agent that appears in the list, in first-seen order — the agent filter's choices. */
export function agentsIn(items: WorkEntry[]): string[] {
  const seen: string[] = [];
  for (const w of items) for (const a of w.agents) if (!seen.includes(a)) seen.push(a);
  return seen;
}

/** The dashboard's number row: in progress · waiting approvals (and how many are mine) · done today. */
export function taskCounts(approvals: ApprovalItem[], work: WorkEntry[], now: Date) {
  const today = startOfDay(now);
  return {
    running: work.filter((w) => w.status === 'running' || w.status === 'pending').length,
    waiting: approvals.length,
    mine: approvals.filter((a) => a.can_approve).length,
    doneToday: work.filter((w) => w.status === 'success' && endedAt(w) >= today).length,
  };
}
