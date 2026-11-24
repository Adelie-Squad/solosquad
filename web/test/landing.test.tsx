// The landing (DESIGN.md `## 랜딩`, PRD v2.1.0 §3.5 — decision 61): six pinned slides, eight stops (the
// workflows hold three), moved by the step controller (one gesture = one stop, then a hold), the
// section names at the left edge and Tab going through it, the
// stacked 2D fallback (reduced motion · `?webgl=off` · no WebGL · a 3D layer that never draws) with
// native scroll, each section's content centred in its scene, where the penguin stands for each
// (staging) and how it walks there, what it does (the wave, a pretend typing patter within the stroke
// limits, the scroll, the stamp at every workflow, the pointing at the gap and the price), that the
// content never shakes, what may show in front of the content (occlusion), the story (2026-11-14 —
// who it is for, the problem and why now, the AI team, the workflows with the old 맡기기 folded in),
// the gap chart, the org chart with its team members and its team modal, the workflows' flow and
// approval tiers (= approvals.py), the prices, the buttons, and the regression for the penguin that
// appeared and then disappeared.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode, useMemo } from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '../src/api/types.gen';
import { lockScroll } from '../src/components/scrollLock';
import { I18nProvider, type Locale } from '../src/i18n';
import {
  ACT_CLIP,
  ACT_DELAY_MS,
  cues,
  RELAY,
  relayAt,
  relayHand,
  resetCues,
  SQUASH,
  squashAt,
  STAMP,
  STAMP_APPROVED_MS,
  STAMP_IMPACT_MS,
  STAMP_REST,
  STAMP_TOP,
  STAMP_TOTAL_MS,
  stampLift,
  stampState,
  tugAt,
  UNROLL_MS,
  WAVE_HZ,
  waveAt,
} from '../src/landing/acting';
import { GAP, GapAct, PricingAct, WorkflowAct } from '../src/landing/Acts';
import { fitEraser, makeEraser, ORDER } from '../src/landing/rig';
import { makeStamp } from '../src/landing/props';
import { paletteFor } from '../src/office/palette';
import { BODY, centreOffset, faceX, easeInOutCubic, headOf, moveAt, MOVE_MS, penguinHeight, spotFor, standSpot, STROKE_DEPTH, STROKE_LIFT, STROKE_LIMITS, STROKE_RATE, strokeAt } from '../src/landing/staging';
import { AGENT_COUNT, TEAMS } from '../src/landing/catalog';
import { follow as followScroll, FOLLOW_RATE, SmoothScroll, wheelPixels, type SmoothEnv } from '../src/landing/smooth';
import { drawState, follow, GIVE_UP_SECONDS, LIMITS, lookAt, wander } from '../src/landing/gaze';
import { ACT_YAW, actingWings, actYaw, ARM_CHOICE, bodyTurn, farWing, MAX_STRETCH, MAX_TURN, nearWing, nextFront, outside, pathAt, rectsOverlap, segmentHits, stretchFor, viaPoint } from '../src/landing/arms';
import { claimIntro, DROP, INTRO, INTRO_MS, introAt, resetIntro, REST, SQUASH_MAX } from '../src/landing/intro';
import { makeMorph } from '../src/landing/morph';
import { useHolder } from '../src/landing/holder';
import { InquiryProvider } from '../src/marketing/Inquiry';
import { Landing } from '../src/landing/Landing';
import { firstStop, MOVED_ANCHORS, SECTIONS, stepAt, STOPS, type ActId } from '../src/landing/sections';
import { DOMAINS, TIER, WORKFLOW_EXAMPLES } from '../src/landing/workflows';
import { APPROVED_AFTER_MS, ASSIGN_FIRST_MS, ASSIGN_STEP_MS, charMs, flowAt, flowLength, flowStill, HOLD_TYPED_MS, STAMP_MS, TEAM_MS, TYPE_MAX_MS, TYPE_MS } from '../src/landing/flow';

/** Every staging (sections.ts `ActId`). */
const ACTS: ActId[] = ['wave', 'type', 'unroll', 'stamp', 'point'];

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
/** A rule's body, by its exact selector. */
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

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

/** jsdom lays nothing out: each stop (a section, or a later stop of the workflows) sits one screen (900px) below the last. */
const SCREEN = 900;
function stubLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const i = STOPS.findIndex((st) => st.anchor === this.id);
    const top = i >= 0 ? i * SCREEN - window.scrollY : 0;
    return { top, bottom: top + SCREEN, left: 0, right: 0, width: 0, height: SCREEN, x: 0, y: top, toJSON() {} } as DOMRect;
  });
}

/** The page's scroll position: `window.scrollTo` moves it (the step controller's glide) and says so. */
function stubScroll() {
  let y = 0;
  Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true });
  return vi.spyOn(window, 'scrollTo').mockImplementation(((o: ScrollToOptions) => {
    y = o.top ?? y;
    window.dispatchEvent(new Event('scroll'));
  }) as never);
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
          <InquiryProvider>
            <Landing />
          </InquiryProvider>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/**
 * Live landing with a frame callback that runs at once — but never inside another one, so a glide
 * (which asks for its next frame from inside a frame) moves on through a timer instead of recursing.
 */
const live = () => {
  stubMotion(false);
  stubWebGL();
  stubLayout();
  let depth = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    if (depth) return setTimeout(() => cb(0), 16) as unknown as number;
    depth++;
    cb(0);
    depth--;
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
};

/** Live landing on a fake clock (timers, frames and `performance.now`) — for the smoothed wheel. */
const liveOnClock = () => {
  stubMotion(false);
  stubWebGL();
  stubLayout();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
};

