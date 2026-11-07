import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client';
import { ERROR_KEYS, errorKey, errorText } from '../src/api/errors';
import type { ErrorCode } from '../src/api/types.gen';
import { QueryError } from '../src/components/Status';
import { dictionaries, LOCALES, translate, type Locale, type Translate } from '../src/i18n';
import { ScopeLayout } from '../src/shell/ScopeLayout';
import schema from '../src/api/schema.json';
import { me, renderWith } from './helpers';

/** The codes as the contract has them — the server's `ErrorCode` (schema.json). */
const CODES = schema.$defs.ErrorCode.enum as ErrorCode[];
const DEV = 'your address 198.51.100.7 is not in the new list — Send confirm_lockout: true';

const tr = (locale: Locale): Translate => (key, vars) => translate(locale, key, vars);
const fail = (code: string | null, params: Record<string, string | number> = {}, status = 400) =>
  new ApiError(status, DEV, code, params);

describe('server error codes → words (DESIGN.md 문구)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('knows every code of the contract, each with its own key', () => {
    expect(CODES.length).toBeGreaterThan(50);
    expect(Object.keys(ERROR_KEYS).sort()).toEqual([...CODES].sort());
    for (const code of CODES) expect(ERROR_KEYS[code]).toBe(`error.${code}`);
  });

  it.each(LOCALES)('%s has words for every code and for an unknown one', (locale) => {
    const dict = dictionaries[locale] as Record<string, string>;
    for (const key of ['error.unknown', ...CODES.map((c) => `error.${c}`)]) {
      expect(dict[key]?.trim(), `${locale} ${key}`).toBeTruthy();
    }
  });

  it.each(LOCALES)('%s fills the params into the text and never shows the server sentence', (locale) => {
    const t = tr(locale);
    const lockout = errorText(fail('access_lockout', { address: '198.51.100.7' }, 409), t);
    expect(lockout).toContain('198.51.100.7');
    expect(lockout).not.toContain('confirm_lockout');
    expect(errorText(fail('password_too_short', { min: 10 }), t)).toContain('10');
    expect(errorText(fail('approval_needs_team', { team: 'business' }, 403), t)).toContain(t('team.business')); // the id, named in the reader's language
    const ineligible = errorText(fail('connection_ineligible_server', { provider: 'anthropic', country: 'HK' }, 422), t);
    expect(ineligible).toContain('anthropic');
    expect(ineligible).toContain('HK');
    for (const code of CODES) expect(errorText(fail(code), t)).not.toContain(DEV);
  });

  it('reads a code the web does not know — or none — as the generic sentence', () => {
    const t = tr('en');
    expect(errorKey(fail('brand_new_code_from_a_newer_server'))).toBe('error.unknown');
    expect(errorKey(fail(null, {}, 500))).toBe('error.unknown');
    expect(errorText(fail('brand_new_code_from_a_newer_server', { x: 'leak' }), t)).toBe(translate('en', 'error.unknown'));
    expect(errorKey(new TypeError('Failed to fetch'))).toBe('common.failed');
  });

  it('maps the scope answers by code, not by the English text (decision 57)', () => {
    expect(errorKey(fail('not_found', {}, 404))).toBe('error.not_found');
    expect(errorKey(fail('feature_disabled', {}, 404))).toBe('error.feature_disabled');
    expect(errorKey(fail('workspace_not_started', {}, 503))).toBe('error.workspace_not_started');
    expect(errorKey(fail('workspace_network_blocked', {}, 403))).toBe('error.workspace_network_blocked');
    expect(errorKey(fail('role_forbidden', {}, 403))).toBe('error.role_forbidden');
  });

  it('takes the code and params from the response body', async () => {
    const body = { error: DEV, code: 'access_lockout', params: { address: '198.51.100.7', junk: { no: 1 } } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 409 })));
    const err = await api.put('/access', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'access_lockout', params: { address: '198.51.100.7' } });
    expect((err as ApiError).params).not.toHaveProperty('junk');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    expect(await api.get('/me').catch((e: unknown) => e)).toMatchObject({ status: 502, code: null });
  });

  it('shows a failed query in the person’s language', () => {
    renderWith(<QueryError error={fail('workspace_network_blocked', {}, 403)} />, 'zh-CN');
    expect(screen.getByRole('alert').textContent).toBe(translate('zh-CN', 'error.workspace_network_blocked'));
    expect(screen.queryByText(DEV)).toBeNull();
  });
});

describe('a workspace that did not start (503 · C31)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubNetwork() {
    const opened: string[] = [];
    class FakeEventSource {
      onopen = null;
      onmessage = null;
      onerror = null;
      constructor(url: string) {
        opened.push(url);
      }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetch = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    return { opened, fetch };
  }

  const layout = (
    <Routes>
      <Route path="o/:org/*" element={<ScopeLayout />} />
    </Routes>
  );

  it('says so and opens no event stream for a running:false workspace', async () => {
    const { opened, fetch } = stubNetwork();
    renderWith(layout, 'en', { me: me(), path: '/o/spacexai/w/hq' }); // hq: running false
    expect(await screen.findByText(translate('en', 'scope.notStartedTitle'))).toBeTruthy();
    expect(screen.getByText(translate('en', 'scope.notStartedBody'))).toBeTruthy();
    expect(opened).toEqual([]);
    const urls = fetch.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls.filter((u) => u.includes('/w/hq/'))).toEqual([]); // nothing asked of the dead runtime
  });

  it('does open the stream for a running workspace (the stub really listens)', async () => {
    const { opened } = stubNetwork();
    renderWith(layout, 'en', { me: me(), path: '/o/tesla/w/charging' });
    await waitFor(() => expect(opened).toEqual(['/api/o/tesla/w/charging/events']));
    expect(screen.queryByText(translate('en', 'scope.notStartedTitle'))).toBeNull();
  });
});
