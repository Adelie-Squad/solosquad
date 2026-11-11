// Settings polish (user 2026-11-11): one screen language per person (no company default) ·
// 내 계정 → 계정 · 사람 → 구성원 · 구성원 추가 = one button and a modal.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import type { Me, PublicUser } from '../src/api/types.gen';
import { dictionaries, translate, type Locale, type MessageKey } from '../src/i18n';
import { ScopeLayout } from '../src/shell/ScopeLayout';
import { engineData, ownerMe, QuietEventSource, staffMe, stubEngine } from './fixtures';
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

const settingsTabs = (locale: Locale) =>
  within(screen.getByRole('navigation', { name: translate(locale, 'nav.settings') }))
    .getAllByRole('link')
    .map((a) => a.textContent);

describe('the words: 계정 · 구성원 in three languages', () => {
  const WORDS: Record<Locale, { account: string; members: string; add: string }> = {
    ko: { account: '계정', members: '구성원', add: '구성원 추가' },
    en: { account: 'Account', members: 'Members', add: 'Add member' },
    'zh-CN': { account: '账户', members: '成员', add: '添加成员' },
  };

  it.each(Object.keys(WORDS) as Locale[])('%s', (locale) => {
    const d = dictionaries[locale];
    expect(d['settings.account']).toBe(WORDS[locale].account);
    expect(d['settings.users']).toBe(WORDS[locale].members);
    expect(d['users.add']).toBe(WORDS[locale].add);
    expect(d['users.addTitle']).toBe(WORDS[locale].add);
  });

  it.each(['ko', 'en', 'zh-CN'] as const)('%s: the settings tabs say them', async (locale) => {
    await openApp('/o/tesla/settings', engineData({}, 'owner'), ownerMe, locale);
    const tabs = settingsTabs(locale);
    expect(tabs).toContain(WORDS[locale].account);
    expect(tabs).toContain(WORDS[locale].members);
    expect(tabs.join(' ')).not.toMatch(/내 계정|My account|我的账户|사람|People|人员/);
  });

  it('the company-default keys are gone from every language', () => {
    for (const d of Object.values(dictionaries)) {
      for (const key of ['settings.followOrg', 'settings.orgLanguage', 'settings.orgLanguageHint', 'profile.defaultLanguage']) {
        expect(key in d).toBe(false);
      }
    }
  });
});

describe('언어 — my screen language only', () => {
  it('changing it saves it on my account and redraws the screen', async () => {
    const zh: Me = { ...staffMe, locale: 'zh-CN', user: { ...staffMe.user!, locale: 'zh-CN' } };
    const api = await openApp('/o/tesla/settings', engineData({ 'PATCH /me': () => zh }), staffMe, 'ko');
    const select = screen.getByRole('combobox', { name: t('settings.myLanguage') }) as HTMLSelectElement;
    expect(select.value).toBe('ko');
    fireEvent.change(select, { target: { value: 'zh-CN' } });
    await waitFor(() => expect(screen.getByRole('heading', { name: t('nav.settings', undefined, 'zh-CN') })).toBeTruthy());
    expect(api.calls.filter((c) => c.method === 'PATCH')).toEqual([{ method: 'PATCH', url: '/api/me', body: { locale: 'zh-CN' } }]);
    expect(settingsTabs('zh-CN')).toContain('账户');
    // the device remembers it for the screens before login
    expect(localStorage.getItem('solosquad.locale')).toBe('zh-CN');
  });

});