beforeEach(() => {
  canvas.behaviour = 'draw';
  resetCues();
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

  it('live (2026-11-24): six sections in the page flow, one stop each and three for the workflows, the canvas fixed, the section from the native scroll position', () => {
    live();
    const { container } = landing();
    const main = container.querySelector('.landing')!;
    expect(main.getAttribute('data-mode')).toBe('live');
    expect(SECTIONS.map((s) => s.id)).toEqual(['hero', 'problem', 'org', 'workflows', 'pricing', 'contact']);
    // every stop is a real place on the page: the sections, the workflows' block and its later thirds
    const stops = STOPS.map((s) => document.getElementById(s.anchor)!);
    expect(stops.map((s) => s.id)).toEqual([
      'landing-hero',
      'landing-problem',
      'landing-org',
      'landing-workflows',
      'landing-workflows-sourcing',
      'landing-workflows-sns',
      'landing-pricing',
      'landing-contact',
    ]);
    expect(stops.map((s) => s.tagName)).toEqual(['SECTION', 'SECTION', 'SECTION', 'DIV', 'SPAN', 'SPAN', 'SECTION', 'SECTION']);
    expect(document.getElementById('landing-workflows')!.querySelector('[data-slide="workflows"]')).toBeTruthy();
    expect(container.querySelector('.landing-flow .landing-stage')).toBeTruthy();
    const on = () => container.querySelector('.landing-slide.is-on')!.getAttribute('data-slide');
    const workflow = () => screen.getByTestId('landing-workflow').getAttribute('data-workflow');
    expect(on()).toBe('hero');
    scrollTo(SCREEN * 2);
    expect(on()).toBe('org');
    expect(main.getAttribute('data-section')).toBe('org');
    expect(container.querySelector('.landing-slide.is-hero')!.classList.contains('is-passed')).toBe(true);
    scrollTo(SCREEN * 3 + 300);
    expect(on()).toBe('workflows');
    expect(workflow()).toBe('finance');
    // the next two stops keep the same slide and card; only the workflow changes
    scrollTo(SCREEN * 4);
    expect(on()).toBe('workflows');
    expect(workflow()).toBe('sourcing');
    scrollTo(SCREEN * 5);
    expect(workflow()).toBe('sns');
    expect(container.querySelectorAll('.landing-slide.is-passed')).toHaveLength(3);
    scrollTo(SCREEN * 6);
    expect(on()).toBe('pricing');
    scrollTo(SCREEN * 7);
    expect(on()).toBe('contact');
    // nothing pinned but the workflows' slide inside its three screens; the canvas stays on the screen
    expect(rule('.landing-flow .landing-slide')).toMatch(/position: relative;[\s\S]*min-height: 100svh;/);
    expect(rule('.landing-steps > .landing-slide')).toMatch(/position: sticky;/);
    expect(rule('.landing-steps')).toMatch(/height: calc\(var\(--steps\) \* 100svh\);/);
    expect(rule('.landing-stage')).toMatch(/position: fixed;/);
    expect(css).not.toMatch(/scroll-snap-type: y/);
    expect(css).not.toMatch(/\.landing-track|\.landing-stop\b/);
  });

  it('the progress nav points at the stops and marks the slide that is up', () => {
    live();
    landing();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const links = [...nav.querySelectorAll<HTMLAnchorElement>(':scope > ol > li > a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SECTIONS.map((s) => `#landing-${s.id}`));
    for (const a of within(nav).getAllByRole('link')) expect(STOPS.map((st) => `#${st.anchor}`)).toContain(a.getAttribute('href'));
    expect(links[0].getAttribute('aria-current')).toBe('step');
    scrollTo(SCREEN);
    expect(links[1].getAttribute('aria-current')).toBe('step');
    expect(links[1].className).toBe('is-on');
    expect(links[0].getAttribute('aria-current')).toBeNull();
    // section names only — no numbers (user, 2026-11-09)
    expect(links.map((a) => a.textContent)).toEqual(['Intro', 'Why now', 'AI team', 'Workflows', 'Pricing', 'Contact']);
    // under 워크플로우: a small dot per workflow, pointing at its stop; the one up is marked
    const dots = within(nav).getAllByRole('link', { name: /^(Finance|Sourcing|Social media)$/ });
    expect(dots.map((a) => a.getAttribute('href'))).toEqual(['#landing-workflows', '#landing-workflows-sourcing', '#landing-workflows-sns']);
    scrollTo(SCREEN * 4);
    expect(links[3].getAttribute('aria-current')).toBe('step');
    expect(dots.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(nav.textContent).not.toMatch(/\d/);
    expect(nav.querySelector('.landing-progress-index')).toBeNull();
  });

  it('the section names sit at the left edge, vertically centred, in the margin left of the message; a phone hides them', () => {
    expect(rule('.landing-progress')).toMatch(/position: fixed;[\s\S]*top: 50%;[\s\S]*left: var\(--space-6\);/);
    expect(rule('.landing-progress')).not.toMatch(/right:/);
    expect(rule('.landing-progress')).toMatch(/max-width: calc\(var\(--landing-gutter\) - var\(--space-10\)\);/);
    expect(rule('.landing-progress')).toMatch(/transform: translateY\(-50%\);/);
    // the page leaves that margin on both sides of the content
    expect(css).toMatch(/--landing-w: min\(1200px, calc\(100% - 2 \* var\(--landing-gutter\)\)\);/);
    expect(rule('.landing-progress a.is-on .landing-progress-mark')).toMatch(/background: var\(--accent\);/);
    expect(rule('.landing-progress a')).toMatch(/font-size: 13px;/);
    const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
    expect(phone).toMatch(/\.landing-progress \{\s*display: none;/);
  });

  it('every heading is plain HTML, the section number above it is gone', () => {
    live();
    landing();
    expect(screen.getByRole('heading', { level: 1, name: 'We build your company an AI team that does the work' })).toBeTruthy();
    for (const name of [
      'You pay for AI. Is the work still the same?',
      'An AI team shaped to your company, working beside your people',
      'Ask in one line; it stops where you approve',
      'Builds from ₩6,000,000. The call is free.',
      'Try it, then decide',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    expect(document.querySelector('.landing-index')).toBeNull();
    expect(screen.queryByText(/^0\d \/ 05$/)).toBeNull();
    expect(screen.queryByText('Scroll')).toBeNull();
  });
});

/** A page 5000px long, a fake clock and frames that run when the clock passes 16 ms. */
function fakePage(start = 0) {
  let t = 0;
  let y = start;
  const frames: { at: number; cb: () => void; id: number }[] = [];
  let nextId = 1;
  const env: SmoothEnv = {
    now: () => t,
    scrollY: () => y,
    maxY: () => 5000,
    scrollTo: (to) => void (y = to),
    frame: (cb) => {
      const id = nextId++;
      frames.push({ at: t + 16, cb, id });
      return id;
    },
    cancel: (id) => {
      const i = frames.findIndex((f) => f.id === id);
      if (i >= 0) frames.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 4);
      for (const f of frames.splice(0).filter((f) => (f.at <= t ? true : (frames.push(f), false)))) f.cb();
    }
  };
  return { env, advance, y: () => y, jump: (to: number) => void (y = to) };
}

describe('natural scroll (2026-11-24 — "스크롤할 때마다 내려가면서 자연스러워야")', () => {
  it('a wheel turn always moves the page by its own amount — nothing is held or swallowed — gliding, not jumping', () => {
    const page = fakePage();
    const s = new SmoothScroll(page.env);
    s.wheel(400);
    page.advance(16);
    expect(page.y()).toBeGreaterThan(0);
    expect(page.y()).toBeLessThan(400); // a glide, not a jump
    page.advance(120);
    expect(page.y()).toBeGreaterThan(200); // half the way in ~0.11 s, like the reference
    page.advance(1200);
    expect(page.y()).toBe(400);
    // every turn counts, also while the page is still moving — no hold, no "one gesture = one section"
    s.wheel(400);
    page.advance(50);
    s.wheel(400);
    page.advance(1500);
    expect(page.y()).toBe(1200);
    for (let i = 0; i < 12; i++) {
      s.wheel(400);
      page.advance(500);
    }
    page.advance(1500);
    expect(page.y()).toBe(5000); // within the page
    s.wheel(-300);
    page.advance(1500);
    expect(page.y()).toBe(4700);
  });

  it('the ease is an exponential follow: half the gap in ln2 / rate, smooth, there in the end', () => {
    const half = (Math.LN2 / FOLLOW_RATE) * 1000;
    expect(half).toBeGreaterThan(90);
    expect(half).toBeLessThan(140);
    expect(followScroll(0, 100, half)).toBeCloseTo(50, 0);
    expect(followScroll(99.8, 100, 16)).toBe(100);
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 }, 900)).toBe(48);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 }, 900)).toBe(900);
  });

  it('keys, the scrollbar and touch are the browser’s: after one, the next turn starts from where the page is', () => {
    const page = fakePage();
    const s = new SmoothScroll(page.env);
    page.jump(2000); // the scrollbar, a key, a swipe
    s.sync();
    s.wheel(100);
    page.advance(1500);
    expect(page.y()).toBe(2100);
    s.to(300); // a section name, a tab
    page.advance(1500);
    expect(page.y()).toBe(300);
  });

  it('on the page: every wheel turn moves the live landing on — through the sections, never held at one', () => {
    liveOnClock();
    stubScroll();
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: SCREEN * 10, configurable: true });
    const { container } = landing();
    act(() => void vi.advanceTimersByTime(50));
    const on = () => container.querySelector('.landing-slide.is-on')!.getAttribute('data-slide');
    const ys: number[] = [];
    for (let i = 0; i < 8; i++) {
      const e = new WheelEvent('wheel', { deltaY: 450, cancelable: true });
      window.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true); // smoothed by us, never dropped
      act(() => void vi.advanceTimersByTime(700));
      ys.push(window.scrollY);
    }
    // ~450 more every turn (the glide nearly there after 0.7 s), right through the section boundaries
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(400);
    act(() => void vi.advanceTimersByTime(2000));
    expect(window.scrollY).toBe(450 * 8);
    expect(on()).toBe('workflows');
    // a pinch-zoom or a modal keeps its wheel
    const zoom = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true });
    window.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(false);
    const release = lockScroll();
    const held = new WheelEvent('wheel', { deltaY: 200, cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(false);
    release();
  });

  it('the section names and the workflow tabs glide to their place (the hash stays for back)', () => {
    liveOnClock();
    stubScroll();
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: SCREEN * 10, configurable: true });
    landing();
    act(() => void vi.advanceTimersByTime(50));
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Pricing' }));
    expect(window.location.hash).toBe('#landing-pricing');
    act(() => void vi.advanceTimersByTime(2000));
    expect(window.scrollY).toBe(SCREEN * firstStop('pricing'));
    fireEvent.click(screen.getByTestId('landing-workflow-tab-sns'));
    act(() => void vi.advanceTimersByTime(2000));
    expect(window.scrollY).toBe(SCREEN * (firstStop('workflows') + 2));
  });

  it('the stacked page keeps plain native scroll — the wheel untouched', () => {
    stubMotion(true);
    landing();
    const e = new WheelEvent('wheel', { deltaY: 400, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('the message rises in with its section by scroll position (it rewinds), not by a timer', () => {
    expect(css).toMatch(/@supports \(animation-timeline: view\(\)\)/);
    expect(css).toMatch(/\.landing-flow \.landing-copy \{[^}]*animation: landing-rise linear both;[^}]*animation-timeline: view\(\);/);
  });
});

describe('the scene: the content centred, the penguin around it', () => {
  it('each section is the message on one side and, on the other, the scene holding its content', () => {
    live();
    const { container } = landing();
    for (const s of SECTIONS) {
      const slide = container.querySelector(`[data-slide="${s.id}"]`)!;
      const parts = [...slide.children].map((c) => c.className);
      expect(parts).toEqual(['landing-copy', 'landing-scene']);
      const scene = screen.getByTestId(`landing-scene-${s.id}`);
      // one centred block per scene — the penguin's spot is read from it
      expect(scene.querySelectorAll('[data-content]'), s.id).toHaveLength(1);
    }
    expect(within(screen.getByTestId('landing-scene-hero')).getByTestId('landing-hero-penguin')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-problem')).getByTestId('landing-gap')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-org')).getByTestId('landing-org')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-workflows')).getAllByTestId('landing-workflow')).toHaveLength(1);
    expect(within(screen.getByTestId('landing-scene-pricing')).getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(within(screen.getByTestId('landing-scene-contact')).getAllByRole('link', { name: 'Try the demo' })).toHaveLength(1);
    expect(container.querySelector('.landing-present')).toBeNull();
  });

  it('the content block sits in the middle of its scene (CSS), and nothing slides under the penguin', () => {
    expect(rule('.landing-flow .landing-scene')).toMatch(/display: grid;[\s\S]*place-items: center;[\s\S]*min-height: calc\(100svh - var\(--landing-gnb\)\);/);
    // the slide only fades: a slide that moved would move the spot the penguin walks to
    expect(rule('.landing-flow .landing-slide')).not.toMatch(/transform|translate/);
    // the canvas covers the scene column (a little past it), the same grid as the slides
    expect(rule('.landing-stage')).toMatch(/grid-template-columns: var\(--landing-cols\);/);
    expect(rule('.landing-mascot')).toMatch(/grid-column: 2;[\s\S]*height: 100%;/);
    expect(rule('.landing-scene')).toMatch(/grid-column: 2;/);
    // layers: the content, the 3D canvas over it, never catching clicks — and no 2D poster at all
    expect(css).not.toMatch(/\.landing-poster/);
    expect(rule('.landing-flow .landing-slide')).toMatch(/z-index: 2;/);
    expect(rule('.landing-canvas')).toMatch(/z-index: 3;[\s\S]*pointer-events: none;/);
    // the request line keeps two lines' room in every workflow, so the card (and the button the stamp
    // lands on) stays the same size from stop to stop
    expect(rule('.landing-workflow-typed')).toMatch(/height: calc\(2 \* 1\.45em\);[\s\S]*overflow: hidden;/);
  });

  it('a centred block is centred within a pixel; an off-centre one is not', () => {
    const area = { left: 600, top: 64, width: 720, height: 836 };
    const block = { width: 480, height: 230 };
    const centred = { left: area.left + (area.width - block.width) / 2, top: area.top + (area.height - block.height) / 2, ...block };
    expect(centreOffset(centred, area)).toEqual({ x: 0, y: 0 });
    expect(Math.abs(centreOffset({ ...centred, left: centred.left + 0.6 }, area).x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreOffset({ ...centred, left: centred.left + 40 }, area).x)).toBeGreaterThan(1);
  });

  it('the marks the canvas reads: the content, what hides the body, the wings’ targets', () => {
    live();
    landing();
    // (the first section has nothing in front of the penguin since 2026-11-24 — it stands on its own)
    for (const s of SECTIONS.filter((x) => x.id !== 'hero')) expect(screen.getByTestId(`landing-scene-${s.id}`).querySelector('[data-front]'), s.id).toBeTruthy();
    expect(screen.getByTestId('landing-scene-hero').querySelector('[data-front]')).toBeNull();
    // the penguin stands behind the workflow card and the last card: nothing of it shows under them either
    for (const id of ['workflows', 'contact']) expect(screen.getByTestId(`landing-scene-${id}`).querySelector('[data-front="ground"]'), id).toBeTruthy();
    // the price: a wing goes out to card 1, the build price (which wing comes from the geometry — arms.ts)
    const pricing = screen.getByTestId('landing-scene-pricing');
    expect(pricing.querySelector('li')!.querySelector('[data-hand]')).toBeTruthy();
    expect(pricing.querySelectorAll('[data-hand]')).toHaveLength(1);
    // the gap: a wing goes out to the bracket between the two lines
    const problem = screen.getByTestId('landing-scene-problem');
    expect(problem.querySelectorAll('[data-hand]')).toHaveLength(1);
    expect(problem.querySelector('[data-hand]')!.classList.contains('is-gap')).toBe(true);
    const org = screen.getByTestId('landing-scene-org');
    expect(org.querySelector('[data-rod]')).toBeTruthy();
    expect(org.querySelectorAll('[data-front]')).toHaveLength(2); // the paper shown so far + the roll
    const workflows = screen.getByTestId('landing-scene-workflows');
    expect(workflows.querySelector('.landing-approve')!.textContent).toContain('Approve');
    expect(workflows.querySelector('[data-hand]')).toBeNull();
    // each section's staging (sections.ts — one act per section, the two cards share the wave)
    // the workflows type (2026-11-14 ②): the prompt box is the card's top row; the stamp is the card's own animation
    expect(Object.fromEntries(SECTIONS.map((x) => [x.id, x.act]))).toEqual({ hero: 'wave', problem: 'point', org: 'unroll', workflows: 'type', pricing: 'point', contact: 'wave' });
  });

  it('phone: the scene first with the content centred in what is left, the message under it; the canvas covers the stage', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
    expect(phone).toMatch(/\.landing-flow \.landing-scene \{[^}]*order: -1;[^}]*flex: 1 1 auto;/);
    expect(phone).toMatch(/\.landing-mascot \{[^}]*position: absolute;[^}]*inset: 0;/);
  });
});

