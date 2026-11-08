// The landing (DESIGN.md `## 랜딩`): five pinned slides moved by the step controller (one gesture =
// one section, then a hold), the progress nav and Tab going through it, the stacked 2D fallback
// (reduced motion · `?webgl=off` · no WebGL · a 3D layer that never draws) with native scroll, each
// section's content in the scene box over the penguin and what the penguin does with it (taps on the
// prompt, turns the step cards, unrolls the org chart, stamps the approval, holds up the sign), the
// org chart and its team modal, the cycling prompt, the buttons, and the regression for the penguin
// that appeared and then disappeared.
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
  FLIP_MS,
  FLIP_STEP_MS,
  resetCues,
  SHAKE_MS,
  squashAt,
  STAMP,
  STAMP_APPROVED_MS,
  STAMP_IMPACT_MS,
  STAMP_REST,
  STAMP_TOP,
  STAMP_TOTAL_MS,
  stampLift,
  stampState,
  TAP_MS,
  tapPulse,
  UNROLL_MS,
} from '../src/landing/acting';
import { PromptAct, StampAct } from '../src/landing/Acts';
import { AGENT_COUNT, TEAMS } from '../src/landing/catalog';
import { DWELL_MS, GESTURE_GAP_MS, GLIDE_MS, keyStep, Stepper, WheelGesture, type StepperEnv } from '../src/landing/dwell';
import { drawState, follow, GIVE_UP_SECONDS, LIMITS, lookAt, wander } from '../src/landing/gaze';
import { useHolder } from '../src/landing/holder';
import { Landing } from '../src/landing/Landing';
import { HOLD_ANSWER_MS, HOLD_TYPED_MS, PromptTyper, TYPE_MS } from '../src/landing/PromptTyper';
import { SECTIONS, stepAt } from '../src/landing/sections';
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
          <Landing />
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
    expect(links[0].getAttribute('aria-current')).toBeNull();
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

describe('the scene: the content in front of the penguin', () => {
  it('each section is the message on one side and, on the other, the scene box holding its content', () => {
    live();
    const { container } = landing();
    for (const s of SECTIONS) {
      const slide = container.querySelector(`[data-slide="${s.id}"]`)!;
      const parts = [...slide.children].map((c) => c.className);
      expect(parts).toEqual(['landing-copy', 'landing-scene']);
      const scene = screen.getByTestId(`landing-scene-${s.id}`);
      expect(scene.querySelector('.landing-act')).toBeTruthy();
    }
    expect(within(screen.getByTestId('landing-scene-hero')).getByTestId('landing-prompt')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-what')).getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(within(screen.getByTestId('landing-scene-team')).getByTestId('landing-org')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-control')).getByTestId('landing-approval')).toBeTruthy();
    expect(within(screen.getByTestId('landing-scene-start')).getByRole('link', { name: 'Log in' })).toBeTruthy();
    // never three columns: nothing sits between the message and the scene
    expect(container.querySelector('.landing-present')).toBeNull();
  });

  it('the scene box lies exactly over the penguin, and the content overlaps its lower half', () => {
    // the same grid and the same box for the penguin layer and every slide's scene
    expect(rule('.landing-stage')).toMatch(/grid-template-columns: var\(--landing-cols\);/);
    expect(rule('.landing-pin .landing-slide')).toMatch(/inset: var\(--landing-gnb\) 0 0;/);
    expect(rule('.landing-slide')).toMatch(/grid-template-columns: var\(--landing-cols\);/);
    expect(rule('.landing-mascot')).toMatch(/grid-column: 2;/);
    expect(rule('.landing-scene')).toMatch(/grid-column: 2;/);
    for (const box of [rule('.landing-mascot'), rule('.landing-pin .landing-scene')]) {
      expect(box).toMatch(/justify-self: center;[\s\S]*align-self: start;/);
      expect(box).toMatch(/width: var\(--mascot\);/);
      expect(box).toMatch(/height: var\(--mascot\);/);
      expect(box).toMatch(/margin-top: var\(--scene-top\);/);
    }
    // the content starts at wing height, the scroll a little higher
    expect(rule('.landing-pin .landing-act')).toMatch(/top: var\(--front-top\);/);
    expect(css).toMatch(/--front-top: calc\(var\(--mascot\) \* 0\.5\d\);/);
    // the scroll rod sits under the beak on every screen size — the face always shows
    for (const m of css.matchAll(/--rod-top: calc\(var\(--mascot\) \* (0\.\d+)\);/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(0.55);
    expect(rule('.landing-pin .landing-act.is-scroll')).toMatch(/top: var\(--rod-top\);/);
    // layers: the 2D poster under the content, the 3D canvas over it (cut out behind the content), never catching clicks
    expect(rule('.landing-poster')).toMatch(/z-index: 1;/);
    expect(rule('.landing-pin .landing-slide')).toMatch(/z-index: 2;/);
    expect(rule('.landing-canvas')).toMatch(/z-index: 3;[\s\S]*pointer-events: none;/);
  });

  it('the wings have marks to go to on every act, and the stamp, the rod and the cut-out theirs', () => {
    live();
    landing();
    for (const id of ['hero', 'what', 'start']) {
      const scene = screen.getByTestId(`landing-scene-${id}`);
      expect(scene.querySelector('[data-hand="L"]'), id).toBeTruthy();
      expect(scene.querySelector('[data-hand="R"]'), id).toBeTruthy();
      expect(scene.querySelector('[data-front]'), id).toBeTruthy();
    }
    const team = screen.getByTestId('landing-scene-team');
    expect(team.querySelector('[data-rod]')).toBeTruthy();
    expect(team.querySelectorAll('[data-front]')).toHaveLength(2); // the paper shown so far + the roll
    const control = screen.getByTestId('landing-scene-control');
    expect(control.querySelector('[data-stamp-target]')!.textContent).toContain('Approve');
    expect(control.querySelector('[data-hand]')).toBeNull(); // only the stamp wing works here — nothing over the chip
  });

  it('phone: the penguin at the top centre, the scene first with the content over its lower half, the message under it', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
    expect(phone).toMatch(/--mascot: min\(\d+svh, \d+vw, \d+px\);/);
    expect(phone).toMatch(/\.landing-pin \.landing-scene \{[^}]*order: -1;[^}]*padding-top: var\(--front-top\);/);
    expect(phone).toMatch(/\.landing-pin \.landing-act,[^{]*\{[^}]*position: relative;/);
  });
});

