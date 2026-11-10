// C15 (PRD v2.1.0 §3.4): the owner-only work is refused by the server (python
// `test_web_security.py::test_c15_staff_is_refused_every_owner_only_key`) *and not shown on
// screen*. Every screen of the app is drawn for the owner and for a staff member of the same
// org; each owner-only control must appear for the owner (so the probe is real) and never
// for staff. Giving work and reading reports stay open to both.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { Me } from '../src/api/types.gen';
import { translate, type MessageKey } from '../src/i18n';
import { ScopeLayout } from '../src/shell/ScopeLayout';
import { NAV } from '../src/shell/nav';
import { engineData, ownerMe, QuietEventSource, staffMe, stubEngine } from './fixtures';
import { renderWith } from './helpers';

// the 3D scene is another slice's work — the office screen is drawn with its list fallback
vi.mock('../src/office/OfficeStage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/office/OfficeStage')>();
  return { ...real, OfficeStage: ({ fallback }: { fallback: React.ReactNode }) => <div data-testid="office-stage">{fallback}</div> };
});

const t = (k: MessageKey, v?: Record<string, string | number>) => translate('en', k, v);

beforeAll(() => {
  (globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

async function open(path: string, who: Me) {
  const api = stubEngine(engineData({}, who === ownerMe ? 'owner' : 'staff'));
  renderWith(
    <Routes>
      <Route path="o/:org/*" element={<><ScopeLayout /><Where /></>} />
    </Routes>,
    'en',
    { me: who, path },
  );
  await waitFor(() => expect(screen.queryAllByText(t('common.loading'))).toHaveLength(0));
  return api;
}

const tab = (name: string) => () => within(screen.getByRole('navigation', { name: t('nav.settings') })).queryByRole('link', { name });

/** Every owner-only control (ROUTE_ROLES owner keys a screen can reach), by where it lives. */
const OWNER_ONLY: Record<string, { path: string; probe: () => HTMLElement | null }> = {
  'settings tab: access policy (access.update)': { path: '/o/tesla/settings', probe: tab(t('settings.access')) },
  'settings tab: approval tiers (approval_policy.update)': { path: '/o/tesla/settings', probe: tab(t('settings.tiers')) },
  'settings tab: people (users.*)': { path: '/o/tesla/settings', probe: tab(t('settings.users')) },
  'profile save (profile.update)': { path: '/o/tesla/settings/profile', probe: () => screen.queryByRole('button', { name: t('common.save') }) },
  'snapshot save (snapshot.update)': { path: '/o/tesla/settings/snapshot', probe: () => screen.queryByRole('button', { name: t('common.save') }) },
  'snapshot now (snapshot.run)': { path: '/o/tesla/settings/snapshot', probe: () => screen.queryByRole('button', { name: t('snapshot.runNow') }) },
  'add connection (connections.create)': { path: '/o/tesla/settings/connections', probe: () => screen.queryByRole('button', { name: t('connections.add') }) },
  'connection on/off — budget and switch (connections.update)': {
    path: '/o/tesla/settings/connections',
    probe: () => screen.queryByRole('switch', { name: t('connections.toggle', { id: 'claude-max' }) }),
  },
  'remove connection (connections.delete)': { path: '/o/tesla/settings/connections', probe: () => screen.queryByRole('button', { name: t('common.remove') }) },
  'workflow on/off (workflows.update)': {
    path: '/o/tesla/w/charging/workflows/monthly-pnl',
    probe: () => screen.queryByRole('switch', { name: t('workflows.switch', { name: 'Monthly P&L' }) }),
  },
  'answer an owner-tier card (approval needs owner)': {
    // approvals live in Task (2026-11-07): staff sees the card under "someone else's turn", without buttons
    path: '/o/tesla/w/charging/tasks',
    probe: () => {
      const card = screen.getByText('send the payment').closest('[data-testid="approval-card"]') as HTMLElement;
      return within(card).queryByRole('button', { name: t('approvals.approve') });
    },
  },
};

describe('C15 — what staff is not shown', () => {
  it.each(Object.entries(OWNER_ONLY))('%s: the owner has it, staff does not', async (_, { path, probe }) => {
    await open(path, ownerMe);
    expect(probe()).not.toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    await open(path, staffMe);
    expect(probe()).toBeNull();
  });

  it('opening an owner-only settings tab by its address lands on the first tab', async () => {
    for (const name of ['access', 'approvals', 'users']) {
      const api = await open(`/o/tesla/settings/${name}`, staffMe);
      expect(screen.getByTestId('where').textContent).toBe('/o/tesla/settings');
      // nothing owner-only was even asked for
      expect(api.calls.map((c) => c.url)).not.toContain('/api/users');
      expect(api.calls.map((c) => c.url)).not.toContain('/api/o/tesla/approval-policy');
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('a person in the org chart is read-only for staff (people.update)', async () => {
    for (const [who, editable] of [
      [ownerMe, true],
      [staffMe, false],
    ] as const) {
      const api = await open('/o/tesla/w/charging/office', who);
      fireEvent.click(screen.getByRole('button', { name: `Kim · ${t('role.staff')}` }));
      const dialog = screen.getByRole('dialog', { name: 'Kim' });
      await waitFor(() => expect(!!within(dialog).queryByRole('button', { name: t('common.edit') })).toBe(editable));
      expect(api.calls.some((c) => c.url === '/api/o/tesla/people')).toBe(editable); // staff never loads the editable list
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('the menu is the same for both — none of it is owner-only — and staff wears the staff chip', async () => {
    expect(NAV.filter((n) => n.ownerOnly)).toEqual([]);
    const menu = async (who: Me) => {
      await open('/o/tesla/w/charging', who);
      // decision 60 — two groups: the whole account, then the workspace in the switcher
      const items = [t('nav.accountGroup'), t('nav.workspaceGroup')].flatMap((name) =>
        within(screen.getByRole('navigation', { name })).getAllByRole('link').map((a) => a.getAttribute('href')),
      );
      const chip = document.querySelector('.account-button-role')?.textContent;
      cleanup();
      vi.unstubAllGlobals();
      return { items, chip };
    };
    const owner = await menu(ownerMe);
    const staff = await menu(staffMe);
    expect(staff.items).toEqual(owner.items);
    expect(staff.items).toHaveLength(NAV.length);
    expect([owner.chip, staff.chip]).toEqual([t('role.owner'), t('role.staff')]);
  });

  it('staff still gives work and reads reports: new request, run a workflow, open the P&L', async () => {
    await open('/o/tesla/w/charging/screens/dashboard', staffMe);
    expect(screen.getByRole('button', { name: t('chat.new') })).toBeTruthy();
    expect(screen.getAllByText('손익표').length).toBeGreaterThan(0); // the latest report on the workspace screen
    cleanup();
    vi.unstubAllGlobals();
    await open('/o/tesla/w/charging/workflows/monthly-pnl', staffMe);
    expect(screen.getByRole('button', { name: t('workflows.runNow') })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    await open('/o/tesla/settings/connections', staffMe);
    expect(screen.getByText('claude-max')).toBeTruthy(); // the list is for everyone
  });
});