describe('where the penguin stands (staging)', () => {
  const desk = { width: 690, height: 836 };
  const h = penguinHeight(desk, false);
  const box = { left: 800, top: 300, width: 480, height: 230 };
  const right = box.left + box.width;
  const bottom = box.top + box.height;

  it('one height per screen, smaller on a phone', () => {
    expect(h).toBeCloseTo(Math.min(836 * 0.36, 690 * 0.4, 320));
    expect(penguinHeight({ width: 390, height: 560 }, true)).toBeLessThanOrEqual(190);
    expect(penguinHeight({ width: 390, height: 560 }, true)).toBeLessThan(h);
  });

  it('type (워크플로우 — the prompt box on top of the card): centred over it, shoulders just above its top edge, the feet hidden behind it', () => {
    const s = spotFor('type', box, h, false);
    expect(s.x).toBe(box.left + box.width / 2);
    const shoulder = s.y - (1 - BODY.shoulder) * h;
    expect(shoulder).toBeLessThan(box.top);
    expect(box.top - shoulder).toBeLessThan(0.15 * h);
    expect(s.y).toBeLessThan(bottom); // feet behind the box
    expect(headOf(s).y).toBeLessThan(box.top); // the face shows above it
    expect(s.lean).toBe(0);
  });

  it('point (가격): beside the price cards on their right, turned to them; on a phone over their upper right', () => {
    const s = spotFor('point', box, h, false);
    expect(s.x).toBeGreaterThan(right);
    expect(s.turn).toBeLessThan(0);
    const p = spotFor('point', box, 170, true);
    expect(p.x).toBeLessThan(right);
    expect(p.x + BODY.halfWidth * 170).toBeLessThanOrEqual(right + 2);
    expect(headOf(p).y).toBeLessThan(box.top);
  });

  it('unroll (조직도): behind the paper’s upper-left corner, leaning out to the left; the eyes above the rod', () => {
    const s = spotFor('unroll', box, h, false);
    expect(s.x).toBeGreaterThan(box.left); // the body is behind the paper
    expect(s.lean).toBeGreaterThan(0.2); // leaning out to the reader's left
    expect(headOf(s).x).toBeLessThan(s.x);
    const eyes = s.y - Math.cos(s.lean) * (1 - BODY.eyes) * h;
    expect(eyes).toBeLessThan(box.top); // the face peeks over the top edge
    expect(s.y).toBeLessThan(bottom); // the feet are hidden behind the paper
  });

  it('stamp (워크플로우): just outside the card’s lower-left corner, turned to it', () => {
    const s = spotFor('stamp', box, h, false);
    expect(s.x).toBeLessThan(box.left);
    expect(s.y).toBeGreaterThan(bottom);
    expect(s.turn).toBeGreaterThan(0.2);
    const p = spotFor('stamp', box, 170, true);
    expect(p.h).toBeLessThan(170); // a smaller penguin on a phone
    expect(p.x).toBeLessThan(box.left);
  });

  it('wave (시작 · 문의): behind the card’s upper right, head and shoulders above it', () => {
    const s = spotFor('wave', box, h, false);
    expect(s.x).toBeGreaterThan(box.left + box.width / 2);
    expect(s.x).toBeLessThan(right);
    expect(headOf(s).y).toBeLessThan(box.top);
    expect(s.y).toBeLessThan(bottom);
  });

  it('every act has its own spot', () => {
    const spots = ACTS.map((a) => spotFor(a, box, h, false));
    const keys = new Set(spots.map((s) => `${Math.round(s.x)}:${Math.round(s.y)}`));
    expect(keys.size).toBe(ACTS.length);
  });

  it('walks between spots in ~0.7 s, eased at both ends, with a small hop — no jump', () => {
    expect(MOVE_MS).toBeGreaterThanOrEqual(600);
    expect(MOVE_MS).toBeLessThanOrEqual(800);
    const a = spotFor('type', box, h, false);
    const b = spotFor('stamp', box, h, false);
    expect(moveAt(a, b, 0).x).toBeCloseTo(a.x);
    expect(moveAt(a, b, MOVE_MS)).toEqual(b);
    // eased: slow at the start and the end, fastest in the middle
    const step = (ms: number) => Math.abs(moveAt(a, b, ms + 16).x - moveAt(a, b, ms).x);
    expect(step(0)).toBeLessThan(step(MOVE_MS / 2 - 8) / 4);
    expect(step(MOVE_MS - 16)).toBeLessThan(step(MOVE_MS / 2 - 8) / 4);
    // never a jump between frames
    let last = moveAt(a, b, 0);
    for (let ms = 16; ms <= MOVE_MS; ms += 16) {
      const now = moveAt(a, b, ms);
      expect(Math.hypot(now.x - last.x, now.y - last.y)).toBeLessThan(h * 0.12);
      last = now;
    }
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });
});

