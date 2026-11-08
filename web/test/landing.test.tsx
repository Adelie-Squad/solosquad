// The landing (DESIGN.md `## 랜딩`): five sections, the cycling prompt, the 2D fallback for
// reduced motion and `?webgl=off`, and where the button goes for a signed-out or signed-in visitor.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '../src/api/types.gen';
import { I18nProvider, type Locale } from '../src/i18n';
import { AGENT_COUNT, TEAMS } from '../src/landing/catalog';
import { Landing } from '../src/landing/Landing';
import { HOLD_ANSWER_MS, HOLD_TYPED_MS, PromptTyper, TYPE_MS } from '../src/landing/PromptTyper';
import { clipForSection, SECTIONS } from '../src/landing/sections';
import { me } from './helpers';

// the 3D chunk itself is not loaded in jsdom — a stand-in that says it has drawn
vi.mock('../src/landing/MascotCanvas', () => ({
  default: ({ onReady }: { onReady: () => void }) => {
    onReady();
    return <canvas data-testid="mascot-canvas" />;
  },
}));

function stubMe(who: Me | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (who ? new Response(JSON.stringify(who), { status: 200 }) : new Response(JSON.stringify({ code: 'login_required' }), { status: 401 }))),
  );
}

function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

/** jsdom has no WebGL; pretend it has. */
function stubWebGL() {
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ getExtension: () => null })) as never);
}

function landing(locale: Locale = 'en') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>
        <MemoryRouter>
          <Landing />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  stubMe(null);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sections', () => {
  it('renders the five sections, each reachable from the progress nav', () => {
    landing();
    expect(SECTIONS.map((s) => s.id)).toEqual(['hero', 'what', 'team', 'control', 'start']);
    expect(screen.getByRole('heading', { level: 1, name: 'Say what you need. The team gets to work.' })).toBeTruthy();
    for (const name of ['Ask in one place. The work happens at every desk.', `${AGENT_COUNT} agents in ${TEAMS.length} teams`, 'You make the decisions', 'Open your company’s office']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SECTIONS.map((s) => `#landing-${s.id}`));
    for (const s of SECTIONS) expect(document.getElementById(`landing-${s.id}`)).toBeTruthy();
    expect(links[0].getAttribute('aria-current')).toBe('step');
  });

  it('shows all 15 agents by team, with names and summaries in the reader’s language', () => {
    landing('ko');
    expect(AGENT_COUNT).toBe(15);
    expect(TEAMS.map((g) => g.team)).toEqual(['core', 'product', 'engineering', 'business', 'brand']);
    const strip = screen.getByRole('list', { name: '에이전트 목록' });
    expect(within(strip).getAllByRole('heading', { level: 3 })).toHaveLength(15);
    expect(within(strip).getByRole('heading', { name: '재무' })).toBeTruthy();
    // the finance SKILL.md summary, Korean
    expect(within(strip).getByText(/장부와 매출, 매입을 맞춰 보고/)).toBeTruthy();
    for (const g of TEAMS) for (const a of g.agents) expect(a.summary.ko && a.summary.en && a.summary['zh-CN'], a.id).toBeTruthy();
  });

  it('maps each section to an office clip', () => {
    expect(clipForSection('hero', 0)).toBe('idle');
    expect(clipForSection('what', 0.2)).toBe('thinking');
    expect(clipForSection('what', 0.7)).toBe('typing');
    expect(clipForSection('control', 0.5)).toBe('waiting');
    expect(clipForSection('start', 0.5)).toBe('done');
  });
});

