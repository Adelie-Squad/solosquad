// The landing (DESIGN.md `## 랜딩`): five pinned slides moved by the step controller (one gesture =
// one section, then a hold), the section names at the left edge and Tab going through it, the
// stacked 2D fallback (reduced motion · `?webgl=off` · no WebGL · a 3D layer that never draws) with
// native scroll, each section's content centred in its scene, where the penguin stands for each
// (staging) and how it walks there, what it does (a pretend typing patter within the stroke limits,
// the relay, the scroll, the stamp, the wave), that the content never shakes, what may show in front
// of the content (occlusion), the org chart and its team modal, the cycling prompt, the buttons, and
// the regression for the penguin that appeared and then disappeared.
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
import { PromptAct, relayStep, StampAct, StepsAct } from '../src/landing/Acts';
import { fitEraser, makeEraser, ORDER } from '../src/landing/rig';
import { makeStamp } from '../src/landing/props';
import { paletteFor } from '../src/office/palette';
import { BODY, centreOffset, faceX, easeInOutCubic, headOf, moveAt, MOVE_MS, penguinHeight, spotFor, STROKE_DEPTH, STROKE_LIFT, STROKE_LIMITS, STROKE_RATE, strokeAt } from '../src/landing/staging';
import { AGENT_COUNT, TEAMS } from '../src/landing/catalog';
import { DWELL_MS, GESTURE_GAP_MS, GLIDE_MS, keyStep, Stepper, WheelGesture, type StepperEnv } from '../src/landing/dwell';
import { drawState, follow, GIVE_UP_SECONDS, LIMITS, lookAt, wander } from '../src/landing/gaze';
import { ACT_YAW, actingWings, actYaw, ARM_CHOICE, bodyTurn, farWing, MAX_STRETCH, MAX_TURN, nearWing, nextFront, outside, pathAt, rectsOverlap, segmentHits, stretchFor, viaPoint } from '../src/landing/arms';
import { claimIntro, DROP, INTRO, INTRO_MS, introAt, resetIntro, REST, SQUASH_MAX } from '../src/landing/intro';
import { makeMorph } from '../src/landing/morph';
import { useHolder } from '../src/landing/holder';
import { InquiryProvider } from '../src/marketing/Inquiry';
import { Landing } from '../src/landing/Landing';
import { HOLD_ANSWER_MS, HOLD_TYPED_MS, PromptTyper, TYPE_MS } from '../src/landing/PromptTyper';
import { SECTIONS, stepAt } from '../src/landing/sections';

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

/** jsdom lays nothing out: each section stop sits one screen (900px) below the last. */
const SCREEN = 900;
function stubLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const n = Number((this as HTMLElement).style?.getPropertyValue('--n') || 0);
    const top = this.classList.contains('landing-stop') ? n * SCREEN - window.scrollY : 0;
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

/** Live landing on a fake clock (timers, frames and `performance.now`) — for the step controller. */
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

  it('live: one stop per section, the stage pinned, the slide from the native scroll position', () => {
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
    expect(css).toMatch(/\.landing-pin \{[^}]*position: sticky;/);
    // CSS snap is gone: a hard flick glided straight past mandatory stops — the controller steps instead
    expect(css).not.toMatch(/scroll-snap-type: y/);
    expect(css).not.toMatch(/\.landing-stop \{[^}]*scroll-snap/);
  });

  it('the progress nav points at the stops and marks the slide that is up', () => {
    live();
    landing();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SECTIONS.map((s) => `#landing-${s.id}`));
    for (const a of links) expect(document.querySelector(a.getAttribute('href')!)!.classList.contains('landing-stop')).toBe(true);
    expect(links[0].getAttribute('aria-current')).toBe('step');
    scrollTo(SCREEN);
    expect(links[1].getAttribute('aria-current')).toBe('step');
    expect(links[1].className).toBe('is-on');
    expect(links[0].getAttribute('aria-current')).toBeNull();
    // section names only — no numbers (user, 2026-11-09)
    expect(links.map((a) => a.textContent)).toEqual(['Intro', 'Work', 'Team', 'Control', 'Get started']);
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
    expect(screen.getByRole('heading', { level: 1, name: 'Say what you need. The team gets to work.' })).toBeTruthy();
    for (const name of ['Ask in one place. The work happens at every desk.', `${AGENT_COUNT} agents in ${TEAMS.length} teams`, 'You make the decisions', 'Try it, then decide']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    expect(document.querySelector('.landing-index')).toBeNull();
    expect(screen.queryByText(/^0\d \/ 05$/)).toBeNull();
    expect(screen.queryByText('Scroll')).toBeNull();
  });
});

