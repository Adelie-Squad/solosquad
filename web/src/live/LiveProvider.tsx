import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { EngineEvent } from '../api/types.gen';
import { invalidationsFor, LiveStream, type EventSourceFactory } from './stream';

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
}

const empty: LiveState = { connected: false, streaming: {}, logs: {}, current: {} };
const LiveContext = createContext<LiveState>(empty);
const LOG_MAX = 8;

const browserFactory: EventSourceFactory = (url) => new EventSource(url, { withCredentials: true });

export function LiveProvider({ children, factory = browserFactory }: { children: ReactNode; factory?: EventSourceFactory }) {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>(empty);

  useEffect(() => {
    const onEvent = (ev: EngineEvent) => {
      for (const queryKey of invalidationsFor(ev)) void qc.invalidateQueries({ queryKey });
      setState((s) => reduce(s, ev));
    };
    const stream = new LiveStream(factory, onEvent, (connected) => setState((s) => ({ ...s, connected })));
    stream.start();
    return () => stream.stop();
  }, [qc, factory]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export function reduce(s: LiveState, ev: EngineEvent): LiveState {
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
      return { ...s, streaming: { ...s.streaming, [tid]: { runId: rid, agent: ev.agent ?? null, text } } };
    }
    case 'run.update': {
      const summary = (ev.summary ?? {}) as { text?: string | null; active_agent?: string | null; step?: string | null };
      const where = summary.step ?? summary.active_agent ?? ev.node ?? '';
      const current = rid && where ? { ...s.current, [rid]: String(where) } : s.current;
      const line = summary.text ? `${where ? `${where}: ` : ''}${summary.text}` : where ? String(where) : '';
      return { ...s, current, logs: line ? note(line) : s.logs };
    }
    case 'run.completed':
    case 'run.failed':
    case 'run.interrupted': {
      if (!tid || !s.streaming[tid]) return s;
      const streaming = { ...s.streaming };
      delete streaming[tid];
      return { ...s, streaming };
    }
    default:
      return s;
  }
}

export const useLive = () => useContext(LiveContext);
export const LiveStateContext = LiveContext;