describe('구성원 — the list and one 구성원 추가 button', () => {
  const lee: PublicUser = { id: 'u-3', username: 'lee', display: 'Lee', role: 'staff', locale: 'ko', two_factor: false, disabled: false, title: '', teams: [], assignments: [{ org: 'tesla', workspace: null, role: 'staff' }] };

  it('the tab has no inline form — only the list and the button', async () => {
    await openApp('/o/tesla/settings/users', engineData({}, 'owner'));
    expect(screen.getByRole('table', { name: t('settings.users') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('users.add') })).toBeTruthy();
    expect(screen.queryByPlaceholderText(t('users.username'))).toBeNull();
    expect(screen.queryByLabelText(t('users.initialPassword'))).toBeNull();
  });

  it('the button opens the modal; validation errors show inside it and nothing is sent', async () => {
    const api = await openApp('/o/tesla/settings/users', engineData({}, 'owner'));
    const opener = screen.getByRole('button', { name: t('users.add') });
    opener.focus(); // a real click focuses the button; jsdom's does not
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: t('users.addTitle') });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByLabelText(t('users.username')));
    expect(document.documentElement.style.overflow).toBe('hidden'); // the page behind stays put
    fireEvent.change(within(dialog).getByLabelText(t('users.initialPassword')), { target: { value: 'short' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('users.submitAdd') }));
    expect(within(dialog).getByText(t('users.usernameRequired'))).toBeTruthy();
    expect(within(dialog).getByText(t('users.passwordShort', { n: 10 }))).toBeTruthy();
    expect(within(dialog).getByLabelText(t('users.username')).getAttribute('aria-invalid')).toBe('true');
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    // a 팀원 needs somewhere to work
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.remove') }));
    fireEvent.change(within(dialog).getByLabelText(t('users.username')), { target: { value: 'lee' } });
    fireEvent.change(within(dialog).getByLabelText(t('users.initialPassword')), { target: { value: 'long enough pw' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('users.submitAdd') }));
    expect(within(dialog).getByText(t('users.assignRequired'))).toBeTruthy();
    // Esc closes it and hands focus back to the button
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('a server error shows in the modal, by its code', async () => {
    const taken = () =>
      new Response(JSON.stringify({ error: 'taken', code: 'username_taken', params: { username: 'kim' } }), { status: 409 });
    await openApp('/o/tesla/settings/users', engineData({ 'POST /users': taken }, 'owner'));
    fireEvent.click(screen.getByRole('button', { name: t('users.add') }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('users.username')), { target: { value: 'kim' } });
    fireEvent.change(within(dialog).getByLabelText(t('users.initialPassword')), { target: { value: 'long enough pw' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('users.submitAdd') }));
    await waitFor(() => expect(within(dialog).getByText(t('error.username_taken', { username: 'kim' }))).toBeTruthy());
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('submit adds the member: the modal closes, the row is in the list and takes focus', async () => {
    const api = await openApp('/o/tesla/settings/users', engineData({ 'POST /users': () => lee }, 'owner'));
    fireEvent.click(screen.getByRole('button', { name: t('users.add') }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('users.username')), { target: { value: 'lee' } });
    fireEvent.change(within(dialog).getByLabelText(t('users.display')), { target: { value: 'Lee' } });
    fireEvent.change(within(dialog).getByLabelText(t('users.initialPassword')), { target: { value: 'long enough pw' } });
    fireEvent.change(within(dialog).getByLabelText(t('settings.myLanguage')), { target: { value: 'en' } });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: t('users.submitAdd') })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      username: 'lee',
      display: 'Lee',
      password: 'long enough pw',
      role: 'staff',
      locale: 'en',
      assignments: [{ org: 'tesla', workspace: null, role: 'staff' }],
    });
    const row = await waitFor(() => {
      const r = document.querySelector('tr[data-user="u-3"]') as HTMLElement | null;
      expect(r).toBeTruthy();
      return r!;
    });
    expect(row.textContent).toContain('@lee');
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('Tab stays inside the modal', async () => {
    await openApp('/o/tesla/settings/users', engineData({}, 'owner'));
    fireEvent.click(screen.getByRole('button', { name: t('users.add') }));
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: t('common.close') });
    const submit = within(dialog).getByRole('button', { name: t('users.submitAdd') });
    submit.focus();
    fireEvent.keyDown(submit, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submit);
  });

  it('a 팀원 does not get the tab', async () => {
    await openApp('/o/tesla/settings', engineData(), staffMe);
    expect(settingsTabs('ko')).not.toContain('구성원');
  });
});
