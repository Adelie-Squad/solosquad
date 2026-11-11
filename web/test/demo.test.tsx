// Demo mode on the web (decision 62 · PRD v2.1.0 §3.6.4 · DESIGN.md `### 데모`): the flag
// comes from the server (`Me.demo`). In a demo the settings show and lock ("데모에서는 바꿀 수
// 없어요"), the account button has a 데모 chip, the band names the expiry, 처음 상태로 and 시나리오
// 다시 시작 call the server, the login page with `?demo=1` is the demo login, and the screens
// people open are counted as path patterns — never what they type.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import type { DemoInfo, Me } from '../src/api/types.gen';
import { Login } from '../src/auth/Login';
import { ArtifactBody } from '../src/components/ArtifactBody';
import { DemoLock } from '../src/demo/demo';
import { translate, type Locale, type MessageKey } from '../src/i18n';
import { ScopeLayout } from '../src/shell/ScopeLayout';
import { engineData, ownerMe, QuietEventSource, stubEngine } from './fixtures';
import { me, renderWith } from './helpers';

const t = (k: MessageKey, v?: Record<string, string | number>, l: Locale = 'ko') => translate(l, k, v);

const INFO: DemoInfo = {
  id: 'samsungDemo',
  label: '',
  expires: Date.UTC(2026, 10, 25) / 1000,
  locked: ['company.update', 'users.create', 'workflows.update', 'people.update'],
  contact_url: 'https://solosquad.example/?contact=demo',
  suggestions: ['10월 손익 정리해줘', '보온 텀블러 공급처 비교해줘'],
};
const demoMe: Me = { ...ownerMe, demo: true, demo_info: INFO };
/** Inside the lock's `fieldset disabled` — every control there is disabled by the browser. */
const inLock = (el: Element) => el.closest('fieldset.demo-lock-body')?.hasAttribute('disabled') === true;

