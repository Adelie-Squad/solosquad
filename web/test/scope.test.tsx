import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { scopedKeys, useApprovals } from '../src/api/queries';
import type { Me } from '../src/api/types.gen';
import { I18nProvider, translate } from '../src/i18n';
import { LiveProvider } from '../src/live/LiveProvider';
import type { EventSourceLike } from '../src/live/stream';
import { defaultScope, defaultWorkspace, ScopeContext, type Scope } from '../src/scope';
import { SessionContext, sessionFrom } from '../src/session';
import { LegacyRedirect, legacyTarget, RootRedirect, ScopeLayout } from '../src/shell/ScopeLayout';
import { ScopeSwitcher } from '../src/shell/ScopeSwitcher';
import { me, renderWith } from './helpers';

/** C30: staff assigned to one workspace only — tesla/charging. */
const staff: Me = me({
  user: { id: 'u-2', username: 'kim', display: 'Kim', role: 'staff', locale: 'ko', two_factor: true, disabled: false, title: '', teams: [], assignments: [{ org: 'tesla', workspace: 'charging', role: 'staff' }] },
  scopes: [{ org: 'tesla', display: 'Tesla', role: 'staff', whole_org: false, workspaces: [{ name: 'charging', role: 'staff', running: true }] }],
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

function routed(path: string, who: Me) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <SessionContext.Provider value={sessionFrom(who)}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route index element={<RootRedirect />} />
              <Route path="o/:org/*" element={<Where />} />
              <Route path="*" element={<LegacyRedirect />} />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('scope in the address (I40)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the last scope, else the first assignment', () => {
    expect(defaultScope(me())).toEqual({ org: 'tesla', ws: 'charging' });
    expect(defaultScope(me({ last_scope: { org: 'spacexai', workspace: 'hq' } }))).toEqual({ org: 'spacexai', ws: 'hq' });
    // a last scope that is no longer assigned is ignored
    expect(defaultScope({ ...staff, last_scope: { org: 'spacexai', workspace: 'hq' } })).toEqual({ org: 'tesla', ws: 'charging' });
    expect(defaultScope(me({ scopes: [] }))).toBeNull();
    expect(defaultWorkspace(me({ last_scope: { org: 'tesla', workspace: 'vehicles' } }), 'tesla')).toBe('vehicles');
  });

  it('sends / and the old unscoped addresses to the current scope', () => {
    routed('/', me({ last_scope: { org: 'tesla', workspace: 'vehicles' } }));
    expect(screen.getByTestId('where').textContent).toBe('/o/tesla/w/vehicles');
    cleanup();
    routed('/office', staff);
    expect(screen.getByTestId('where').textContent).toBe('/o/tesla/w/charging/office');
    cleanup();
    routed('/chat/th-1', staff);
    expect(screen.getByTestId('where').textContent).toBe('/o/tesla/w/charging/chat/th-1');
    cleanup();
    routed('/settings/users', staff);
    expect(screen.getByTestId('where').textContent).toBe('/o/tesla/settings/users');
    expect(legacyTarget('/nothing-here', { org: 'a', ws: 'b' })).toBeNull();
  });

  it('answers "no such page" for an org or workspace outside the assignments (C3 · C30)', () => {
    for (const path of ['/o/spacexai/w/hq', '/o/tesla/w/vehicles', '/o/tesla/w/vehicles/approvals', '/o/nowhere', '/o/nowhere/w/x/office']) {
      renderWith(
        <Routes>
          <Route path="o/:org/*" element={<ScopeLayout />} />
        </Routes>,
        'en',
        { me: staff, path },
      );
      expect(screen.getByText(translate('en', 'scope.notFoundTitle'))).toBeTruthy();
      cleanup();
    }
  });

  it('keeps every scope in its own cache entry and on its own API path', async () => {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify([{ url }]), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let client: ReturnType<typeof useQueryClient> | null = null;
    function Probe() {
      client = useQueryClient();
      const q = useApprovals();
      return <p>{q.data ? 'ready' : 'loading'}</p>;
    }
    const view = (scope: Scope) => (
      <QueryClientProvider client={qc}>
        <ScopeContext.Provider value={scope}>
          <Probe />
        </ScopeContext.Provider>
      </QueryClientProvider>
    );
    const r = render(view({ org: 'tesla', ws: 'charging', inWorkspace: true }));
    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy());
    r.rerender(view({ org: 'spacexai', ws: 'hq', inWorkspace: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/o/tesla/w/charging/approvals', '/api/o/spacexai/w/hq/approvals']);
    const a = client!.getQueryData(scopedKeys({ org: 'tesla', ws: 'charging' }).approvals);
    const b = client!.getQueryData(scopedKeys({ org: 'spacexai', ws: 'hq' }).approvals);
    expect(a).toEqual([{ url: '/api/o/tesla/w/charging/approvals' }]);
    expect(b).toEqual([{ url: '/api/o/spacexai/w/hq/approvals' }]);
  });

  it('closes the event stream when the scope changes and subscribes to the new one', () => {
    const opened: { url: string; closed: boolean }[] = [];
    const factory = (url: string): EventSourceLike => {
      const s = { url, closed: false, onopen: null, onmessage: null, onerror: null, close() { s.closed = true; } };
      opened.push(s);
      return s;
    };
    const qc = new QueryClient();
    const view = (scope: Scope) => (
      <QueryClientProvider client={qc}>
        <ScopeContext.Provider value={scope}>
          <LiveProvider key={`${scope.org}/${scope.ws}`} factory={factory}>
            <p>live</p>
          </LiveProvider>
        </ScopeContext.Provider>
      </QueryClientProvider>
    );
    const r = render(view({ org: 'tesla', ws: 'charging', inWorkspace: true }));
    expect(opened.map((o) => o.url)).toEqual(['/api/o/tesla/w/charging/events']);
    act(() => r.rerender(view({ org: 'tesla', ws: 'vehicles', inWorkspace: true })));
    expect(opened[0].closed).toBe(true);
    expect(opened.at(-1)!.url).toBe('/api/o/tesla/w/vehicles/events');
    expect(opened.at(-1)!.closed).toBe(false);
  });
});

describe('switch menu (DESIGN 전환 메뉴)', () => {
  afterEach(cleanup);

  it('lists only the assignments; a single one shows just the names', () => {
    renderWith(<ScopeSwitcher />, 'en', { me: staff });
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
    expect(screen.getByText('Tesla')).toBeTruthy();
    expect(screen.getByText('charging')).toBeTruthy();
    expect(screen.queryByText('SpaceXAI')).toBeNull();
  });

  it('walks with ↑↓, opens with Enter, closes with Esc and marks what is not started', () => {
    renderWith(
      <Routes>
        <Route path="*" element={<><ScopeSwitcher /><Where /></>} />
      </Routes>,
      'en',
      { path: '/o/tesla/w/charging' },
    );
    fireEvent.click(screen.getByRole('button', { name: /Tesla/ }));
    const list = screen.getByRole('listbox');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['charging✓', 'vehicles', `hq${translate('en', 'scope.stopped')}`]);
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tesla/ }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/o/tesla/w/vehicles');
  });
});