describe('the acting', () => {
  it('each act plays an office clip under the wings — typing at the prompt, idle while holding things', () => {
    expect(ACT_CLIP).toEqual({ hero: 'typing', what: 'idle', team: 'idle', control: 'idle', start: 'idle' });
  });

  it('a key tap: down fast, up slower, one per typed character, wings alternating', () => {
    expect(tapPulse(-1)).toBe(0);
    expect(tapPulse(TAP_MS * 0.35)).toBeCloseTo(1);
    expect(tapPulse(TAP_MS * 0.2)).toBeGreaterThan(0.5);
    expect(tapPulse(TAP_MS)).toBe(0);
    vi.useFakeTimers();
    render(
      <I18nProvider locale="en">
        <div className="landing-pin is-acting">
          <PromptAct on acting still={false} />
        </div>
      </I18nProvider>,
    );
    const sides: string[] = [];
    const nudges: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      act(() => void vi.advanceTimersByTime(TYPE_MS));
      sides.push(cues.tapSide);
      nudges.push(document.querySelector('.landing-act.is-prompt')!.getAttribute('data-tap'));
    }
    expect(sides).toEqual(['R', 'L', 'R', 'L']);
    expect(nudges).toEqual(['a', 'b', 'a', 'b']); // the box nudges with each tap
    expect(cues.tapAt).toBeGreaterThan(-Infinity);
    expect(css).toMatch(/\.landing-pin\.is-acting \.landing-act\.is-prompt\[data-tap="a"\] \{\s*animation: landing-tap-a 150ms/);
  });

  it('the stamp: raised past its strike height, a fast strike to the card, a small rebound, back to rest', () => {
    expect(stampLift(-10)).toBe(STAMP_REST);
    expect(Math.max(...[100, 200, 300, 400].map(stampLift))).toBeGreaterThan(STAMP_TOP); // anticipation overshoot
    expect(stampLift(STAMP.raise + STAMP.cock / 2)).toBeGreaterThan(STAMP_TOP - 0.01);
    // the strike accelerates: most of the drop happens in its second half
    const s0 = STAMP.raise + STAMP.cock;
    expect(stampLift(s0 + STAMP.strike / 2)).toBeGreaterThan(STAMP_TOP * 0.7);
    expect(stampLift(STAMP_IMPACT_MS)).toBe(0);
    expect(stampLift(STAMP_IMPACT_MS + STAMP.hold / 2)).toBe(0);
    expect(Math.max(...[60, 120, 200, 300, 400].map((d) => stampLift(STAMP_IMPACT_MS + STAMP.hold + d)))).toBeGreaterThan(STAMP_REST); // overshoot on the way up
    expect(stampLift(STAMP_TOTAL_MS + 1)).toBe(STAMP_REST);
    // the body squashes at the hit, rebounds, and is itself again
    expect(squashAt(STAMP_IMPACT_MS - 1)).toBe(1);
    expect(squashAt(STAMP_IMPACT_MS + 70)).toBeLessThan(0.95);
    expect(squashAt(STAMP_IMPACT_MS + 170)).toBeGreaterThan(1);
    expect(squashAt(STAMP_IMPACT_MS + 400)).toBe(1);
    expect(stampState(STAMP_IMPACT_MS - 1)).toBe('waiting');
    expect(stampState(STAMP_IMPACT_MS)).toBe('pressed');
    expect(stampState(STAMP_APPROVED_MS)).toBe('approved');
  });

  it('the stamp sequence on the card: waiting → pressed at the hit (mark, shake) → approved', () => {
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
    expect(card.className).toContain('is-pressed');
    act(() => void vi.advanceTimersByTime(STAMP_APPROVED_MS - STAMP_IMPACT_MS));
    expect(card.getAttribute('data-state')).toBe('approved');
    expect(card.className).toContain('is-approved');
    expect(within(card).getByText('Approved')).toBeTruthy();
    expect(approve.textContent).toBe('Approve');
    expect(approve.parentElement!.querySelector('[data-testid="landing-stamp-mark"]')).toBeTruthy();
    // CSS: pressed = the button goes down; approved = ok border and text; the mark and the shake appear from the hit
    expect(css).toMatch(/\.landing-approval\.is-pressed \.landing-approve \{[^}]*translate: 0 2px;/);
    expect(css).toMatch(/\.landing-approval\.is-approved \.landing-approve \{[^}]*border-color: var\(--ok\);[^}]*color: var\(--ok\);/);
    expect(css).toMatch(/\.landing-approval:not\(\.is-waiting\) \.landing-stamp-mark \{[^}]*opacity: 0\.9;/);
    expect(css).toContain(`.landing-approval.is-pressed {\n  animation: landing-shake ${SHAKE_MS}ms`);
    // nothing plays without acting (no 3D yet, or the stacked page)
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

  it('the scroll unrolls and the step cards turn over on the same clock as the wings', () => {
    expect(css).toContain(`transition: --unroll ${UNROLL_MS}ms cubic-bezier(0.3, 1.12, 0.45, 1) ${ACT_DELAY_MS}ms;`);
    expect(css).toMatch(/@property --unroll \{[^}]*initial-value: 1;/);
    expect(css).toMatch(/\.landing-scroll-sheet \{[^}]*clip-path: inset\(0 -1px calc\(\(1 - var\(--unroll\)\) \* 100%\) -1px\);/);
    expect(css).toMatch(/\.landing-scroll-roll \{[^}]*top: calc\(var\(--unroll\) \* 100%\);/);
    expect(css).toContain(`animation: landing-flip ${FLIP_MS}ms cubic-bezier(0.3, 1.35, 0.5, 1) var(--flip-at) both;`);
    live();
    landing();
    const cards = [...screen.getByTestId('landing-scene-what').querySelectorAll('li')];
    expect(cards.map((li) => li.style.getPropertyValue('--flip-at'))).toEqual([0, 1, 2].map((i) => `${ACT_DELAY_MS + i * FLIP_STEP_MS}ms`));
  });

  it('every act animation waits for acting — the poster and the stacked page show the finished picture', () => {
    const gated = [...css.matchAll(/\n([^\n{}]+)\{[^}]*(animation: landing-(?:flip|tap-a|tap-b)|--unroll: 0)/g)].map((m) => m[1].trim());
    expect(gated.length).toBeGreaterThanOrEqual(4);
    for (const sel of gated) expect(sel).toMatch(/^\.landing-pin\.is-acting /);
    expect(css).not.toMatch(/(^|\n)\.landing-act \{[^}]*opacity: 0/);
    expect(css).not.toMatch(/(^|\n)\.landing-slide \{[^}]*opacity: 0/);
  });
});

describe('the penguin', () => {
  it('stays in its place for every slide (one layer, never moved per section)', () => {
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

  it('the 2D penguin stays until the 3D one has really drawn', () => {
    expect(drawState(0, 0.5)).toBe('waiting');
    expect(drawState(7, 0.5)).toBe('drawn');
    expect(drawState(0, GIVE_UP_SECONDS)).toBe('empty');
  });

  it('a 3D layer that never draws keeps the poster (never an empty stage) and the finished pictures', async () => {
    canvas.behaviour = 'never';
    live();
    const { container } = landing();
    await waitFor(() => expect(screen.getByTestId('mascot-canvas')).toBeTruthy());
    expect(container.querySelector('.landing-mascot.is-ready')).toBeNull();
    expect(container.querySelector('.landing-poster svg.penguin')).toBeTruthy();
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

  it('signed in: both go to the account dashboard (decision 60)', async () => {
    stubMe(me({ last_scope: { org: 'tesla', workspace: 'vehicles' } }));
    landing();
    const links = await screen.findAllByRole('link', { name: 'Go to my office' });
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute('href')).toBe('/dashboard');
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
