// Engine facts → the six office states (DESIGN.md `## 사무실 장면` — 상태 → 모션 → 색).
// Pure: the scene, the name tags and the screen-reader list all read the same answer.

export type AgentStatus = 'idle' | 'thinking' | 'typing' | 'waiting' | 'done' | 'error';

export const STATUSES: AgentStatus[] = ['idle', 'thinking', 'typing', 'waiting', 'done', 'error'];

/** How long a finished run shows `done` before the agent goes back to `idle`. */
export const DONE_MS = 10_000;
/** A failed run keeps `error` this long (or until the agent works again). */
export const ERROR_MS = 60_000;
/** Text or a tool step within this window = `typing`; a quieter running agent is `thinking`. */
export const TYPING_MS = 4_000;

export interface StatusInput {
  /** `/api/agents` — `working_on` lists the runs the engine has this agent on now. */
  agents: { name: string; working_on: unknown[] }[];
  /** `/api/approvals` cards — the agent that asked is waiting for a person. */
  approvals: { card: { agent?: string | null } }[];
  /** Last streamed text / step per agent (ms, from SSE `run.message` · `run.update`). */
  activity: Record<string, number>;
  /** Last finished run per agent (ms, from SSE `run.completed` · `run.failed`). */
  outcomes: Record<string, { kind: 'done' | 'error'; at: number }>;
  now: number;
}

export function agentStatus(name: string, input: StatusInput): AgentStatus {
  if (input.approvals.some((a) => a.card.agent === name)) return 'waiting';
  const agent = input.agents.find((a) => a.name === name);
  const outcome = input.outcomes[name];
  const last = input.activity[name];
  if (agent && agent.working_on.length > 0) {
    // a newer run started after a failure — the error is over
    return last !== undefined && input.now - last <= TYPING_MS ? 'typing' : 'thinking';
  }
  if (outcome) {
    const age = input.now - outcome.at;
    if (outcome.kind === 'done' && age <= DONE_MS) return 'done';
    if (outcome.kind === 'error' && age <= ERROR_MS && !(last !== undefined && last > outcome.at)) return 'error';
  }
  return 'idle';
}

export function agentStatuses(input: StatusInput): Record<string, AgentStatus> {
  return Object.fromEntries(input.agents.map((a) => [a.name, agentStatus(a.name, input)]));
}

/** The next moment a status can change by time alone (done → idle, typing → thinking …). */
export function nextChange(input: StatusInput): number | null {
  const times: number[] = [];
  for (const at of Object.values(input.activity)) if (input.now - at <= TYPING_MS) times.push(at + TYPING_MS);
  for (const o of Object.values(input.outcomes)) {
    const end = o.at + (o.kind === 'done' ? DONE_MS : ERROR_MS);
    if (end > input.now) times.push(end);
  }
  return times.length ? Math.min(...times) : null;
}
