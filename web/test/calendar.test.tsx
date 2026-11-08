// Decision 60 (DESIGN.md `### 일정`): the account calendar — month · week · list, quick add, the
// item sheet with its 할 일 checklist and tags, the 구분 · 태그 settings and the agent-access
// choice, personal privacy on screen; plus the sidebar's collapsed rail (user, 2026-11-09).
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import { addDays, iso, monthGrid, rangeOf, readQuery, weekDays, writeQuery } from '../src/lib/calendar';
import { RAIL_KEY, isRailShortcut } from '../src/shell/rail';
import { Shell } from '../src/shell/Shell';
import { CalendarView } from '../src/views/calendar/CalendarView';
import { calendarDemo, engineData, QuietEventSource, stubEngine } from './fixtures';
import { me, renderWith } from './helpers';

(globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;

const TODAY = iso(new Date());
const demo = calendarDemo(TODAY);

function calendarData(over: Record<string, unknown> = {}) {
  return engineData(
    {
      '/calendar/items': demo.list(TODAY, addDays(TODAY, 40)),
      '/calendar/labels': { labels: demo.labels, seeded: {}, preset_errors: {} },
      '/calendar/agent-access': { level: 'off' },
      '/people': [{ id: 'u-1', username: 'boss', display: 'Boss', role: 'owner', title: '', teams: [], workspaces: null }],
      ...Object.fromEntries(demo.items.map((i) => [`/calendar/items/${i.id}`, demo.detail(i.id)])),
      ...over,
    },
    'owner',
  );
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

const open = (path: string, locale: 'ko' | 'en' | 'zh-CN' = 'ko') =>
  renderWith(
    <Routes>
      <Route path="*" element={<><CalendarView /><Where /></>} />
    </Routes>,
    locale,
    { path, me: me() },
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

// ---------------------------------------------------------------------- dates

describe('calendar dates', () => {
  it('draws six Monday-first weeks for a month and seven days for a week', () => {
    const g = monthGrid('2026-11-09');
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-10-26'); // the Monday before 1 November
    expect(weekDays('2026-11-12')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(rangeOf('list', '2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-12-09' });
  });

  it('keeps the view, the day and the filters in the address', () => {
    const q = readQuery(new URLSearchParams('view=week&date=2026-11-14&kind=work&done=0'), TODAY);
    expect(q).toMatchObject({ view: 'week', date: '2026-11-14', kind: 'work', done: false });
    expect(readQuery(new URLSearchParams('view=year&date=nope'), TODAY)).toMatchObject({ view: null, date: TODAY });
    expect(writeQuery({ kind: null, done: true }, new URLSearchParams('kind=work&done=0&view=list')).toString()).toBe('view=list');
  });
});

// ---------------------------------------------------------------------- views

describe('the calendar screen', () => {
  it('month: the items, the sub-items and the 할 일 due that day, with the 구분 colour', async () => {
    stubEngine(calendarData());
    open(`/calendar?view=month&date=${TODAY}`);
    const month = await screen.findByTestId('month');
    const r1 = within(month).getAllByRole('button', { name: '1라운드 제출 열기' });
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0].getAttribute('data-color')).toBe('blue'); // inherits 지원 from its 항목
    // the to-do due today is on today's cell
    expect(within(month).getByRole('button', { name: '사업계획서 작성/제출 · 1라운드 제출 열기' })).toBeTruthy();
    // a personal entry is drawn quietly (dashed border, person icon) — and only because it is mine
    const dentist = within(month).getByRole('button', { name: '치과 예약 열기' });
    expect(dentist.className).toContain('is-personal');
  });

  it('week and list: the same entries, the list with checkable 할 일', async () => {
    const { calls } = stubEngine({ ...calendarData(), 'PATCH /calendar/todos/ct-plan': () => ({ todo: { ...demo.todos[0], done: true }, item: demo.items[3] }) });
    open(`/calendar?view=week&date=${TODAY}`);
    const week = await screen.findByTestId('week');
    expect(within(week).getAllByRole('gridcell')).toHaveLength(7);
    expect(within(week).getAllByText('오리엔테이션').length + within(week).queryAllByText('치과 예약').length).toBeGreaterThan(0);
    cleanup();
    open(`/calendar?view=list&date=${TODAY}`);
    const list = await screen.findByTestId('list');
    const check = within(list).getByRole('checkbox', { name: '사업계획서 작성/제출 완료로 표시' });
    await act(async () => fireEvent.click(check));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/calendar/todos/ct-plan'))).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ done: true });
  });

  it('asks the engine for the range of the view and the chosen filters', async () => {
    const { calls } = stubEngine(calendarData());
    open(`/calendar?view=month&date=2026-11-09&kind=work&done=0`);
    await screen.findByTestId('month');
    const url = calls.find((c) => c.url.startsWith('/api/calendar/items'))!.url;
    expect(url).toContain('from=2026-10-26');
    expect(url).toContain('to=2026-12-06');
    expect(url).toContain('kind=work');
    expect(url).toContain('done=false');
  });

  it('quick add: a day opens the form and the new entry opens in the sheet', async () => {
    const created = { ...demo.items[0], id: 'ci-new', title: '데모데이' };
    const { calls } = stubEngine({ ...calendarData({ '/calendar/items/ci-new': { ...demo.detail('ci-top'), item: created, children: [], todos: [], child_todos: [] } }), 'POST /calendar/items': () => created });
    open(`/calendar?view=month&date=${TODAY}`);
    const month = await screen.findByTestId('month');
    const days = within(month).getAllByRole('button', { name: /에 일정 더하기$/ });
    expect(days).toHaveLength(42);
    // arrow keys move between days
    const first = days.find((d) => d.getAttribute('tabindex') === '0')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-day')).toBe(addDays(TODAY, 1));
    await act(async () => fireEvent.click(first));
    const form = await screen.findByTestId('quick-add');
    fireEvent.change(within(form).getByLabelText('제목'), { target: { value: '데모데이' } });
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: '더하기' })));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ kind: 'work', org: 'tesla', title: '데모데이', start: TODAY });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('item=ci-new'));
  });

  it.each([
    ['ko', '일정', '새 일정', '월'],
    ['en', 'Calendar', 'New event', 'Month'],
    ['zh-CN', '日程', '新建日程', '月'],
  ] as const)('%s words', async (locale, title, add, month) => {
    stubEngine(calendarData());
    open(`/calendar?date=${TODAY}`, locale);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByRole('button', { name: add })).toBeTruthy();
    expect(screen.getByRole('tab', { name: month })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------- the sheet

describe('the item sheet', () => {
  it('breadcrumbs 사업 › 항목 › 세부 항목, the 할 일 checklist with inline add, and tags with inline create', async () => {
    const newTag = { id: 'cl-new', type: 'tag', scope_kind: 'org', scope: 'tesla', name: '마감', color: 'blue', archived: false, position: 2 };
    const { calls } = stubEngine({
      ...calendarData(),
      'POST /calendar/items/ci-r1/todos': () => ({ todo: { ...demo.todos[0], id: 'ct-x', title: '발표 자료' }, item: demo.items[3] }),
      'PATCH /calendar/todos/ct-plan': () => ({ todo: { ...demo.todos[0], done: true }, item: demo.items[3] }),
      'POST /calendar/labels': () => newTag,
      'PATCH /calendar/items/ci-r1': () => demo.items[3],
    });
    open(`/calendar?view=list&date=${TODAY}&item=ci-r1`);
    const sheet = await screen.findByTestId('item-drawer');
    const crumbs = within(sheet).getByRole('navigation');
    expect(within(crumbs).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Tesla', '2차 모두의 창업', '1라운드 제출']);
    const todos = within(sheet).getByTestId('todos');
    expect(within(todos).getAllByRole('checkbox')).toHaveLength(2);
    await act(async () => fireEvent.click(within(todos).getByRole('checkbox', { name: '사업계획서 작성/제출 완료로 표시' })));
    const add = within(todos).getByLabelText('할 일 더하기');
    fireEvent.change(add, { target: { value: '발표 자료' } });
    await act(async () => fireEvent.keyDown(add, { key: 'Enter' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/todos'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/todos'))?.body).toEqual({ title: '발표 자료' });
    expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/ct-plan'))?.body).toEqual({ done: true });
    // a new tag is made and put on the item in one go
    const tag = within(sheet).getByLabelText('새 태그');
    fireEvent.change(tag, { target: { value: '마감' } });
    await act(async () => fireEvent.submit(tag.closest('form')!));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/calendar/items/ci-r1'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/calendar/labels'))?.body).toEqual({ type: 'tag', org: 'tesla', name: '마감' });
    expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/calendar/items/ci-r1'))?.body).toEqual({ tag_ids: ['cl-doc', 'cl-new'] });
    // 구분 offers this business's categories only
    const cats = within(within(sheet).getByTestId('category-select')).getAllByRole('option').map((o) => o.textContent);
    expect(cats).toEqual(['구분 없음', '지원', '개발', '영업', '인사', '네트워킹']);
  });

  it('a 항목 lists its 세부 항목 with their 할 일 count', async () => {
    stubEngine(calendarData());
    open(`/calendar?view=list&date=${TODAY}&item=ci-top`);
    const sheet = await screen.findByTestId('item-drawer');
    const rows = within(sheet).getAllByRole('button', { name: /지원|오리엔테이션|1라운드 제출|멘토링/ }).map((b) => b.querySelector('.cal-sub-title')?.textContent).filter(Boolean);
    expect(rows).toEqual(['지원', '오리엔테이션', '1라운드 제출', '멘토링']);
    expect(within(sheet).getByText('할 일 0/2')).toBeTruthy();
  });

  it('a personal entry says only I see it, offers my own labels, and names nobody else', async () => {
    stubEngine(calendarData());
    open(`/calendar?view=list&date=${TODAY}&item=ci-trip`);
    const sheet = await screen.findByTestId('item-drawer');
    expect(within(sheet).getAllByRole('listitem')[0].textContent).toBe('개인 일정');
    expect(within(sheet).getByText('개인 일정은 나만 봐요.')).toBeTruthy();
    const cats = within(within(sheet).getByTestId('category-select')).getAllByRole('option').map((o) => o.textContent);
    expect(cats).toEqual(['구분 없음', '개인']);
  });
});

