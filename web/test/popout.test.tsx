// The office in its own window (DESIGN.md `## 사무실 장면` — 새 창, 2026-11-09): the display
// route shows the scene and the live work only; "새 창으로 띄우기" opens it, a second click brings
// it forward, a blocked pop-up says so; the office screen dims while the pop-out is alive and
// comes back when it closes or stops beating; the pop-out has its own full screen; logging out
// in one window sends the pop-out to the login.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { App } from '../src/App';
import type { Me } from '../src/api/types.gen';
import { translate, I18nProvider, type MessageKey } from '../src/i18n';
import { DATA_CHANNEL, SESSION_CHANNEL } from '../src/lib/channels';
import { channelName, displayPath, TIMEOUT_MS, windowName } from '../src/office/popout';
import { ScopeLayout } from '../src/shell/ScopeLayout';
import { OfficeDisplay } from '../src/views/OfficeDisplay';
import { OfficeView } from '../src/views/OfficeView';
import { engineData, QuietEventSource, staffMe, stubEngine } from './fixtures';
import { renderWith } from './helpers';

vi.mock('../src/office/OfficeStage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/office/OfficeStage')>();
  return {
    ...real,
    OfficeStage: ({ fallback, paused }: { fallback: React.ReactNode; paused?: boolean }) => (
      <div data-testid="office-stage" data-paused={paused ? 'yes' : 'no'}>
        {fallback}
      </div>
    ),
  };
});

const t = (k: MessageKey, v?: Record<string, string | number>) => translate('en', k, v);

/** In-memory BroadcastChannel: same name, other instances, delivered on the next microtask. */
class FakeChannel {
  static all: FakeChannel[] = [];
  private listeners = new Set<(e: MessageEvent) => void>();
  closed = false;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const ch of FakeChannel.all) {
      if (ch === this || ch.closed || ch.name !== this.name) continue;
      queueMicrotask(() => !ch.closed && ch.listeners.forEach((l) => l(new MessageEvent('message', { data }))));
    }
  }
  addEventListener(_: 'message', l: (e: MessageEvent) => void) {
    this.listeners.add(l);
  }
  removeEventListener(_: 'message', l: (e: MessageEvent) => void) {
    this.listeners.delete(l);
  }
  close() {
    this.closed = true;
    FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
  }
}

/** A test's own end of a channel: what it heard, and a way to talk. */
function tap(name: string) {
  const ch = new FakeChannel(name);
  const heard: unknown[] = [];
  ch.addEventListener('message', (e) => heard.push(e.data));
  return {
    heard,
    say: async (data: unknown) => {
      await act(async () => {
        ch.postMessage(data);
        await Promise.resolve();
      });
    },
  };
}

function fakeWindow() {
  return { closed: false, focus: vi.fn(), close: vi.fn(), moveTo: vi.fn(), location: { href: '/x', replace: vi.fn() } };
}

beforeAll(() => {
  (globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;
});

beforeEach(() => {
  FakeChannel.all = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settled = () => waitFor(() => expect(screen.queryAllByText(t('common.loading'))).toHaveLength(0));

const OFFICE = '/o/tesla/w/charging/office';
const DISPLAY = '/o/tesla/w/charging/office/display';

async function office() {
  stubEngine(engineData());
  renderWith(<OfficeView />, 'en', { me: staffMe, path: OFFICE });
  await settled();
}

const popoutButton = () => screen.getByRole('button', { name: t('office.popout') });
const body = () => document.querySelector('.office-body') as HTMLElement;

describe('the display route', () => {
  it('draws the scene, the live work and the title with its numbers — nothing else', async () => {
    stubEngine(engineData());
    renderWith(
      <Routes>
        <Route path="o/:org/*" element={<ScopeLayout />} />
      </Routes>,
      'en',
      { me: staffMe, path: DISPLAY },
    );
    await settled();
    const main = document.querySelector('.office-display') as HTMLElement;
    expect(main).toBeTruthy();
    expect(screen.getByTestId('office-stage')).toBeTruthy();
    expect(main.querySelector('.office-live')).toBeTruthy();
    // the title and 진행 중 · 승인 대기 · 오늘 완료 sit inside the scene
    const overlay = main.querySelector('.office-display-scene .office-display-overlay') as HTMLElement;
    expect(overlay.querySelector('h1')?.textContent).toBe(t('office.title'));
    expect(overlay.querySelector('.office-stats')?.textContent).toBe(
      `0 ${t('job.running')}2 ${t('office.needsAnswer')}0 ${t('office.doneToday')}`,
    );
    // no shell, no page header, no org chart, no pop-out button
    expect(document.querySelector('.workspace')).toBeNull();
    expect(document.querySelector('nav')).toBeNull();
    expect(document.querySelector('.view-header')).toBeNull();
    expect(document.querySelector('.office-org')).toBeNull();
    expect(screen.queryByRole('button', { name: t('office.popout') })).toBeNull();
    expect(document.title).toBe(t('office.displayTitle', { org: 'Tesla', ws: 'charging' }));
  });

  it('says it is open, beats, and says goodbye', async () => {
    const ch = tap(channelName('tesla', 'charging'));
    stubEngine(engineData());
    const view = renderWith(<OfficeDisplay />, 'en', { me: staffMe, path: DISPLAY });
    await settled();
    expect(ch.heard).toContainEqual(expect.objectContaining({ type: 'opened' }));
    await ch.say({ type: 'ping' });
    await act(async () => Promise.resolve());
    expect(ch.heard).toContainEqual(expect.objectContaining({ type: 'heartbeat' }));
    view.unmount();
    await act(async () => Promise.resolve());
    expect(ch.heard.at(-1)).toEqual(expect.objectContaining({ type: 'closed' }));
  });

  it('asks again when another window changed something', async () => {
    const { fetch } = stubEngine(engineData());
    renderWith(<OfficeDisplay />, 'en', { me: staffMe, path: DISPLAY });
    await settled();
    const asked = () => fetch.mock.calls.filter(([u]) => String(u).includes('/approvals')).length;
    const before = asked();
    await tap(DATA_CHANNEL).say({ type: 'refetch' });
    await waitFor(() => expect(asked()).toBeGreaterThan(before));
  });

  it('its full-screen button asks this window for full screen', async () => {
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true });
    stubEngine(engineData());
    renderWith(<OfficeDisplay />, 'en', { me: staffMe, path: DISPLAY });
    await settled();
    fireEvent.click(screen.getByRole('button', { name: t('office.fullscreen') }));
    expect(request).toHaveBeenCalledTimes(1);
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
  });
});

describe('the office screen opens the pop-out', () => {
  it('"Open in new window" opens the display route in a named window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow() as unknown as Window);
    await office();
    fireEvent.click(popoutButton());
    expect(open).toHaveBeenCalledWith(displayPath('tesla', 'charging'), windowName('tesla', 'charging'), expect.stringContaining('width=1280'));
    expect(displayPath('tesla', 'charging')).toBe(DISPLAY);
  });

  it('a second click brings the open window forward instead of opening another', async () => {
    const win = fakeWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    await office();
    fireEvent.click(popoutButton());
    fireEvent.click(popoutButton());
    expect(open).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it('says so when the browser blocks the window', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await office();
    fireEvent.click(popoutButton());
    expect(screen.getByRole('alert').textContent).toBe(t('office.popoutBlocked'));
    expect(body().classList.contains('is-popped')).toBe(false);
  });

  it('"Show here" closes the pop-out and restores the office', async () => {
    const win = fakeWindow();
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    const ch = tap(channelName('tesla', 'charging'));
    await office();
    fireEvent.click(popoutButton());
    expect(body().classList.contains('is-popped')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: t('office.popoutHere') }));
    await act(async () => Promise.resolve());
    expect(win.close).toHaveBeenCalled();
    expect(ch.heard).toContainEqual({ type: 'close' });
    expect(body().classList.contains('is-popped')).toBe(false);
  });
});

