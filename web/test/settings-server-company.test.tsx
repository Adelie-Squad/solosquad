// 서버 · 회사 (user 2026-11-11): 회사 프로필 → 서버 (detected, read-only, "로컬" on a laptop) and a new
// 회사 tab (법인 / 개인 사업자 · 법인명 or 상호 · 대표자 · 소재지) that the owner edits and staff reads.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import type { Me, ServerFacts } from '../src/api/types.gen';
import { dictionaries, translate, type Locale, type MessageKey } from '../src/i18n';
import { ScopeLayout } from '../src/shell/ScopeLayout';
import { CN_ENTITY, connection, engineData, entity, ownerMe, QuietEventSource, SERVER_LOCAL, staffMe, stubEngine } from './fixtures';
import { countryName } from '../src/lib/countries';
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

// 여러 법인 (user 2026-11-14 — "어 여러 개 등록할 수 있어"): the 회사 tab is a list of entities.
const TWO = { entities: [entity(), CN_ENTITY] };
const row = (id: number) => document.querySelector(`[data-entity="${id}"]`) as HTMLElement;

describe('회사 — the legal entities', () => {
  it('lists each entity: 대표 법인 chip, kind, country, the number as people read it, what uses it', async () => {
    await openApp('/o/tesla/settings/company', engineData({ '/entities': TWO }, 'owner'));
    const hq = row(1);
    expect(within(hq).getByText('Moa Korea Co.')).toBeTruthy();
    expect(within(hq).getByText(t('company.primary'))).toBeTruthy();
    expect(within(hq).getByText(t('company.kind.corporation'))).toBeTruthy();
    expect(within(hq).getByText(countryName('KR', 'ko'))).toBeTruthy();
    expect(within(hq).getByText('110111-1234569')).toBeTruthy();
    expect(within(hq).getByText(t('company.usedBy', { businesses: 1, connections: 1 }))).toBeTruthy();
    // the 대표 cannot be removed, and says why; it has no "make 대표" button
    const removeHq = within(hq).getByRole('button', { name: t('company.removeOf', { name: 'Moa Korea Co.' }) }) as HTMLButtonElement;
    expect(removeHq.disabled).toBe(true);
    expect(document.getElementById(removeHq.getAttribute('aria-describedby')!)?.textContent).toBe(t('company.blocked.primary'));
    expect(within(hq).queryByRole('button', { name: t('company.makePrimary') })).toBeNull();
    const cn = row(2);
    expect(within(cn).getByText(t('company.kind.foreign'))).toBeTruthy();
    expect(within(cn).getByText(countryName('CN', 'ko'))).toBeTruthy();
    expect(within(cn).getByText(t('company.registration.uscc'), { exact: false })).toBeTruthy();
    expect(within(cn).getByText('91370200MA3C5XL01G')).toBeTruthy();
    expect((within(cn).getByRole('button', { name: t('company.removeOf', { name: CN_ENTITY.name }) }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('an entity in use cannot be removed; another one can be made 대표', async () => {
    const used = { ...CN_ENTITY, removable: false, blocked_by: 'in_use' as const, businesses: [{ org: 'tesla', name: 'Tesla' }] };
    const after = { entities: [{ ...used, is_primary: true }, entity({ is_primary: false })] };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = await openApp('/o/tesla/settings/company', engineData({ '/entities': { entities: [entity(), used] }, 'POST /entities/2/primary': () => after }, 'owner'));
    const remove = within(row(2)).getByRole('button', { name: t('company.removeOf', { name: CN_ENTITY.name }) }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(within(row(2)).getByText(t('company.blocked.in_use'))).toBeTruthy();
    fireEvent.click(within(row(2)).getByRole('button', { name: t('company.makePrimary') }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.url === '/api/entities/2/primary')).toBe(true));
  });

  it('법인 추가: the country first (한국), 개인 사업자 · 법인, the number with its hyphens, checked before sending', async () => {
    const api = await openApp('/o/tesla/settings/company', engineData({ 'POST /entities': (b: unknown) => ({ ...entity({ id: 3, is_primary: false }), ...(b as object) }) }, 'owner'));
    fireEvent.click(screen.getByRole('button', { name: t('company.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('company.add') });
    const country = within(dialog).getByLabelText(t('company.country')) as HTMLSelectElement;
    expect(country.value).toBe('KR');
    expect(country.options[0].value).toBe('KR');
    expect(country.options[1].value).toBe('CN');
    const kinds = within(dialog).getByTestId('entity-kind');
    fireEvent.click(within(kinds).getByRole('radio', { name: t('company.kind.corporation') }));
    const number = within(dialog).getByLabelText(t('company.registration.corporate')) as HTMLInputElement;
    fireEvent.change(number, { target: { value: '1101111234568' } }); // a wrong check digit
    expect(number.value).toBe('110111-1234568');
    fireEvent.change(within(dialog).getByLabelText(t('company.name.corporation')), { target: { value: '모아리빙 주식회사' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('company.addButton') }));
    expect(await within(dialog).findByText(t('company.registrationCheck'))).toBeTruthy();
    expect(number.getAttribute('aria-invalid')).toBe('true');
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.change(number, { target: { value: '1101111234569' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('company.addButton') }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      kind: 'corporation',
      country: 'KR',
      registration_no: '1101111234569',
      name: '모아리빙 주식회사',
      representative: '',
      address: '',
      controlled_by: null,
    });
  });

  it('China: no 개인 사업자 · 법인 toggle, 해외, the 18-character code upper-cased', async () => {
    const api = await openApp('/o/tesla/settings/company', engineData({ 'POST /entities': () => CN_ENTITY }, 'owner'));
    fireEvent.click(screen.getByRole('button', { name: t('company.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('company.add') });
    fireEvent.change(within(dialog).getByLabelText(t('company.country')), { target: { value: 'CN' } });
    expect(within(dialog).queryByTestId('entity-kind')).toBeNull();
    expect(within(dialog).getByText(t('company.kind.foreign'))).toBeTruthy();
    const code = within(dialog).getByLabelText(t('company.registration.uscc')) as HTMLInputElement;
    fireEvent.change(code, { target: { value: '91370200ma3c5xl01g' } });
    expect(code.value).toBe('91370200MA3C5XL01G');
    fireEvent.change(within(dialog).getByLabelText(t('company.name.corporation')), { target: { value: CN_ENTITY.name } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('company.addButton') }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ kind: 'foreign', country: 'CN', registration_no: '91370200MA3C5XL01G' });
  });

  it('a server error shows under its field, in the reader’s language', async () => {
    const bad = () => new Response(JSON.stringify({ error: 'bad number', code: 'entity_registration_invalid', params: { field: 'registration_no', reason: 'check', kind: 'uscc' } }), { status: 400 });
    await openApp('/o/tesla/settings/company', engineData({ '/entities': TWO, 'PATCH /entities/2': bad }, 'owner'), ownerMe, 'zh-CN');
    fireEvent.click(within(row(2)).getByRole('button', { name: t('company.editOf', { name: CN_ENTITY.name }, 'zh-CN') }));
    const dialog = await screen.findByRole('dialog', { name: t('company.editTitle', undefined, 'zh-CN') });
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.save', undefined, 'zh-CN') }));
    expect(await within(dialog).findByText(t('error.entity_registration_invalid', undefined, 'zh-CN'))).toBeTruthy();
    expect(within(dialog).getByLabelText(t('company.registration.uscc', undefined, 'zh-CN')).getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('bad number')).toBeNull();
  });

  it('a team member reads the list and cannot change it', async () => {
    const api = await openApp('/o/tesla/settings/company', engineData({ '/entities': TWO }), staffMe);
    expect(screen.getByText(t('settings.readOnly'))).toBeTruthy();
    expect(within(row(2)).getByText(CN_ENTITY.name)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('company.add') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('common.edit') })).toBeNull();
    expect(api.calls.some((c) => c.method !== 'GET')).toBe(false);
  });
});

describe('연결 — 이 사업의 소속 법인 and each account’s 보유 법인', () => {
  const refused = connection({
    id: 'claude-max',
    eligible: false,
    eligibility_reason: 'anthropic does not serve entities controlled from CN (青岛摩阿贸易有限公司)',
    eligibility_source: 'https://www.anthropic.com/news/updating-restrictions-of-sales-to-unsupported-regions',
    eligibility_by: 'entity',
    eligibility_provider: 'anthropic',
    eligibility_country: 'CN',
    eligibility_entity: CN_ENTITY.name,
  });

  it('the owner picks the 사업’s entity and an account’s holder; a refused one says why in their words', async () => {
    const api = await openApp(
      '/o/tesla/settings/connections',
      engineData({ '/entities': TWO, '/entity': { entity_id: 2, explicit: true }, '/connections': [refused], 'PUT /entity': () => ({ entity_id: 1, explicit: true }), 'PATCH /connections/claude-max': () => refused }, 'owner'),
    );
    const business = (await screen.findByRole('combobox', { name: t('connections.businessEntity') })) as HTMLSelectElement;
    await waitFor(() => expect(business.value).toBe('2'));
    expect([...business.options].map((o) => o.textContent)).toEqual([`Moa Korea Co. · ${t('company.primary')}`, CN_ENTITY.name]);
    expect(screen.getByText(`${t('error.connection_ineligible_company', { provider: 'anthropic', country: 'CN' })} ${t('connections.refusedEntity', { entity: CN_ENTITY.name })}`)).toBeTruthy();
    expect(screen.queryByText(refused.eligibility_reason!)).toBeNull(); // never the server's English
    fireEvent.change(business, { target: { value: '1' } });
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')).toEqual({ method: 'PUT', url: '/api/o/tesla/entity', body: { entity_id: 1 } }));
    const holder = screen.getByLabelText(t('connections.owner')) as HTMLSelectElement;
    expect(holder.value).toBe('1');
    fireEvent.change(holder, { target: { value: '2' } });
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PATCH')).toEqual({ method: 'PATCH', url: '/api/o/tesla/connections/claude-max', body: { entity_id: 2 } }));
  });

  it('a team member sees the entities as text', async () => {
    await openApp('/o/tesla/settings/connections', engineData({ '/entities': TWO, '/entity': { entity_id: 2, explicit: true } }), staffMe);
    expect(screen.queryByRole('combobox', { name: t('connections.businessEntity') })).toBeNull();
    expect(await screen.findByText(CN_ENTITY.name)).toBeTruthy();
  });
});

