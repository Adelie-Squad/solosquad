// The landing (DESIGN.md `## 랜딩`): five pinned slides stepped by native scroll (snap stops), the
// progress nav and Tab bringing a slide up, the stacked 2D fallback (reduced motion · `?webgl=off` ·
// no WebGL · a 3D layer that never draws), the org chart and its team modal with the sideways list,
// the cycling prompt, the buttons (none in the first slide, no arrow on login) and the regression
// for the penguin that appeared and then disappeared.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode, useMemo } from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '../src/api/types.gen';
import { I18nProvider, type Locale } from '../src/i18n';
import { AGENT_COUNT, TEAMS } from '../src/landing/catalog';
import { drawState, follow, GIVE_UP_SECONDS, LIMITS, lookAt, wander } from '../src/landing/gaze';
import { useHolder } from '../src/landing/holder';
import { Landing } from '../src/landing/Landing';
import { HOLD_ANSWER_MS, HOLD_TYPED_MS, PromptTyper, TYPE_MS } from '../src/landing/PromptTyper';
import { clipForSection, presentWeight, PRESENT_SECONDS, SECTIONS, stepAt, THINK_SECONDS } from '../src/landing/sections';
import { me } from './helpers';

// the 3D chunk itself is not loaded in jsdom — a stand-in that says it has drawn (or, per test, fails)
const canvas = vi.hoisted(() => ({ behaviour: 'draw' as 'draw' | 'never' | 'fail' }));
vi.mock('../src/landing/MascotCanvas', async () => {
  const { useEffect } = await import('react');
  return {
    default: function Stand({ onReady, onFail }: { onReady: () => void; onFail: () => void }) {
      useEffect(() => {
        if (canvas.behaviour === 'draw') onReady();
        if (canvas.behaviour === 'fail') onFail();
      }, [onReady, onFail]);
      return <canvas data-testid="mascot-canvas" />;
    },
  };
});

const css = readFileSync(join(process.cwd(), 'src/styles/landing.css'), 'utf8');

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

/** jsdom lays nothing out: each snap stop sits one screen (900px) below the last. */
const SCREEN = 900;
function stubLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const n = Number((this as HTMLElement).style?.getPropertyValue('--n') || 0);
    const top = this.classList.contains('landing-stop') ? n * SCREEN - window.scrollY : 0;
    return { top, bottom: top + SCREEN, left: 0, right: 0, width: 0, height: SCREEN, x: 0, y: top, toJSON() {} } as DOMRect;
  });
}

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
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

const live = () => {
  stubMotion(false);
  stubWebGL();
  stubLayout();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0; // ran already — nothing left pending
  });
};