describe('the office screen while the pop-out is open', () => {
  it('dims the scene and the live work on "opened", and comes back on "closed"', async () => {
    const ch = tap(channelName('tesla', 'charging'));
    await office();
    expect(ch.heard).toContainEqual({ type: 'ping' }); // is one open already? (after a reload)
    await ch.say({ type: 'opened', id: 'p1' });
    expect(body().classList.contains('is-popped')).toBe(true);
    expect(document.querySelector('.office-main')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.office-live')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('office-stage').dataset.paused).toBe('yes');
    expect(screen.getByRole('status').textContent).toBe(t('office.popoutOn'));
    expect(screen.getByRole('button', { name: t('office.popoutGo') })).toBeTruthy();
    // the rest of the page stays usable
    expect(document.querySelector('.office-org')?.getAttribute('aria-hidden')).toBeNull();

    await ch.say({ type: 'closed', id: 'p1' });
    expect(body().classList.contains('is-popped')).toBe(false);
    expect(document.querySelector('.office-main')?.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByTestId('office-stage').dataset.paused).toBe('no');
  });

  it('comes back when the heartbeat stops', async () => {
    const ch = tap(channelName('tesla', 'charging'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await office();
    await ch.say({ type: 'opened', id: 'p1' });
    expect(body().classList.contains('is-popped')).toBe(true);
    // beating — stays dimmed
    for (let i = 0; i < 3; i++) {
      await act(async () => vi.advanceTimersByTime(1000));
      await ch.say({ type: 'heartbeat', id: 'p1' });
    }
    expect(body().classList.contains('is-popped')).toBe(true);
    // silence (a crashed or killed window, no pagehide)
    await act(async () => {
      vi.advanceTimersByTime(TIMEOUT_MS + 1000);
      await Promise.resolve();
    });
    await act(async () => Promise.resolve());
    expect(body().classList.contains('is-popped')).toBe(false);
  });

  it('comes back as soon as the window it opened is closed', async () => {
    const win = fakeWindow();
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await office();
    fireEvent.click(popoutButton());
    expect(body().classList.contains('is-popped')).toBe(true);
    win.closed = true;
    await act(async () => vi.advanceTimersByTime(600));
    expect(body().classList.contains('is-popped')).toBe(false);
  });
});

describe('one session across windows', () => {
  function Where() {
    const l = useLocation();
    return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
  }

  it('a logout in the main window sends the pop-out to the login', async () => {
    let who: Me | null = staffMe;
    const { fetch: engine } = stubEngine(engineData({ '/me': staffMe }));
    // signed out, the server answers 401 to everything
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      who ? engine(url, init) : Promise.resolve(new Response(JSON.stringify({ code: 'login_required' }), { status: 401 })),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nProvider locale="en">
          <MemoryRouter initialEntries={[DISPLAY]}>
            <App />
            <Where />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.querySelector('.office-display')).toBeTruthy());
    const session = tap(SESSION_CHANNEL);

    who = null; // the server forgot the session
    await session.say({ type: 'logout' });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/login?next=${encodeURIComponent(DISPLAY)}`));
    expect(document.querySelector('.office-display')).toBeNull();
    // the agents it showed are gone from its cache
    expect(qc.getQueryCache().findAll().filter((q) => q.queryKey[0] !== 'me' && q.state.data !== undefined)).toEqual([]);
    // and it tells the others (the main window already knows — it ignores this)
    expect(session.heard).toContainEqual({ type: 'logout' });
  });
});
