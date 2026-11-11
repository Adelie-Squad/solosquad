// The menu of 2026-11-07 (DESIGN.md `## 레이아웃` · `## 컴포넌트` 대시보드 / Task / 예약된 작업):
// dashboard · office · messenger · Task · workflows; old addresses redirected; Task's groups; the
// dashboard's cost area; the schedule list and its sentences.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { Artifact, Budget, ScheduleList, ScreenResponse, WorkEntry } from '../src/api/types.gen';
import { translate, type Locale } from '../src/i18n';
import { cronText } from '../src/lib/cron';
import { filterDone, groupTasks, taskCounts } from '../src/lib/tasks';
import { widgetsOf } from '../src/screens/DeclarativeScreen';
import { ACCOUNT_NAV, NAV, navActive, visibleNav, WORKSPACE_NAV } from '../src/shell/nav';
import { accountTarget, MOVED, movedTarget, ScopeLayout, TO_ACCOUNT } from '../src/shell/ScopeLayout';
import { Sidebar } from '../src/shell/Sidebar';
import { MessengerView } from '../src/views/MessengerView';
import { ScheduleView } from '../src/views/ScheduleView';
import { WorkflowsView } from '../src/views/WorkflowsView';
import { ScheduleWidget } from '../src/screens/widgets';
import { TasksView } from '../src/views/TasksView';
import { DeclarativeScreen } from '../src/screens/DeclarativeScreen';
import { approval, me, renderWith } from './helpers';

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

const NOW = Date.now() / 1000;

function work(over: Partial<WorkEntry> = {}): WorkEntry {
  return {
    source: 'chat',
    thread_id: 'th-1',
    run_id: 'r-1',
    title: 'Compare three suppliers',
    workflow: null,
    cron: null,
    status: 'success',
    created: NOW - 60,
    ended: NOW - 30,
    agents: ['chief'],
    step: null,
    steps: null,
    current_step: null,
    artifacts: [],
    ...over,
  };
}

function artifact(over: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art-1',
    kind: 'finance.pnl',
    title: 'P&L October',
    data: {},
    thread_id: 'wf-1',
    run_id: 'r-9',
    workflow: 'monthly-pnl',
    needs_review: true,
    reviewed_by: null,
    created: NOW - 100,
    schema_version: 1,
    ...over,
  };
}

const budget: Budget = {
  month_start: NOW - 86400 * 6,
  warn_at: 0.8,
  org: { spent_usd: 12.4, budget_usd: 40, remaining_usd: 27.6, warning: false, exhausted: false },
  connections: [
    { id: 'max', spent_usd: 9, budget_usd: 10, remaining_usd: 1, warning: true, exhausted: false },
    { id: 'router', spent_usd: 3.4, budget_usd: null, remaining_usd: null, warning: false, exhausted: false },
  ],
  suggestions: [],
};

const schedules: ScheduleList = {
  timezone: 'Asia/Seoul',
  errors: [],
  schedules: [
    { id: 'wf:morning', kind: 'workflow', name: 'morning', title: 'Weekly brief', schedule: '0 9 * * 1', enabled: true, next_run: NOW + 7200, last_run: { id: 'r', status: 'success', created: NOW - 3600 }, workflow: 'morning' },
    { id: 'cron:sales-goal', kind: 'goal', name: 'sales-goal', title: 'sales-goal', schedule: '30 8 * * 1-5', enabled: true, next_run: NOW + 600, last_run: null, workflow: null },
  ],
};