describe('the prompt to Chief', () => {
  const box = () => screen.getByTestId('landing-prompt');
  const text = () => box().querySelector('.landing-prompt-text')!.textContent;
  const answered = () => screen.getByTestId('landing-answer').classList.contains('is-on');

  it('types an example, says who took it, then moves to the next', () => {
    vi.useFakeTimers();
    render(
      <I18nProvider locale="en">
        <PromptTyper still={false} />
      </I18nProvider>,
    );
    const first = 'Sum up last month’s profit and loss';
    expect(text()).toBe('');
    for (let i = 0; i < 6; i++) act(() => void vi.advanceTimersByTime(TYPE_MS));
    expect(text()).toBe(first.slice(0, 6));
    expect(answered()).toBe(false);
    for (let i = 6; i < first.length + 1; i++) act(() => void vi.advanceTimersByTime(TYPE_MS));
    expect(text()).toBe(first);
    act(() => void vi.advanceTimersByTime(HOLD_TYPED_MS));
    expect(answered()).toBe(true);
    expect(screen.getByTestId('landing-answer').textContent).toBe('Finance is on it');
    act(() => void vi.advanceTimersByTime(HOLD_ANSWER_MS));
    expect(answered()).toBe(false);
    for (let i = 0; i < 60; i++) act(() => void vi.advanceTimersByTime(TYPE_MS));
    expect(text()).toBe('Draft the product page for next week’s new item');
  });

  it('lists every example for screen readers', () => {
    render(
      <I18nProvider locale="ko">
        <PromptTyper still />
      </I18nProvider>,
    );
    const list = screen.getByRole('list', { name: '요청 예시' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '지난달 손익 정리해줘 재무에게 맡겼어요',
      '다음 주 신상품 상세 페이지 시안 만들어줘 크리에이티브에게 맡겼어요',
      '재고가 적은 상품 목록 뽑아줘 데이터 분석가에게 맡겼어요',
    ]);
  });
});

describe('3D and its fallbacks', () => {
  it('with WebGL and motion: the sticky mascot layer, idle in the hero', async () => {
    stubMotion(false);
    stubWebGL();
    const { container } = landing();
    const main = container.querySelector('.landing')!;
    expect(main.getAttribute('data-mode')).toBe('live');
    expect(container.querySelector('.landing-mascot')!.getAttribute('data-clip')).toBe('idle');
    expect(screen.queryByTestId('landing-static-mascot')).toBeNull();
    // the 3D chunk loads after the first paint, not with it
    expect(screen.queryByTestId('mascot-canvas')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('mascot-canvas')).toBeTruthy());
    await waitFor(() => expect(container.querySelector('.landing-mascot.is-ready')).toBeTruthy());
  });

  it('reduced motion: the 2D penguin, no mascot layer, the prompt standing still', () => {
    stubMotion(true);
    stubWebGL();
    vi.useFakeTimers();
    const { container } = landing();
    expect(container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static');
    expect(container.querySelector('.landing-stage')).toBeNull();
    expect(screen.getByTestId('landing-static-mascot').querySelector('svg.penguin')).toBeTruthy();
    const text = () => screen.getByTestId('landing-prompt').querySelector('.landing-prompt-text')!.textContent;
    expect(text()).toBe('Sum up last month’s profit and loss');
    act(() => void vi.advanceTimersByTime(20_000));
    expect(text()).toBe('Sum up last month’s profit and loss');
    expect(screen.getByTestId('landing-answer').classList.contains('is-on')).toBe(true);
  });

  it('?webgl=off: the 2D penguin even when WebGL works', () => {
    stubMotion(false);
    stubWebGL();
    window.history.replaceState(null, '', '/?webgl=off');
    const { container } = landing();
    expect(container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static');
    expect(container.querySelector('.landing-stage')).toBeNull();
    expect(screen.getByTestId('landing-static-mascot')).toBeTruthy();
  });

  it('no WebGL at all: the 2D penguin', () => {
    stubMotion(false);
    const { container } = landing();
    expect(container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static');
  });
});

describe('the button', () => {
  it('signed out: every call to action goes to /login', async () => {
    landing();
    const links = await screen.findAllByRole('link', { name: /Log in/ });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) expect(a.getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('link', { name: /Go to my office/ })).toBeNull();
    expect(screen.getByText('Log in and you are straight in the office.')).toBeTruthy();
  });

  it('signed in: every call to action goes to the last workspace', async () => {
    stubMe(me({ last_scope: { org: 'tesla', workspace: 'vehicles' } }));
    landing();
    const links = await screen.findAllByRole('link', { name: /Go to my office/ });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) expect(a.getAttribute('href')).toBe('/o/tesla/w/vehicles');
    expect(screen.queryByRole('link', { name: /Log in/ })).toBeNull();
    expect(screen.getByText('Your team is waiting in the office.')).toBeTruthy();
  });
});
