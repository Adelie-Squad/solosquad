// The office pop-out in the demo (2026-11-14, link.ts): the pop-out window borrows the opener's
// in-memory engine over a BroadcastChannel scoped to the demo account — its requests are answered
// by the opener's engine and the opener's engine events are its stream, so an approval in either
// window is the same approval. A reset in the opener moves the pop-out to the new engine; when the
// opener is gone the pop-out says so and never starts a demo of its own.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ApprovalItem } from '../src/api/types.gen';
import { setTransport } from '../src/api/transport';
import DemoApp from '../src/demo/DemoApp';
import { DemoEngine, type DemoData } from '../src/demo/engine';
import { channelFor, hostDemo, isPopoutPath, joinDemo, type ChannelLike } from '../src/demo/link';
import ko from '../src/demo/data/ko.json';
import { I18nProvider, translate, type MessageKey } from '../src/i18n';
import '../src/marketing/messages';
import { QuietEventSource } from './fixtures';

vi.mock('../src/office/OfficeCanvas', () => ({ default: () => null }));

const t = (k: MessageKey) => translate('ko', k);
const DATA = ko as unknown as DemoData;
const ACCOUNT = { demoId: 'minji@example.com', companyName: '에이스상사', expires: Date.now() / 1000 + 14 * 86_400 };
const FAST = { agentMs: 20, toolMs: 5, chatMs: 5 };
const W = '/o/moa/w/hq';

/** Same-name channels in one test, delivered a tick later and never to the sender — like BroadcastChannel. */
function bus() {
  const all = new Map<string, Set<Fake>>();
  class Fake implements ChannelLike {
    private fns = new Set<(e: MessageEvent) => void>();
    closed = false;
    constructor(private name: string) {
      if (!all.has(name)) all.set(name, new Set());
      all.get(name)!.add(this);
    }
    postMessage(message: unknown) {
      const data = structuredClone(message);
      for (const other of all.get(this.name) ?? []) {
        if (other === this || other.closed) continue;
        setTimeout(() => other.fns.forEach((fn) => fn(new MessageEvent('message', { data }))), 0);
      }
    }
    addEventListener(_t: 'message', fn: (e: MessageEvent) => void) {
      this.fns.add(fn);
    }
    removeEventListener(_t: 'message', fn: (e: MessageEvent) => void) {
      this.fns.delete(fn);
    }
    close() {
      this.closed = true;
      all.get(this.name)?.delete(this);
    }
  }
  return (name: string) => new Fake(name);
}

const engines: DemoEngine[] = [];
const newEngine = () => {
  const e = new DemoEngine(DATA, ACCOUNT, { pace: FAST });
  engines.push(e);
  return e;
};
const approvals = (e: DemoEngine) => e.handle('GET', `${W}/approvals`, new URLSearchParams(), null).body as ApprovalItem[];