// ---------------------------------------------------------------------- settings

describe('구분 · 태그 settings and agent access', () => {
  it('lists a business’s categories and tags, recolours and archives them', async () => {
    const { calls } = stubEngine({ ...calendarData(), 'PATCH /calendar/labels/cl-dev': () => ({ ...demo.labels[1], archived: true }) });
    open(`/calendar?view=list&date=${TODAY}`);
    await screen.findByTestId('list');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '구분 · 태그' })));
    const cats = await screen.findByTestId('labels-category');
    expect(within(cats).getAllByRole('textbox', { name: '이름' }).map((i) => (i as HTMLInputElement).value)).toEqual(['지원', '개발', '영업', '인사', '네트워킹']);
    const dev = within(cats).getAllByRole('listitem')[1];
    expect(within(dev).getAllByRole('radio')).toHaveLength(7); // the fixed palette
    await act(async () => fireEvent.click(within(dev).getByRole('button', { name: '보관' })));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ archived: true }));
    expect(within(screen.getByTestId('labels-tag')).getAllByRole('textbox', { name: '이름' }).map((i) => (i as HTMLInputElement).value)).toEqual(['서류', '인터뷰']);
  });

  it('the agent-access choice: off by default, saved on a press, people never see it either way', async () => {
    const { calls } = stubEngine({ ...calendarData(), 'PUT /calendar/agent-access': (b: unknown) => b });
    open(`/calendar?view=list&date=${TODAY}`);
    await screen.findByTestId('list');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '구분 · 태그' })));
    await act(async () => fireEvent.click(await screen.findByRole('tab', { name: '내 개인 일정' })));
    const panel = await screen.findByTestId('agent-access');
    await waitFor(() => expect(within(panel).getByRole('radio', { name: '허용 안 함' }).getAttribute('aria-checked')).toBe('true'));
    expect(within(panel).getByText('어느 쪽을 골라도 다른 사람은 대표를 포함해 내 개인 일정을 볼 수 없어요.')).toBeTruthy();
    await act(async () => fireEvent.click(within(panel).getByRole('radio', { name: '바쁨·한가함만' })));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ level: 'busy' }));
    expect(within(panel).getByText('에이전트는 바쁜 시간과 비어 있는 시간만 알아요. 제목과 메모는 읽지 않아요.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------- the rail

describe('the sidebar rail (user, 2026-11-09)', () => {
  beforeEach(() => stubEngine(engineData({}, 'owner')));
  const shell = (locale: 'ko' | 'en' = 'ko') =>
    renderWith(
      <Routes>
        <Route path="*" element={<Shell><p>body</p></Shell>} />
      </Routes>,
      locale,
      { path: '/o/tesla/w/charging/office' },
    );

  it('folds to a rail of icons and back — each icon keeps its name and a tooltip — and remembers it', async () => {
    const { container } = shell();
    const toggle = screen.getByRole('button', { name: '사이드바 접기' });
    expect(toggle.getAttribute('title')).toContain('⌘\\');
    await act(async () => fireEvent.click(toggle));
    expect(container.querySelector('.workspace')!.className).toContain('is-rail');
    expect(localStorage.getItem(RAIL_KEY)).toBe('rail');
    const unfold = screen.getByRole('button', { name: '사이드바 펼치기' });
    expect(unfold.getAttribute('aria-expanded')).toBe('false');
    for (const name of ['대시보드', '일정', '메신저', '사무실', '워크플로우']) {
      const tile = screen.getByRole('link', { name });
      expect(tile.getAttribute('title')).toBe(name);
    }
    expect(screen.getByRole('link', { name: /^과제/ }).getAttribute('title')).toBe('과제');
    expect(screen.getByRole('button', { name: /현재 범위|Tesla/ })).toBeTruthy(); // the switcher as a letter
    expect(screen.getByRole('link', { name: /설정 · / })).toBeTruthy(); // the account button
    cleanup();
    // a new page in the same browser opens folded
    const again = shell();
    expect(again.container.querySelector('.workspace')!.className).toContain('is-rail');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '사이드바 펼치기' })));
    expect(localStorage.getItem(RAIL_KEY)).toBe('open');
  });

  it('⌘\\ or Ctrl+\\ toggles it; ⌘K stays the quick jump', async () => {
    expect(isRailShortcut({ key: '\\', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isRailShortcut({ key: '\\', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(isRailShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(false);
    const { container } = shell('en');
    await act(async () => fireEvent.keyDown(window, { key: '\\', ctrlKey: true }));
    expect(container.querySelector('.workspace')!.className).toContain('is-rail');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    await act(async () => fireEvent.keyDown(window, { key: '\\', metaKey: true }));
    expect(container.querySelector('.workspace')!.className).not.toContain('is-rail');
  });

  it('is not there on a phone: the toggle is hidden and the rail rules are desktop-only', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/calendar.css'), 'utf8');
    expect(css).toMatch(/@media \(max-width: 860px\) \{\s*\.sidebar-collapse \{\s*display: none;/);
    const railBlock = css.slice(css.indexOf('@media (min-width: 861px)'));
    expect(railBlock).toContain('.workspace.is-rail .sidebar');
    expect(css.slice(0, css.indexOf('@media (min-width: 861px)'))).not.toContain('.workspace.is-rail .sidebar {');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.workspace \.sidebar \{\s*transition: none;/);
  });
});
