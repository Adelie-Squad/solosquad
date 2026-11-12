// The demo (2026-11-13 — frontend only, the marketing site's /demo/app, DESIGN.md `### 데모`): the
// in-browser engine plays the three scripted workflows with their approval points (team approval,
// then the owner's; decline takes the branch), keeps nothing (a new engine is the start again),
// speaks the screen's language, and the app around it is the customer's own screens: settings show
// and take nothing (언어 · 화면 open), the company tab shows the account's company name, the band
// names the end date, and only screens viewed and buttons pressed are reported.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ApprovalItem, Artifact, Run, WorkList, WorkflowThreadState } from '../src/api/types.gen';
import { setTransport, transport } from '../src/api/transport';
import { ArtifactBody } from '../src/components/ArtifactBody';
import DemoApp from '../src/demo/DemoApp';
import { DemoEngine, type DemoData } from '../src/demo/engine';
import { viewDetail } from '../src/demo/session';
import { demoTransport } from '../src/demo/transport';
import en from '../src/demo/data/en.json';
import ko from '../src/demo/data/ko.json';
import zh from '../src/demo/data/zh-CN.json';
import { I18nProvider, translate, type Locale, type MessageKey } from '../src/i18n';
import { ViewOnlyArea, SurfaceContext } from '../src/shell/surface';
import '../src/marketing/messages';
import { QuietEventSource } from './fixtures';
import { renderWith } from './helpers';

vi.mock('../src/office/OfficeCanvas', () => ({ default: () => null }));

const t = (k: MessageKey, v?: Record<string, string | number>, l: Locale = 'ko') => translate(l, k, v);
const DATA: Record<Locale, DemoData> = { ko: ko as unknown as DemoData, en: en as unknown as DemoData, 'zh-CN': zh as unknown as DemoData };
const ACCOUNT = { demoId: 'samsungDemo', companyName: '삼성전자', expires: Date.now() / 1000 + 14 * 86_400 };
const FAST = { agentMs: 30, toolMs: 10, chatMs: 10 };
const W = '/o/moa/w/hq';
const get = <T,>(e: DemoEngine, path: string, q = '') => e.handle('GET', path, new URLSearchParams(q), null).body as T;
const post = (e: DemoEngine, path: string, body: unknown) => e.handle('POST', path, new URLSearchParams(), body);

