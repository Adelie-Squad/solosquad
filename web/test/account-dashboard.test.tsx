// Decision 60 + 2026-11-10 (DESIGN.md `### 대시보드`): the account dashboard adds up every workspace
// the viewer may open, filtered by business and workspace — first 자리를 비운 동안 (the engine's
// digest, with approvals answerable in place), then the four work tabs and their lists, then cost.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { Digest, Me, WorkEntry } from '../src/api/types.gen';
import { dictionaries, type Locale, type MessageKey } from '../src/i18n';
import { addDays, iso } from '../src/lib/calendar';
import { digestHeadline, durationText } from '../src/lib/digest';
import { AccountDashboard, scopesIn } from '../src/views/AccountDashboard';
import { defaultTab } from '../src/views/dashboard/WorkTabs';
import { budget, calendarDemo, engineData, QuietEventSource, stubEngine } from './fixtures';
import { approval, me, renderWith } from './helpers';

(globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;

const TODAY = iso(new Date());
const NOW = Date.now() / 1000;
const demo = calendarDemo(TODAY);

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

const workItem = (over: Partial<WorkEntry>): WorkEntry => ({
  source: 'chat', thread_id: 'th-w', run_id: 'run-w', title: 'Compare suppliers', workflow: null, cron: null,
  status: 'success', created: NOW - 600, ended: NOW - 60, agents: ['chief'], step: null, steps: null,
  current_step: null, artifacts: [], ...over,
});

function digest(over: Partial<Digest> = {}): Digest {
  const base: Digest = {
    basis: 'away',
    since: NOW - 3 * 3600,
    until: NOW,
    finished: [
      { org: 'tesla', workspace: 'charging', source: 'chat', thread_id: 'th-d1', run_id: 'r-d1', title: '정산 정리', workflow: null, cron: null, status: 'success', ended: NOW - 1800, agents: ['finance'], artifacts: [{ id: 'art-1', kind: 'finance.pnl', title: '10월 손익표', needs_review: true }], error: null },
    ],
    failed: [],
    approvals_mine: [{ org: 'tesla', workspace: 'vehicles', ...approval({ thread_id: 'th-dig', run_id: 'run-dig', can_approve: true }, { title: 'Pay the supplier' }) }],
    approvals_others: [{ org: 'tesla', workspace: 'charging', ...approval({ thread_id: 'th-oth', run_id: 'run-oth', can_approve: false, tier: 'owner' }, { title: 'Owner only' }) }],
    decided: [],
    scheduled: [{ org: 'tesla', workspace: 'charging', run_id: 'r-s1', thread_id: 'th-s1', kind: 'cron', name: 'sales-goal', title: 'sales-goal', status: 'success', created: NOW - 7000, artifacts: [] }],
    calendar: [],
    cost: { spent_usd: 1.25, orgs: [{ org: 'tesla', display: 'Tesla', spent_usd: 1.25 }] },
    counts: { finished: 1, failed: 0, approvals_mine: 1, approvals_others: 1, decided: 0, scheduled: 1, calendar: 0 },
    cap: 20,
  };
  return { ...base, ...over };
}

const data = (over: Record<string, unknown> = {}) =>
  engineData(
    {
      '/approvals': [approval({ can_approve: true }, { title: 'Send the report' }), approval({ can_approve: false, tier: 'owner', run_id: 'run-x', thread_id: 'th-x' }, { title: 'Transfer money' })],
      '/artifacts': [],
      '/work': { items: [workItem({ thread_id: 'th-run', status: 'running', title: 'Drafting the newsletter', ended: null }), workItem({ thread_id: 'th-done', title: 'Compare suppliers' })] },
      '/schedules': { timezone: 'Asia/Seoul', errors: [], schedules: [{ id: 'cron:sales-goal', kind: 'goal', name: 'sales-goal', title: 'sales-goal', schedule: '30 8 * * 1-5', enabled: true, next_run: NOW + 3600, last_run: null, workflow: null }] },
      '/budget': budget({ org: { spent_usd: 10, budget_usd: null, remaining_usd: null, warning: false, exhausted: false } }),
      '/calendar/items': demo.list(TODAY, addDays(TODAY, 14)),
      '/calendar/labels': { labels: demo.labels, seeded: {}, preset_errors: {} },
      '/me/digest': digest({ basis: 'acknowledged', finished: [], approvals_mine: [], approvals_others: [], scheduled: [], cost: { spent_usd: 0, orgs: [] }, counts: { finished: 0, failed: 0, approvals_mine: 0, approvals_others: 0, decided: 0, scheduled: 0, calendar: 0 } }),
      ...over,
    },
    'owner',
  );

const open = (path: string, who: Me = me(), locale: Locale = 'ko') =>
  renderWith(
    <Routes>
      <Route path="*" element={<><AccountDashboard /><Where /></>} />
    </Routes>,
    locale,
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

const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('the account dashboard', () => {
  it('lists the workspaces a filter covers — only what the person is assigned', () => {
    const scopes = me().scopes;
    expect(scopesIn(scopes, null, null).map((r) => `${r.org}/${r.ws}`)).toEqual(['tesla/charging', 'tesla/vehicles', 'spacexai/hq']);
    expect(scopesIn(scopes, 'tesla', null).map((r) => r.ws)).toEqual(['charging', 'vehicles']);
    expect(scopesIn(scopes, 'tesla', 'vehicles').map((r) => r.ws)).toEqual(['vehicles']);
  });

  it('has four stat tabs, no 지금 일하는 에이전트 / 내가 할 일 / 다음 실행 / 다가오는 일정, and cost lives in 비용', async () => {
    const { calls } = stubEngine(data());
    open('/dashboard');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.querySelector('.dash-stat-label')?.textContent)).toEqual(['진행 예정', '진행 중', '승인 대기', '오늘 완료']);
    expect(screen.getByRole('tablist', { name: '작업 현황' })).toBeTruthy();
    for (const gone of ['지금 일하는 에이전트', '내가 할 일', '다음 실행', '다가오는 일정']) expect(screen.queryByRole('heading', { name: gone })).toBeNull();
    expect(screen.queryByTestId('stat-cost')).toBeNull();
    expect(within(screen.getByTestId('stats')).queryByText('이번 달 비용')).toBeNull();
    const cost = screen.getByTestId('account-cost');
    expect(within(cost).getByRole('heading', { name: '비용' })).toBeTruthy();
    await waitFor(() => expect(within(cost).getAllByText(/\$20\.00/).length).toBe(2)); // the company this month and its one business
    expect(within(cost).getByText('이번 달 회사 전체')).toBeTruthy();
    expect(within(cost).getByText('사업별 비용')).toBeTruthy();
    // spacexai/hq did not start: it is left out, and the screen says so
    expect(calls.some((c) => c.url.includes('/o/spacexai/'))).toBe(false);
    expect(screen.getByText(/시작되지 않은 워크스페이스는 빠졌어요/)).toBeTruthy();
  });

  it('opens on 승인 대기 when something is my turn: cards answered in place, 다른 사람 차례 folded', async () => {
    const { calls } = stubEngine(data({ 'POST /o/tesla/w/charging/threads/th-1/resume': () => ({ run_id: 'r' }) }));
    open('/dashboard');
    await waitFor(() => expect(tab(/승인 대기/).getAttribute('aria-selected')).toBe('true'));
    const waiting = tab(/승인 대기/);
    expect(waiting.textContent).toContain('4'); // 2 workspaces × (mine + someone else's)
    expect(waiting.textContent).toContain('내 차례 2');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(waiting.id);
    expect(waiting.getAttribute('aria-controls')).toBe(panel.id);
    const mine = within(panel).getByTestId('waiting-mine');
    expect(within(mine).getAllByText('Send the report')).toHaveLength(2);
    expect(within(mine).getAllByText(/^Tesla · (charging|vehicles)$/i).length).toBe(2);
    const others = within(panel).getByTestId('waiting-others') as HTMLDetailsElement;
    expect(others.open).toBe(false);
    expect(within(others).getByText('다른 사람 차례 2')).toBeTruthy();
    expect(within(others).getAllByTestId('approval-blocked').length).toBe(2); // the reason line, no buttons
    await act(async () => fireEvent.click(within(mine).getAllByRole('button', { name: '승인' })[0]));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/o/tesla/w/charging/threads/th-1/resume')).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/th-1/resume'))?.body).toEqual({ value: 'approved' });
  });

  it('the default tab: 승인 대기 if mine, else 진행 중, else 진행 예정', () => {
    const r = { org: 'tesla', ws: 'charging', orgDisplay: 'Tesla', wsDisplay: 'charging', running: true };
    const a = approval();
    const w = workItem({ status: 'running' });
    expect(defaultTab({ mine: [{ r, a }], reviews: [], running: [{ r, w }] })).toBe('waiting');
    expect(defaultTab({ mine: [], reviews: [{ r, a: { id: 'x' } as never }], running: [] })).toBe('waiting');
    expect(defaultTab({ mine: [], reviews: [], running: [{ r, w }] })).toBe('running');
    expect(defaultTab({ mine: [], reviews: [], running: [] })).toBe('upcoming');
  });

  it('switches lists with a click or the arrow keys; 진행 예정 has scheduled runs, 일정 and 할 일, soonest first', async () => {
    stubEngine(data({ '/approvals': [] }));
    open('/dashboard');
    await waitFor(() => expect(tab(/진행 중/).getAttribute('aria-selected')).toBe('true')); // nothing is mine → 진행 중
    expect(within(screen.getByRole('tabpanel')).getAllByText('Drafting the newsletter')).toHaveLength(2);
    await act(async () => fireEvent.click(tab(/진행 예정/)));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard?tab=upcoming');
    const upcoming = screen.getByRole('tabpanel');
    expect(tab(/진행 예정/).getAttribute('aria-selected')).toBe('true');
    expect(within(upcoming).getAllByText(/^sales.goal$/i).length).toBe(2); // one per running workspace
    expect(within(upcoming).getByText('오리엔테이션')).toBeTruthy();
    expect(within(upcoming).getByText('치과 예약')).toBeTruthy(); // my own personal entry
    expect(within(upcoming).getByText('사업계획서 작성/제출')).toBeTruthy(); // a 할 일 due today
    const titles = within(upcoming).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
    expect(titles[0]).toBe('사업계획서 작성/제출'); // a 할 일 due today (the day's start) comes before a run in an hour
    // the keyboard: right arrow → 진행 중, End → 오늘 완료, Home → 진행 예정
    await act(async () => fireEvent.keyDown(tab(/진행 예정/), { key: 'ArrowRight' }));
    expect(tab(/진행 중/).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab(/진행 중/));
    await act(async () => fireEvent.keyDown(tab(/진행 중/), { key: 'End' }));
    expect(tab(/오늘 완료/).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel')).getAllByText('Compare suppliers')).toHaveLength(2);
    await act(async () => fireEvent.keyDown(tab(/오늘 완료/), { key: 'Home' }));
    expect(tab(/진행 예정/).getAttribute('aria-selected')).toBe('true');
    expect(tab(/진행 예정/).tabIndex).toBe(0);
    expect(tab(/진행 중/).tabIndex).toBe(-1);
  });

  it('the counts follow the filter chips', async () => {
    const { calls } = stubEngine(data());
    open('/dashboard');
    await waitFor(() => expect(tab(/승인 대기/).textContent).toContain('4'));
    expect(tab(/진행 중/).textContent).toContain('2');
    const chips = screen.getByRole('group', { name: '보는 범위' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['전체', 'Tesla', 'SpaceXAI']);
    await act(async () => fireEvent.click(within(chips).getByRole('button', { name: 'Tesla' })));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard?org=tesla');
    await act(async () => fireEvent.click(within(screen.getByRole('group', { name: '보는 범위' })).getByRole('button', { name: 'Vehicles' })));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard?org=tesla&ws=vehicles');
    await waitFor(() => expect(tab(/승인 대기/).textContent).toContain('2'));
    expect(tab(/진행 중/).textContent).toContain('1');
    expect(screen.getByRole('link', { name: '이 워크스페이스 화면' }).getAttribute('href')).toBe('/o/tesla/w/vehicles/screens/dashboard');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/calendar/items') && c.url.includes('org=tesla') && c.url.includes('workspace=vehicles'))).toBe(true));
  });

  it('a team member asks only for their own scope; a business they do not have reads as no such page', async () => {
    const { calls } = stubEngine(data());
    open('/dashboard', staffOne);
    await screen.findAllByRole('tab');
    await waitFor(() => expect(calls.some((c) => c.url.includes('/approvals'))).toBe(true));
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

  it("C9 — Chief's suggestions under the cost, named by business and said once", async () => {
    const warned = budget({
      org: { spent_usd: 85, budget_usd: 100, remaining_usd: 15, warning: true, exhausted: false },
      suggestions: [
        { kind: 'switch_connection', subject: 'claude-max', to_connection: 'local', budget_usd: null },
        { kind: 'raise_budget', subject: null, to_connection: null, budget_usd: 130 },
      ],
    });
    stubEngine(data({ '/budget': warned }));
    open('/dashboard'); // tesla/charging and tesla/vehicles answer the same: one business, one set
    const box = await waitFor(() => within(screen.getByTestId('account-cost')).getByTestId('budget-suggestions'));
    expect(within(box).getByRole('heading', { name: '임원의 제안' })).toBeTruthy();
    expect([...box.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Tesla · claude-max 의 작업을 한도에 여유가 있는 local 로 옮겨 보세요.',
      'Tesla 의 월 한도를 US$130.00 로 올려 보세요. 이번 달 쓰는 속도에 맞춘 금액이에요.',
    ]);
  });

  it('no suggestions, no suggestion block', async () => {
    stubEngine(data());
    open('/dashboard');
    await waitFor(() => expect(within(screen.getByTestId('account-cost')).getAllByText(/\$20\.00/).length).toBe(2));
    expect(screen.queryByTestId('budget-suggestions')).toBeNull();
  });
});

describe('자리를 비운 동안', () => {
  it('sits on top: a headline, what finished with its work products, approvals answered right there', async () => {
    const { calls } = stubEngine(
      data({
        '/me/digest': digest(),
        'POST /o/tesla/w/vehicles/threads/th-dig/resume': () => ({ run_id: 'r' }),
        'POST /me/digest/ack': () => ({ seen_until: NOW, basis: 'acknowledged' }),
      }),
    );
    open('/dashboard');
    const box = await screen.findByTestId('digest');
    const view = box.closest('.view') as HTMLElement;
    expect(view.querySelector('[data-testid=digest]')!.compareDocumentPosition(screen.getByTestId('work-tabs')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(box).getByTestId('digest-headline').textContent).toBe('자리를 비운 3시간 동안 2건이 끝났고, 1건이 대표님 승인을 기다리고, 1건이 다른 사람 승인을 기다려요.');
    const done = within(box).getByTestId('digest-done');
    expect(within(done).getByText('정산 정리')).toBeTruthy();
    expect(within(done).getByRole('link', { name: /10월 손익표/ }).getAttribute('href')).toBe('/o/tesla/w/charging/tasks/artifacts/art-1');
    expect(within(box).getByTestId('digest-scheduled')).toBeTruthy();
    expect(within(box).getByText(/다른 사람 차례 1건은 승인 대기에서/)).toBeTruthy();
    expect(within(box).getByText(/이 동안 쓴 비용/)).toBeTruthy();
    const approve = within(box).getByTestId('digest-approve');
    expect(within(approve).getByText('Pay the supplier')).toBeTruthy();
    await act(async () => fireEvent.click(within(approve).getByRole('button', { name: '승인' })));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/o/tesla/w/vehicles/threads/th-dig/resume')).toBe(true));
    await act(async () => fireEvent.click(within(box).getByTestId('digest-ack')));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/me/digest/ack')?.body).toEqual({ until: NOW }));
    await waitFor(() => expect(screen.queryByTestId('digest')).toBeNull()); // collapsed
  });

  it('nothing happened → one quiet line; never here before → a welcome', async () => {
    const empty = { finished: [], approvals_mine: [], approvals_others: [], scheduled: [], cost: { spent_usd: 0, orgs: [] }, counts: { finished: 0, failed: 0, approvals_mine: 0, approvals_others: 0, decided: 0, scheduled: 0, calendar: 0 } };
    stubEngine(data({ '/me/digest': digest({ ...empty, since: NOW - 45 * 60 }) }));
    open('/dashboard');
    expect((await screen.findByTestId('digest-quiet')).textContent).toBe('자리를 비운 45분 동안 새로 생긴 일이 없어요.');
    expect(screen.queryByTestId('digest')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    stubEngine(data({ '/me/digest': digest({ ...empty, basis: 'first', since: null }) }));
    open('/dashboard');
    expect((await screen.findByTestId('digest-headline')).textContent).toMatch(/^처음 오셨네요/);
    expect(screen.queryByTestId('digest-ack')).toBeNull();
  });

  it('the headline in three languages', () => {
    const d = digest();
    const t = (l: Locale) => (k: MessageKey, v?: Record<string, string | number>) =>
      (dictionaries[l] as Record<string, string>)[k].replace(/\{(\w+)\}/g, (m, n: string) => (v && n in v ? String(v[n]) : m));
    expect(digestHeadline(d, t('ko'), 'ko', '대표님')).toBe('자리를 비운 3시간 동안 2건이 끝났고, 1건이 대표님 승인을 기다리고, 1건이 다른 사람 승인을 기다려요.');
    expect(digestHeadline(d, t('en'), 'en', 'you')).toBe('While you were away for 3 hours, 2 finished, 1 wait for you to approve and 1 wait for someone else.');
    expect(digestHeadline(d, t('zh-CN'), 'zh-CN', '您')).toBe('您离开的3小时里，2 项已完成，1 项待您审批，1 项待他人审批。');
    const two = digest({ approvals_others: [], counts: { ...d.counts, approvals_others: 0 } });
    expect(digestHeadline(two, t('ko'), 'ko', '대표님')).toBe('자리를 비운 3시간 동안 2건이 끝났고, 1건이 대표님 승인을 기다려요.');
    expect(digestHeadline({ ...two, basis: 'acknowledged' }, t('en'), 'en', 'you')).toBe('Since you last checked, 2 finished and 1 wait for you to approve.');
    expect(durationText(2 * 86400 + 5, 'ko')).toBe('2일');
    expect(durationText(30, 'en')).toBe('1 minute');
  });

  it('renders the English headline on the screen', async () => {
    stubEngine(data({ '/me/digest': digest() }));
    open('/dashboard', me({ locale: 'en' }), 'en');
    expect((await screen.findByTestId('digest-headline')).textContent).toMatch(/^While you were away for 3 hours, 2 finished/);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
  });
});
