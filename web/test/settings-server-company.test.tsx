// 서버 · 회사 (user 2026-11-11): 회사 프로필 → 서버 (detected, read-only, "로컬" on a laptop) and a new
// 회사 tab (법인 / 개인 사업자 · 법인명 or 상호 · 대표자 · 소재지) that the owner edits and staff reads.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import type { Company, Me, ServerFacts } from '../src/api/types.gen';
import { dictionaries, translate, type Locale, type MessageKey } from '../src/i18n';
import { ScopeLayout } from '../src/shell/ScopeLayout';
import { COMPANY, engineData, ownerMe, QuietEventSource, SERVER_LOCAL, staffMe, stubEngine } from './fixtures';
import { renderWith } from './helpers';

const t = (k: MessageKey, v?: Record<string, string | number>, l: Locale = 'ko') => translate(l, k, v);

beforeAll(() => {
  (globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openApp(path: string, data: Record<string, unknown>, who: Me = ownerMe, locale: Locale = 'ko') {
  const api = stubEngine(data);
  renderWith(
    <Routes>
      <Route path="o/:org/*" element={<ScopeLayout />} />
    </Routes>,
    locale,
    { me: who, path },
  );
  await waitFor(() => expect(screen.queryAllByText(t('common.loading', undefined, locale))).toHaveLength(0));
  return api;
}

const tabs = (locale: Locale) =>
  within(screen.getByRole('navigation', { name: translate(locale, 'nav.settings') }))
    .getAllByRole('link')
    .map((a) => a.textContent);

describe('the tabs: 회사 · 서버 instead of 회사 프로필', () => {
  const WORDS: Record<Locale, [string, string, string]> = {
    ko: ['회사', '서버', '로컬'],
    en: ['Company', 'Server', 'Local'],
    'zh-CN': ['公司', '服务器', '本地'],
  };
  it.each(Object.keys(WORDS) as Locale[])('%s', async (locale) => {
    const [company, server, local] = WORDS[locale];
    expect(dictionaries[locale]['server.where.local']).toBe(local);
    await openApp('/o/tesla/settings', engineData({}, 'owner'), ownerMe, locale);
    const names = tabs(locale);
    expect(names).toContain(company);
    expect(names).toContain(server);
    expect(names.join(' ')).not.toMatch(/프로필|Profile|档案/);
  });

  it('the profile keys are gone', () => {
    for (const d of Object.values(dictionaries)) {
      expect(Object.keys(d).filter((k) => k.startsWith('profile.') || k === 'settings.profile' || k.startsWith('connections.entity'))).toEqual([]);
    }
  });
});

describe('서버 — what the server detected, read-only', () => {
  it('a laptop says 로컬 and nothing can be edited', async () => {
    const api = await openApp('/o/tesla/settings/server', engineData({}, 'owner'));
    const panel = screen.getByRole('region', { name: t('settings.server') });
    expect(within(panel).getByText('로컬')).toBeTruthy();
    expect(within(panel).queryByText(t('server.cloud'))).toBeNull(); // no cloud · region rows on a laptop
    expect(within(panel).getByText(SERVER_LOCAL.os)).toBeTruthy();
    expect(within(panel).getByText(t('server.localCountry'))).toBeTruthy();
    expect(panel.querySelectorAll('input, select, textarea, button')).toHaveLength(0);
    // the removed sections are not there
    for (const word of ['모델 계정 보유 법인', '개인정보', '쓰는 언어', '에이전시 접근 방식']) expect(screen.queryByText(word)).toBeNull();
    expect(api.calls.some((c) => c.url.includes('/profile'))).toBe(false);
  });

  it('a cloud server shows the provider, region and country, and marks the overrides', async () => {
    const cloud: ServerFacts = { ...SERVER_LOCAL, where: 'cloud', cloud: 'aws', region: 'ap-northeast-2', country: 'KR', sources: { where: 'detected', cloud: 'detected', region: 'detected', country: 'override' } };
    await openApp('/o/tesla/settings/server', engineData({ '/server': cloud }, 'owner'), ownerMe, 'en');
    const panel = screen.getByRole('region', { name: t('settings.server', undefined, 'en') });
    expect(within(panel).getByText('Cloud')).toBeTruthy();
    expect(within(panel).getByText('AWS')).toBeTruthy();
    expect(within(panel).getByText('ap-northeast-2')).toBeTruthy();
    expect(within(panel).getByText('KR')).toBeTruthy();
    expect(within(panel).getAllByText(t('server.override', undefined, 'en'))).toHaveLength(1);
  });
});

describe('회사 — the owner edits, staff reads', () => {
  it('the owner saves the company; the name label follows 법인 / 개인 사업자', async () => {
    const saved: Company = { ...COMPANY, kind: 'sole_proprietor', name: '모아상회', controlled_by: null };
    const api = await openApp('/o/tesla/settings/company', engineData({ 'PUT /company': () => saved }, 'owner'));
    expect(screen.getByLabelText('법인명')).toBeTruthy();
    expect(screen.getByLabelText(t('company.controlledBy'))).toBeTruthy(); // 법인 only
    fireEvent.change(screen.getByLabelText(t('company.kind')), { target: { value: 'sole_proprietor' } });
    expect(screen.getByLabelText('상호')).toBeTruthy();
    expect(screen.queryByLabelText(t('company.controlledBy'))).toBeNull();
    fireEvent.change(screen.getByLabelText('상호'), { target: { value: '모아상회' } });
    fireEvent.change(screen.getByLabelText(t('company.country')), { target: { value: 'kr' } });
    fireEvent.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(api.calls.find((c) => c.method === 'PUT')).toEqual({
      method: 'PUT',
      url: '/api/company',
      body: { kind: 'sole_proprietor', name: '모아상회', representative: '김대표', country: 'KR', address: COMPANY.address, controlled_by: null },
    });
  });

  it('a validation error shows under its field, in the reader’s language', async () => {
    const bad = () => new Response(JSON.stringify({ error: 'country must be ISO', code: 'company_country_invalid', params: { field: 'country' } }), { status: 400 });
    await openApp('/o/tesla/settings/company', engineData({ 'PUT /company': bad }, 'owner'), ownerMe, 'zh-CN');
    const country = screen.getByLabelText(t('company.country', undefined, 'zh-CN'));
    fireEvent.change(country, { target: { value: 'KOR' } });
    fireEvent.click(screen.getByRole('button', { name: t('common.save', undefined, 'zh-CN') }));
    await waitFor(() => expect(screen.getByText(t('error.company_country_invalid', undefined, 'zh-CN'))).toBeTruthy());
    expect(country.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('country must be ISO')).toBeNull();
  });

  it('a team member reads it and cannot change it', async () => {
    const api = await openApp('/o/tesla/settings/company', engineData(), staffMe);
    expect(screen.getByText(t('settings.readOnly'))).toBeTruthy();
    expect((screen.getByLabelText('법인명') as HTMLInputElement).value).toBe(COMPANY.name);
    expect(screen.getByLabelText('법인명').matches(':disabled')).toBe(true); // the fieldset is disabled
    expect(screen.queryByRole('button', { name: t('common.save') })).toBeNull();
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('connections no longer ask who holds the account', async () => {
    await openApp('/o/tesla/settings/connections', engineData({}, 'owner'));
    expect(screen.queryByText('계정 법인')).toBeNull();
  });
});