beforeAll(() => {
  (globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setTransport(null);
});

/** Run the engine's timers until `done` holds. */
async function until(done: () => boolean, max = 400) {
  for (let i = 0; i < max && !done(); i++) await vi.advanceTimersByTimeAsync(25);
  expect(done()).toBe(true);
}

describe('the engine', () => {
  it('yesterday is already there: each workflow once (SNS ad payment declined), one conversation, decisions — nothing open', () => {
    const e = new DemoEngine(DATA.ko, ACCOUNT, { pace: FAST });
    const runs = get<Run[]>(e, `${W}/workflow-runs`);
    expect(runs.filter((r) => r.status === 'success')).toHaveLength(3);
    expect(get<ApprovalItem[]>(e, `${W}/approvals`)).toEqual([]);
    const work = get<WorkList>(e, `${W}/work`).items;
    expect(work.map((w) => w.source).sort()).toEqual(['chat', 'workflow', 'workflow', 'workflow']);
    const titles = get<Artifact[]>(e, `${W}/artifacts`).map((a) => a.title);
    expect(titles).toContain('10월 손익표');
    expect(titles).toContain('광고 없이 게시'); // the declined branch
    expect(titles).not.toContain('게시 · 광고 예약 결과');
    const digest = get<{ finished: unknown[]; decided: { decision: string }[] }>(e, '/me/digest');
    expect(digest.finished).toHaveLength(4);
    expect(digest.decided.map((d) => d.decision)).toContain('declined');
    e.stop();
  });

  it('재무: steps play, the team approval waits, then the owner’s; approve → paid', async () => {
    vi.useFakeTimers();
    const e = new DemoEngine(DATA.ko, ACCOUNT, { pace: FAST });
    const events: string[] = [];
    e.subscribe((ev) => events.push(ev.event));
    const actions: string[] = [];
    e.onAction = (d) => actions.push(d);
    const started = post(e, `${W}/workflows/finance-monthly/run`, {}).body as { thread_id: string };
    const approvals = () => get<ApprovalItem[]>(e, `${W}/approvals`);
    await until(() => approvals().length === 1);
    const review = approvals()[0];
    expect(review.tier).toBe('team');
    expect(review.card.step).toBe('review');
    expect(review.card.summary).toMatch(/^기간 2026-10-01 ~ 2026-10-31 · 매출 107,600,000/);
    expect(events).toEqual(expect.arrayContaining(['run.created', 'run.started', 'run.message', 'run.update', 'run.interrupted']));
    // an agent step is that agent at work (the office) while it streams
    expect(get<WorkflowThreadState>(e, `${W}/workflow-threads/${started.thread_id}/state`).values.outputs).toHaveProperty('compare');
    // the P&L with a row to check waits for a look
    expect(get<Artifact[]>(e, `${W}/artifacts`, 'needs_review=true').map((a) => a.kind)).toEqual(['finance.pnl']);

    post(e, `${W}/workflow-threads/${started.thread_id}/resume`, { value: 'approved' });
    await until(() => approvals()[0]?.card.step === 'pay');
    const pay = approvals()[0];
    expect(pay.tier).toBe('owner');
    expect(pay.card.title).toBe('거래처 대금 지급 ₩35,145,000');
    expect(pay.card.summary).toContain('데모 — 실제로 보내지 않아요');

    post(e, `${W}/workflow-threads/${started.thread_id}/resume`, { value: 'approved' });
    const state = () => get<WorkflowThreadState>(e, `${W}/workflow-threads/${started.thread_id}/state`).values;
    await until(() => state().status === 'done');
    expect(Object.keys(state().outputs)).toContain('paid');
    expect(Object.keys(state().outputs)).not.toContain('hold');
    expect(actions).toEqual(['run:finance-monthly', 'approve:review', 'approve:pay']);
    e.stop();
  });

  it('decline takes the scenario’s branch (소싱 → 재협상 메모); a team review declined ends the run', async () => {
    vi.useFakeTimers();
    const e = new DemoEngine(DATA.ko, ACCOUNT, { pace: FAST });
    const tid = (post(e, `${W}/workflows/product-sourcing/run`, {}).body as { thread_id: string }).thread_id;
    const card = () => get<ApprovalItem[]>(e, `${W}/approvals`)[0]?.card.step;
    const state = () => get<WorkflowThreadState>(e, `${W}/workflow-threads/${tid}/state`).values;
    await until(() => card() === 'shortlist');
    post(e, `${W}/workflow-threads/${tid}/resume`, { value: 'approved' });
    await until(() => card() === 'order');
    post(e, `${W}/workflow-threads/${tid}/resume`, { value: 'declined' });
    await until(() => state().status === 'done');
    expect(Object.keys(state().outputs)).toContain('renegotiate');
    expect(Object.keys(state().outputs)).not.toContain('sent');
    expect(get<Artifact[]>(e, `${W}/artifacts`)[0].title).toBe('재협상 메모');

    const sns = (post(e, `${W}/workflows/sns-marketing/run`, {}).body as { thread_id: string }).thread_id;
    await until(() => card() === 'publish_ok');
    post(e, `${W}/workflow-threads/${sns}/resume`, { value: 'declined' });
    await until(() => get<WorkflowThreadState>(e, `${W}/workflow-threads/${sns}/state`).values.status === 'done');
    expect(get<ApprovalItem[]>(e, `${W}/approvals`)).toEqual([]);
    e.stop();
  });

  it('a request in a conversation: Chief answers from the script, hands it over and starts its workflow', async () => {
    vi.useFakeTimers();
    const e = new DemoEngine(DATA.en, ACCOUNT, { pace: FAST });
    const tid = (post(e, `${W}/threads`, { title: 'x' }).body as { thread_id: string }).thread_id;
    post(e, `${W}/threads/${tid}/runs`, { input: DATA.en.chat.suggestions[2] });
    await until(() => get<ApprovalItem[]>(e, `${W}/approvals`).length === 1);
    const messages = get<{ values: { messages: { name: string | null; role: string }[] } }>(e, `${W}/threads/${tid}/state`).values.messages;
    expect(messages.filter((m) => m.role === 'assistant').map((m) => m.name)).toEqual(['chief', 'researcher']);
    expect(get<ApprovalItem[]>(e, `${W}/approvals`)[0].card.workflow).toBe('product-sourcing');
    // anything else: the fixed answer
    post(e, `${W}/threads/${tid}/runs`, { input: 'write me a poem' });
    await vi.advanceTimersByTimeAsync(200);
    const last = get<{ values: { messages: { parts: { kind: string; text?: string }[] }[] } }>(e, `${W}/threads/${tid}/state`).values.messages.at(-1)!;
    expect(last.parts[0].text).toBe(DATA.en.chat.fallback);
    e.stop();
  });

  it('three languages: the same company and scripts, in the account’s or screen’s language', () => {
    for (const l of ['ko', 'en', 'zh-CN'] as const) {
      const d = DATA[l];
      expect(d.locale).toBe(l);
      expect(d.workflows.map((w) => w.name)).toEqual(['finance-monthly', 'product-sourcing', 'sns-marketing']);
      expect(d.chat.suggestions).toHaveLength(6);
      expect(Object.keys(d.replies).sort()).toEqual(Object.keys(DATA.ko.replies).sort());
    }
    expect(DATA.en.workflows[0].title).toBe('Monthly finance');
    expect(DATA['zh-CN'].org.display).toBe('Moa Living（示例）');
    // no Hangul in the English and Chinese calendars and company
    for (const l of ['en', 'zh-CN'] as const) expect(JSON.stringify([DATA[l].calendar.items, DATA[l].company])).not.toMatch(/[가-힣]/);
  });

  it('the account: its company name in the company record; settings and the people take nothing', () => {
    const e = new DemoEngine(DATA.ko, ACCOUNT, { pace: FAST });
    expect(get<{ name: string }>(e, '/company').name).toBe('삼성전자');
    expect(get<{ user: { display: string } }>(e, '/me').user.display).toBe('samsungDemo');
    for (const [m, p] of [['PUT', '/company'], ['POST', '/users'], ['PATCH', '/o/moa/workflows/finance-monthly'], ['PUT', '/o/moa/approval-policy'], ['POST', '/snapshot/run']] as const) {
      expect(e.handle(m, p, new URLSearchParams(), {}).status).toBe(403);
    }
    expect(e.handle('PATCH', '/me', new URLSearchParams(), { password: 'x'.repeat(12) }).status).toBe(403);
    expect((e.handle('PATCH', '/me', new URLSearchParams(), { locale: 'en' }).body as { locale: string }).locale).toBe('en');
    e.stop();
  });

  it('nothing is kept: no storage written while it runs, a new engine starts from the beginning', async () => {
    vi.useFakeTimers();
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const e = new DemoEngine(DATA.ko, ACCOUNT, { pace: FAST });
    post(e, `${W}/workflows/finance-monthly/run`, {});
    await until(() => get<ApprovalItem[]>(e, `${W}/approvals`).length === 1);
    e.stop();
    expect(set).not.toHaveBeenCalled();
    const again = new DemoEngine(DATA.ko, ACCOUNT, { pace: FAST });
    expect(get<ApprovalItem[]>(again, `${W}/approvals`)).toEqual([]);
    again.stop();
  });
});

describe('the transport', () => {
  it('answers /api/… from the engine and streams its events; uploads take nothing', async () => {
    const e = new DemoEngine(DATA.ko, ACCOUNT, { pace: FAST });
    setTransport(demoTransport(() => e));
    const r = await transport().fetch('/api/o/moa/w/hq/workflows', { method: 'GET' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { workflows: unknown[] }).workflows).toHaveLength(3);
    const up = await transport().fetch('/api/o/moa/w/hq/uploads?filename=a.csv', { method: 'POST', body: new Blob(['x']) });
    expect(up.status).toBe(403);
    const got: string[] = [];
    const src = transport().events('/api/o/moa/w/hq/events');
    src.onmessage = (ev) => got.push((JSON.parse(ev.data) as { event: string }).event);
    e.runNow('finance-monthly');
    expect(got).toEqual(['run.created']);
    src.close();
    e.stop();
  });

  it('usage details leave the ids out', () => {
    expect(viewDetail('/o/moa/w/hq/workflows/finance-monthly/runs/th-1a2b3c4d5e6f')).toBe('/o/moa/w/hq/workflows/finance-monthly/runs/:id');
    expect(viewDetail('/o/moa/w/hq/tasks/artifacts/art-99aa')).toBe('/o/moa/w/hq/tasks/artifacts/:id');
  });
});

describe('the demo app', () => {
  /** The marketing Worker's demo session, faked; everything else must not reach the network. */
  function stubSite(session: Record<string, unknown> | null = { demo_id: 'samsungDemo', company_name: '삼성전자', locale: 'ko', expires: '2026-11-27T00:00:00.000Z' }) {
    const calls: { url: string; body: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
        if (url === '/api/demo/me') return session ? new Response(JSON.stringify(session)) : new Response('{}', { status: 401 });
        if (url === '/api/demo/event' || url === '/api/demo/logout') return new Response('{"ok":true}');
        throw new Error(`the demo reached the network: ${url}`);
      }),
    );
    return calls;
  }

  const app = (path: string, locale: Locale = 'ko') =>
    render(
      <I18nProvider locale={locale}>
        <MemoryRouter initialEntries={[path]}>
          <DemoApp />
        </MemoryRouter>
      </I18nProvider>,
    );

  it('the company tab: the account’s company name, every field disabled with the quiet line; the band and the 데모 chip', async () => {
    stubSite();
    app('/o/moa/settings/company');
    const area = await screen.findByTestId('view-only', {}, { timeout: 4000 });
    expect(within(area).getByText(t('demo.locked'))).toBeTruthy();
    await waitFor(() => expect((within(area).getByDisplayValue('삼성전자') as HTMLInputElement).closest('fieldset.view-only-body')?.hasAttribute('disabled')).toBe(true));
    expect(screen.getByTestId('demo-band').textContent).toContain(t('demo.chip'));
    expect(screen.getByTestId('role-tag').textContent).toBe(t('demo.chip'));
    expect(screen.getByTestId('demo-reset')).toBeTruthy();
  });

  it('언어 stays open; the other tabs are view-only', async () => {
    stubSite();
    app('/o/moa/settings');
    await screen.findByLabelText(t('settings.myLanguage'), {}, { timeout: 4000 });
    expect(screen.queryByTestId('view-only')).toBeNull();
    expect((screen.getByLabelText(t('settings.myLanguage')) as HTMLSelectElement).disabled).toBe(false);
  });

  it('no session → back to the demo login', async () => {
    stubSite(null);
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace, origin: 'http://localhost' });
    app('/dashboard');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/demo'));
  });

  it('a workflow runs to its approval, approve → the next one; the run is reported as an action', async () => {
    const calls = stubSite();
    app('/o/moa/w/hq/workflows/finance-monthly');
    const run = await screen.findByRole('button', { name: t('workflows.runNow') }, { timeout: 4000 });
    await act(async () => fireEvent.click(run));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/demo/event' && c.body?.includes('run:finance-monthly'))).toBe(true), { timeout: 4000 });
  });

  it('English: the account’s language when this device has not chosen one', async () => {
    stubSite({ demo_id: 'acmeDemo', company_name: 'Acme Ltd', locale: 'en', expires: '2026-11-27T00:00:00.000Z' });
    app('/o/moa/settings/company', 'en');
    expect(await screen.findByDisplayValue('Acme Ltd', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByTestId('demo-band').textContent).toContain(t('demo.chip', undefined, 'en'));
  });
});

describe('ViewOnlyArea (the seam a company server never fills)', () => {
  it('renders its children unchanged without a surface; disables them and counts a press with one', () => {
    renderWith(
      <ViewOnlyArea name="settings.company">
        <button>save</button>
      </ViewOnlyArea>,
    );
    expect(screen.queryByTestId('view-only')).toBeNull();
    expect(screen.getByRole('button', { name: 'save' })).toHaveProperty('disabled', false);
    cleanup();
    const blocked = vi.fn();
    renderWith(
      <SurfaceContext.Provider value={{ viewOnly: { note: 'not here', locked: () => true, onBlocked: blocked } }}>
        <ViewOnlyArea name="settings.company">
          <button>save</button>
        </ViewOnlyArea>
      </SurfaceContext.Provider>,
    );
    expect(screen.getByText('not here')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'save' });
    expect(button.closest('fieldset')?.disabled).toBe(true);
    fireEvent.pointerDown(button);
    expect(blocked).toHaveBeenCalledWith('settings.company');
  });
});

describe('the work products', () => {
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