describe('the acting', () => {
  it('every act breathes on the standing clip — the office clips sit on a chair, and the office typing clip (the trembling) is not used', () => {
    expect(ACT_CLIP).toEqual({ wave: 'stand', type: 'stand', unroll: 'stand', stamp: 'stand', point: 'stand' });
    expect(ACT_DELAY_MS).toBeGreaterThan(MOVE_MS); // the act starts once the penguin has arrived
  });

  it('typing is a pretend patter: 3–4 strokes a second, alternating, smooth, not one per character', () => {
    expect(STROKE_RATE).toBeGreaterThanOrEqual(STROKE_LIMITS.min);
    expect(STROKE_RATE).toBeLessThanOrEqual(STROKE_LIMITS.max);
    // count the strokes (each wing's local peaks) over ten seconds
    const peaks = (side: 'L' | 'R') => {
      let n = 0;
      const dt = 0.002;
      for (let t = dt; t < 10; t += dt) {
        const [a, b, c] = [strokeAt(t - dt, side), strokeAt(t, side), strokeAt(t + dt, side)];
        if (b > a && b >= c && b > 0.5) n++;
      }
      return n;
    };
    const perSecond = (peaks('L') + peaks('R')) / 10;
    expect(perSecond).toBeGreaterThanOrEqual(STROKE_LIMITS.min);
    expect(perSecond).toBeLessThanOrEqual(STROKE_LIMITS.max);
    // the wings take turns: when one is down the other is up
    for (let t = 0; t < 2; t += 0.01) expect(Math.min(strokeAt(t, 'L'), strokeAt(t, 'R'))).toBe(0);
    // smooth: no step bigger than a frame's worth of a gentle curve
    for (let t = 0; t < 2; t += 1 / 60) expect(Math.abs(strokeAt(t + 1 / 60, 'L') - strokeAt(t, 'L'))).toBeLessThan(0.4);
    // small strokes
    expect(STROKE_DEPTH + STROKE_LIFT).toBeLessThan(0.06);
  });

  it('the content never shakes: no animation or transform on the gap chart or the approval card', () => {
    for (const sel of ['.landing-act.is-gap', '.landing-gap-plot', '.landing-approval', '.landing-preview', '.landing-act.is-flow', '.landing-workflow-ask', '.landing-workflow-pieces', '.landing-task-chip']) {
      for (const m of css.matchAll(new RegExp(`(^|\\n)([^\\n{}]*${sel.replace(/[.[\]]/g, '\\$&')}[^\\n{},]*)\\{([^}]*)\\}`, 'g'))) {
        if (/\.landing-approve\b|\.landing-stamp-mark|\.landing-decline|\.btn/.test(m[2])) continue; // the button and its ink, not the card
        expect(m[3], m[2]).not.toMatch(/animation|transform|translate|rotate/);
      }
    }
    expect(css).not.toMatch(/@keyframes landing-(shake|tap)/);
    expect(css).not.toMatch(/data-tap/);
  });

  it('the stamp: raised past its strike height, a decisive strike, a small rebound, a subtle squash', () => {
    expect(stampLift(-10)).toBe(STAMP_REST);
    expect(Math.max(...[150, 300, 450, 600].map(stampLift))).toBeGreaterThan(STAMP_TOP);
    const s0 = STAMP.raise + STAMP.cock;
    expect(stampLift(s0 + STAMP.strike / 2)).toBeGreaterThan(STAMP_TOP * 0.7);
    expect(stampLift(STAMP_IMPACT_MS)).toBe(0);
    expect(stampLift(STAMP_IMPACT_MS + STAMP.hold / 2)).toBe(0);
    expect(stampLift(STAMP_TOTAL_MS + 1)).toBe(STAMP_REST);
    // calm: nothing in the stamp moves faster than 120 ms, the whole beat takes ~2 s
    for (const v of Object.values(STAMP)) expect(v).toBeGreaterThanOrEqual(120);
    expect(STAMP_TOTAL_MS).toBeGreaterThan(1600);
    // the squash: at most 4 %, back to itself
    expect(squashAt(STAMP_IMPACT_MS - 1)).toBe(1);
    expect(Math.min(...[0, 30, 60, 90, 120, 200].map((d) => squashAt(STAMP_IMPACT_MS + d)))).toBeGreaterThanOrEqual(1 - SQUASH - 1e-9);
    expect(SQUASH).toBeLessThanOrEqual(0.04);
    expect(squashAt(STAMP_IMPACT_MS + 400)).toBe(1);
    expect(stampState(STAMP_IMPACT_MS - 1)).toBe('waiting');
    expect(stampState(STAMP_IMPACT_MS)).toBe('pressed');
    expect(stampState(STAMP_APPROVED_MS)).toBe('approved');
  });

  it('the workflow card (2026-11-14 ②): the request types in (the penguin patters), Chief hands each agent its piece one after another, the team approval lights, the stamp lands — again at every stop', () => {
    // the timeline itself
    const chars = 30;
    expect(charMs(chars)).toBe(TYPE_MS);
    expect(charMs(200) * 200).toBeLessThanOrEqual(TYPE_MAX_MS); // a long request still types in ≤ 2.4 s
    expect(flowAt(-1, chars, 3)).toMatchObject({ typed: 0, typing: false, pieces: ['waiting', 'waiting', 'waiting'], team: false, stamp: 'waiting' });
    expect(flowAt(TYPE_MS * 10, chars, 3)).toMatchObject({ typed: 10, typing: true, pieces: ['waiting', 'waiting', 'waiting'] });
    const typed = chars * TYPE_MS;
    const first = typed + HOLD_TYPED_MS + ASSIGN_FIRST_MS;
    expect(flowAt(first - 1, chars, 3)).toMatchObject({ typed: chars, typing: false, pieces: ['waiting', 'waiting', 'waiting'] });
    expect(flowAt(first, chars, 3).pieces).toEqual(['on', 'waiting', 'waiting']);
    expect(flowAt(first + ASSIGN_STEP_MS, chars, 3).pieces).toEqual(['done', 'on', 'waiting']);
    const all = first + 3 * ASSIGN_STEP_MS;
    expect(flowAt(all, chars, 3)).toMatchObject({ pieces: ['done', 'done', 'done'], team: false });
    expect(flowAt(all + TEAM_MS, chars, 3)).toMatchObject({ team: true, stamp: 'waiting' });
    expect(flowAt(all + TEAM_MS + STAMP_MS, chars, 3).stamp).toBe('pressed');
    expect(flowAt(all + TEAM_MS + STAMP_MS + APPROVED_AFTER_MS, chars, 3)).toMatchObject({ stamp: 'approved', done: true });
    expect(flowLength(chars, 3)).toBe(all + TEAM_MS + STAMP_MS + APPROVED_AFTER_MS);
    expect(flowStill(chars, 3)).toMatchObject({ typed: chars, pieces: ['done', 'done', 'done'], stamp: 'waiting' });

    // on the card
    vi.useFakeTimers();
    const { rerender } = render(
      <I18nProvider locale="en">
        <WorkflowAct on acting at={0} stacked={false} />
      </I18nProvider>,
    );
    const card = () => screen.getByTestId('landing-workflow');
    const shown = () => card().querySelector('.landing-workflow-typed')!.textContent;
    const pieces = () => [...card().querySelectorAll('.landing-workflow-pieces li')].map((li) => li.getAttribute('data-state'));
    const ask = 'Sort out this month’s profit and loss, and see to the supplier payments';
    const per = charMs(Array.from(ask).length);
    expect(shown()).toBe('');
    expect(card().getAttribute('data-state')).toBe('waiting');
    act(() => void vi.advanceTimersByTime(ACT_DELAY_MS + per * 10 + 60));
    expect(shown()!.length).toBeGreaterThan(5);
    expect(shown()!.length).toBeLessThan(ask.length);
    expect(card().querySelector('.landing-caret')).toBeTruthy();
    expect(cues.typing).toBe(true); // the penguin patters while it types
    // not yet handed out: no words in the empty chips
    expect(pieces()).toEqual(['waiting', 'waiting', 'waiting']);
    act(() => void vi.advanceTimersByTime(TYPE_MAX_MS + HOLD_TYPED_MS + ASSIGN_FIRST_MS + 50));
    expect(shown()).toBe(ask);
    expect(cues.typing).toBe(false);
    expect(pieces()).toEqual(['on', 'waiting', 'waiting']);
    act(() => void vi.advanceTimersByTime(ASSIGN_STEP_MS));
    expect(pieces()).toEqual(['done', 'on', 'waiting']);
    act(() => void vi.advanceTimersByTime(2 * ASSIGN_STEP_MS + TEAM_MS));
    expect(pieces()).toEqual(['done', 'done', 'done']);
    expect(card().querySelectorAll('.landing-workflow-gate.is-up')).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(STAMP_MS + APPROVED_AFTER_MS + 100));
    expect(card().getAttribute('data-state')).toBe('approved');
    expect(within(card()).getByText('Approved')).toBeTruthy();
    expect(card().querySelector('[data-testid="landing-stamp-mark"]')).toBeTruthy();
    // the buttons come last in the card
    expect(card().lastElementChild!.className).toBe('landing-approval-actions');
    expect(css).toMatch(/\.landing-approval\.is-pressed \.landing-approve \{[^}]*translate: 0 1px;/);
    expect(css).toMatch(/\.landing-approval:not\(\.is-waiting\) \.landing-stamp-mark \{[^}]*opacity: 0\.9;/);
    // the hand-out reads in the app's colours: going out = accent ring, set down = ok check
    expect(css).toMatch(/\.landing-workflow-pieces li\.is-on \.landing-task-chip \{[^}]*outline-color: var\(--accent\);/);
    expect(css).toMatch(/\.landing-task-chip > \.icon \{[^}]*color: var\(--ok\);/);
    // the next stop: the next workflow types in from the start
    rerender(
      <I18nProvider locale="en">
        <WorkflowAct on acting at={1} stacked={false} />
      </I18nProvider>,
    );
    act(() => void vi.advanceTimersByTime(50));
    expect(card().getAttribute('data-workflow')).toBe('sourcing');
    expect(shown()).toBe('');
    expect(pieces()).toEqual(['waiting', 'waiting', 'waiting']);
    cleanup();
    resetCues();
    // not acting: the finished picture — typed, handed out, waiting for the owner; no patter
    render(
      <I18nProvider locale="en">
        <WorkflowAct on acting={false} at={0} stacked={false} />
      </I18nProvider>,
    );
    act(() => void vi.advanceTimersByTime(10_000));
    expect(shown()).toBe(ask);
    expect(card().querySelector('.landing-caret')).toBeNull();
    expect(pieces()).toEqual(['done', 'done', 'done']);
    expect(card().getAttribute('data-state')).toBe('waiting');
    expect(cues.typing).toBe(false);
  });

  it('the pointing: the wing goes out to price card 1, which lights up while it is there, then back — once', () => {
    expect(relayAt(0)).toBe(-1);
    expect(relayAt(RELAY.reach)).toBe(0);
    expect(relayHand(-1)).toBe(0);
    expect(relayHand(RELAY.reach)).toBeCloseTo(1);
    expect(relayHand(RELAY.reach + 2000)).toBe(0);
    vi.useFakeTimers();
    render(
      <I18nProvider locale="en">
        <PricingAct on acting />
      </I18nProvider>,
    );
    const lit = () => [...document.querySelectorAll('.landing-price')].map((li) => li.classList.contains('is-on'));
    expect(cues.relayAt).toBeGreaterThan(-Infinity);
    expect(lit()).toEqual([false, false, false]);
    act(() => void vi.advanceTimersByTime(ACT_DELAY_MS + RELAY.reach + 10));
    expect(lit()).toEqual([true, false, false]);
    expect(document.querySelector('[data-gaze]')).toBe(document.querySelectorAll('.landing-price')[0]);
    act(() => void vi.advanceTimersByTime(RELAY.step + RELAY.release));
    expect(lit()).toEqual([false, false, false]);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(lit()).toEqual([false, false, false]); // no repeat
    expect(css).toMatch(/\.landing-price\.is-on \{[^}]*outline-color: var\(--accent\);/);
    // without acting: nothing lit, no cue
    cleanup();
    resetCues();
    render(
      <I18nProvider locale="en">
        <PricingAct on acting={false} />
      </I18nProvider>,
    );
    expect(lit()).toEqual([false, false, false]);
    expect(cues.relayAt).toBe(-Infinity);
  });

  it('the gap (왜 지금): the same pointing — the wing goes to the bracket between the two lines, which lights up and is looked at, once', () => {
    vi.useFakeTimers();
    render(
      <I18nProvider locale="en">
        <GapAct on acting />
      </I18nProvider>,
    );
    const chart = () => document.querySelector('.landing-gap')!;
    expect(cues.relayAt).toBeGreaterThan(-Infinity);
    expect(chart().classList.contains('is-on')).toBe(false);
    act(() => void vi.advanceTimersByTime(ACT_DELAY_MS + RELAY.reach + 10));
    expect(chart().classList.contains('is-on')).toBe(true);
    expect(document.querySelector('[data-gaze]')).toBe(document.querySelector('.landing-gap-bracket'));
    act(() => void vi.advanceTimersByTime(RELAY.step + RELAY.release + 10_000));
    expect(chart().classList.contains('is-on')).toBe(false);
    // the hand mark sits on the bracket, halfway between the two lines' ends
    const hand = document.querySelector<HTMLElement>('[data-hand]')!;
    expect(hand.style.left).toBe(`${(GAP.bracket / 400) * 100}%`);
    expect(hand.style.top).toBe(`${((GAP.team.y + GAP.sub.y) / 2 / 240) * 100}%`);
    cleanup();
    resetCues();
    render(
      <I18nProvider locale="en">
        <GapAct on acting={false} />
      </I18nProvider>,
    );
    expect(cues.relayAt).toBe(-Infinity);
  });

  it('the scroll unrolls once the penguin has arrived, on the same clock as the wing; the wave is slow', () => {
    expect(css).toContain(`transition: --unroll ${UNROLL_MS}ms cubic-bezier(0.33, 1, 0.5, 1) ${ACT_DELAY_MS}ms;`);
    expect(css).toMatch(/@property --unroll \{[^}]*initial-value: 1;/);
    expect(css).toMatch(/\.landing-scroll-sheet \{[^}]*clip-path: inset\(0 -1px calc\(\(1 - var\(--unroll\)\) \* 100%\) -1px\);/);
    expect(tugAt(-1)).toBe(0);
    expect(Math.max(...[100, 350, 600].map(tugAt))).toBeLessThanOrEqual(0.02);
    expect(WAVE_HZ).toBeLessThan(STROKE_LIMITS.min / 2);
    expect(waveAt(-1)).toEqual({ swing: 0, raise: 0 });
    expect(waveAt(5000).raise).toBe(0);
  });

  it('every act animation waits for acting — the poster and the stacked page show the finished picture', () => {
    const gated = [...css.matchAll(/\n([^\n{}]+)\{[^}]*(animation: landing-|--unroll: 0)/g)].map((m) => m[1].trim());
    // (the message's rise is scroll-driven, not an act — it is the same with or without the penguin)
    for (const sel of gated) expect(sel).toMatch(/^\.landing-flow\.is-acting |^\.landing-approval:not|caret|^\.landing-flow \.landing-copy|^@supports \(animation-timeline/);
    expect(css).not.toMatch(/(^|\n)\.landing-act \{[^}]*opacity: 0/);
    expect(css).not.toMatch(/(^|\n)\.landing-slide \{[^}]*opacity: 0/);
  });
});