beforeAll(() => {
  (globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openApp(path: string, who: Me, extra: Record<string, unknown> = {}) {
  const api = stubEngine({ ...engineData({}, 'owner'), 'POST /demo/events': () => ({ ok: true }), ...extra });
  renderWith(
    <Routes>
      <Route path="o/:org/*" element={<ScopeLayout />} />
    </Routes>,
    'ko',
    { me: who, path },
  );
  await waitFor(() => expect(screen.queryAllByText(t('common.loading'))).toHaveLength(0));
  return api;
}

describe('settings in a demo', () => {
  it('every settings tab but 언어 · 화면 is locked, with the quiet line', async () => {
    await openApp('/o/tesla/settings/company', demoMe);
    const lock = await screen.findByTestId('demo-lock');
    expect(within(lock).getByText(t('demo.locked'))).toBeTruthy();
    const save = within(lock).getByRole('button', { name: t('common.save') });
    expect(inLock(save)).toBe(true);
    for (const input of within(lock).queryAllByRole('textbox')) {
      expect(inLock(input)).toBe(true);
    }
  });

  it('the account tab is locked but logging out is not', async () => {
    await openApp('/o/tesla/settings/account', demoMe);
    const lock = await screen.findByTestId('demo-lock');
    const logout = screen.getByRole('button', { name: t('nav.logout') });
    expect(lock.contains(logout)).toBe(false);
    expect((logout as HTMLButtonElement).disabled).toBe(false);
  });

  it('언어 stays open (a person setting) and no lock outside a demo', async () => {
    await openApp('/o/tesla/settings', demoMe);
    expect(screen.queryByTestId('demo-lock')).toBeNull();
    expect((screen.getByLabelText(t('settings.myLanguage')) as HTMLSelectElement).disabled).toBe(false);
    cleanup();
    await openApp('/o/tesla/settings/company', ownerMe);
    expect(screen.queryByTestId('demo-lock')).toBeNull();
    expect(screen.queryByTestId('demo-band')).toBeNull();
  });

  it('a click on the locked area is counted, by name', async () => {
    const api = await openApp('/o/tesla/settings/company', demoMe);
    fireEvent.pointerDown(await screen.findByTestId('demo-lock'));
    await waitFor(() => {
      const sent = api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/demo/events'));
      expect(sent?.body).toEqual({ kind: 'blocked_click', name: 'settings.company' });
    });
  });

  it('DemoLock disables what is inside', () => {
    renderWith(
      <DemoLock name="x">
        <button>go</button>
      </DemoLock>,
      'en',
      { me: demoMe },
    );
    expect(inLock(screen.getByRole('button', { name: 'go' }))).toBe(true);
    expect(screen.getByText(t('demo.locked', undefined, 'en'))).toBeTruthy();
  });
});

describe('the shell in a demo', () => {
  it('shows the 데모 chip on the account button, the band and 처음 상태로', async () => {
    await openApp('/o/tesla/w/charging/office', demoMe);
    const account = screen.getByRole('link', { name: new RegExp(t('demo.chip')) });
    expect(within(account).getByTestId('demo-chip').textContent).toBe(t('demo.chip'));
    const band = screen.getByTestId('demo-band');
    expect(band.textContent).toContain(t('demo.notice'));
    expect(within(band).getByRole('link', { name: new RegExp(t('demo.contact')) }).getAttribute('href')).toBe(INFO.contact_url);
    expect(screen.getByTestId('demo-reset').textContent).toContain(t('demo.reset'));
  });

  it('no chip, band or reset for a customer', async () => {
    await openApp('/o/tesla/w/charging/office', ownerMe);
    expect(screen.queryByTestId('demo-chip')).toBeNull();
    expect(screen.queryByTestId('demo-band')).toBeNull();
    expect(screen.queryByTestId('demo-reset')).toBeNull();
  });

  it('처음 상태로 asks once, then posts /api/demo/reset', async () => {
    const api = await openApp('/o/tesla/w/charging/office', demoMe, { 'POST /demo/reset': () => ({ ok: true }) });
    vi.stubGlobal('confirm', () => true);
    fireEvent.click(screen.getByTestId('demo-reset'));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/demo/reset'))).toBe(true));
  });

  it('시나리오 다시 시작 is on the workflows screen and posts to its workspace', async () => {
    const api = await openApp('/o/tesla/w/charging/workflows', demoMe, { 'POST /demo/restart': () => ({ workflows: [] }) });
    fireEvent.click(await screen.findByTestId('demo-restart'));
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/o/tesla/w/charging/demo/restart'))).toBe(true),
    );
  });

  it('the screen left is sent as a page view', async () => {
    const api = await openApp('/o/tesla/w/charging/office', demoMe);
    fireEvent.click(screen.getAllByRole('link', { name: new RegExp(t('nav.tasks')) })[0]);
    await waitFor(() => {
      const sent = api.calls.find((c) => c.url.endsWith('/api/demo/events') && (c.body as { kind?: string }).kind === 'page_view');
      expect((sent?.body as { path: string }).path).toBe('/o/tesla/w/charging/office');
    });
  });
});

describe('the demo login', () => {
  const demoHealth = { ok: true, passkeys: true, demo: true, demo_login_url: 'https://solosquad.example/demo' };

  it('?demo=1 has no password form: it sends the visitor to the marketing demo login', async () => {
    const api = stubEngine({ '/health': demoHealth });
    renderWith(<Login />, 'ko', { path: '/login?demo=1', me: me() });
    const go = await screen.findByRole('link', { name: t('demo.loginGo') });
    expect(go.getAttribute('href')).toBe('https://solosquad.example/demo');
    expect(screen.getByText(t('demo.loginElsewhere'))).toBeTruthy();
    expect(screen.queryByLabelText(t('auth.password'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('auth.login') })).toBeNull();
    expect(screen.queryByTestId('passkey-login')).toBeNull();
    expect(api.calls.some((c) => c.url.includes('/api/auth/login'))).toBe(false);
  });

  it('a demo server’s plain /login is the same way there (where a visitor lands after logging out)', async () => {
    stubEngine({ '/health': demoHealth });
    renderWith(<Login />, 'en', { path: '/login', me: me() });
    expect((await screen.findByRole('link', { name: t('demo.loginGo', undefined, 'en') })).getAttribute('href')).toBe('https://solosquad.example/demo');
    expect(screen.queryByLabelText(t('auth.password', undefined, 'en'))).toBeNull();
  });

  it('without a marketing address: one neutral line, no link and no form', async () => {
    stubEngine({ '/health': { ...demoHealth, demo_login_url: null } });
    renderWith(<Login />, 'ko', { path: '/login?demo=1&error=1', me: me() });
    expect(await screen.findByText(t('demo.loginNoSite'))).toBeTruthy();
    expect(screen.queryByRole('link', { name: t('demo.loginGo') })).toBeNull();
    expect(screen.queryByLabelText(t('auth.password'))).toBeNull();
  });

  it('a customer server keeps the account login', async () => {
    stubEngine({ '/health': { ok: true, passkeys: false, demo: false, demo_login_url: null } });
    renderWith(<Login />, 'ko', { path: '/login', me: me() });
    expect(await screen.findByLabelText(t('auth.password'))).toBeTruthy();
    expect(screen.queryByTestId('demo-login-elsewhere')).toBeNull();
  });
});

describe('the demo work products', () => {
  it('draws a purchase order in the supplier language and says nothing is sent', () => {
    renderWith(
      <ArtifactBody
        artifact={{
          id: 'a-1', kind: 'sourcing.po', title: '발주서', thread_id: null, run_id: null, workflow: null,
          needs_review: false, reviewed_by: null, created: 0, schema_version: 1,
          data: {
            supplier: '(예시) 이우 화성무역', language: 'zh-CN', title_local: '采购订单（草稿）', po_number: 'PO-1',
            currency: 'CNY', lines: [{ sku: 'TB', name: '텀블러', name_local: '保温杯', qty: 2, unit_price: 48, amount: 96 }],
            subtotal: 96, total: 96, total_text: '¥96', delivery: '11-28', terms_local: '到港后30天内付款', summary: '',
          },
        }}
      />,
      'ko',
    );
    expect(screen.getByText('保温杯').getAttribute('lang')).toBe('zh-CN');
    expect(screen.getByText(t('art.draftOnly'))).toBeTruthy();
  });
});
