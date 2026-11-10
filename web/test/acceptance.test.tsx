// PRD v2.1.0 §7 — the screens behind C5 (who works on what, per team) · C9 (budget warning)
// · C18 (the holder of a connection) · C21 (a screen file drawn by the real widgets) · C20 (switching the language) · C25 (approval tiers that
// differ from the recommendation) · C22 (the P&L as a table and bars) · C26 (the org chart
// widget). Whole screens are drawn from engine-shaped answers (fixtures.ts).
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import type { Agent, Me, OrgChart, ThreadState } from '../src/api/types.gen';
import { translate, type Locale, type MessageKey } from '../src/i18n';
import { ScopeLayout } from '../src/shell/ScopeLayout';
import { OfficeView } from '../src/views/OfficeView';
import { agent, budget, engineData, ownerMe, QuietEventSource, staffMe, stubEngine } from './fixtures';
import { approval, renderWith } from './helpers';

// the 3D scene is another slice's work: the office is checked through its list fallback
vi.mock('../src/office/OfficeStage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/office/OfficeStage')>();
  return { ...real, OfficeStage: ({ fallback }: { fallback: React.ReactNode }) => <div data-testid="office-stage">{fallback}</div> };
});

const t = (k: MessageKey, v?: Record<string, string | number>, l: Locale = 'en') => translate(l, k, v);