describe('what shows in front of the content (occlusion)', () => {
  it('the acting wing is the one away from the content, from the screen geometry — the body turns to bring it round', () => {
    // the penguin faces the reader: its right wing (R) is on the reader's left
    expect(nearWing(500, 300)).toBe('R');
    expect(farWing(500, 300)).toBe('L');
    expect(farWing(500, 700)).toBe('R');
    const h = 290;
    const box = { left: 700, top: 300, width: 380, height: 260 };
    const cx = box.left + box.width / 2;
    const picked = Object.fromEntries(ACTS.map((a) => [a, actingWings(a, spotFor(a, box, h, false).x, cx)]));
    // point: the penguin is right of the price cards → its far (left) wing; unroll: the paper is to its
    // right → its far (right) wing, on the knob at the paper's left end; type: both; wave: the far one waves
    expect(picked.point.wings).toEqual(['L']);
    expect(picked.unroll.wings).toEqual(['R']);
    expect(picked.type.wings).toEqual(['L', 'R']);
    expect(picked.wave).toEqual({ wings: ['L', 'R'], wave: 'L' });
    // the workflow card is the measured exception: the near wing stamps (ARM_CHOICE)
    expect(ARM_CHOICE.stamp).toBe('near');
    expect(picked.stamp.wings).toEqual(['L']);
    // mirrored content flips every choice — it comes from where things are, not from the section
    expect(actingWings('point', 400, 700).wings).toEqual(['R']);
    expect(actingWings('stamp', 1200, 900).wings).toEqual(['R']);
    expect(actingWings('wave', 500, 800).wave).toBe('R');
    // the body turns towards the content to bring the far wing round, within natural limits
    expect(actYaw('point', 1200, 900)).toBeLessThan(0);
    expect(actYaw('point', 400, 700)).toBeGreaterThan(0);
    for (const id of ['type', 'unroll', 'stamp'] as const) expect(actYaw(id, 1200, 900)).toBe(0);
    // the wave turns the body a little so the raised wing's face shows (a hinge in the frontal plane)
    expect(actYaw('wave', 1200, 900)).toBeLessThan(0);
    expect(Math.abs(actYaw('wave', 1200, 900))).toBeLessThan(ACT_YAW);
    expect(Math.abs(bodyTurn(-0.18, -ACT_YAW))).toBeLessThanOrEqual(MAX_TURN);
    expect(Math.abs(bodyTurn(-0.6, -0.6))).toBe(MAX_TURN);
    // the v3 wing is a rigid paddle on a hinge: it never stretches to reach (the body turns instead)
    expect(MAX_STRETCH).toBe(1);
    expect(stretchFor(50, 100)).toBe(1);
    expect(stretchFor(130, 100)).toBe(1);
    expect(stretchFor(500, 100)).toBe(1);
    expect(ORDER.eraser).toBeLessThan(ORDER.front);
  });

  it('the near-wing stamp: its shoulder stands outside the card’s edge — a wing rooted behind the card could never come in front', () => {
    const h = 290;
    const box = { left: 700, top: 300, width: 380, height: 260 };
    const stamp = spotFor('stamp', box, h, false);
    expect(stamp.x + BODY.shoulderX * Math.cos(stamp.turn) * h).toBeLessThan(box.left);
    const phone = spotFor('stamp', box, 170, true);
    expect(phone.x + BODY.shoulderX * Math.cos(phone.turn) * phone.h).toBeLessThan(box.left);
    // beside the price cards the face stays clear of them even with the body turned to act
    const point = spotFor('point', box, h, false);
    expect(faceX(point.x, h, bodyTurn(point.turn, -ACT_YAW)) - BODY.face.half * h).toBeGreaterThan(box.left + box.width - 0.1 * h);
    // behind the content (prompt box, the cards, phone pointing) the shoulders are above the top edge
    for (const s of [spotFor('type', box, h, false), spotFor('wave', box, h, false), spotFor('point', box, 170, true)]) expect(s.y - (1 - BODY.shoulder) * s.h).toBeLessThan(box.top);
  });

  it('the wing goes round the edge: drawn in front only once it is clear of the content, behind again once clear on the way back', () => {
    // the hero: a box, the shoulder above its top edge, the hand at rest hanging down behind it
    const rect = { left: 300, top: 300, right: 700, bottom: 900 };
    const shoulder = { x: 420, y: 270 };
    const rest = { x: 410, y: 360 }; // inside the box: behind it
    const to = { x: 440, y: 304 }; // the key, just under the top edge: in front of it
    const via = viaPoint(rect, shoulder, to, 18);
    expect(via).toEqual({ x: 440, y: 282 }); // round the top edge, over the key
    const path = { from: rest, via, to };
    expect(pathAt(path, 0)).toEqual(rest);
    expect(pathAt(path, 0.5)).toEqual(via);
    expect(pathAt(path, 1)).toEqual(to);
    expect(segmentHits(shoulder, to, rect)).toBe(true); // on the key the wing is over the box — it must be in front by then

    const walk = (us: number[], start: boolean) => {
      let front = start;
      let last = us[0];
      return us.map((u) => {
        const tip = pathAt(path, u);
        const clear = !segmentHits(shoulder, tip, rect);
        const was = front;
        front = nextFront(front, u, u - last, clear, outside(shoulder, rect));
        last = u;
        return { u, was, front, clear, tipOut: outside(tip, rect) };
      });
    };
    const out = walk(
      Array.from({ length: 61 }, (_, i) => i / 60),
      false,
    );
    expect(out[0].front).toBe(false);
    expect(out[out.length - 1].front).toBe(true);
    // it switches exactly once, at a frame where the whole wing is off the box (it has crossed the edge)
    const on = out.filter((f) => f.front !== f.was);
    expect(on).toHaveLength(1);
    expect(on[0].clear).toBe(true);
    expect(on[0].tipOut).toBe(true);
    // while the hand is still over the box from behind, never in front
    for (const f of out.slice(0, out.findIndex((x) => x.tipOut))) expect(f.front).toBe(false);

    // the way back: in front until it is clear past the edge again, then behind — never back over the box in front
    const back = walk(
      Array.from({ length: 61 }, (_, i) => 1 - i / 60),
      true,
    );
    const off = back.filter((f) => f.front !== f.was);
    expect(off).toHaveLength(1);
    expect(off[0].clear).toBe(true);
    expect(off[0].u).toBeLessThan(0.5);
    for (const f of back) if (!f.clear && f.u < 0.5) expect(f.front).toBe(false);

    // a shoulder behind the content never brings its wing in front; at rest, never in front
    expect(nextFront(false, 1, 0.1, true, false)).toBe(false);
    expect(nextFront(true, 1, 0, true, false)).toBe(false);
    expect(nextFront(true, 0, -0.1, true, true)).toBe(false);
  });

  it('round the edge the shoulder is beyond; a held stamp must be off the card too', () => {
    const card = { left: 300, top: 300, right: 600, bottom: 450 };
    // beside the card (even with the shoulder level with its top) → round the side edge, level with the target
    expect(viaPoint(card, { x: 250, y: 420 }, { x: 340, y: 430 }, 15)).toEqual({ x: 285, y: 430 });
    expect(viaPoint(card, { x: 700, y: 300 }, { x: 560, y: 380 }, 15)).toEqual({ x: 615, y: 380 });
    // above it → round the top edge
    expect(viaPoint(card, { x: 400, y: 200 }, { x: 420, y: 330 }, 15)).toEqual({ x: 420, y: 285 });
    expect(rectsOverlap({ left: 280, right: 310, top: 400, bottom: 440 }, card)).toBe(true);
    expect(rectsOverlap({ left: 260, right: 300, top: 400, bottom: 440 }, card)).toBe(false);
  });

  it('the eraser wipes every pixel under the content whatever its depth, and covers the content rect exactly', () => {
    const eraser = makeEraser();
    expect(eraser.material.depthTest).toBe(false);
    expect(eraser.renderOrder).toBe(ORDER.eraser);
    expect(eraser.material.transparent).toBe(true);
    // an orthographic camera, one unit = 100 px, over a 800 × 600 canvas at (100, 50)
    const camera = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.01, 40);
    camera.zoom = 100;
    camera.position.set(0, 0, 10);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const rect = { left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650 } as DOMRect;
    const box = { left: 300, top: 200, right: 700, bottom: 450 };
    fitEraser(eraser, box, 1, rect, camera, new THREE.Ray());
    const pos = eraser.geometry.getAttribute('position');
    const page = [0, 1, 2, 3].map((i) => {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).project(camera);
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    });
    expect(page.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [300, 200],
      [700, 200],
      [700, 450],
      [300, 450],
    ]);
    // the props draw after it
    expect(makeStamp(paletteFor('light')).group.children.every((c) => c.renderOrder === ORDER.front)).toBe(true);
  });
});