/** Every API call answers from this table by path (the query string is ignored). */
function stubApi(table: Record<string, unknown>) {
  const fetch = vi.fn(async (url: string) => {
    const path = url.split('?')[0].replace(/^\/api\/o\/[^/]+(\/w\/[^/]+)?/, '');
    const body = path in table ? table[path] : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}${l.hash}`}</p>;
}

const staff = me({
  user: { id: 'u-2', username: 'kim', display: 'Kim', role: 'staff', locale: 'en', two_factor: true, disabled: false, title: '', teams: [], assignments: [] },
  scopes: [{ org: 'tesla', display: 'Tesla', role: 'staff', whole_org: false, workspaces: [{ name: 'charging', display: 'charging', role: 'staff', running: true }] }],
});

// ---------------------------------------------------------------------- the menu

describe('the sidebar menu (decision 60 — two groups)', () => {
  it('is dashboard · calendar · messenger for the account, then office · Tasks · workflows — the same for owner and staff', () => {
    expect(ACCOUNT_NAV.map((n) => n.to)).toEqual(['/dashboard', '/calendar', '/messenger']);
    expect(WORKSPACE_NAV.map((n) => n.to)).toEqual(['/office', '/tasks', '/workflows']);
    const ids = NAV.map((n) => n.to);
    expect(visibleNav(true).map((n) => n.to)).toEqual(ids);
    expect(visibleNav(false).map((n) => n.to)).toEqual(ids);
    // three tiles per group in two columns: the first takes the whole row (DESIGN.md — no hole)
    expect(ACCOUNT_NAV.length % 2).toBe(1);
    expect(WORKSPACE_NAV.length % 2).toBe(1);
  });

  it.each([
    ['owner', me()],
    ['staff', staff],
  ])('draws both groups for %s, with a Task badge for what waits for them', async (_who, person) => {
    stubApi({ '/approvals': [approval(), approval({ run_id: 'r-2', can_approve: false })], '/artifacts': [artifact()], '/threads': [] });
    renderWith(<Sidebar onCommand={() => {}} />, 'en', { me: person, path: '/o/tesla/w/charging/scheduled-jobs' });
    const account = within(screen.getByRole('navigation', { name: 'Whole company' })).getAllByRole('link');
    expect(account.map((a) => a.textContent)).toEqual(['Dashboard', 'Calendar', 'Messenger']);
    expect(account.map((a) => a.getAttribute('href'))).toEqual(['/dashboard', '/calendar', '/messenger']);
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    const tiles = within(nav).getAllByRole('link');
    expect(tiles.map((a) => a.textContent?.replace(/\d+$/, ''))).toEqual(['Office', 'Tasks', 'Workflows']);
    expect(tiles[0].getAttribute('href')).toBe('/o/tesla/w/charging/office');
    // the scheduled runs are a view of the workflows: that tile stays selected on them
    expect(tiles[2].getAttribute('aria-current')).toBe('page');
    // 1 card I may answer + 1 work product to check (the other team's card is not mine)
    await waitFor(() => expect(within(tiles[1]).getByText('2')).toBeTruthy());
    expect(within(nav).queryByText('Approvals')).toBeNull();
    // the two groups are split by a plain line — no label, no band
    expect(document.querySelector('.sidebar-divider')).toBeTruthy();
  });

  it.each([
    ['ko', ['대시보드', '일정', '메신저'], ['사무실', '과제', '워크플로우']],
    ['en', ['Dashboard', 'Calendar', 'Messenger'], ['Office', 'Tasks', 'Workflows']],
    ['zh-CN', ['仪表盘', '日程', '消息渠道'], ['办公室', '任务', '工作流']],
  ] as const)('%s menu labels', (locale, top, ws) => {
    stubApi({ '/approvals': [], '/artifacts': [], '/threads': [] });
    renderWith(<Sidebar onCommand={() => {}} />, locale);
    const labels = (name: string) => within(screen.getByRole('navigation', { name: translate(locale, name as 'nav.accountGroup') })).getAllByRole('link').map((a) => a.textContent);
    expect(labels('nav.accountGroup')).toEqual([...top]);
    expect(labels('nav.workspaceGroup')).toEqual([...ws]);
  });

  it.each([
    ['owner', 'ko', me(), '계정 설정 · Boss 대표'],
    ['staff', 'en', staff, 'Account settings · Kim Team member'],
    ['owner', 'zh-CN', me(), '账户设置 · Boss 代表'],
  ] as const)('%s (%s): the bottom is one control — who is here and settings, one focus stop', async (_who, locale, person, name) => {
    stubApi({ '/approvals': [], '/artifacts': [], '/threads': [] });
    renderWith(
      <Routes>
        <Route path="*" element={<><Sidebar onCommand={() => {}} /><Where /></>} />
      </Routes>,
      locale,
      { me: person, path: '/o/tesla/w/charging/dashboard' },
    );
    const bottom = document.querySelector('.sidebar-bottom') as HTMLElement;
    const focusable = bottom.querySelectorAll('a, button, [tabindex]');
    expect(focusable).toHaveLength(1); // one hit target, one focus stop
    const account = within(bottom).getByRole('link', { name });
    expect(account.getAttribute('href')).toBe('/o/tesla/settings');
    expect(account.querySelectorAll('svg')).toHaveLength(2); // the person icon and the trailing settings icon
    // no second settings button anywhere in the sidebar
    expect(screen.getAllByRole('link', { name: new RegExp(translate(locale, 'nav.settings'), 'i') })).toEqual([account]);
    await act(async () => fireEvent.click(account));
    expect(screen.getByTestId('where').textContent).toBe('/o/tesla/settings');
  });

  it('marks a tile selected on its own address and below it', () => {
    const links = { w: (p = '') => `/o/t/w/c${p}`, o: (p = '') => `/o/t${p}` };
    const [office, tasks, wf] = WORKSPACE_NAV;
    expect(navActive(wf, '/o/t/w/c/workflows/monthly-pnl/runs/x', links)).toBe(true);
    expect(navActive(wf, '/o/t/w/c/scheduled-jobs', links)).toBe(true);
    expect(navActive(tasks, '/o/t/w/c/tasks/artifacts/a', links)).toBe(true);
    expect(navActive(tasks, '/o/t/w/c/tasksx', links)).toBe(false);
    expect(navActive(office, '/o/t/w/c/office/display', links)).toBe(true);
    // an account tile is its own address, whatever the scope
    expect(navActive(ACCOUNT_NAV[1], '/calendar', links)).toBe(true);
    expect(navActive(ACCOUNT_NAV[0], '/o/t/w/c/dashboard', links)).toBe(false);
  });
});

// ---------------------------------------------------------------------- old addresses

describe('old addresses', () => {
  it('maps every moved screen', () => {
    expect(movedTarget('artifacts/:id', { id: 'a 1' })).toBe('/tasks/artifacts/a%201');
    expect(MOVED).toMatchObject({ approvals: '/tasks', artifacts: '/tasks' });
    // decision 60: the dashboard and the messenger became account screens — the scope is the filter
    expect(TO_ACCOUNT).toMatchObject({ dashboard: '/dashboard', home: '/dashboard', budget: '/dashboard#cost', messenger: '/messenger', mail: '/messenger' });
    expect(accountTarget('dashboard', 'tesla', 'charging', '?x=1')).toEqual({ pathname: '/dashboard', search: '?x=1&org=tesla&ws=charging', hash: '' });
  });

  it.each([
    ['/o/tesla/w/charging', '/o/tesla/w/charging/office'],
    ['/o/tesla/w/charging/dashboard', '/dashboard?org=tesla&ws=charging'],
    ['/o/tesla/w/charging/home', '/dashboard?org=tesla&ws=charging'],
    ['/o/tesla/w/charging/budget', '/dashboard?org=tesla&ws=charging#cost'],
    ['/o/tesla/w/charging/messenger', '/messenger?org=tesla&ws=charging'],
    ['/o/tesla/w/charging/mail', '/messenger?org=tesla&ws=charging'],
    ['/o/tesla/w/charging/approvals?x=1', '/o/tesla/w/charging/tasks?x=1'],
    ['/o/tesla/w/charging/artifacts', '/o/tesla/w/charging/tasks'],
    ['/o/tesla/w/charging/screens/artifacts', '/o/tesla/w/charging/tasks'],
    ['/o/tesla/w/charging/artifacts/art-7', '/o/tesla/w/charging/tasks/artifacts/art-7'],
  ])('%s → %s', async (from, to) => {
    stubApi({ '/budget': budget, '/schedules': schedules, '/work': { items: [] } });
    renderWith(
      <Routes>
        <Route path="o/:org/*" element={<><ScopeLayout /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>,
      'en',
      { path: from },
    );
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(to));
  });
});

// ---------------------------------------------------------------------- Task

describe('Task groups', () => {
  const now = new Date();
  const items = [
    work({ thread_id: 'a', status: 'running', ended: null }),
    work({ thread_id: 'b', status: 'interrupted', source: 'workflow', workflow: 'monthly-pnl', step: 1, steps: 3, current_step: 'Check the P&L' }),
    work({ thread_id: 'c', status: 'success', agents: ['finance'], artifacts: [{ id: 'x', kind: 'brief', title: 'Brief', needs_review: false }] }),
    work({ thread_id: 'd', status: 'error', ended: NOW - 86400 * 10 }),
  ];

  it('sorts approvals, reviews and work into mine · others · running · done', () => {
    const mine = approval();
    const other = approval({ run_id: 'r-2', can_approve: false, tier: 'owner' });
    const g = groupTasks([mine, other], [artifact(), artifact({ id: 'ok', needs_review: false })], items);
    expect(g.mine.approvals).toEqual([mine]);
    expect(g.mine.reviews.map((r) => r.id)).toEqual(['art-1']);
    expect(g.others).toEqual([other]);
    expect(g.running.map((w) => w.thread_id)).toEqual(['a', 'b']);
    expect(g.done.map((w) => w.thread_id)).toEqual(['c', 'd']);
  });

  it('filters finished work by period, agent and kind', () => {
    const done = groupTasks([], [], items).done;
    expect(filterDone(done, { period: 'week', agent: '', kind: 'all' }, now).map((w) => w.thread_id)).toEqual(['c']);
    expect(filterDone(done, { period: 'all', agent: '', kind: 'all' }, now)).toHaveLength(2);
    expect(filterDone(done, { period: 'all', agent: 'finance', kind: 'all' }, now).map((w) => w.thread_id)).toEqual(['c']);
    expect(filterDone(done, { period: 'all', agent: '', kind: 'artifact' }, now).map((w) => w.thread_id)).toEqual(['c']);
    expect(filterDone(done, { period: 'all', agent: '', kind: 'workflow' }, now)).toEqual([]);
  });

  it('counts the dashboard numbers from the same lists', () => {
    const c = taskCounts([approval(), approval({ run_id: 'r-2', can_approve: false })], items, now);
    expect(c).toEqual({ running: 1, waiting: 2, mine: 1, doneToday: 1 });
  });

  it('draws the groups — answers and checks in "for you", the reason in "someone else"', async () => {
    stubApi({
      '/approvals': [approval({}, { title: 'Send the report' }), approval({ run_id: 'r-2', can_approve: false, tier: 'owner' }, { title: 'Pay the supplier' })],
      '/artifacts': [artifact()],
      '/work': { items },
    });
    renderWith(<TasksView />, 'en');
    const mine = await screen.findByTestId('group-mine');
    expect(within(mine).getByText('Send the report')).toBeTruthy();
    expect(within(mine).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(within(mine).getByTestId('review-card').textContent).toContain('P&L October');
    expect(within(mine).getByRole('button', { name: 'Mark as reviewed' })).toBeTruthy();
    const others = screen.getByTestId('group-others');
    expect(within(others).getByText('Pay the supplier')).toBeTruthy();
    expect(within(others).getByTestId('approval-blocked').textContent).toBe('Only the owner can approve this.');
    expect(within(others).queryByRole('button', { name: 'Approve' })).toBeNull();
    const running = screen.getByTestId('group-running');
    expect(within(running).getAllByTestId('work-row')).toHaveLength(2);
    expect(running.textContent).toContain('Step 2 of 3 · Check the P&L');
    const done = screen.getByTestId('group-done');
    expect(within(done).getAllByTestId('work-row')).toHaveLength(1); // 7 days by default
    await act(async () => fireEvent.click(within(done).getByRole('tab', { name: 'All' })));
    expect(within(done).getAllByTestId('work-row')).toHaveLength(2);
  });

  it('says so in a sentence when nothing waits, and hides "someone else" when it is empty', async () => {
    stubApi({ '/approvals': [], '/artifacts': [], '/work': { items: [] } });
    renderWith(<TasksView />, 'en');
    expect((await screen.findByTestId('group-mine')).textContent).toContain('Nothing waits for you right now.');
    expect(screen.queryByTestId('group-others')).toBeNull();
    expect(screen.getByTestId('group-mine').querySelector('.chip')).toBeNull(); // no "0" next to the title
  });
});

// ---------------------------------------------------------------------- the dashboard

describe('the dashboard', () => {
  it('always ends with the cost area', () => {
    expect(widgetsOf('dashboard', [{ widget: 'stats', version: 1 }]).map((w) => w.widget)).toEqual(['stats', 'budget']);
    expect(widgetsOf('dashboard', [{ widget: 'budget', version: 1 }, { widget: 'office', version: 1 }]).map((w) => w.widget)).toEqual(['budget', 'office']);
    expect(widgetsOf('artifacts', [{ widget: 'stats', version: 1 }]).map((w) => w.widget)).toEqual(['stats']);
  });

  it('shows the whole cost screen inside it — the company line, each connection, warning and cap', async () => {
    const screenRes: ScreenResponse = { name: 'dashboard', source: 'org', screen: { format_version: 1, title: '', widgets: [{ widget: 'stats', version: 1 }] }, error: null };
    stubApi({ '/screens/dashboard': screenRes, '/budget': budget, '/approvals': [approval()], '/work': { items: [work({ status: 'running', ended: null })] }, '/artifacts': [] });
    renderWith(<DeclarativeScreen name="dashboard" />, 'en');
    const cost = await screen.findByTestId('cost');
    await waitFor(() => expect(within(cost).getByText('Whole business')).toBeTruthy());
    expect(within(cost).getByText('max')).toBeTruthy();
    expect(within(cost).getByText('router')).toBeTruthy();
    expect(within(cost).getByText('Warning')).toBeTruthy();
    expect(within(cost).getAllByRole('meter')).toHaveLength(2); // the company and max have caps
    const stats = screen.getByTestId('stats');
    await waitFor(() => expect(within(stats).getByTestId('stat-running').textContent).toContain('1'));
    expect(within(stats).getByTestId('stat-waiting').textContent).toContain('1 are yours');
    expect(within(stats).getByTestId('stat-cost').textContent).toContain('31% of the cap');
    expect(within(stats).getByTestId('stat-cost').getAttribute('href')).toBe('/o/tesla/w/charging/dashboard#cost');
  });

  it('never puts a zero in a title', async () => {
    const screenRes: ScreenResponse = { name: 'dashboard', source: 'default', screen: { format_version: 1, title: '', widgets: [{ widget: 'todo', version: 1 }, { widget: 'office', version: 1 }] }, error: null };
    stubApi({ '/screens/dashboard': screenRes, '/budget': budget, '/approvals': [], '/artifacts': [], '/agents': [] });
    renderWith(<DeclarativeScreen name="dashboard" />, 'en');
    expect(await screen.findByText('Nothing waits for you right now. The agents carry on with their work.')).toBeTruthy();
    for (const h of screen.getAllByRole('heading', { level: 2 })) expect(h.textContent).not.toMatch(/\d/);
  });
});

// ---------------------------------------------------------------------- schedule

describe('schedule sentences', () => {
  const say = (expr: string, locale: Locale) => cronText(expr, locale, (k, v) => translate(locale, k, v));

  it.each([
    ['0 9 * * 1', 'ko', '매주 월요일 오전 9시'],
    ['0 9 * * 1', 'en', 'Every Monday at 9 AM'],
    ['30 8 * * 1-5', 'ko', '평일 오전 8:30'],
    ['30 8 * * 1-5', 'en', 'Weekdays at 8:30 AM'],
    ['0 18 1 * *', 'ko', '매월 1일 오후 6시'],
    ['0 18 1 * *', 'en', 'Every month on day 1 at 6 PM'],
    ['0 7 * * *', 'ko', '매일 오전 7시'],
    ['0 10 * * 6,0', 'en', 'Weekends at 10 AM'],
    ['0 9 * * 1,3', 'ko', '매주 월요일 · 수요일 오전 9시'],
    ['0 9 * * 0', 'en', 'Every Sunday at 9 AM'],
    ['15 * * * *', 'en', 'Every hour at :15'],
    ['*/10 * * * *', 'ko', '10분마다'],
    ['0 */4 * * *', 'en', 'Every 4 hours'],
    ['0 9 1 1 *', 'en', 'Custom schedule (0 9 1 1 *)'],
    ['not a cron', 'ko', '직접 정한 주기 (not a cron)'],
  ] as const)('%s (%s) → %s', (expr, locale, text) => {
    expect(say(expr, locale)).toBe(text);
  });

  it('speaks Chinese too', () => {
    expect(say('0 9 * * 1', 'zh-CN')).toMatch(/^每星期一 /);
    expect(say('0 18 1 * *', 'zh-CN')).toMatch(/^每月1日 /);
    expect(say('30 8 * * 1-5', 'zh-CN')).toMatch(/^工作日 /);
  });
});

describe('the schedule view', () => {
  it('lists every scheduled run; the owner switches a workflow, a cron shows its state', async () => {
    stubApi({ '/schedules': schedules });
    renderWith(<ScheduleView />, 'en');
    const rows = await screen.findAllByTestId('schedule-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Weekly brief');
    expect(rows[0].textContent).toContain('Every Monday at 9 AM');
    expect(within(rows[0]).getByRole('switch', { name: 'Switch Weekly brief on or off' })).toBeTruthy();
    expect(rows[1].textContent).toContain('Sales Goal');
    expect(rows[1].textContent).toContain('Weekdays at 8:30 AM');
    expect(rows[1].textContent).toContain('Not run yet');
    expect(within(rows[1]).queryByRole('switch')).toBeNull();
    expect(screen.getByText(/Times are in Asia\/Seoul/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Scheduled runs' }).getAttribute('aria-current')).toBe('page');
  });

  it('staff reads only', async () => {
    stubApi({ '/schedules': schedules });
    renderWith(<ScheduleView />, 'en', { me: staff });
    await screen.findAllByTestId('schedule-row');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(/Only the owner can switch these on and off/)).toBeTruthy();
  });
});

// 2026-11-09 — 일정 → 예약된 작업, and the tabs moved from the header to right above the list
describe('예약된 작업 (scheduled runs)', () => {
  const TAB = { ko: ['워크플로우', '예약된 작업'], en: ['Workflows', 'Scheduled runs'], 'zh-CN': ['工作流', '定时运行'] } as const;

  it.each(Object.keys(TAB) as Locale[])('%s: the tabs read workflows | scheduled runs and point at scheduled-jobs', async (locale) => {
    stubApi({ '/schedules': schedules });
    renderWith(<ScheduleView />, locale);
    await screen.findAllByTestId('schedule-row');
    const tabs = within(screen.getByRole('navigation', { name: translate(locale, 'workflows.views') })).getAllByRole('link');
    expect(tabs.map((a) => a.textContent)).toEqual([...TAB[locale]]);
    expect(tabs.map((a) => a.getAttribute('href'))).toEqual(['/o/tesla/w/charging/workflows', '/o/tesla/w/charging/scheduled-jobs']);
    expect(tabs[1].getAttribute('aria-current')).toBe('page');
  });

  it('the tabs sit outside the header, right above the scheduled-runs list', async () => {
    stubApi({ '/schedules': schedules });
    renderWith(<ScheduleView />, 'ko');
    const list = await screen.findByTestId('schedule-list');
    const tabs = screen.getByRole('navigation', { name: '워크플로우 보기 전환' });
    const header = document.querySelector('.view-header') as HTMLElement;
    expect(header.contains(tabs)).toBe(false);
    expect(header.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.nextElementSibling).toBe(list);
  });

  it('on the workflows view too — under the title and lead, above the cards', async () => {
    const wf = { name: 'monthly-pnl', title: 'Monthly P&L', description: '', enabled: true, team: null, schedule: '0 9 1 * *', steps: [], inputs: [], last_run: null };
    stubApi({ '/workflows': { workflows: [wf], errors: [] }, '/workflows/monthly-pnl/runs': [] });
    renderWith(
      <Routes>
        <Route path="o/:org/w/:ws/workflows/:name" element={<WorkflowsView />} />
      </Routes>,
      'ko',
      { path: '/o/tesla/w/charging/workflows/monthly-pnl' },
    );
    const cards = await screen.findByRole('navigation', { name: '워크플로우' });
    const tabs = screen.getByRole('navigation', { name: '워크플로우 보기 전환' });
    const header = document.querySelector('.view-header') as HTMLElement;
    expect(header.contains(tabs)).toBe(false);
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('워크플로우');
    expect(tabs.nextElementSibling).toBe(cards);
    expect(within(tabs).getAllByRole('link').map((a) => a.textContent)).toEqual(['워크플로우', '예약된 작업']);
    // the cadence chip in the detail goes to the scheduled runs and says so
    const chip = screen.getByRole('link', { name: /^예약된 작업: / });
    expect(chip.getAttribute('href')).toBe('/o/tesla/w/charging/scheduled-jobs');
  });

  it.each([
    ['ko', '다음 예약된 작업'],
    ['en', 'Next scheduled runs'],
    ['zh-CN', '接下来的定时运行'],
  ] as const)('%s: the dashboard widget is titled %s and opens scheduled-jobs', async (locale, title) => {
    stubApi({ '/schedules': schedules });
    renderWith(<ScheduleWidget />, locale);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(title);
    expect(screen.getByRole('link', { name: translate(locale, 'widget.all') }).getAttribute('href')).toBe('/o/tesla/w/charging/scheduled-jobs');
    await screen.findByText('Weekly brief');
  });
});

// ----------------------------------------------------------------- messenger

describe('messenger (not connected yet)', () => {
  it('points the owner to Settings › Connections and tells staff who turns it on', () => {
    renderWith(<MessengerView />, 'en');
    expect(screen.getByTestId('messenger-pending').textContent).toContain('No messenger is connected yet.');
    expect(screen.getByRole('link', { name: /Open connection settings/ }).getAttribute('href')).toBe('/o/tesla/settings/connections');
    cleanup();
    renderWith(<MessengerView />, 'en', { me: staff });
    expect(screen.getByTestId('messenger-pending').textContent).toContain('once the owner connects a messenger');
    expect(screen.queryByRole('link', { name: /Open connection settings/ })).toBeNull();
  });
});
