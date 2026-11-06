import { describe, expect, it } from 'vitest';
import { scopedKeys } from '../src/api/queries';

const keys = scopedKeys({ org: 'tesla', ws: 'hq' });
const EVENTS_URL = eventsUrl('/o/tesla/w/hq');
import type { EngineEvent } from '../src/api/types.gen';
import { emptyLive, reduce, type LiveState } from '../src/live/LiveProvider';
import { eventsUrl, invalidationsFor, LiveStream, type EventSourceLike } from '../src/live/stream';

class FakeSource implements EventSourceLike {
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.(new Event('open'));
  }
  emit(id: number, data: Partial<EngineEvent>) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ ts: 1, ...data }), lastEventId: String(id) }));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

function harness() {
  const sources: FakeSource[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const got: [string, number][] = [];
  const status: boolean[] = [];
  const stream = new LiveStream(
    EVENTS_URL,
    (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    },
    (ev, id) => got.push([ev.event, id]),
    (on) => status.push(on),
    { baseDelayMs: 100, maxDelayMs: 1000, schedule: (fn, ms) => timers.push({ fn, ms }), cancel: () => {} },
  );
  return { stream, sources, timers, got, status };
}

describe('live event stream (I9)', () => {
  it('reconnects after an error and resumes after the last event it saw', () => {
    const h = harness();
    h.stream.start();
    expect(h.sources[0].url).toBe(EVENTS_URL);
    h.sources[0].open();
    h.sources[0].emit(41, { event: 'run.started', run_id: 'r1', thread_id: 't1' });
    h.sources[0].emit(42, { event: 'run.completed', run_id: 'r1', thread_id: 't1' });
    expect(h.got).toEqual([
      ['run.started', 41],
      ['run.completed', 42],
    ]);

    h.sources[0].fail();
    expect(h.sources[0].closed).toBe(true);
    expect(h.status).toEqual([true, false]);
    expect(h.timers).toHaveLength(1);
    h.timers[0].fn();
    expect(h.sources[1].url).toBe(`${EVENTS_URL}?last_event_id=42`);
  });

  it('backs off exponentially and resets after a successful connection', () => {
    const h = harness();
    h.stream.start();
    h.sources[0].fail();
    h.timers.at(-1)!.fn();
    h.sources[1].fail();
    h.timers.at(-1)!.fn();
    h.sources[2].fail();
    h.timers.at(-1)!.fn();
    h.sources[3].fail();
    h.timers.at(-1)!.fn();
    h.sources[4].fail();
    expect(h.timers.map((x) => x.ms)).toEqual([100, 200, 400, 800, 1000]); // capped
    h.timers.at(-1)!.fn();
    h.sources[5].open();
    h.sources[5].fail();
    expect(h.timers.at(-1)!.ms).toBe(100);
  });

  it('stops reconnecting once stopped', () => {
    const h = harness();
    h.stream.start();
    h.stream.stop();
    expect(h.sources[0].closed).toBe(true);
    h.sources[0].fail();
    expect(h.timers).toHaveLength(0);
  });

  it('invalidates queries only on run lifecycle and approval events', () => {
    const ev = (e: Partial<EngineEvent>) => ({ ts: 1, event: 'run.started', ...e }) as EngineEvent;
    expect(invalidationsFor(ev({ event: 'run.message', thread_id: 't' }), keys)).toEqual([]);
    expect(invalidationsFor(ev({ event: 'run.update', thread_id: 't' }), keys)).toEqual([]);
    const done = invalidationsFor(ev({ event: 'run.interrupted', thread_id: 't' }), keys);
    expect(done).toContainEqual(keys.approvals);
    expect(done).toContainEqual(keys.thread('t'));
    const wf = invalidationsFor(ev({ event: 'run.completed', thread_id: 'w', source: 'workflow' }), keys);
    expect(wf).toContainEqual(keys.workflowState('w'));
    expect(wf).toContainEqual(keys.artifacts);
    expect(wf).not.toContainEqual(keys.threads);
  });

  it('streams answer text per thread and drops it when the run settles', () => {
    let s: LiveState = { ...emptyLive, connected: true };
    s = reduce(s, { ts: 1, event: 'run.message', run_id: 'r', thread_id: 't', agent: 'chief', text: 'Hel' });
    s = reduce(s, { ts: 1, event: 'run.message', run_id: 'r', thread_id: 't', agent: 'chief', text: 'lo' });
    expect(s.streaming.t.text).toBe('Hello');
    s = reduce(s, { ts: 2, event: 'run.update', run_id: 'r', thread_id: 't', node: 'pm', summary: { text: 'planned', active_agent: 'pm' } });
    expect(s.current.r).toBe('pm');
    expect(s.logs.r.at(-1)?.text).toBe('pm: planned');
    s = reduce(s, { ts: 3, event: 'run.completed', run_id: 'r', thread_id: 't' });
    expect(s.streaming.t).toBeUndefined();
  });
});