beforeAll(() => {
  (globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settled = () => waitFor(() => expect(screen.queryAllByText(t('common.loading'))).toHaveLength(0));

async function openApp(path: string, data: Record<string, unknown>, who: Me = staffMe, locale: Locale = 'en') {
  const api = stubEngine(data);
  renderWith(
    <Routes>
      <Route path="o/:org/*" element={<ScopeLayout />} />
    </Routes>,
    locale,
    { me: who, path },
  );
  await settled();
  return api;
}

// ---------------------------------------------------------------------- C5

const work = (thread_id: string, title: string) => ({ thread_id, run_id: `r-${thread_id}`, title });

/** 재무 · 소싱 · 마케팅 — two agents each, some at work, one waiting for an answer. */
const THREE: Agent[] = [
  agent('chief', 'core', { display_name: { en: 'Chief' } }),
  agent('finance', 'finance', { display_name: { en: 'Finance', ko: '재무' }, working_on: [work('t1', 'October P&L')] }),
  agent('bookkeeper', 'finance'),
  agent('buyer', 'sourcing', { display_name: { en: 'Buyer' }, working_on: [work('t2', 'Compare suppliers'), work('t3', 'Sample order')] }),
  agent('quality-inspector', 'sourcing'),
  agent('marketer', 'marketing', { display_name: { en: 'Marketer' } }),
  agent('creative', 'marketing', { working_on: [work('t4', 'Winter banner')] }),
];

const card = (a: Agent) => ({ name: a.name, description: a.description, display_name: a.display_name, summary: a.summary, appearance: null });

const THREE_CHART: OrgChart = {
  owners: [{ id: 'u-1', display: 'Boss', title: '', role: 'owner' }],
  teams: [
    { name: 'core', agents: [card(THREE[0])], people: [] },
    { name: 'finance', agents: [card(THREE[1]), card(THREE[2])], people: [{ id: 'u-2', display: 'Kim', title: 'Controller', role: 'staff' }] },
    { name: 'sourcing', agents: [card(THREE[3]), card(THREE[4])], people: [] },
    { name: 'marketing', agents: [card(THREE[5]), card(THREE[6])], people: [{ id: 'u-3', display: 'Lee', title: 'Lead', role: 'staff' }] },
  ],
  unassigned: [],
};

describe('C5 — the office shows every team, its agents and what they are doing', () => {
  const data = () =>
    engineData({
      '/agents': THREE,
      '/org-chart': THREE_CHART,
      '/approvals': [approval({ can_approve: false }, { agent: 'marketer', team: 'marketing', title: 'post the campaign' })],
    });

  it('draws the org chart: three departments, their agents with a status, their people', async () => {
    stubEngine(data());
    renderWith(<OfficeView />, 'en', { me: staffMe, path: '/o/tesla/w/charging/office' });
    await settled();
    const depts = screen.getByRole('list', { name: t('org.departments') });
    expect(within(depts).getAllByRole('list').map((l) => l.getAttribute('aria-label'))).toEqual(['Finance', 'Sourcing', 'Marketing']);
    const nodes = (team: string) => within(screen.getByRole('list', { name: team })).getAllByRole('button').map((b) => b.textContent);
    expect(nodes('Finance')).toEqual([`Finance${t('office.status.thinking')}`, `Bookkeeper${t('office.status.idle')}`, `Kim${t('role.staff')}`]);
    expect(nodes('Sourcing')).toEqual([`Buyer${t('office.status.thinking')}`, `Quality Inspector${t('office.status.idle')}`]);
    expect(nodes('Marketing')).toEqual([`Marketer${t('office.status.waiting')}`, `Creative${t('office.status.thinking')}`, `Lee${t('role.staff')}`]);
  });

  it('draws the list next to the scene: each team, each agent, its status and the tasks in hand', async () => {
    stubEngine(data());
    renderWith(<OfficeView />, 'en', { me: staffMe, path: '/o/tesla/w/charging/office' });
    await settled();
    const list = within(screen.getByTestId('office-stage'));
    expect(list.getAllByText(/^(Leadership|Finance|Sourcing|Marketing)$/, { selector: '.settings-group' }).map((e) => e.textContent)).toEqual([
      'Leadership', // core, in the reader's language
      'Finance',
      'Sourcing',
      'Marketing',
    ]);
    const row = (name: string) => list.getByText(name, { selector: 'strong' }).closest('button') as HTMLElement;
    expect(within(row('Finance')).getByText(t('office.status.thinking'))).toBeTruthy();
    expect(within(row('Finance')).getByText('October P&L')).toBeTruthy();
    expect(within(row('Buyer')).getByText('Compare suppliers, Sample order')).toBeTruthy();
    expect(within(row('Marketer')).getByText(t('office.status.waiting'))).toBeTruthy();
    expect(within(row('Creative')).getByText('Winter banner')).toBeTruthy();
    expect(within(row('Bookkeeper')).getByText(t('office.status.idle'))).toBeTruthy();
    // the counts above the scene agree: 3 at work in 4 tasks · 1 waiting for an answer
    expect(document.querySelector('.office-stats')?.textContent).toContain(`1 ${t('office.needsAnswer')}`);
  });

  it('the dashboard office widget lists who is working and on what', async () => {
    await openApp('/o/tesla/w/charging/screens/dashboard', data());
    const widget = screen.getByText(t('widget.office')).closest('section') as HTMLElement;
    const working = t('office.status.typing');
    expect(within(widget).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      `FinanceOctober P&L${working}`,
      `BuyerCompare suppliers, Sample order${working}`,
      `CreativeWinter banner${working}`,
    ]);
  });
});

// ---------------------------------------------------------------------- C9

// the spend screen moved into the dashboard (2026-11-07): its old address lands on the cost area
const costArea = () => screen.getByTestId('cost');

describe('C9 — a connection near its cap is flagged in the dashboard cost area', () => {
  const warned = budget({
    org: { spent_usd: 85, budget_usd: 100, remaining_usd: 15, warning: true, exhausted: false },
    connections: [
      { id: 'claude-max', spent_usd: 85, budget_usd: 100, remaining_usd: 15, warning: true, exhausted: false },
      { id: 'local', spent_usd: 0, budget_usd: null, remaining_usd: null, warning: false, exhausted: false },
    ],
  });

  it('the cost area of the workspace screen marks the 85 % connection and the company line', async () => {
    await openApp('/o/tesla/w/charging/screens/dashboard', engineData({ '/budget': warned }));
    await waitFor(() => expect(within(costArea()).getByText(/80%/)).toBeTruthy()); // the lead names the warning line (warn_at 0.8)
    const meter = within(costArea()).getByRole('meter', { name: 'claude-max' });
    expect(meter.getAttribute('aria-valuenow')).toBe('85');
    expect(meter.className).toContain('is-warn');
    const lineOf = (label: string) => within(costArea()).getByText(label, { selector: 'strong' }).closest('.budget-line') as HTMLElement;
    expect(within(lineOf('claude-max')).getByText(t('budget.warning'))).toBeTruthy();
    expect(within(lineOf(t('budget.org'))).getByText(t('budget.warning'))).toBeTruthy();
    expect(within(lineOf('local')).queryByText(t('budget.warning'))).toBeNull();
  });

  it('the dashboard shows the warning, and a reached cap as such', async () => {
    await openApp('/o/tesla/w/charging/screens/dashboard', engineData({ '/budget': warned }));
    const company = () => within(costArea()).getByRole('meter', { name: t('budget.org') });
    await waitFor(() => expect(company().getAttribute('aria-valuenow')).toBe('85'));
    expect(within(company().closest('.budget-line') as HTMLElement).getByText(t('budget.warning'))).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    const full = budget({ org: { spent_usd: 100, budget_usd: 100, remaining_usd: 0, warning: true, exhausted: true } });
    await openApp('/o/tesla/w/charging/screens/dashboard', engineData({ '/budget': full }));
    const line = company().closest('.budget-line') as HTMLElement;
    expect(within(line).getByText(t('budget.exhausted'))).toBeTruthy();
    expect(within(line).queryByText(t('budget.warning'))).toBeNull();
  });

  it('no warning under the line', async () => {
    await openApp('/o/tesla/w/charging/screens/dashboard', engineData());
    expect(within(costArea()).queryByText(t('budget.warning'))).toBeNull();
  });
});

// ---------------------------------------------------------------------- C22

describe('C22 — the P&L from the ledger is drawn as a table and bars', () => {
  const won = (n: number) => new Intl.NumberFormat('en', { style: 'currency', currency: 'KRW' }).format(n);

  it('the dashboard sums the latest P&L up in one line and links to it in Task', async () => {
    await openApp('/o/tesla/w/charging/screens/dashboard', engineData());
    const latest = screen.getByRole('heading', { name: '손익표' }).closest('section') as HTMLElement;
    expect(within(latest).getByTestId('pnl-summary').textContent).toBe(
      `${t('pnl.revenue')}${won(2_000_000)}${t('pnl.expenses')}${won(550_000)}${t('pnl.net')}${won(1_450_000)}`,
    );
    expect(within(latest).getByText(t('pnl.needsReview', { n: 1 }))).toBeTruthy();
    expect(within(latest).queryByRole('table')).toBeNull(); // the table stays on the detail screen
    expect(within(latest).queryByTestId('needs-review')).toBeNull();
    expect(within(latest).getByRole('link', { name: t('widget.open') }).getAttribute('href')).toBe('/o/tesla/w/charging/tasks/artifacts/art-pnl-1');
  });

  it('the old work-products address opens Task, and the P&L detail shows totals and the month table', async () => {
    await openApp('/o/tesla/w/charging/screens/artifacts', engineData());
    expect(screen.getByRole('heading', { level: 1, name: t('nav.tasks') })).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    await openApp('/o/tesla/w/charging/tasks/artifacts/art-pnl-1', engineData());
    expect(screen.getAllByText(won(1_450_000)).length).toBeGreaterThan(0);
    const month = screen.getByRole('columnheader', { name: t('pnl.month') }).closest('table') as HTMLElement;
    const rows = within(month).getAllByRole('row').map((r) => Array.from(r.children).map((c) => c.textContent));
    expect(rows).toEqual([
      [t('pnl.month'), t('pnl.revenue'), t('pnl.expenses'), t('pnl.net')],
      ['2026-10', won(1_200_000), won(450_000), won(750_000)],
      ['2026-11', won(800_000), won(100_000), won(700_000)],
      [t('pnl.total'), won(2_000_000), won(550_000), won(1_450_000)],
    ]);
    const review = screen.getByTestId('needs-review');
    expect(review.textContent).toContain('금액을 읽을 수 없음');
    expect(review.querySelectorAll('li .ledger-flag')).toHaveLength(1); // a plain row with a warn icon, no tinted band
  });

  it('the P&L page adds the month bars and the account table', async () => {
    const container = document.body;
    await openApp('/o/tesla/w/charging/artifacts/art-pnl-1', engineData());
    const bars = Array.from(container.querySelectorAll('.pnl-bars .vbar'));
    expect(bars.map((b) => b.querySelector('.vbar-label')?.textContent)).toEqual(['2026-10', '2026-11']);
    const heights = bars.map((b) => Array.from(b.querySelectorAll<HTMLElement>('.vbar-fill')).map((f) => f.style.height));
    expect(heights).toEqual([
      ['100%', '37.5%'], // revenue 1.2 M is the tallest; expenses 450 k
      [`${(800_000 / 1_200_000) * 100}%`, `${(100_000 / 1_200_000) * 100}%`],
    ]);
    const accounts = screen.getByText(t('pnl.byAccount')).closest('section') as HTMLElement;
    expect(within(accounts).getAllByRole('row').map((r) => r.textContent)).toEqual([
      t('pnl.revenue'),
      `상품매출${won(2_000_000)}`,
      t('pnl.expenses'),
      `배송비${won(250_000)}`,
      `광고비${won(300_000)}`,
    ]);
  });
});

// ---------------------------------------------------------------------- C20

describe('C20 — switching my language redraws the screen, and only the screen', () => {
  it('picking English in Settings saves it for me and the page turns English', async () => {
    const next: Me = { ...staffMe, locale: 'en', user: { ...staffMe.user!, locale: 'en' } };
    const api = await openApp('/o/tesla/settings', engineData({ 'PATCH /me': () => next }), staffMe, 'ko');
    expect(screen.getByRole('heading', { name: t('nav.settings', undefined, 'ko') })).toBeTruthy();
    const mine = screen.getByLabelText(t('settings.myLanguage', undefined, 'ko'));
    fireEvent.change(mine, { target: { value: 'en' } });
    await waitFor(() => expect(screen.getByRole('heading', { name: t('nav.settings') })).toBeTruthy());
    expect(api.calls.filter((c) => c.method === 'PATCH')).toEqual([{ method: 'PATCH', url: '/api/me', body: { locale: 'en' } }]);
    expect(screen.getByText(t('settings.myLanguage'))).toBeTruthy();
    expect(screen.queryByText(t('settings.myLanguage', undefined, 'ko'))).toBeNull();
  });

  // 2026-11-11 — no company default language: the tab is my screen language and nothing else
  it.each([
    ['staff', staffMe],
    ['owner', ownerMe],
  ] as const)('the language tab shows only my language (%s)', async (role, who) => {
    const api = await openApp('/o/tesla/settings', engineData({}, role === 'owner' ? 'owner' : undefined), who);
    const panel = screen.getByText(t('settings.myLanguage')).closest('section')!;
    const selects = panel.querySelectorAll('select');
    expect(selects).toHaveLength(1);
    // three languages, no "follow the company" choice
    expect([...selects[0].options].map((o) => o.value)).toEqual(['ko', 'en', 'zh-CN']);
    expect(selects[0].value).toBe('ko');
    expect(api.calls.some((c) => c.url === '/api/settings')).toBe(false);
  });

  it('a conversation reads the same in every web language', async () => {
    const state: ThreadState = {
      values: {
        messages: [
          { id: 'm1', role: 'user', name: null, parts: [{ kind: 'text', text: '이번 주 매출 정리해줘' }] },
          { id: 'm2', role: 'assistant', name: null, parts: [{ kind: 'text', text: '이번 주 매출은 1,200,000원이에요.' }] },
        ],
        active_agent: null,
      },
      next: [],
      interrupts: [],
    };
    const bubbles: string[][] = [];
    for (const locale of ['ko', 'en', 'zh-CN'] as const) {
      await openApp('/o/tesla/w/charging/chat/th-1', engineData({ '/threads/th-1/state': state }), staffMe, locale);
      await waitFor(() => expect(screen.getByText('이번 주 매출 정리해줘')).toBeTruthy());
      bubbles.push([screen.getByText('이번 주 매출 정리해줘').textContent!, screen.getByText('이번 주 매출은 1,200,000원이에요.').textContent!]);
      expect(screen.getByRole('button', { name: t('chat.send', undefined, locale) })).toBeTruthy(); // the screen's own words follow the language
      cleanup();
      vi.unstubAllGlobals();
    }
    expect(new Set(bubbles.map((b) => b.join('|'))).size).toBe(1);
  });
});

// ---------------------------------------------------------------------- C26

describe('C26 — the org chart widget follows the people and the teams', () => {
  it('counts agents and people per team from the chart', async () => {
    const screens = { '/screens/dashboard': { name: 'dashboard', source: 'org', screen: { format_version: 1, title: null, widgets: [{ widget: 'org-chart', version: 1 }] }, error: null } };
    await openApp('/o/tesla/w/charging/screens/dashboard', engineData({ ...screens, '/org-chart': THREE_CHART }));
    const widget = screen.getByRole('heading', { name: t('nav.org') }).closest('section') as HTMLElement;
    expect(within(widget).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      `Leadership${t('widget.teamCounts', { agents: 1, people: 0 })}`,
      `Finance${t('widget.teamCounts', { agents: 2, people: 1 })}`,
      `Sourcing${t('widget.teamCounts', { agents: 2, people: 0 })}`,
      `Marketing${t('widget.teamCounts', { agents: 2, people: 1 })}`,
    ]);
  });
});

// ---------------------------------------------------------------------- C18

describe('C18 — a connection that reaches a provider asks for its holder', () => {
  it('the add form explains the entity, and the refusal is shown in the reader’s language', async () => {
    const refused = () => new Response(JSON.stringify({ error: 'an API key needs its entity', code: 'entity_required', params: {} }), { status: 400 });
    for (const locale of ['ko', 'en'] as const) {
      const api = await openApp('/o/tesla/settings/connections', engineData({ 'POST /connections': refused }, 'owner'), ownerMe, locale);
      fireEvent.click(screen.getByRole('button', { name: t('connections.add', undefined, locale) }));
      const form = screen.getByRole('heading', { name: t('connections.add', undefined, locale) }).closest('form') as HTMLElement;
      expect(within(form).getByText(t('connections.entityHint', undefined, locale))).toBeTruthy();
      fireEvent.change(within(form).getAllByRole('textbox')[0], { target: { value: 'claude-api' } });
      fireEvent.submit(form);
      await waitFor(() => expect(within(form).getByText(t('error.entity_required', undefined, locale))).toBeTruthy());
      expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ id: 'claude-api', provider: 'anthropic' });
      expect(within(form).queryByText('an API key needs its entity')).toBeNull(); // never the server's English
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------- C25

describe('C25 — a tier that differs from the recommendation is marked in Settings', () => {
  it('marks a saved deviation, marks a new one as it is chosen, and saves it', async () => {
    const rows = [
      { category: 'review', label: '검토 · 확인', tier: 'owner', recommended: 'team', deviates: true },
      { category: 'purchase', label: '구매', tier: 'owner', recommended: 'owner', deviates: false },
    ];
    const api = await openApp('/o/tesla/settings/approvals', engineData({ '/approval-policy': rows, 'PUT /approval-policy': () => rows }, 'owner'), ownerMe);
    const rowOf = (category: string) => screen.getByRole('combobox', { name: t('tiers.tierFor', { category }) }).closest('tr') as HTMLElement;
    expect(within(rowOf('Review')).getByText(t('tiers.deviates'))).toBeTruthy();
    expect(within(rowOf('Purchase')).queryByText(t('tiers.deviates'))).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: t('tiers.tierFor', { category: 'Purchase' }) }), { target: { value: 'team' } });
    expect(within(rowOf('Purchase')).getByText(t('tiers.deviates'))).toBeTruthy();
    expect(rowOf('Purchase').className).toContain('is-deviating');
    fireEvent.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/o/tesla/approval-policy', body: { tiers: { review: 'owner', purchase: 'team' } } });
  });
});

// ---------------------------------------------------------------------- C21

describe('C21 — a screen file is drawn by the real widget registry', () => {
  it('the default dashboard draws its six widgets in order, none as a placeholder', async () => {
    await openApp('/o/tesla/w/charging/screens/dashboard', engineData({ '/agents': THREE }));
    expect(screen.getByTestId('stats')).toBeTruthy(); // the number strip leads, without a card head
    const titles = Array.from(document.querySelectorAll('.widget .widget-head h2')).map((h) => h.textContent);
    // staff: no card is theirs to answer, one P&L waits to be checked → "1" as a chip, never a 0
    expect(titles).toEqual([`${t('widget.todo')}1`, t('widget.office'), '손익표', t('widget.schedule'), t('budget.title')]);
    expect(screen.queryByTestId('placeholder')).toBeNull();
  });

  it('an org file (an old home.yaml, served as the dashboard) with an unknown widget keeps the rest of the screen', async () => {
    const home = {
      name: 'dashboard',
      source: 'org',
      screen: { format_version: 1, title: '모아 첫 화면', widgets: [{ widget: 'budget', version: 1 }, { widget: 'weather', version: 1 }, { widget: 'workflows', version: 1 }] },
      error: null,
    };
    await openApp('/o/tesla/w/charging/screens/dashboard', engineData({ '/screens/dashboard': home }));
    expect(screen.getByRole('heading', { name: '모아 첫 화면' })).toBeTruthy();
    const titles = Array.from(document.querySelectorAll('.widget .widget-head h2')).map((h) => h.textContent);
    expect(titles).toEqual([t('budget.title'), t('nav.workflows')]);
    expect(screen.getByTestId('placeholder').textContent).toContain('weather');
  });
});