/** A page of five stops, a fake clock and frames that run when the clock passes 16 ms. */
function fakePage(start = 0) {
  let t = 0;
  let y = start;
  let locked = false;
  const frames: { at: number; cb: () => void; id: number }[] = [];
  let nextId = 1;
  const log: string[] = [];
  const env: StepperEnv = {
    now: () => t,
    scrollY: () => y,
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
    stops: () => [0, 900, 1800, 2700, 3600],
    locked: () => locked,
    onLog: (l) => log.push(l),
  };
  const advance = (ms: number) => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 4);
      for (const f of frames.splice(0).filter((f) => (f.at <= t ? true : (frames.push(f), false)))) f.cb();
    }
  };
  return { env, advance, y: () => y, lock: (v: boolean) => (locked = v), log, at: () => t };
}

describe('one gesture, one section (dwell)', () => {
  it('a hard flick — a burst of wheel events with its inertia tail — moves exactly one section', () => {
    const page = fakePage();
    const s = new Stepper(page.env);
    // 60 events 16 ms apart: rising for 5, then the long decaying tail of a trackpad
    for (let i = 0; i < 60; i++) {
      s.wheel(i < 5 ? 30 * (i + 1) : 150 * 0.9 ** (i - 5));
      page.advance(16);
    }
    page.advance(GLIDE_MS + DWELL_MS);
    expect(page.y()).toBe(900);
    expect(page.log.filter((l) => l.includes('->'))).toEqual([expect.stringMatching(/wheel -> section 2$/)]);
  });

  it('holds at the section: a new gesture inside the glide or the dwell is ignored, after it it steps', () => {
    const page = fakePage();
    const s = new Stepper(page.env);
    s.wheel(120);
    expect(s.busy()).toBe(true);
    page.advance(GLIDE_MS + 50);
    expect(page.y()).toBe(900);
    // the dwell: a fresh flick after a quiet gap still does nothing
    page.advance(GESTURE_GAP_MS + 20);
    s.wheel(120);
    page.advance(GLIDE_MS);
    expect(page.y()).toBe(900);
    expect(s.busyUntil).toBeGreaterThan(0);
    // once the hold is over, the next flick moves on
    page.advance(DWELL_MS);
    expect(s.busy()).toBe(false);
    s.wheel(-120);
    page.advance(GLIDE_MS + DWELL_MS);
    expect(page.y()).toBe(0);
  });

  it('a second flick on top of the first one’s inertia (the deltas rise again) is a new gesture', () => {
    const g = new WheelGesture();
    let now = 0;
    const feed = (d: number, busy = false) => g.feed(d, (now += 16), busy);
    expect(feed(10)).toBe(0);
    expect(feed(30)).toBe(1);
    for (let i = 0; i < 20; i++) expect(feed(60 * 0.85 ** i)).toBe(0); // the tail, decaying
    expect(feed(70)).toBe(1); // rises sharply: a new flick
    expect(feed(-200, true)).toBe(0); // the page is busy: spent, whatever it is
  });

  it('a resting finger’s jitter never steps; a mouse notch does', () => {
    const g = new WheelGesture();
    expect(g.feed(3, 0, false)).toBe(0);
    expect(g.feed(-2, 20, false)).toBe(0);
    expect(g.feed(4, 40, false)).toBe(0);
    expect(g.feed(100, 1000, false)).toBe(1);
  });

  it('the keyboard steps through the same controller and retargets at once (two presses, two sections)', () => {
    const page = fakePage();
    const s = new Stepper(page.env);
    const key = (k: string, shiftKey = false) => {
      const to = keyStep({ key: k, shiftKey, altKey: false, ctrlKey: false, metaKey: false }, s.current(), 4);
      if (to !== null) s.go(to, 'key');
    };
    key('PageDown');
    page.advance(100);
    key('ArrowDown');
    page.advance(1200);
    expect(page.y()).toBe(1800);
    key(' ');
    page.advance(1200);
    expect(page.y()).toBe(2700);
    key(' ', true);
    page.advance(1200);
    expect(page.y()).toBe(1800);
    key('End');
    page.advance(1200);
    expect(page.y()).toBe(3600);
    key('Home');
    page.advance(1200);
    expect(page.y()).toBe(0);
    expect(keyStep({ key: 'a', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }, 0, 4)).toBeNull();
    expect(keyStep({ key: 'ArrowDown', shiftKey: false, altKey: false, ctrlKey: true, metaKey: false }, 0, 4)).toBeNull();
  });

  it('a scroll that rests between two stops (scrollbar, resize, history) settles on the nearest', () => {
    const page = fakePage(1300);
    const s = new Stepper(page.env);
    s.settle();
    page.advance(1200);
    expect(page.y()).toBe(900);
  });

  it('while a modal holds the page, the wheel is the modal’s — the controller lets it be', () => {
    const page = fakePage();
    const s = new Stepper(page.env);
    page.lock(true);
    expect(s.wheel(200)).toBe(false);
    page.advance(1500);
    expect(page.y()).toBe(0);
  });

  it('on the page: a wheel burst on the live landing glides one section and holds; a burst in the hold is ignored', () => {
    liveOnClock();
    const scrolled = stubScroll();
    const { container } = landing();
    act(() => void vi.advanceTimersByTime(50));
    const on = () => container.querySelector('.landing-slide.is-on')!.getAttribute('data-slide');
    const burst = () => {
      for (let i = 0; i < 20; i++) {
        const e = new WheelEvent('wheel', { deltaY: 90, cancelable: true });
        window.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true); // the page never scrolls natively under the controller
        act(() => void vi.advanceTimersByTime(16));
      }
    };
    burst();
    act(() => void vi.advanceTimersByTime(GLIDE_MS + 100));
    expect(window.scrollY).toBe(SCREEN);
    expect(on()).toBe('what');
    burst(); // inside the dwell
    act(() => void vi.advanceTimersByTime(GLIDE_MS + 100));
    expect(window.scrollY).toBe(SCREEN);
    act(() => void vi.advanceTimersByTime(DWELL_MS));
    act(() => void vi.advanceTimersByTime(GESTURE_GAP_MS + 10));
    burst();
    act(() => void vi.advanceTimersByTime(GLIDE_MS + 100));
    expect(window.scrollY).toBe(SCREEN * 2);
    expect(on()).toBe('team');
    // the keyboard goes through it too
    fireEvent.keyDown(window, { key: 'PageUp' });
    act(() => void vi.advanceTimersByTime(GLIDE_MS + 100));
    expect(window.scrollY).toBe(SCREEN);
    // and a modal holds it still
    const release = lockScroll();
    const held = new WheelEvent('wheel', { deltaY: 200, cancelable: true });
    window.dispatchEvent(held);
    act(() => void vi.advanceTimersByTime(2000));
    expect(window.scrollY).toBe(SCREEN);
    release();
    expect(scrolled).toHaveBeenCalled();
  });

  it('the progress links and Tab go through the controller too (native scroll position stays the truth)', () => {
    liveOnClock();
    stubScroll();
    landing();
    act(() => void vi.advanceTimersByTime(50));
    const link = screen.getByRole('link', { name: /Team/ });
    fireEvent.click(link);
    act(() => void vi.advanceTimersByTime(1100));
    expect(window.scrollY).toBe(SCREEN * 2);
    expect(window.location.hash).toBe('#landing-team');
    // Tab into a slide that is not up brings it up
    const login = document.querySelector<HTMLElement>('[data-slide="start"] .landing-final-cta')!;
    act(() => login.focus());
    act(() => void vi.advanceTimersByTime(1100));
    expect(window.scrollY).toBe(SCREEN * 4);
  });

  it('the stacked page keeps plain native scroll — no controller, the wheel untouched', () => {
    stubMotion(true);
    stubWebGL();
    landing();
    const e = new WheelEvent('wheel', { deltaY: 200, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(css).toMatch(/html:has\(\.landing\[data-mode="static"\]\) \{\s*scroll-behavior: smooth;/);
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
    expect(within(screen.getByTestId('landing-scene-hero')).getByTestId('landing-prompt')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-what')).getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(within(screen.getByTestId('landing-scene-team')).getByTestId('landing-org')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-control')).getByTestId('landing-approval')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-start')).getAllByRole('link', { name: 'Try the demo' })).toHaveLength(1);
    expect(container.querySelector('.landing-present')).toBeNull();
  });

  it('the content block sits in the middle of its scene (CSS), and nothing slides under the penguin', () => {
    expect(rule('.landing-pin .landing-scene')).toMatch(/display: grid;[\s\S]*place-items: center;[\s\S]*height: 100%;/);
    // the slide only fades: a slide that moved would move the spot the penguin walks to
    expect(rule('.landing-pin .landing-slide')).not.toMatch(/transform|translate/);
    expect(rule('.landing-pin .landing-slide.is-on')).not.toMatch(/transform|translate/);
    // the canvas covers the scene column (a little past it), the same grid as the slides
    expect(rule('.landing-stage')).toMatch(/grid-template-columns: var\(--landing-cols\);/);
    expect(rule('.landing-mascot')).toMatch(/grid-column: 2;[\s\S]*height: 100%;/);
    expect(rule('.landing-scene')).toMatch(/grid-column: 2;/);
    // layers: the content, the 3D canvas over it, never catching clicks — and no 2D poster at all
    expect(css).not.toMatch(/\.landing-poster/);
    expect(rule('.landing-pin .landing-slide')).toMatch(/z-index: 2;/);
    expect(rule('.landing-canvas')).toMatch(/z-index: 3;[\s\S]*pointer-events: none;/);
    // the prompt box never grows as it types (the spot would creep)
    expect(rule('.landing-prompt-text')).toMatch(/height: calc\(2 \* 1\.5em\);[\s\S]*overflow: hidden;/);
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
    for (const s of SECTIONS) expect(screen.getByTestId(`landing-scene-${s.id}`).querySelector('[data-front]'), s.id).toBeTruthy();
    // the penguin stands behind the prompt box and the last card: nothing of it shows under them either
    expect(screen.getByTestId('landing-scene-hero').querySelector('[data-front="ground"]')).toBeTruthy();
    expect(screen.getByTestId('landing-scene-start').querySelector('[data-front="ground"]')).toBeTruthy();
    // the relay: a wing hands the request to card 1 (which wing comes from the geometry — arms.ts)
    const what = screen.getByTestId('landing-scene-what');
    expect(what.querySelector('li')!.querySelector('[data-hand]')).toBeTruthy();
    const team = screen.getByTestId('landing-scene-team');
    expect(team.querySelector('[data-rod]')).toBeTruthy();
    expect(team.querySelectorAll('[data-front]')).toHaveLength(2); // the paper shown so far + the roll
    const control = screen.getByTestId('landing-scene-control');
    expect(control.querySelector('[data-stamp-target]')!.textContent).toContain('Approve');
    expect(control.querySelector('[data-hand]')).toBeNull();
  });

  it('phone: the scene first with the content centred in what is left, the message under it; the canvas covers the stage', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
    expect(phone).toMatch(/\.landing-pin \.landing-scene \{[^}]*order: -1;[^}]*flex: 1 1 auto;/);
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

  it('hero: centred over the prompt box, shoulders just above its top edge, the feet hidden behind it', () => {
    const s = spotFor('hero', box, h, false);
    expect(s.x).toBe(box.left + box.width / 2);
    const shoulder = s.y - (1 - BODY.shoulder) * h;
    expect(shoulder).toBeLessThan(box.top);
    expect(box.top - shoulder).toBeLessThan(0.15 * h);
    expect(s.y).toBeLessThan(bottom); // feet behind the box
    expect(headOf(s).y).toBeLessThan(box.top); // the face shows above it
    expect(s.lean).toBe(0);
  });

  it('what: beside the step cards on their right, turned to them; on a phone over their upper right', () => {
    const s = spotFor('what', box, h, false);
    expect(s.x).toBeGreaterThan(right);
    expect(s.turn).toBeLessThan(0);
    const p = spotFor('what', box, 170, true);
    expect(p.x).toBeLessThan(right);
    expect(p.x + BODY.halfWidth * 170).toBeLessThanOrEqual(right + 2);
    expect(headOf(p).y).toBeLessThan(box.top);
  });

  it('team: behind the paper’s upper-left corner, leaning out to the left; the eyes above the rod', () => {
    const s = spotFor('team', box, h, false);
    expect(s.x).toBeGreaterThan(box.left); // the body is behind the paper
    expect(s.lean).toBeGreaterThan(0.2); // leaning out to the reader's left
    expect(headOf(s).x).toBeLessThan(s.x);
    const eyes = s.y - Math.cos(s.lean) * (1 - BODY.eyes) * h;
    expect(eyes).toBeLessThan(box.top); // the face peeks over the top edge
    expect(s.y).toBeLessThan(bottom); // the feet are hidden behind the paper
  });

  it('control: just outside the card’s lower-left corner, turned to it', () => {
    const s = spotFor('control', box, h, false);
    expect(s.x).toBeLessThan(box.left);
    expect(s.y).toBeGreaterThan(bottom);
    expect(s.turn).toBeGreaterThan(0.2);
    const p = spotFor('control', box, 170, true);
    expect(p.h).toBeLessThan(170); // a smaller penguin on a phone
    expect(p.x).toBeLessThan(box.left);
  });

  it('start: behind the last card’s upper right, head and shoulders above it', () => {
    const s = spotFor('start', box, h, false);
    expect(s.x).toBeGreaterThan(box.left + box.width / 2);
    expect(s.x).toBeLessThan(right);
    expect(headOf(s).y).toBeLessThan(box.top);
    expect(s.y).toBeLessThan(bottom);
  });

  it('every section has its own spot', () => {
    const spots = SECTIONS.map((sec) => spotFor(sec.id, box, h, false));
    const keys = new Set(spots.map((s) => `${Math.round(s.x)}:${Math.round(s.y)}`));
    expect(keys.size).toBe(SECTIONS.length);
  });

  it('walks between spots in ~0.7 s, eased at both ends, with a small hop — no jump', () => {
    expect(MOVE_MS).toBeGreaterThanOrEqual(600);
    expect(MOVE_MS).toBeLessThanOrEqual(800);
    const a = spotFor('hero', box, h, false);
    const b = spotFor('control', box, h, false);
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
  it('every act breathes on the idle clip — the office typing clip (the body bob behind the trembling) is not used', () => {
    expect(ACT_CLIP).toEqual({ hero: 'idle', what: 'idle', team: 'idle', control: 'idle', start: 'idle' });
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
    // the box tells the canvas only whether it is typing — no per-character tap
    vi.useFakeTimers();
    render(
      <I18nProvider locale="en">
        <div className="landing-pin is-acting">
          <PromptAct on acting still={false} />
        </div>
      </I18nProvider>,
    );
    act(() => void vi.advanceTimersByTime(TYPE_MS * 3));
    expect(cues.typing).toBe(true);
    expect(document.querySelector('.landing-act.is-prompt')!.getAttribute('data-tap')).toBeNull();
    for (let i = 0; i < 40; i++) act(() => void vi.advanceTimersByTime(TYPE_MS));
    act(() => void vi.advanceTimersByTime(HOLD_TYPED_MS));
    expect(screen.getByTestId('landing-answer').classList.contains('is-on')).toBe(true);
    expect(cues.typing).toBe(false); // it holds still while the answer shows
  });

  it('the content never shakes: no animation or transform on the prompt box or the approval card', () => {
    for (const sel of ['.landing-act.is-prompt', '.landing-prompt-box', '.landing-approval', '.landing-preview', '.landing-act.is-stamp']) {
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

  it('the stamp sequence on the card: waiting → pressed at the hit (mark) → approved; the card stays still', () => {
    vi.useFakeTimers();
    render(
      <I18nProvider locale="en">
        <StampAct on acting />
      </I18nProvider>,
    );
    const card = screen.getByTestId('landing-approval');
    const approve = card.querySelector<HTMLElement>('[data-stamp-target]')!;
    expect(card.getAttribute('data-state')).toBe('waiting');
    expect(within(card).getByText('Waiting for approval')).toBeTruthy();
    expect(cues.stampAt).toBeGreaterThan(-Infinity);
    act(() => void vi.advanceTimersByTime(ACT_DELAY_MS + STAMP_IMPACT_MS - 10));
    expect(card.getAttribute('data-state')).toBe('waiting');
    act(() => void vi.advanceTimersByTime(20));
    expect(card.getAttribute('data-state')).toBe('pressed');
    act(() => void vi.advanceTimersByTime(STAMP_APPROVED_MS - STAMP_IMPACT_MS));
    expect(card.getAttribute('data-state')).toBe('approved');
    expect(within(card).getByText('Approved')).toBeTruthy();
    expect(approve.textContent).toBe('Approve');
    expect(approve.parentElement!.querySelector('[data-testid="landing-stamp-mark"]')).toBeTruthy();
    // the buttons come last in the card — the bottom-left corner the penguin reaches from
    expect(card.lastElementChild!.className).toBe('landing-approval-actions');
    expect(css).toMatch(/\.landing-approval\.is-pressed \.landing-approve \{[^}]*translate: 0 1px;/);
    expect(css).toMatch(/\.landing-approval\.is-approved \.landing-approve \{[^}]*border-color: var\(--ok\);[^}]*color: var\(--ok\);/);
    expect(css).toMatch(/\.landing-approval:not\(\.is-waiting\) \.landing-stamp-mark \{[^}]*opacity: 0\.9;/);
    cleanup();
    resetCues();
    render(
      <I18nProvider locale="en">
        <StampAct on acting={false} />
      </I18nProvider>,
    );
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByTestId('landing-approval').getAttribute('data-state')).toBe('waiting');
    expect(cues.stampAt).toBe(-Infinity);
  });

  it('the relay: the wing hands the request to card 1, then the cards light up in turn — accent working, ok done', () => {
    expect(relayAt(0)).toBe(-1);
    expect(relayAt(RELAY.reach)).toBe(0);
    expect(relayAt(RELAY.reach + RELAY.step)).toBe(1);
    expect(relayAt(RELAY.reach + 3 * RELAY.step + 1)).toBe(3);
    expect(relayHand(-1)).toBe(0);
    expect(relayHand(RELAY.reach)).toBeCloseTo(1);
    expect(relayHand(RELAY.reach + 2000)).toBe(0);
    expect(relayStep(0, 1)).toBe('done');
    expect(relayStep(1, 1)).toBe('on');
    expect(relayStep(2, 1)).toBe('waiting');
    vi.useFakeTimers();
    render(
      <I18nProvider locale="en">
        <StepsAct on acting />
      </I18nProvider>,
    );
    const states = () => [...document.querySelectorAll('.landing-step')].map((li) => li.getAttribute('data-state'));
    expect(states()).toEqual(['waiting', 'waiting', 'waiting']);
    act(() => void vi.advanceTimersByTime(ACT_DELAY_MS + RELAY.reach + 10));
    expect(states()).toEqual(['on', 'waiting', 'waiting']);
    expect(document.querySelector('[data-gaze]')).toBe(document.querySelectorAll('.landing-step')[0]);
    act(() => void vi.advanceTimersByTime(RELAY.step));
    expect(states()).toEqual(['done', 'on', 'waiting']);
    act(() => void vi.advanceTimersByTime(2 * RELAY.step));
    expect(states()).toEqual(['done', 'done', 'done']);
    expect(css).toMatch(/\.landing-step\.is-on \{[^}]*outline-color: var\(--accent\);/);
    expect(css).toMatch(/\.landing-step\.is-done \.landing-step-badge \{[^}]*color: var\(--ok\);/);
    // without acting it is the finished picture
    cleanup();
    render(
      <I18nProvider locale="en">
        <StepsAct on acting={false} />
      </I18nProvider>,
    );
    expect(states()).toEqual(['done', 'done', 'done']);
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
    for (const sel of gated) expect(sel).toMatch(/^\.landing-pin\.is-acting |^\.landing-approval:not|caret/);
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
    const picked = Object.fromEntries(SECTIONS.map(({ id }) => [id, actingWings(id, spotFor(id, box, h, false).x, cx)]));
    // relay: the penguin is right of the cards → its far (left) wing; scroll: the paper is to its right
    // → its far (right) wing, on the knob at the paper's left end; hero: both type; start: the far one waves
    expect(picked.what.wings).toEqual(['L']);
    expect(picked.team.wings).toEqual(['R']);
    expect(picked.hero.wings).toEqual(['L', 'R']);
    expect(picked.start).toEqual({ wings: ['L', 'R'], wave: 'L' });
    // the approval card is the measured exception: the near wing stamps (ARM_CHOICE)
    expect(ARM_CHOICE.control).toBe('near');
    expect(picked.control.wings).toEqual(['L']);
    // mirrored content flips every choice — it comes from where things are, not from the section
    expect(actingWings('what', 400, 700).wings).toEqual(['R']);
    expect(actingWings('control', 1200, 900).wings).toEqual(['R']);
    expect(actingWings('start', 500, 800).wave).toBe('R');
    // the body turns towards the content to bring the far wing round, within natural limits
    expect(actYaw('what', 1200, 900)).toBeLessThan(0);
    expect(actYaw('what', 400, 700)).toBeGreaterThan(0);
    for (const id of ['hero', 'team', 'control', 'start'] as const) expect(actYaw(id, 1200, 900)).toBe(0);
    expect(Math.abs(bodyTurn(-0.18, -ACT_YAW))).toBeLessThanOrEqual(MAX_TURN);
    expect(Math.abs(bodyTurn(-0.6, -0.6))).toBe(MAX_TURN);
    // a clay wing stretches to reach across the body, never past its limit
    expect(stretchFor(50, 100)).toBe(1);
    expect(stretchFor(130, 100)).toBeCloseTo(1.326, 2);
    expect(stretchFor(500, 100)).toBe(MAX_STRETCH);
    expect(ORDER.eraser).toBeLessThan(ORDER.front);
  });

  it('the near-wing stamp: its shoulder stands outside the card’s edge — a wing rooted behind the card could never come in front', () => {
    const h = 290;
    const box = { left: 700, top: 300, width: 380, height: 260 };
    const control = spotFor('control', box, h, false);
    expect(control.x + BODY.shoulderX * Math.cos(control.turn) * h).toBeLessThan(box.left);
    const phone = spotFor('control', box, 170, true);
    expect(phone.x + BODY.shoulderX * Math.cos(phone.turn) * phone.h).toBeLessThan(box.left);
    // beside the cards the face stays clear of them even with the body turned to act
    const what = spotFor('what', box, h, false);
    expect(faceX(what.x, h, bodyTurn(what.turn, -ACT_YAW)) - BODY.face.half * h).toBeGreaterThan(box.left + box.width - 0.1 * h);
    // behind the content (hero, start, phone relay) the shoulders are above the top edge
    for (const s of [spotFor('hero', box, h, false), spotFor('start', box, h, false), spotFor('what', box, 170, true)]) expect(s.y - (1 - BODY.shoulder) * s.h).toBeLessThan(box.top);
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
    expect(container.querySelector('.landing-pin.is-acting')).toBeNull();
    await waitFor(() => expect(container.querySelector('.landing-pin.is-acting')).toBeTruthy());
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
    expect(screen.getByTestId('landing-prompt')).toBeTruthy();
    expect(screen.getByTestId('landing-approval').getAttribute('data-state')).toBe('waiting');
    expect(container.querySelector('.landing-pin.is-acting')).toBeNull();
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

describe('stacked fallback', () => {
  it('reduced motion: the sections stacked, the 2D penguin, the prompt standing still, no acting', () => {
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
    expect(screen.getByTestId('landing-approval').getAttribute('data-state')).toBe('waiting');
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

describe('section 3: the org chart and the team modal', () => {
  it('draws the owner and Chief on top, the teams below, names in the reader’s language', () => {
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
    for (const id of ['hero', 'start']) {
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
    const start = document.querySelector('[data-slide="start"]') as HTMLElement;
    expect(within(start).getByRole('heading', { name: 'Try it, then decide' })).toBeTruthy();
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