beforeAll(() => {
  (globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;
});

afterEach(() => {
  cleanup();
  for (const e of engines.splice(0)) e.stop();
  vi.unstubAllGlobals();
  setTransport(null);
});

describe('the link (link.ts)', () => {
  it('no opener demo → null after the wait (the pop-out never makes its own)', async () => {
    expect(await joinDemo('minji@example.com', { open: bus(), waitMs: 30, want: null })).toBeNull();
  });

  it('the pop-out’s requests are answered by the opener’s engine; an approval made in the pop-out happens there', async () => {
    const open = bus();
    let engine = newEngine();
    const host = hostDemo('minji@example.com', () => engine, () => 'ko', open);
    const link = (await joinDemo('MINJI@example.com', { open, want: null }))!;
    expect(link).not.toBeNull();
    expect(link.locale).toBe('ko');

    const started = (await (await link.transport.fetch(`/api${W}/workflows/finance-monthly/run`, { method: 'POST', body: '{}' })).json()) as { thread_id: string };
    expect(started.thread_id).toBeTruthy();
    await waitFor(() => expect(approvals(engine)).toHaveLength(1), { timeout: 3000 });
    // the pop-out sees the opener's approval waiting
    const seen = (await (await link.transport.fetch(`/api${W}/approvals`, {})).json()) as ApprovalItem[];
    expect(seen.map((a) => a.card.step)).toEqual(approvals(engine).map((a) => a.card.step));
    // approve in the pop-out → the opener's engine moves on
    const res = await link.transport.fetch(`/api${W}/workflow-threads/${started.thread_id}/resume`, { method: 'POST', body: JSON.stringify({ value: 'approved' }) });
    expect(res.status).toBe(200);
    await waitFor(() => expect(approvals(engine)[0]?.card.step).toBe('pay'), { timeout: 3000 });
    host.stop();
    link.close();
    engine = newEngine();
  });

  it('the opener’s engine events are the pop-out’s workspace stream (an approval in the opener shows there)', async () => {
    const open = bus();
    const engine = newEngine();
    const host = hostDemo('minji@example.com', () => engine, () => 'ko', open);
    const link = (await joinDemo('minji@example.com', { open, want: null }))!;
    const stream = link.transport.events(`/api${W}/events`);
    const got: string[] = [];
    stream.onmessage = (e) => got.push((JSON.parse(e.data) as { event: string }).event);
    const calendar = link.transport.events('/api/o/moa/calendar/events');
    const quiet = vi.fn();
    calendar.onmessage = quiet;

    const started = engine.handle('POST', `${W}/workflows/finance-monthly/run`, new URLSearchParams(), {}).body as { thread_id: string };
    await waitFor(() => expect(approvals(engine)).toHaveLength(1), { timeout: 3000 });
    engine.handle('POST', `${W}/workflow-threads/${started.thread_id}/resume`, new URLSearchParams(), { value: 'approved' });
    await waitFor(() => expect(got.length).toBeGreaterThan(2));
    expect(quiet).not.toHaveBeenCalled();
    stream.close();
    const before = got.length;
    engine.handle('POST', `${W}/workflows/sns-weekly/run`, new URLSearchParams(), {});
    await new Promise((r) => setTimeout(r, 60));
    expect(got.length).toBe(before);
    host.stop();
    link.close();
  });

  it('처음 상태로 in the opener (a new engine): the pop-out follows it', async () => {
    const open = bus();
    let engine = newEngine();
    const host = hostDemo('minji@example.com', () => engine, () => 'ko', open);
    const link = (await joinDemo('minji@example.com', { open, want: null }))!;
    const reset = vi.fn();
    link.onReset(reset);
    engine.handle('POST', `${W}/workflows/finance-monthly/run`, new URLSearchParams(), {});
    await waitFor(() => expect(approvals(engine)).toHaveLength(1), { timeout: 3000 });
    engine = newEngine();
    host.swap();
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    const seen = (await (await link.transport.fetch(`/api${W}/approvals`, {})).json()) as ApprovalItem[];
    expect(seen).toEqual([]);
    host.stop();
    link.close();
  });

  it('the opener gone (closed · reloaded): the pop-out is told once and its requests stop', async () => {
    const open = bus();
    const engine = newEngine();
    const host = hostDemo('minji@example.com', () => engine, () => 'ko', open);
    const link = (await joinDemo('minji@example.com', { open, want: null }))!;
    const gone = vi.fn();
    link.onGone(gone);
    host.stop();
    await waitFor(() => expect(gone).toHaveBeenCalledTimes(1));
    expect((await link.transport.fetch(`/api${W}/approvals`, {})).status).toBe(503);
    link.close();
  });

  it('scoped: another account’s demo and another tab’s host are not joined', async () => {
    const open = bus();
    const mine = newEngine();
    const other = newEngine();
    const a = hostDemo('someone@else.com', () => other, () => 'ko', open);
    expect(await joinDemo('minji@example.com', { open, waitMs: 40, want: null })).toBeNull();
    const b = hostDemo('minji@example.com', () => mine, () => 'en', open);
    // a pop-out asks for its opener's host by id; a different id is not taken
    expect(await joinDemo('minji@example.com', { open, waitMs: 40, want: 'not-this-one' })).toBeNull();
    const link = await joinDemo('minji@example.com', { open, want: null });
    expect(link?.locale).toBe('en');
    expect(channelFor('MinJi@Example.com')).toBe('solosquad-demo:minji@example.com');
    a.stop();
    b.stop();
    link?.close();
  });

  it('the pop-out route', () => {
    expect(isPopoutPath('/o/moa/w/hq/office/display')).toBe(true);
    expect(isPopoutPath('/o/moa/w/hq/office')).toBe(false);
  });
});

describe('DemoApp in the pop-out window', () => {
  function stubSite() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/demo/me') return new Response(JSON.stringify({ demo_id: 'minji@example.com', company_name: '에이스상사', locale: 'ko', expires: null }));
        if (url === '/api/demo/event') return new Response('{"ok":true}');
        throw new Error(`the pop-out reached the network: ${url}`);
      }),
    );
  }
  const popout = () =>
    render(
      <I18nProvider locale="ko">
        <MemoryRouter initialEntries={[`${W}/office/display`]}>
          <DemoApp />
        </MemoryRouter>
      </I18nProvider>,
    );

  it('with no opener demo: one line and the two ways out — no demo of its own', async () => {
    stubSite();
    popout();
    const gone = await screen.findByTestId('demo-popout-gone', {}, { timeout: 4000 });
    expect(gone.textContent).toContain(t('demo.popoutGone'));
    expect(screen.getByRole('button', { name: t('demo.popoutBack') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('demo.popoutClose') })).toBeTruthy();
    expect(document.querySelector('.office-display')).toBeNull();
  });

  it.runIf(typeof BroadcastChannel !== 'undefined')('with the opener’s demo: the office display mirrors its approvals, and says so when it goes', async () => {
    stubSite();
    const engine = newEngine();
    const host = hostDemo('minji@example.com', () => engine, () => 'ko');
    popout();
    await waitFor(() => expect(document.querySelector('.office-display')).toBeTruthy(), { timeout: 4000 });
    const pending = () => document.querySelector('.office-stats')?.textContent ?? '';
    await waitFor(() => expect(pending()).toContain(`0 ${t('office.needsAnswer')}`), { timeout: 4000 });
    let tid = '';
    await act(async () => {
      tid = (engine.handle('POST', `${W}/workflows/finance-monthly/run`, new URLSearchParams(), {}).body as { thread_id: string }).thread_id;
    });
    await waitFor(() => expect(pending()).toContain(`1 ${t('office.needsAnswer')}`), { timeout: 4000 });
    await act(async () => {
      engine.handle('POST', `${W}/workflow-threads/${tid}/resume`, new URLSearchParams(), { value: 'approved' });
    });
    await waitFor(() => expect(approvals(engine)[0]?.card.step).toBe('pay'), { timeout: 3000 });
    await act(async () => host.stop());
    expect(await screen.findByTestId('demo-popout-gone', {}, { timeout: 3000 })).toBeTruthy();
  });
});
