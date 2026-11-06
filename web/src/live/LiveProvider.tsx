import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { EngineEvent } from '../api/types.gen';
import { scopedKeys } from '../api/queries';
import { apiPath, useScope } from '../scope';
import { eventsUrl, invalidationsFor, LiveStream, type EventSourceFactory } from './stream';

export interface LogLine {
  at: number;
  text: string;
}

/** What the live view knows beyond the API: streaming text and step notes per run. */
export interface LiveState {
  connected: boolean;
  /** Text streamed so far by the run currently answering in each thread. */
  streaming: Record<string, { runId: string; agent: string | null; text: string }>;
  /** Recent notes per run (agent turns, workflow steps) for the job cards. */
  logs: Record<string, LogLine[]>;
  /** Run id → the agent or step it is on now. */
  current: Record<string, string>;
  /** Run id → the agent last seen speaking or acting in it (for the office states). */
  runAgent: Record<string, string>;
  /** Agent → when it last streamed text or took a step (client ms) — `typing`. */
  activity: Record<string, number>;
  /** Agent → its last finished run (client ms) — `done` · `error`. */
  outcomes: Record<string, { kind: 'done' | 'error'; at: number }>;
}

export const emptyLive: LiveState = {
  connected: false,
  streaming: {},
  logs: {},
  current: {},
  runAgent: {},
  activity: {},
  outcomes: {},
};
const empty = emptyLive;
const LiveContext = createContext<LiveState>(empty);
const LOG_MAX = 8;

const browserFactory: EventSourceFactory = (url) => new EventSource(url, { withCredentials: true });

/**
 * The live view of ONE workspace. Mounted per scope (keyed by it), so switching org or
 * workspace closes this stream and opens the new one — events and replay numbers never mix.
 */
export function LiveProvider({ children, factory = browserFactory }: { children: ReactNode; factory?: EventSourceFactory }) {
  const qc = useQueryClient();
  const scope = useScope();
  const [state, setState] = useState<LiveState>(empty);
  const { org, ws } = scope;

  useEffect(() => {
    const k = scopedKeys({ org, ws });
    const onEvent = (ev: EngineEvent) => {
      for (const queryKey of invalidationsFor(ev, k)) void qc.invalidateQueries({ queryKey });
      setState((s) => reduce(s, ev));
    };
    setState(empty);
    const stream = new LiveStream(eventsUrl(apiPath.ws({ org, ws }, '')), factory, onEvent, (connected) =>
      setState((s) => ({ ...s, connected })),
    );
    stream.start();
    return () => stream.stop();
  }, [qc, factory, org, ws]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export function reduce(s: LiveState, ev: EngineEvent, clock: number = Date.now()): LiveState {
  const rid = ev.run_id ?? '';
  const tid = ev.thread_id ?? '';
  const now = (ev.ts ?? Date.now() / 1000) * 1000;
  const note = (text: string): Record<string, LogLine[]> =>
    rid ? { ...s.logs, [rid]: [...(s.logs[rid] ?? []), { at: now, text }].slice(-LOG_MAX) } : s.logs;
  switch (ev.event) {
    case 'run.message': {
      if (!tid) return s;
      const prev = s.streaming[tid];
      const text = (prev && prev.runId === rid ? prev.text : '') + (ev.text ?? '');
      const agent = ev.agent ?? null;
      return {
        ...s,
        streaming: { ...s.streaming, [tid]: { runId: rid, agent, text } },
        ...(agent ? seen(s, rid, agent, clock) : {}),
      };
    }
    case 'run.update': {
      const summary = (ev.summary ?? {}) as { text?: string | null; active_agent?: string | null; step?: string | null };
      const where = summary.step ?? summary.active_agent ?? ev.node ?? '';
      const current = rid && where ? { ...s.current, [rid]: String(where) } : s.current;
      const line = summary.text ? `${where ? `${where}: ` : ''}${summary.text}` : where ? String(where) : '';
      const agent = summary.active_agent ?? (ev.source === 'workflow' ? null : ev.node) ?? null;
      return { ...s, current, logs: line ? note(line) : s.logs, ...(agent ? seen(s, rid, agent, clock) : {}) };
    }
    case 'run.completed':
    case 'run.failed':
    case 'run.interrupted': {
      const agent = rid ? s.runAgent[rid] : undefined;
      const outcomes =
        agent && ev.event !== 'run.interrupted'
          ? { ...s.outcomes, [agent]: { kind: ev.event === 'run.failed' ? ('error' as const) : ('done' as const), at: clock } }
          : s.outcomes;
      if (!tid || !s.streaming[tid]) return outcomes === s.outcomes ? s : { ...s, outcomes };
      const streaming = { ...s.streaming };
      delete streaming[tid];
      return { ...s, streaming, outcomes };
    }
    default:
      return s;
  }
}

function seen(s: LiveState, rid: string, agent: string, clock: number): Pick<LiveState, 'runAgent' | 'activity'> {
  return {
    runAgent: rid && s.runAgent[rid] !== agent ? { ...s.runAgent, [rid]: agent } : s.runAgent,
    activity: { ...s.activity, [agent]: clock },
  };
}

export const useLive = () => useContext(LiveContext);
export const LiveStateContext = LiveContext;