beforeEach(() => {
  canvas.behaviour = 'draw';
  stubMe(null);
  window.history.replaceState(null, '', '/');
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('stepping the slides', () => {
  it('picks the stop nearest the scroll position, changing halfway between two', () => {
    const stops = [0, 900, 1800, 2700, 3600];
    expect(stepAt(0, stops)).toBe(0);
    expect(stepAt(449, stops)).toBe(0);
    expect(stepAt(450, stops)).toBe(1);
    expect(stepAt(1800, stops)).toBe(2);
    expect(stepAt(9999, stops)).toBe(4);
    expect(stepAt(-50, stops)).toBe(0);
    expect(stepAt(10, [])).toBe(0);
  });

  it('live: one snap stop per section, the stage pinned, the slide from the scroll position', () => {
    live();
    const { container } = landing();
    const main = container.querySelector('.landing')!;
    expect(main.getAttribute('data-mode')).toBe('live');
    const stops = [...container.querySelectorAll('.landing-stop')];
    expect(stops.map((s) => s.id)).toEqual(SECTIONS.map((s) => `landing-${s.id}`));
    expect(container.querySelector('.landing-pin .landing-stage')).toBeTruthy();
    const on = () => container.querySelector('.landing-slide.is-on')!.getAttribute('data-slide');
    expect(on()).toBe('hero');
    scrollTo(SCREEN * 2);
    expect(on()).toBe('team');
    expect(main.getAttribute('data-section')).toBe('team');
    expect(container.querySelector('.landing-slide.is-hero')!.classList.contains('is-passed')).toBe(true);
    scrollTo(SCREEN * 3 + 300);
    expect(on()).toBe('control');
    scrollTo(SCREEN * 4);
    expect(on()).toBe('start');
    // native scroll: the stops are snap targets, the page snaps on its own — nothing takes the wheel
    expect(css).toMatch(/html:has\(\.landing\[data-mode="live"\]\)\s*\{\s*scroll-snap-type: y mandatory;/);
    expect(css).toMatch(/\.landing-stop \{[^}]*scroll-snap-align: start;[^}]*scroll-snap-stop: always;/);
    expect(css).toMatch(/\.landing-pin \{[^}]*position: sticky;/);
  });

  it('the progress nav jumps to the stops and marks the slide that is up', () => {
    live();
    landing();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SECTIONS.map((s) => `#landing-${s.id}`));
    for (const a of links) expect(document.querySelector(a.getAttribute('href')!)!.classList.contains('landing-stop')).toBe(true);
    expect(links[0].getAttribute('aria-current')).toBe('step');
    scrollTo(SCREEN);
    expect(links[1].getAttribute('aria-current')).toBe('step');
    expect(links[0].getAttribute('aria-current')).toBeNull();
  });

  it('Tab into a slide that is not up brings it up (scrolls to its stop)', () => {
    live();
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    landing();
    const orgButton = screen.getByRole('button', { name: /^Product 4 members/ });
    act(() => orgButton.focus());
    expect(into).toHaveBeenCalledTimes(1);
    expect(into.mock.instances[0]).toBe(document.getElementById('landing-team'));
  });

  it('every heading is plain HTML, the section number above it is gone', () => {
    live();
    landing();
    expect(screen.getByRole('heading', { level: 1, name: 'Say what you need. The team gets to work.' })).toBeTruthy();
    for (const name of ['Ask in one place. The work happens at every desk.', `${AGENT_COUNT} agents in ${TEAMS.length} teams`, 'You make the decisions', 'Open your company’s office']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    expect(document.querySelector('.landing-index')).toBeNull();
    expect(screen.queryByText(/^0\d \/ 05$/)).toBeNull();
    expect(screen.queryByText('Scroll')).toBeNull();
  });
});

describe('the penguin', () => {
  it('stays in the middle of the stage for every slide (one layer, never moved per section)', () => {
    live();
    const { container } = landing();
    const mascot = () => screen.getByTestId('landing-mascot');
    const before = mascot();
    for (let i = 0; i < SECTIONS.length; i++) {
      scrollTo(SCREEN * i);
      expect(mascot()).toBe(before);
      expect(mascot().className).not.toMatch(/is-(hero|what|team|control|start)/);
    }
    expect(container.querySelectorAll('.landing-mascot')).toHaveLength(1);
  });

  it('maps each slide to an office clip — "what" thinks, then types', () => {
    expect(clipForSection('hero', 0)).toBe('idle');
    expect(clipForSection('what', 0)).toBe('thinking');
    expect(clipForSection('what', THINK_SECONDS)).toBe('typing');
    expect(clipForSection('team', 1)).toBe('idle');
    expect(clipForSection('control', 1)).toBe('waiting');
    expect(clipForSection('start', 1)).toBe('done');
  });

  it('presents: the wing goes up fast, holds while the content comes in, and comes back down', () => {
    expect(presentWeight(-0.1)).toBe(0);
    expect(presentWeight(0.1)).toBeGreaterThan(0);
    expect(presentWeight(0.5)).toBe(1);
    expect(presentWeight(PRESENT_SECONDS - 0.1)).toBeLessThan(0.2);
    expect(presentWeight(PRESENT_SECONDS)).toBe(0);
    // the content follows the wing, one piece after another
    expect(css).toMatch(/\.landing-pin \.landing-slide\.is-on \.landing-item \{[^}]*transition-delay: calc\(var\(--present-delay\) \+ var\(--i, 0\) \* var\(--present-step\)\)/);
  });

  it('looks at the cursor with the head, the body following a little, within limits and damped', () => {
    const far = lookAt({ x: 5, y: -5 });
    expect(far.body).toBeCloseTo(LIMITS.body);
    expect(far.body + far.yaw).toBeCloseTo(LIMITS.yaw);
    expect(far.pitch).toBeCloseTo(-LIMITS.pitch);
    expect(lookAt({ x: 0, y: 0 })).toEqual({ body: 0, yaw: 0, pitch: 0 });
    const step = follow({ body: 0, yaw: 0, pitch: 0 }, far, 1 / 60);
    expect(step.yaw).toBeGreaterThan(0);
    expect(step.yaw).toBeLessThan(far.yaw / 4);
    let l = { body: 0, yaw: 0, pitch: 0 };
    for (let i = 0; i < 60; i++) l = follow(l, far, 1 / 60);
    expect(l.yaw).toBeCloseTo(far.yaw, 2);
    // touch: a slow look around, never past the cursor's reach
    for (let s = 0; s < 60; s += 0.7) {
      const p = wander(s);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });
});

describe('regression: the penguin that appeared, then disappeared', () => {
  it('the holder keeps the penguin under StrictMode (the old useMemo moved it into a discarded group)', () => {
    const penguin = new THREE.Object3D();
    const seen: THREE.Group[] = [];
    function Probe() {
      const holder = useHolder(penguin);
      seen.push(holder);
      return null;
    }
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    const kept = seen[seen.length - 1];
    expect(penguin.parent).toBe(kept);
    expect(kept.children).toEqual([penguin]);

    // the old shape, for the record: mutation inside useMemo under StrictMode loses the penguin
    const old = new THREE.Object3D();
    const kepts: THREE.Group[] = [];
    function Old() {
      const holder = useOldHolder(old);
      kepts.push(holder);
      return null;
    }
    render(
      <StrictMode>
        <Old />
      </StrictMode>,
    );
    expect(kepts[kepts.length - 1].children).toHaveLength(0);
  });

  it('the 2D penguin stays until the 3D one has really drawn', () => {
    expect(drawState(0, 0.5)).toBe('waiting');
    expect(drawState(7, 0.5)).toBe('drawn');
    expect(drawState(0, GIVE_UP_SECONDS)).toBe('empty');
  });

  it('a 3D layer that never draws keeps the poster (never an empty stage)', async () => {
    canvas.behaviour = 'never';
    live();
    const { container } = landing();
    await waitFor(() => expect(screen.getByTestId('mascot-canvas')).toBeTruthy());
    expect(container.querySelector('.landing-mascot.is-ready')).toBeNull();
    expect(container.querySelector('.landing-poster svg.penguin')).toBeTruthy();
  });

  it('a 3D layer that gives up falls back to the stacked page with the 2D penguin', async () => {
    canvas.behaviour = 'fail';
    live();
    const { container } = landing();
    await waitFor(() => expect(container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static'));
    expect(screen.getByTestId('landing-static-mascot').querySelector('svg.penguin')).toBeTruthy();
  });

  it('when it has drawn, the canvas takes over from the poster', async () => {
    live();
    const { container } = landing();
    expect(screen.queryByTestId('mascot-canvas')).toBeNull(); // after the first paint, not with it
    await waitFor(() => expect(container.querySelector('.landing-mascot.is-ready')).toBeTruthy());
  });
});

/** The pre-fix holder (2.1 MascotCanvas), kept only to show the test above catches it. */
function useOldHolder(child: THREE.Object3D): THREE.Group {
  return useMemo(() => {
    const g = new THREE.Group();
    g.add(child);
    return g;
  }, [child]);
}

describe('stacked fallback', () => {
  it('reduced motion: the sections stacked, the 2D penguin, the prompt standing still', () => {
    stubMotion(true);
    stubWebGL();
    vi.useFakeTimers();
    const { container } = landing();
    expect(container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static');
    expect(container.querySelector('.landing-stage')).toBeNull();
    expect(container.querySelector('.landing-stop')).toBeNull();
    expect(container.querySelector('.landing-stack')).toBeTruthy();
    for (const s of SECTIONS) expect(document.getElementById(`landing-${s.id}`)!.tagName).toBe('SECTION');
    expect(container.querySelectorAll('.landing-slide.is-on')).toHaveLength(SECTIONS.length);
    expect(screen.getByTestId('landing-static-mascot').querySelector('svg.penguin')).toBeTruthy();
    const text = () => screen.getByTestId('landing-prompt').querySelector('.landing-prompt-text')!.textContent;
    expect(text()).toBe('Sum up last month’s profit and loss');
    act(() => void vi.advanceTimersByTime(20_000));
    expect(text()).toBe('Sum up last month’s profit and loss');
  });

  it('?webgl=off and no WebGL: stacked, 2D', () => {
    stubMotion(false);
    stubWebGL();
    window.history.replaceState(null, '', '/?webgl=off');
    const { container } = landing();
    expect(container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static');
    expect(container.querySelector('.landing-stage')).toBeNull();
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
    const again = landing();
    expect(again.container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static');
  });

  it('a screen too short for one slide stacks too', () => {
    live();
    const h = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 480, configurable: true });
    const { container } = landing();
    expect(container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static');
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  });

  it('the stacked page needs no JS animation: every slide and item is shown by plain CSS', () => {
    expect(css).toMatch(/\.landing-pin \.landing-item \{/);
    expect(css).not.toMatch(/(^|\n)\.landing-item \{[^}]*opacity: 0/);
    expect(css).not.toMatch(/(^|\n)\.landing-slide \{[^}]*opacity: 0/);
  });
});

describe('section 3: the org chart and the team modal', () => {
  it('draws the owner and Chief on top, the teams below, names in the reader’s language', () => {
    landing('ko');
    const org = screen.getByTestId('landing-org');
    expect(within(org).getByText('대표와 임원')).toBeTruthy();
    expect(within(org).getByText('임원')).toBeTruthy();
    const teams = within(org).getByRole('list', { name: '팀' });
    expect(within(teams).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      '프로덕트 4명 · 에이전트 보기',
      '엔지니어링 5명 · 에이전트 보기',
      '비즈니스 3명 · 에이전트 보기',
      '브랜드 2명 · 에이전트 보기',
    ]);
    expect(within(org).getByText('재무')).toBeTruthy();
    expect(within(org).queryByText('PRODUCT')).toBeNull();
  });

  it('a team opens the modal at that team: the agent cards side by side, scrolling sideways', async () => {
    landing('ko');
    const opener = screen.getByRole('button', { name: '비즈니스 3명 · 에이전트 보기' });
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: '에이전트 15명, 5개 팀' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' }));
    const strip = within(dialog).getByRole('list', { name: '에이전트 목록' });
    expect(strip.getAttribute('tabindex')).toBe('0');
    expect(within(strip).getAllByRole('heading', { level: 3 })).toHaveLength(15);
    expect(within(strip).getByText(/장부와 매출, 매입을 맞춰 보고/)).toBeTruthy();
    for (const g of TEAMS) for (const a of g.agents) expect(a.summary.ko && a.summary.en && a.summary['zh-CN'], a.id).toBeTruthy();
    expect(css).toMatch(/\.landing-strip \{[^}]*overflow-x: auto;[^}]*scroll-snap-type: x proximity;/);
    expect(css).toMatch(/\.landing-card \{[^}]*scroll-snap-align: start;/);

    // a plain mouse wheel scrolls it sideways while it can move, and is left alone at the end
    Object.defineProperty(strip, 'scrollWidth', { value: 3000, configurable: true });
    Object.defineProperty(strip, 'clientWidth', { value: 1000, configurable: true });
    strip.scrollLeft = 0;
    const wheel = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    strip.dispatchEvent(wheel);
    expect(strip.scrollLeft).toBe(120);
    expect(wheel.defaultPrevented).toBe(true);
    strip.scrollLeft = 2000;
    const atEnd = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    strip.dispatchEvent(atEnd);
    expect(atEnd.defaultPrevented).toBe(false);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('the top row and "see all" open it too', async () => {
    landing('en');
    fireEvent.click(screen.getByRole('button', { name: 'See all agents' }));
    expect(await screen.findByRole('dialog', { name: `${AGENT_COUNT} agents in ${TEAMS.length} teams` })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^Owner and Chief/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
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

describe('the buttons', () => {
  it('no call to action in the first slide; login only in the top bar and the last slide, with no arrow', async () => {
    landing();
    const hero = document.querySelector('[data-slide="hero"]') as HTMLElement;
    expect(within(hero).queryAllByRole('link')).toHaveLength(0);
    expect(within(hero).queryAllByRole('button')).toHaveLength(0);
    const links = await screen.findAllByRole('link', { name: 'Log in' });
    expect(links).toHaveLength(2);
    expect(links[0].closest('.landing-top')).toBeTruthy();
    expect(links[1].closest('[data-slide="start"]')).toBeTruthy();
    for (const a of links) {
      expect(a.getAttribute('href')).toBe('/login');
      expect(a.querySelector('svg')).toBeNull();
    }
    expect(screen.getByText('Log in and you are straight in the office.')).toBeTruthy();
  });

  it('signed in: both go to the last workspace', async () => {
    stubMe(me({ last_scope: { org: 'tesla', workspace: 'vehicles' } }));
    landing();
    const links = await screen.findAllByRole('link', { name: 'Go to my office' });
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute('href')).toBe('/o/tesla/w/vehicles');
      expect(a.querySelector('svg')).toBeNull();
    }
    expect(screen.queryByRole('link', { name: /Log in/ })).toBeNull();
    expect(screen.getByText('Your team is waiting in the office.')).toBeTruthy();
  });

  it('the top bar stays fixed on the page colour, with a hairline once the page has moved', () => {
    live();
    const { container } = landing();
    const top = container.querySelector('.landing-top')!;
    expect(top.classList.contains('is-scrolled')).toBe(false);
    scrollTo(SCREEN);
    expect(top.classList.contains('is-scrolled')).toBe(true);
    expect(css).toMatch(/\.landing-top \{[^}]*position: fixed;[^}]*background: var\(--bg\);/);
    expect(css).toMatch(/\.landing-top\.is-scrolled \{\s*border-bottom-color: var\(--line\);/);
    expect(css).not.toMatch(/box-shadow: (?!none)/);
  });
});
