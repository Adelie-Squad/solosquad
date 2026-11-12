// Addresses (DESIGN.md `## 레이아웃` — 주소): `/` → login, no landing (decision 62 · C62) · `/login` ·
// `/o/…` app; signed-out app addresses go to `/login?next=`; logout lands on `/login` with the
// cache emptied; connections moved into Settings with the old addresses redirected.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { App } from '../src/App';
import { keys } from '../src/api/queries';
import type { Me } from '../src/api/types.gen';
import { logOut, useLogout } from '../src/auth/logout';
import { loginFor, officeHref, safeNext } from '../src/auth/next';
import { dictionaries, I18nProvider } from '../src/i18n';
import { legacyTarget, ScopeLayout } from '../src/shell/ScopeLayout';
import { me, renderWith } from './helpers';

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

/** `/api/me` answers `who` (null = 401, logged out); everything else is an empty list. */
function stubApi(who: () => Me | null) {
  const fetch = vi.fn(async (url: string) => {
    if (url.startsWith('/api/me')) {
      const m = who();
      return m ? new Response(JSON.stringify(m), { status: 200 }) : new Response(JSON.stringify({ code: 'login_required' }), { status: 401 });
    }
    if (url.startsWith('/api/auth/logout')) return new Response('{"ok":true}', { status: 200 });
    return new Response('[]', { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function app(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={[path]}>
          <App />
          <Where />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const where = () => screen.getByTestId('where').textContent;

/** jsdom has no EventSource; the shell opens one per workspace (kept for the whole file —
 * a reconnect timer may fire after a test ends). */
class QuietEventSource {
  onopen = null;
  onmessage = null;
  onerror = null;
  addEventListener() {}
  close() {}
}
(globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('next= (same-origin app paths only)', () => {
  it('keeps app paths with their query', () => {
    expect(safeNext('/o/tesla/w/charging/office')).toBe('/o/tesla/w/charging/office');
    expect(safeNext('/o/tesla/settings/users?x=1#y')).toBe('/o/tesla/settings/users?x=1#y');
  });

  it.each(['//evil.example', '//evil.example/o/x', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', 'o/x', '', null, '/login', '/login?next=/o', '/'])(
    'drops %s',
    (raw) => expect(safeNext(raw)).toBeNull(),
  );

  it('builds the login address and the office address', () => {
    expect(loginFor('/o/tesla/w/charging')).toBe('/login?next=%2Fo%2Ftesla%2Fw%2Fcharging');
    expect(loginFor('//evil.example')).toBe('/login');
    // decision 60 — people land on the account dashboard; the sidebar points at the last scope
    expect(officeHref(me({ last_scope: { org: 'tesla', workspace: 'vehicles' } }))).toBe('/dashboard');
    expect(officeHref(me({ scopes: [] }))).toBe('/o');
  });
});

describe('landing · login · app addresses', () => {
  it('signed out: an app address goes to /login?next=<it>', async () => {
    stubApi(() => null);
    app('/o/tesla/w/charging/office');
    await waitFor(() => expect(where()).toBe('/login?next=%2Fo%2Ftesla%2Fw%2Fcharging%2Foffice'));
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy();
  });

  it('signed in: /login goes to next, else the account dashboard (decision 60)', async () => {
    stubApi(() => me({ last_scope: { org: 'tesla', workspace: 'vehicles' } }));
    app('/login');
    await waitFor(() => expect(where()).toBe('/dashboard'));
    cleanup();
    app('/login?next=%2Fo%2Ftesla%2Fsettings%2Fusers');
    await waitFor(() => expect(where()).toBe('/o/tesla/settings/users'));
    cleanup();
    app('/login?next=%2F%2Fevil.example');
    await waitFor(() => expect(where()).toBe('/dashboard'));
  });

  it('a company server’s / is its login, or the dashboard when signed in — no landing (decision 62)', async () => {
    stubApi(() => null);
    app('/');
    await waitFor(() => expect(where()).toBe('/login'));
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy();
    expect(document.querySelector('.landing')).toBeNull();
    cleanup();
    stubApi(() => me({ last_scope: { org: 'tesla', workspace: 'vehicles' } }));
    app('/');
    await waitFor(() => expect(where()).toBe('/dashboard'));
    expect(document.querySelector('.landing')).toBeNull();
  });

  it('the login takes ?u=<id> from the marketing login router to fill the ID', async () => {
    stubApi(() => null);
    app('/login?u=minji');
    expect(((await screen.findByLabelText('Username')) as HTMLInputElement).value).toBe('minji');
  });

  it('C62: nothing the customer app imports reaches the landing, the marketing pages or the demo (code, fixtures or words)', () => {
    const root = join(process.cwd(), 'src');
    const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
    const resolve = (from: string, spec: string) => {
      const base = join(from, '..', spec);
      return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(isFile) ?? null;
    };
    const seen = new Set<string>();
    const styles = new Set<string>();
    const jsons = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const code = readFileSync(file, 'utf8');
      // static imports and re-exports (`import type` too — harmless, but keeps the rule simple), side-effect imports and lazy imports
      for (const m of code.matchAll(/from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|^import\s+['"](\.[^'"]+)['"]/gm)) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (spec.endsWith('.css')) {
          styles.add(spec.split('/').pop()!);
          continue;
        }
        if (spec.endsWith('.json')) {
          jsons.add(spec);
          continue;
        }
        const next = resolve(file, spec);
        if (next) walk(next);
      }
    };
    walk(join(root, 'main.tsx'));
    const reached = [...seen].map((f) => f.slice(root.length + 1).split('\\').join('/'));
    expect(reached.length).toBeGreaterThan(50);
    // the one allowed touch: a type-only import of the marketing keys in i18n (erased in the build)
    const offending = reached.filter((f) => f.startsWith('landing/') || f.startsWith('demo/') || (f.startsWith('marketing/') && f !== 'marketing/messages/ko.ts'));
    expect(offending).toEqual([]);
    // the demo's fixtures (src/demo/data/*.json), its stylesheet and its words stay out too (2026-11-13)
    expect([...jsons]).toEqual([]);
    expect(styles.has('demo.css')).toBe(false);
    for (const l of ['ko', 'en', 'zh-CN'] as const) expect(Object.keys(dictionaries[l]).filter((k) => k.startsWith('demo.'))).toEqual([]);
    expect(readFileSync(join(root, 'i18n/index.tsx'), 'utf8')).toMatch(/import type \{ MarketingKey \} from '\.\.\/marketing\/messages\/ko'/);
  });
});

describe('logout', () => {
  it('forgets the session data and lands on /login without a history entry', async () => {
    let signed = true;
    const fetch = stubApi(() => (signed ? me() : null));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.me, me());
    qc.setQueryData(['o', 'tesla', 'w', 'charging', 'threads'], [{ id: 't1' }]);
    const go = vi.fn();
    signed = false;
    await logOut(qc, go);
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    expect(go).toHaveBeenCalledWith('/login');
    expect(qc.getQueryCache().getAll().map((q) => q.queryKey[0])).toEqual(['me']);
    expect(qc.getQueryData(['o', 'tesla', 'w', 'charging', 'threads'])).toBeUndefined();
  });

  it('replaces the address with /login', async () => {
    stubApi(() => null);
    function Button() {
      const logout = useLogout();
      return <button onClick={() => void logout()}>out</button>;
    }
    renderWith(
      <Routes>
        <Route path="*" element={<><Button /><Where /></>} />
      </Routes>,
      'en',
      { path: '/o/tesla/w/charging/office' },
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'out' })));
    await waitFor(() => expect(where()).toBe('/login'));
  });
});

describe('connections live in Settings', () => {
  it('redirects the old addresses', async () => {
    expect(legacyTarget('/connections', { org: 'tesla', ws: 'charging' })).toBe('/o/tesla/settings/connections');
    stubApi(() => me());
    renderWith(
      <Routes>
        <Route path="o/:org/*" element={<ScopeLayout />} />
      </Routes>,
      'en',
      { path: '/o/tesla/connections', me: me() },
    );
    // the settings screen with the connections tab chosen
    await waitFor(() => expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('aria-current')).toBe('page'));
  });
});