describe('the penguin', () => {
  it('one penguin layer for the whole page; it walks per section instead of the layer moving', () => {
    live();
    const { container } = landing();
    const mascot = () => screen.getByTestId('landing-mascot');
    const before = mascot();
    for (let i = 0; i < SECTIONS.length; i++) {
      scrollTo(SCREEN * i);
      expect(mascot()).toBe(before);
    }
    expect(container.querySelectorAll('.landing-mascot')).toHaveLength(1);
  });

  it('acts only once the 3D penguin has drawn', async () => {
    live();
    const { container } = landing();
    expect(container.querySelector('.landing-flow.is-acting')).toBeNull();
    await waitFor(() => expect(container.querySelector('.landing-flow.is-acting')).toBeTruthy());
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

  it('the stage waits for the 3D penguin to really draw, and gives up after a while', () => {
    expect(drawState(0, 0.5)).toBe('waiting');
    expect(drawState(7, 0.5)).toBe('drawn');
    expect(drawState(0, GIVE_UP_SECONDS)).toBe('empty');
  });

  it('while the 3D penguin loads there is no 2D penguin on the stage — nothing where it goes, the content as usual', async () => {
    canvas.behaviour = 'never';
    live();
    const { container } = landing();
    const stage = () => container.querySelector('.landing-stage')!;
    // before the 3D chunk (first paint) and while it has not drawn: no poster, no 2D penguin in the stage
    expect(stage()).toBeTruthy();
    expect(stage().querySelector('svg.penguin, .landing-poster')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('mascot-canvas')).toBeTruthy());
    expect(stage().querySelector('svg.penguin, .landing-poster')).toBeNull();
    expect(container.querySelector('.landing-mascot.is-ready')).toBeNull();
    expect(screen.queryByTestId('landing-static-mascot')).toBeNull();
    // the content shows as usual (the finished pictures — no acting yet)
    expect(screen.getByTestId('landing-gap')).toBeTruthy();
    expect(screen.getByTestId('landing-workflow').getAttribute('data-state')).toBe('waiting');
    expect(container.querySelector('.landing-flow.is-acting')).toBeNull();
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

describe('the entrance: a clay ball that becomes the penguin', () => {
  it('drops in, squashes ~15 %, stretches past its height, dips back a little, settles — in 0.9–1.3 s', () => {
    expect(INTRO_MS).toBeGreaterThanOrEqual(900);
    expect(INTRO_MS).toBeLessThanOrEqual(1300);
    const samples = Array.from({ length: Math.ceil(INTRO_MS / 10) + 1 }, (_, i) => ({ ms: i * 10, ...introAt(i * 10) }));
    // a ball at first, popping in from above
    expect(introAt(0)).toMatchObject({ morph: 0, parts: 0, size: 0 });
    expect(introAt(0).lift).toBeCloseTo(DROP);
    expect(introAt(INTRO.fall).lift).toBe(0);
    // squash on contact (~15 %), the stretch past its height, a small overshoot under, then rest
    const contact = INTRO.fall;
    const squash = Math.min(...samples.filter((x) => x.ms >= contact && x.ms <= contact + INTRO.squash + 30).map((x) => x.sy));
    expect(squash).toBeCloseTo(1 - SQUASH_MAX, 2);
    expect(SQUASH_MAX).toBeGreaterThanOrEqual(0.12);
    expect(SQUASH_MAX).toBeLessThanOrEqual(0.18);
    const peak = samples.reduce((a, b) => (b.sy > a.sy ? b : a));
    expect(peak.sy).toBeGreaterThan(1.08);
    expect(peak.ms).toBeGreaterThan(contact + INTRO.squash);
    const dip = Math.min(...samples.filter((x) => x.ms > peak.ms).map((x) => x.sy));
    expect(dip).toBeLessThan(1);
    expect(dip).toBeGreaterThan(0.94);
    expect(introAt(INTRO_MS)).toEqual(REST);
    // the ball becomes the body during the stretch; the face, beak, wings and feet come after it
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].morph).toBeGreaterThanOrEqual(samples[i - 1].morph);
      expect(samples[i].parts).toBeLessThanOrEqual(samples[i].morph + 1e-9);
    }
    expect(introAt(contact + INTRO.squash).morph).toBeLessThan(0.1);
    expect(introAt(peak.ms).morph).toBeGreaterThan(0.3);
    // smooth: no jump between 60 fps frames
    for (let ms = 0; ms < INTRO_MS; ms += 16) expect(Math.abs(introAt(ms + 16).sy - introAt(ms).sy)).toBeLessThan(0.1);
  });

  it('plays once per page load, and never under reduced motion', () => {
    resetIntro();
    expect(claimIntro(true)).toBe(false); // reduced motion: skipped (and it does not use up the one play)
    expect(claimIntro(false)).toBe(true);
    expect(claimIntro(false)).toBe(false); // a remount shows the penguin as it is
    resetIntro();
    // the stacked page (what reduced motion gets) has no 3D stage at all
    stubMotion(true);
    stubWebGL();
    const { container } = landing();
    expect(container.querySelector('.landing-stage')).toBeNull();
    expect(screen.queryByTestId('mascot-canvas')).toBeNull();
  });

  it('the ball comes from the body’s own bounds — a taller penguin gets its own ball', () => {
    const make = (sx: number, sy: number) => {
      const geo = new THREE.SphereGeometry(1, 12, 8);
      geo.scale(sx, sy, sx);
      const n = geo.attributes.position.count;
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      const bone = new THREE.Bone();
      bone.name = 'body';
      const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ name: 'penguin.body' }));
      mesh.add(bone);
      mesh.bind(new THREE.Skeleton([bone]));
      const root = new THREE.Group();
      root.add(mesh);
      const holder = new THREE.Group();
      holder.add(root);
      return makeMorph(root, holder)!;
    };
    const a = make(0.3, 0.4);
    const b = make(0.3, 0.6);
    expect(a.radius).toBeCloseTo(Math.cbrt(0.3 * 0.4 * 0.3), 2);
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(a.core.length()).toBeLessThan(1e-6);
  });
});

describe('the site footer (2026-11-14)', () => {
  const check = (footer: HTMLElement, owner: string, policy: string) => {
    expect(within(footer).getByText(owner)).toBeTruthy();
    expect(within(footer).getByRole('link', { name: 'contact@toronchul.app' }).getAttribute('href')).toBe('mailto:contact@toronchul.app');
    expect(within(footer).getByRole('link', { name: policy }).getAttribute('href')).toBe('/privacy');
    expect(footer.textContent).toContain(`© ${new Date().getFullYear()} 주식회사 제슬`);
    expect(footer.textContent).toContain('주식회사 제슬');
    expect(footer.textContent).toContain('서울 강남구 언주로134길 18, 5층 라32호');
  };

  it('live: after the sections — outside the flow, every stop and anchor where it was', () => {
    live();
    const { container } = landing('ko');
    const footer = screen.getByTestId('site-footer');
    check(footer, '대표 정승원', '개인정보처리방침');
    expect(footer.className).not.toContain('is-compact');
    expect(footer.previousElementSibling!.classList.contains('landing-flow')).toBe(true);
    expect(footer.closest('.landing-flow')).toBeNull();
    for (const st of STOPS) expect(container.querySelector(`#${st.anchor}`), st.anchor).toBeTruthy();
    expect(document.getElementById('landing-contact')!.getAttribute('data-slide')).toBe('contact');
  });

  it('stacked: after the last section; en names the representative in Latin letters', () => {
    stubMotion(true);
    const { container } = landing('en');
    const footer = screen.getByTestId('site-footer');
    check(footer, 'Representative Seungwon Jung', 'Privacy policy');
    expect(footer.previousElementSibling!.classList.contains('landing-stack')).toBe(true);
    expect(container.querySelector('.landing-stack')!.lastElementChild!.getAttribute('data-slide')).toBe('contact');
  });
});

