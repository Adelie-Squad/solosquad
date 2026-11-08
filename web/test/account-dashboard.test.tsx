// Decision 60 (DESIGN.md `### 대시보드`): the account dashboard adds up every workspace the viewer
// may open, filtered by business and workspace; a team member's numbers are only their scopes'.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { Me } from '../src/api/types.gen';
import { addDays, iso } from '../src/lib/calendar';
import { AccountDashboard, scopesIn } from '../src/views/AccountDashboard';
import { budget, calendarDemo, engineData, QuietEventSource, stubEngine } from './fixtures';
import { approval, me, renderWith } from './helpers';

(globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;

const TODAY = iso(new Date());
const demo = calendarDemo(TODAY);

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

const data = (over: Record<string, unknown> = {}) =>
  engineData(
    {
      '/approvals': [approval({ can_approve: true }, { title: 'Send the report' })],
      '/artifacts': [],
      '/budget': budget({ org: { spent_usd: 10, budget_usd: null, remaining_usd: null, warning: false, exhausted: false } }),
      '/calendar/items': demo.list(TODAY, addDays(TODAY, 14)),
      '/calendar/labels': { labels: demo.labels, seeded: {}, preset_errors: {} },
      ...over,
    },
    'owner',
  );

const open = (path: string, who: Me = me()) =>
  renderWith(
    <Routes>
      <Route path="*" element={<><AccountDashboard /><Where /></>} />
    </Routes>,
    'ko',
    { path, me: who },
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const staffOne: Me = me({
  user: { id: 'u-2', username: 'kim', display: 'Kim', role: 'staff', locale: 'ko', two_factor: true, disabled: false, title: '', teams: [], assignments: [] },
  scopes: [{ org: 'tesla', display: 'Tesla', role: 'staff', whole_org: false, workspaces: [{ name: 'charging', display: 'charging', role: 'staff', running: true }] }],
});

describe('the account dashboard', () => {
  it('lists the workspaces a filter covers — only what the person is assigned', () => {
    const scopes = me().scopes;
    expect(scopesIn(scopes, null, null).map((r) => `${r.org}/${r.ws}`)).toEqual(['tesla/charging', 'tesla/vehicles', 'spacexai/hq']);
    expect(scopesIn(scopes, 'tesla', null).map((r) => r.ws)).toEqual(['charging', 'vehicles']);
    expect(scopesIn(scopes, 'tesla', 'vehicles').map((r) => r.ws)).toEqual(['vehicles']);
  });

  it('adds up every running workspace: approvals, today’s 할 일, coming 일정, cost per business', async () => {
    const { calls } = stubEngine(data());
    open('/dashboard');
    const todo = await screen.findByTestId('account-todo');
    // one card per running workspace (charging · vehicles) + today's calendar to-do
    await waitFor(() => expect(within(todo).getAllByText('Send the report')).toHaveLength(2));
    expect(within(todo).getByText('사업계획서 작성/제출')).toBeTruthy();
    expect(within(todo).getAllByText(/^Tesla · (charging|vehicles)$/i).length).toBe(2);
    // spacexai/hq did not start: it is left out, and the screen says so
    expect(calls.some((c) => c.url.includes('/o/spacexai/'))).toBe(false);
    expect(screen.getByText(/시작되지 않은 워크스페이스는 빠졌어요/)).toBeTruthy();
    const upcoming = screen.getByTestId('account-upcoming');
    expect(within(upcoming).getByText('오리엔테이션')).toBeTruthy();
    expect(within(upcoming).getByText('치과 예약')).toBeTruthy(); // my own personal entry
    const cost = screen.getByTestId('account-cost');
    await waitFor(() => expect(within(cost).getAllByText(/\$20\.00/).length).toBe(2)); // the company and its one business
    expect(within(cost).getByText('회사 전체')).toBeTruthy();
    expect(within(cost).getByText('사업별 비용')).toBeTruthy();
  });

  it('the filter chips narrow it to a business, then a workspace — and link to that workspace’s own screen', async () => {
    const { calls } = stubEngine(data());
    open('/dashboard');
    await screen.findByTestId('account-todo');
    const chips = screen.getByRole('group', { name: '보는 범위' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['전체', 'Tesla', 'SpaceXAI']);
    await act(async () => fireEvent.click(within(chips).getByRole('button', { name: 'Tesla' })));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard?org=tesla');
    await act(async () => fireEvent.click(within(screen.getByRole('group', { name: '보는 범위' })).getByRole('button', { name: 'Vehicles' })));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard?org=tesla&ws=vehicles');
    expect(screen.getByRole('link', { name: '이 워크스페이스 화면' }).getAttribute('href')).toBe('/o/tesla/w/vehicles/screens/dashboard');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/calendar/items') && c.url.includes('org=tesla') && c.url.includes('workspace=vehicles'))).toBe(true));
  });

  it('a team member asks only for their own scope; a business they do not have reads as no such page', async () => {
    const { calls } = stubEngine(data());
    open('/dashboard', staffOne);
    await screen.findByTestId('account-todo');
    const scoped = calls.filter((c) => c.url.startsWith('/api/o/')).map((c) => c.url.split('/').slice(0, 6).join('/'));
    expect(new Set(scoped)).toEqual(new Set(['/api/o/tesla/w/charging']));
    expect(screen.queryByRole('group', { name: '보는 범위' })).toBeNull(); // one scope: no chips
    cleanup();
    vi.unstubAllGlobals();
    const again = stubEngine(data());
    open('/dashboard?org=spacexai', staffOne);
    expect(await screen.findByText('없는 페이지예요')).toBeTruthy();
    expect(again.calls.some((c) => c.url.includes('spacexai'))).toBe(false);
  });
});
