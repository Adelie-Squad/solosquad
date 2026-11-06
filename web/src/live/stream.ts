// The live view's event stream (PRD v2.1.0 I9). One EventSource on /api/events; on any
// error it is closed and reopened with exponential backoff, resuming after the last event
// it saw (`last_event_id`, the server's replay of `Last-Event-ID`). The stream is a hint —
// the API is the truth — so events only invalidate queries (I8 · K20).
import type { QueryKey } from '@tanstack/react-query';
import type { EngineEvent } from '../api/types.gen';
import type { ScopedKeys } from '../api/queries';

export interface EventSourceLike {
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent<string>) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface StreamOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** The workspace's stream: `/api/o/<org>/w/<ws>/events` — replay numbers are per workspace. */
export const eventsUrl = (wsPrefix: string) => `/api${wsPrefix}/events`;

export class LiveStream {
  lastId = 0;
  attempts = 0;
  connected = false;
  private source: EventSourceLike | null = null;
  private timer: unknown = null;
  private stopped = true;
  private readonly base: number;
  private readonly max: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(
    private readonly base_url: string,
    private readonly factory: EventSourceFactory,
    private readonly onEvent: (event: EngineEvent, id: number) => void,
    private readonly onStatus: (connected: boolean) => void = () => {},
    opts: StreamOptions = {},
  ) {
    this.base = opts.baseDelayMs ?? 1000;
    this.max = opts.maxDelayMs ?? 30_000;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  url(): string {
    return this.lastId > 0 ? `${this.base_url}?last_event_id=${this.lastId}` : this.base_url;
  }

  /** Delay before the next reconnect attempt: base · 2^n, capped. */
  delay(): number {
    return Math.min(this.max, this.base * 2 ** Math.max(0, this.attempts - 1));
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
    this.setConnected(false);
  }

  private open(): void {
    const src = this.factory(this.url());
    this.source = src;
    src.onopen = () => {
      this.attempts = 0;
      this.setConnected(true);
    };
    src.onmessage = (ev) => {
      const id = Number(ev.lastEventId);
      if (Number.isFinite(id) && id > this.lastId) this.lastId = id;
      this.attempts = 0;
      this.setConnected(true);
      let data: EngineEvent;
      try {
        data = JSON.parse(ev.data) as EngineEvent;
      } catch {
        return;
      }
      this.onEvent(data, id);
    };
    src.onerror = () => {
      // Close the browser's own retry and reconnect ourselves: we control the backoff and
      // the resume point (a new EventSource does not resend Last-Event-ID by itself).
      src.close();
      if (this.source === src) this.source = null;
      this.setConnected(false);
      if (this.stopped) return;
      this.attempts += 1;
      this.timer = this.schedule(() => {
        this.timer = null;
        if (!this.stopped) this.open();
      }, this.delay());
    };
  }

  private setConnected(on: boolean): void {
    if (this.connected !== on) {
      this.connected = on;
      this.onStatus(on);
    }
  }
}

/** Which cached queries an event makes stale. Streaming text and step updates change no
 * list — they feed the live view directly — so a busy office does not refetch on every token. */
export function invalidationsFor(ev: EngineEvent, keys: ScopedKeys): QueryKey[] {
  const lifecycle = ['run.created', 'run.started', 'run.interrupted', 'run.completed', 'run.failed'];
  if (ev.event === 'escalation') return [keys.budget, keys.connections];
  if (!lifecycle.includes(ev.event)) return [];
  const tid = ev.thread_id ?? undefined;
  const settled = ev.event !== 'run.created' && ev.event !== 'run.started';
  if (ev.source === 'workflow') {
    const out: QueryKey[] = [keys.workflowRuns(), keys.workflows];
    if (tid) out.push(keys.workflowState(tid));
    if (settled) out.push(keys.approvals, keys.artifacts);
    return out;
  }
  const out: QueryKey[] = [keys.threads, keys.runs, keys.agents];
  if (tid) out.push(keys.thread(tid));
  if (settled) out.push(keys.approvals, keys.budget);
  return out;
}