describe('stacked fallback', () => {
  it('reduced motion: the sections stacked, the 2D penguin, the gap not lit, no acting', () => {
    stubMotion(true);
    stubWebGL();
    vi.useFakeTimers();
    const { container } = landing();
    expect(container.querySelector('.landing')!.getAttribute('data-mode')).toBe('static');
    expect(container.querySelector('.landing-stage')).toBeNull();
    expect(container.querySelector('.landing-steps')).toBeNull();
    expect(container.querySelector('.landing-stack')).toBeTruthy();
    for (const s of SECTIONS) expect(document.getElementById(`landing-${s.id}`)!.tagName).toBe('SECTION');
    expect(container.querySelectorAll('.landing-slide.is-on')).toHaveLength(SECTIONS.length);
    expect(screen.getByTestId('landing-static-mascot').querySelector('svg.penguin')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(20_000));
    expect(document.querySelector('.landing-gap')!.classList.contains('is-on')).toBe(false);
    expect(cues.relayAt).toBe(-Infinity);
    // the three workflows one under another, each with its own heading and its request
    const cards = screen.getAllByTestId('landing-workflow');
    expect(cards.map((c) => c.getAttribute('data-workflow'))).toEqual(['finance', 'sourcing', 'sns']);
    for (const c of cards) expect(c.getAttribute('data-state')).toBe('waiting');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(cues.stampAt).toBe(-Infinity);
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
});

describe('section 3: the AI team (the org chart — agents and team members) and the team modal', () => {
  it('draws the owner (who approves) and Chief on top, the teams below as faces — a few words only, names in the reader’s language', () => {
    landing('ko');
    const org = screen.getByTestId('landing-org');
    // no "owner and Chief" caption any more — the line from 대표 down to 임원 says it; the button still does
    const top = within(org).getByRole('button', { name: '대표와 임원 · 에이전트 보기' });
    expect([...top.querySelectorAll('[data-org]')].map((n) => [n.getAttribute('data-org'), n.textContent])).toEqual([
      ['owner', '대표'],
      ['chief', '임원'],
    ]);
    expect(within(org).queryByText('대표와 임원')).toBeNull();
    const teams = within(org).getByRole('list', { name: '팀' });
    expect(within(teams).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      '프로덕트 4명 · 에이전트 보기',
      '엔지니어링 5명 · 에이전트 보기',
      '비즈니스 3명 · 에이전트 보기',
      '브랜드 2명 · 에이전트 보기',
    ]);
    // the owner approves: an ok check beside 대표
    expect(org.querySelector('[data-org="owner"] .landing-org-approves')).toBeTruthy();
    // faces, not names (2026-11-14 — a few words on the paper): the names are the faces' tooltips
    expect(within(org).getByTitle('재무')).toBeTruthy();
    expect(within(org).queryByText('재무')).toBeNull();
    expect(org.querySelectorAll('.landing-org-face')).toHaveLength(AGENT_COUNT - 1 + 2);
    expect(org.textContent).toBe('대표임원프로덕트엔지니어링비즈니스브랜드');
    expect(within(org).queryByText('PRODUCT')).toBeNull();
    // a team member (an example, no name) in the business and the brand team — a person, not a penguin
    const people = [...org.querySelectorAll('[data-person]')];
    expect(people.map((n) => [n.closest('[data-org="dept"]')!.querySelector('.landing-org-label')!.textContent, n.getAttribute('title')])).toEqual([
      ['비즈니스', '팀원 (예시)'],
      ['브랜드', '팀원 (예시)'],
    ]);
    for (const n of people) {
      expect(n.querySelector('.landing-person-face')).toBeTruthy();
      expect(n.querySelector('svg.penguin')).toBeNull();
    }
    // the message (2026-11-24 — "결정은 사람, 모든 일이 남아요, 에이전트/사람 태그 제거. 설명도 () 제거해서 좀 줄여"):
    // the title, a short plain lead, the three domain lines, see all — no legend, no other lines, no brackets
    const copy = document.querySelector('[data-slide="org"] .landing-copy')!;
    expect(copy.querySelector('h2')!.textContent).toBe('회사에 맞춘 AI 팀이 팀원 옆에서 일해요');
    expect(copy.querySelector('.landing-lead')!.textContent).toBe('구축할 때 회사가 하는 일을 듣고 AI 팀을 꾸려요. 업종마다 맡기는 일이 달라요.');
    expect(copy.textContent).not.toMatch(/[()（）]/);
    expect(copy.querySelector('.landing-legend')).toBeNull();
    expect(copy.querySelectorAll('.landing-points')).toHaveLength(1);
    expect(copy.querySelector('.landing-points')!.classList.contains('landing-domain-lines')).toBe(true);
    expect(copy.textContent).not.toContain('결정은 사람이 해요');
    expect(copy.textContent).not.toContain('모든 일이 남아요');
  });

  it('a team opens the modal at that team: the agent cards side by side, scrolling sideways', async () => {
    landing('ko');
    const opener = screen.getByRole('button', { name: '비즈니스 3명 · 에이전트 보기' });
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: '에이전트 15명, 5개 팀' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' }));
    expect(document.documentElement.style.overflow).toBe('hidden'); // the page holds still under it
    const strip = within(dialog).getByRole('list', { name: '에이전트 목록' });
    expect(strip.getAttribute('tabindex')).toBe('0');
    expect(within(strip).getAllByRole('heading', { level: 3 })).toHaveLength(15);
    expect(within(strip).getByText(/장부와 매출, 매입을 맞춰 보고/)).toBeTruthy();
    for (const g of TEAMS) for (const a of g.agents) expect(a.summary.ko && a.summary.en && a.summary['zh-CN'], a.id).toBeTruthy();
    expect(css).toMatch(/\.landing-strip \{[^}]*overflow-x: auto;[^}]*scroll-snap-type: x proximity;/);
    expect(css).toMatch(/\.landing-card \{[^}]*scroll-snap-align: start;/);

    // a plain mouse wheel scrolls it sideways while it can move; at the end it is let go — to the
    // dialog, never the page (the page is locked and the strip contains its overscroll)
    Object.defineProperty(strip, 'scrollWidth', { value: 3000, configurable: true });
    Object.defineProperty(strip, 'clientWidth', { value: 1000, configurable: true });
    strip.scrollLeft = 0;
    const wheel = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
    strip.dispatchEvent(wheel);
    expect(strip.scrollLeft).toBe(120);
    expect(wheel.defaultPrevented).toBe(true);
    strip.scrollLeft = 2000;
    const atEnd = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
    strip.dispatchEvent(atEnd);
    expect(atEnd.defaultPrevented).toBe(false);
    expect(window.scrollY).toBe(0);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('the top row and "see all" (beside the message) open it too', async () => {
    landing('en');
    const all = screen.getByRole('button', { name: 'See all agents' });
    expect(all.closest('.landing-copy')).toBeTruthy();
    fireEvent.click(all);
    expect(await screen.findByRole('dialog', { name: `${AGENT_COUNT} agents in ${TEAMS.length} teams` })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^Owner and Chief/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('section 2: 왜 지금 — the problem and the stakes (2026-11-14)', () => {
  it('names the pain (paying for AI, not using it; multi-agent too hard to set up) and the stakes (competitors, the gap, now) — no numbers', () => {
    landing('ko');
    const slide = document.querySelector('[data-slide="problem"]') as HTMLElement;
    expect(within(slide).getByRole('heading', { level: 2 }).textContent).toBe('AI 는 결제했는데, 일은 그대로인가요?');
    const copy = slide.querySelector('.landing-copy')!.textContent!;
    expect(copy).toContain('ChatGPT · Claude 구독');
    expect(copy).toContain("'멀티 에이전트'");
    expect([...slide.querySelectorAll('.landing-points b')].map((b) => b.textContent)).toEqual(['경쟁사는 이미 시작했어요', '격차는 저절로 줄지 않아요', '지금 시작하면 앞설 수 있어요']);
    // no statistic anywhere on the slide (no source to cite — so no numbers at all)
    for (const locale of ['ko', 'en', 'zh-CN'] as const) {
      cleanup();
      landing(locale);
      expect(document.querySelector('[data-slide="problem"]')!.textContent, locale).not.toMatch(/\d|%/);
    }
  });

  it('the picture: two lines from one start, a bracket where they part, four words — no axis values', () => {
    landing('ko');
    const chart = screen.getByTestId('landing-gap');
    expect([...chart.querySelectorAll('.landing-gap-label')].map((l) => l.textContent)).toEqual(['AI 팀', '구독만', '격차', '지금']);
    expect(chart.querySelectorAll('.landing-gap-lines path')).toHaveLength(3); // the two lines and the bracket
    expect(chart.querySelector('text')).toBeNull();
    // the paid subscription is the icon under the flat line; the AI team is penguins at the top of the climbing one
    expect(chart.querySelector('.landing-gap-label.is-sub svg')).toBeTruthy();
    expect(chart.querySelectorAll('.landing-gap-label.is-team svg.penguin')).toHaveLength(3);
    // the picture says it in words for screen readers
    expect(chart.querySelector('figure')!.getAttribute('aria-label')).toMatch(/^같은 곳에서 출발한 두 회사/);
  });

  it('who it is for: the three domains in the first section and, one line each, in the AI team (what that business hands over) — the workflows are shared examples', () => {
    landing('ko');
    expect(DOMAINS).toEqual(['logistics', 'commerce', 'it']);
    expect(screen.getByText('물류 · 커머스 · IT 서비스 소규모 비즈니스를 위해').closest('[data-slide="hero"]')).toBeTruthy();
    // "업종은 AI 팀 섹션에서 다뤄" (2026-11-14): the lines sit in the AI team's message, not the workflows'
    const lines = [...screen.getByTestId('landing-domain-lines').querySelectorAll('li')];
    expect(screen.getByTestId('landing-domain-lines').closest('[data-slide="org"]')).toBeTruthy();
    expect(lines.map((li) => [li.querySelector('b')!.textContent, !!li.querySelector('svg')])).toEqual([
      ['물류', true],
      ['커머스', true],
      ['IT 서비스', true],
    ]);
    expect(lines.map((li) => li.textContent!.slice(li.querySelector('b')!.textContent!.length))).toEqual([
      '운송 · 정산 내역 정리와 거래처 대금 준비',
      '공급처 견적 비교 · 발주서 초안과 상품 게시물',
      '매달 손익 · 비용 정리와 새 소식 게시물',
    ]);
    const workflows = document.querySelector('[data-slide="workflows"] .landing-copy')!;
    expect(workflows.querySelector('.landing-domain-lines')).toBeNull();
    expect(workflows.textContent).toContain('아래 세 가지는 업종과 관계없이 쓰는 예시예요.');
    // the domain lines stay on a phone (the other lines of the message do not)
    const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
    expect(phone).toMatch(/\.landing-flow \.landing-slide \.landing-points:not\(\.landing-domain-lines\)/);
  });

  it('the old 맡기기 anchor opens the workflows (that is where the request went)', () => {
    expect(MOVED_ANCHORS).toEqual({ 'landing-delegate': 'landing-workflows' });
    live();
    window.history.replaceState(null, '', '/#landing-delegate');
    landing();
    expect(window.location.hash).toBe('#landing-workflows');
    window.history.replaceState(null, '', '/');
  });
});

describe('section 4: three workflows — what runs on its own, where it stops for approval', () => {
  const approvals = readFileSync(join(process.cwd(), '..', 'python', 'src', 'solosquad', 'approvals.py'), 'utf8');
  /** approvals.py `RECOMMENDED`: category → owner | team (decision 51). */
  const recommended = Object.fromEntries(
    [...approvals.slice(approvals.indexOf('RECOMMENDED'), approvals.indexOf('}', approvals.indexOf('RECOMMENDED'))).matchAll(/"(\w+)": Tier\.(OWNER|TEAM)/g)].map((m) => [m[1], m[2].toLowerCase()]),
  );

  it('the approval tiers are the engine’s recommended table (approvals.py RECOMMENDED — C54)', () => {
    expect(Object.keys(recommended).length).toBeGreaterThan(5);
    for (const [category, tier] of Object.entries(TIER)) expect(recommended[category], category).toBe(tier);
    // every workflow: a team approval, then the owner's — money out (payment · purchase) is the owner's
    for (const w of WORKFLOW_EXAMPLES) {
      expect(TIER[w.team.category], w.id).toBe('team');
      expect(TIER[w.owner.category], w.id).toBe('owner');
    }
    expect(WORKFLOW_EXAMPLES.map((w) => [w.id, w.team.category, w.owner.category])).toEqual([
      ['finance', 'review', 'payment'],
      ['sourcing', 'review', 'purchase'],
      ['sns', 'publish', 'payment'],
    ]);
  });

  it('each card is the flow (the old 맡기기 folded in): the prompt box to Chief → Chief hands each agent its piece → the team approval → the owner approval with the button the stamp lands on', () => {
    stubMotion(true);
    landing('ko');
    const cards = screen.getAllByTestId('landing-workflow');
    expect(cards).toHaveLength(3);
    const asks = ['이번 달 손익 정리하고, 거래처 대금도 챙겨 줘', '공급처 세 곳 견적 비교해서 발주서 초안 만들어 줘', '신상품 나오는 주에 맞춰 SNS 게시물 준비해 줘'];
    cards.forEach((card, i) => {
      expect(within(card).getByRole('heading', { level: 3 }).classList.contains('sr-only')).toBe(true);
      expect(within(card).getByText('예시 화면')).toBeTruthy();
      // the prompt box to Chief (the typing is for the eye; screen readers get the whole flow in one line)
      expect(within(card).getByTestId('landing-workflow-ask').textContent).toBe(`임원에게${asks[i]}`);
      expect(within(card).getByTestId('landing-workflow-ask').getAttribute('aria-hidden')).toBe('true');
      expect(card.querySelector('p.sr-only')!.textContent).toMatch(new RegExp(`^요청: ${asks[i]} — `));
      expect(card.querySelector('.landing-workflow-chief')!.textContent).toBe('임원');
      // each agent with its piece of work (a short chip), set down
      const pieces = [...card.querySelectorAll('.landing-workflow-pieces li')];
      expect(pieces).toHaveLength(3);
      for (const li of pieces) {
        expect(li.querySelector('svg.penguin')).toBeTruthy();
        expect(li.getAttribute('data-state')).toBe('done');
        expect(li.querySelector('.landing-task-chip')!.textContent!.length).toBeLessThan(20);
      }
      // few words: no step sentences, no "에이전트가 해요 · 사람이 해요" rows, no reasons
      expect(within(card).queryByText('에이전트가 해요')).toBeNull();
      expect(within(card).queryByText('사람이 해요')).toBeNull();
      const gates = [...card.querySelectorAll('.landing-workflow-gate')];
      expect(gates.map((g) => g.getAttribute('data-tier'))).toEqual(['team', 'owner']);
      expect(gates[0].querySelector('.chip')!.textContent).toMatch(/^팀 승인 · (비즈니스|브랜드)$/);
      expect(gates[1].querySelector('.chip')!.textContent).toBe('대표 승인');
      expect(gates[1].textContent).not.toContain('돈이 나가는 일이라');
      // the button is the card's last row, after the owner's approval
      expect(card.lastElementChild!.querySelector('.landing-approve')!.textContent).toBe('승인');
    });
    expect(cards[2].querySelector('.landing-workflow-gate[data-tier="team"] .chip')!.textContent).toBe('팀 승인 · 브랜드');
    // why it stops is in the message: before money goes out, the owner approves
    expect(document.querySelector('[data-slide="workflows"] .landing-lead')!.textContent).toContain('돈이 나가는 일 앞에서는 멈추고 대표님 승인을 기다려요.');
    // the note says only finance works today (PRD §3.5.4 — no present-tense promise for sourcing · SNS)
    expect(document.querySelector('[data-slide="workflows"] .landing-aside')!.textContent).toContain('재무 관리는 지금 바로 써요. 상품 소싱 · SNS 마케팅은 구축할 때 회사가 쓰는 서비스에 맞춰 연결해요.');
  });

  it('live: one card, its tabs are the three workflows, the one up is selected', () => {
    live();
    landing('en');
    const tabs = within(screen.getByRole('tablist', { name: 'Example workflows' })).getAllByRole('tab');
    expect(tabs.map((b) => [b.textContent, b.getAttribute('aria-selected')])).toEqual([
      ['Finance', 'true'],
      ['Sourcing', 'false'],
      ['Social media', 'false'],
    ]);
    scrollTo(SCREEN * 5);
    expect(screen.getByRole('tab', { name: 'Social media' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByTestId('landing-workflow')).toHaveLength(1);
  });
});

describe('section 5: pricing (user decision 2026-11-12)', () => {
  const amounts = (text: string) => text.match(/\d[\d,]*/g) ?? [];

  it.each([
    ['ko', '600만원부터', 'VAT 별도', '무료', '상담 신청하기'],
    ['en', 'from ₩6,000,000', 'plus VAT', 'Free', 'Book a call'],
    ['zh-CN', '600万韩元起', '不含增值税', '免费', '申请咨询'],
  ] as const)('%s: the 3-month build from ₩6,000,000 (VAT on top), the call free, usage at cost — no other amount', (locale, build, vat, free, cta) => {
    stubMotion(true);
    landing(locale);
    const scene = screen.getByTestId('landing-scene-pricing');
    const cards = [...scene.querySelectorAll('.landing-price')];
    expect(cards).toHaveLength(3);
    expect(cards[0].querySelector('.landing-price-amount')!.textContent).toBe(`${build}${vat}`);
    expect(cards[1].querySelector('.landing-price-amount')!.textContent).toBe(free);
    // the only amount on the slide is the build's (3 = the three months)
    const slide = document.querySelector('[data-slide="pricing"]')!.textContent!;
    expect(new Set(amounts(slide))).toEqual(new Set(locale === 'en' ? ['6,000,000', '3'] : ['600', '3']));
    expect(within(document.querySelector('[data-slide="pricing"]') as HTMLElement).getByRole('button', { name: cta })).toBeTruthy();
  });

  it('the button opens the request modal with 상담 picked (an exact quote comes from the call)', async () => {
    landing('ko');
    fireEvent.click(within(document.querySelector('[data-slide="pricing"]') as HTMLElement).getByRole('button', { name: '상담 신청하기' }));
    const dialog = await screen.findByRole('dialog', { name: '데모 계정 신청하기' });
    expect((within(dialog).getByLabelText('상담') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('데모 계정') as HTMLInputElement).checked).toBe(false);
  });
});

describe('section 1: the penguin alone (2026-11-24 — "첫번째 섹션은 인포그래픽 제거하고 펭귄만 조금 큰 사이즈로")', () => {
  it('no card on the right — an empty box the size of the (larger) penguin, which stands on its bottom edge and waves', () => {
    live();
    landing('ko');
    const scene = screen.getByTestId('landing-scene-hero');
    expect(scene.querySelector('.landing-company, .landing-domains, .landing-faces')).toBeNull();
    const stand = within(scene).getByTestId('landing-hero-penguin');
    expect(stand.hasAttribute('data-content')).toBe(true);
    expect(stand.hasAttribute('data-stand')).toBe(true);
    expect(stand.hasAttribute('data-front')).toBe(false); // nothing in front of it
    expect(stand.textContent).toBe('');
    expect(rule('.landing-flow .landing-act.is-stand')).toMatch(/height: min\(52svh, 440px\);/);
    // the spot: the feet at the middle of the bottom edge, as tall as the box — taller than elsewhere
    const box = { left: 800, top: 200, width: 300, height: 440 };
    expect(standSpot(box)).toEqual({ x: 950, y: 640, h: 440, lean: 0, turn: 0 });
    expect(standSpot(box).h).toBeGreaterThan(penguinHeight({ width: 720, height: 836 }, false));
    expect(SECTIONS[0].act).toBe('wave');
    // plain words: no "AX" (2026-11-14)
    expect(document.querySelector('[data-slide="hero"]')!.textContent).not.toMatch(/\bAX\b/);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('우리 회사 일을 하는 AI 팀을 만들어 드려요');
    expect(TEAMS.length).toBe(5);
  });

  it('stacked: a large 2D penguin in its place', () => {
    stubMotion(true);
    landing('ko');
    expect(screen.getByTestId('landing-static-mascot').querySelector('svg.penguin')).toBeTruthy();
    expect(screen.queryByTestId('landing-hero-penguin')).toBeNull();
  });
});

describe('the buttons', () => {
  it('the top bar (decision 62): the language select with no 언어 label · 데모 체험하기 (primary) · 로그인 — no arrows', () => {
    landing('ko');
    const top = document.querySelector('.landing-top') as HTMLElement;
    expect(within(top).queryByText('언어')).toBeNull();
    expect(within(top).getByRole('combobox', { name: '언어' })).toBeTruthy(); // named for screen readers only
    const demo = within(top).getByRole('link', { name: '데모 체험하기' });
    const login = within(top).getByRole('link', { name: '로그인' });
    expect(demo.getAttribute('href')).toBe('/demo');
    expect(login.getAttribute('href')).toBe('/login');
    expect(demo.className).toContain('is-primary');
    expect(login.className).not.toContain('is-primary');
    for (const a of [demo, login]) expect(a.querySelector('svg')).toBeNull();
    // the language select comes before the two buttons
    expect(top.querySelector('.landing-top-actions')!.firstElementChild!.classList.contains('locale-picker')).toBe(true);
  });

  it('데모 체험하기 · 로그인 in the first slide (under the message) and the last; the last also opens the request modal (PRD §3.5.2 rev10)', async () => {
    landing();
    for (const id of ['hero', 'contact']) {
      const slide = document.querySelector(`[data-slide="${id}"]`) as HTMLElement;
      const links = within(slide).getAllByRole('link');
      expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
        ['Try the demo', '/demo'],
        ['Log in', '/login'],
      ]);
      expect(links[0].className).toContain('is-primary');
      expect(links[1].className).not.toContain('is-primary');
      for (const a of links) expect(a.querySelector('svg')).toBeNull();
    }
    const hero = document.querySelector('[data-slide="hero"]') as HTMLElement;
    expect(within(hero).getAllByRole('link')[0].closest('.landing-copy')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Try the demo' })).toHaveLength(3);
    const start = document.querySelector('[data-slide="contact"]') as HTMLElement;
    expect(within(start).getByRole('heading', { name: 'Try it, then decide' })).toBeTruthy();
    // no other slide has a link (the workflow tabs and the price button are buttons)
    for (const id of ['problem', 'org', 'workflows', 'pricing']) expect(within(document.querySelector(`[data-slide="${id}"]`) as HTMLElement).queryAllByRole('link'), id).toEqual([]);
    fireEvent.click(within(start).getByRole('button', { name: 'No demo account yet? Apply for one' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply for a demo account' });
    // opened from the last section: a demo account is pre-checked
    expect((within(dialog).getByLabelText('A demo account') as HTMLInputElement).checked).toBe(true);
  });

  it('the landing asks the engine nothing (it is the marketing site only)', () => {
    const fetch = vi.fn(async (_url: string) => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    landing();
    expect(fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/me'))).toEqual([]);
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
