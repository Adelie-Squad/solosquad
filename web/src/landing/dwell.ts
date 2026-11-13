// The landing's step controller (DESIGN.md `## 랜딩` — 한 동작에 한 섹션). The user asked for the page
// to stop at each section even when scrolled hard (2026-11-09), which native scroll snap cannot do:
// a fast flick or trackpad inertia glides past several stops. So on the live landing a wheel or
// touch gesture becomes ±1 section, the page glides to that section's stop, and it holds there
// (`DWELL_MS`) before another gesture can move it. The native scroll position stays the truth —
// the glide is ordinary `window.scrollTo` steps, the slide on stage is read from `scrollY`
// (sections.ts `stepAt`), so anchors, the back button and the scrollbar still work; a scroll that
// ends between two stops (scrollbar drag, resize, history) settles on the nearest one.
// Plain functions with the clock and the page passed in — testable without a browser.
import { stepAt } from './sections';

/** How long the page holds at a section after arriving, before a new gesture can move it (ms). */
export const DWELL_MS = 700;
/** The glide from one stop to the next (ms) — calm, a little longer for a jump of several. */
export const GLIDE_MS = 620;
export const GLIDE_MAX_MS = 1000;
/** Wheel events closer together than this are one gesture (a trackpad's inertia tail included). */
export const GESTURE_GAP_MS = 180;
/** Scroll distance (px) a gesture has to gather before it counts — ignores a resting finger's jitter. */
export const WHEEL_THRESHOLD = 24;
/** A new flick on top of an old one's inertia: the deltas rise again, by this factor and size. */
export const RISE_FACTOR = 1.6;
export const RISE_MIN = 28;
/** A swipe this long (px) is a step. */
export const SWIPE_PX = 40;
/** A scroll that stops off a stop settles this long after its last event (ms). */
export const SETTLE_MS = 160;

export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * One wheel gesture → at most one step. Events less than `GESTURE_GAP_MS` apart belong to the same
 * gesture; once a gesture has made its step (or arrived while the page was busy) the rest of it —
 * the inertia tail — is spent, unless the deltas rise sharply again (a second flick).
 */
export class WheelGesture {
  private last = -Infinity;
  private acc = 0;
  private prev = 0;
  private peak = 0;
  /** The gesture's deltas have started to fall — its inertia tail; only then can a rise be a new flick. */
  private decaying = false;
  private spent = false;

  private fresh(mag: number) {
    this.acc = 0;
    this.spent = false;
    this.peak = mag;
    this.decaying = false;
  }

  /** `busy` = the page is gliding or holding. Returns the step this event makes: -1, 0 or 1. */
  feed(dy: number, now: number, busy: boolean): -1 | 0 | 1 {
    const mag = Math.abs(dy);
    if (now - this.last > GESTURE_GAP_MS) this.fresh(mag);
    else if (this.spent && this.decaying && mag >= RISE_MIN && mag > this.prev * RISE_FACTOR) this.fresh(mag);
    this.peak = Math.max(this.peak, mag);
    if (mag < this.peak * 0.7) this.decaying = true;
    this.last = now;
    this.prev = mag;
    if (busy) {
      this.spent = true;
      return 0;
    }
    if (this.spent) return 0;
    this.acc += dy;
    if (Math.abs(this.acc) < WHEEL_THRESHOLD) return 0;
    this.spent = true;
    return this.acc > 0 ? 1 : -1;
  }
}

export interface StepperEnv {
  now(): number;
  scrollY(): number;
  /** Jump the page (no smooth behaviour — the stepper animates). */
  scrollTo(y: number): void;
  frame(cb: () => void): number;
  cancel(id: number): void;
  /** Offsets of the section stops from the top of the page, ascending. */
  stops(): number[];
  /** A modal holds the page (components/scrollLock.ts): input goes to the modal, not here. */
  locked(): boolean;
  onLog?: (line: string) => void;
}

export type StepInput = 'wheel' | 'touch' | 'key' | 'link' | 'settle' | 'focus';

export class Stepper {
  private wheelGesture = new WheelGesture();
  private touchFrom: number | null = null;
  private touchSpent = false;
  private glideId = 0;
  private target = -1;
  /** Input from a gesture is ignored until then (glide + dwell). */
  busyUntil = 0;

  constructor(private env: StepperEnv) {}

  /** The section the page is on — or is gliding to. */
  current(): number {
    return this.target >= 0 ? this.target : stepAt(this.env.scrollY(), this.env.stops());
  }

  gliding(): boolean {
    return this.target >= 0;
  }

  busy(): boolean {
    return this.gliding() || this.env.now() < this.busyUntil;
  }

  /**
   * The page goes on past the last stop (the site footer, 2026-11-14): a gesture down while resting
   * on the last stop, or any gesture down below it, is the browser's own scroll (`native`); a
   * gesture up from below the last stop glides back to it (`back`). Null = an ordinary step.
   */
  private tail(dy: number): 'native' | 'back' | null {
    const stops = this.env.stops();
    if (!stops.length || dy === 0) return null;
    const last = stops[stops.length - 1];
    const y = this.env.scrollY();
    if (y > last + 2) return dy > 0 ? 'native' : 'back';
    if (dy > 0 && !this.busy() && Math.abs(y - last) <= 2) return 'native';
    return null;
  }

  /** A wheel event (pixels, + = down). Returns whether the page should not scroll natively. */
  wheel(dy: number): boolean {
    if (this.env.locked()) return false;
    const tail = this.tail(dy);
    if (tail === 'native') return false;
    if (tail === 'back') {
      if (!this.busy()) this.go(this.env.stops().length - 1, 'wheel');
      return true;
    }
    const d = this.wheelGesture.feed(dy, this.env.now(), this.busy());
    if (d) this.step(d, 'wheel');
    return true;
  }

  touchStart(y: number) {
    this.touchFrom = y;
    this.touchSpent = false;
  }

  /** Returns whether the move should be held from native scroll. */
  touchMove(y: number): boolean {
    if (this.env.locked() || this.touchFrom === null) return false;
    const dy = this.touchFrom - y;
    const tail = this.tail(dy);
    if (tail === 'native') return false;
    if (!this.touchSpent && Math.abs(dy) >= SWIPE_PX) {
      this.touchSpent = true;
      if (!this.busy()) {
        if (tail === 'back') this.go(this.env.stops().length - 1, 'touch');
        else this.step(dy > 0 ? 1 : -1, 'touch');
      }
    }
    return true;
  }

  touchEnd() {
    this.touchFrom = null;
  }

  /** ±1 from where the page is (or is going). */
  step(d: number, input: StepInput) {
    this.go(this.current() + d, input);
  }

  /**
   * To section `i`. Gestures (wheel · touch) hold for the dwell afterwards; the keyboard and the
   * progress links retarget at once — someone pressing PageDown twice means two sections.
   */
  go(i: number, input: StepInput) {
    const stops = this.env.stops();
    if (!stops.length) return;
    const to = Math.max(0, Math.min(stops.length - 1, i));
    const from = this.env.scrollY();
    if (to === this.current() && Math.abs(stops[to] - from) < 1) return;
    this.env.onLog?.(`${Math.round(this.env.now())}ms ${input} -> section ${to + 1}`);
    this.glide(from, stops[to], to, input === 'wheel' || input === 'touch' || input === 'settle');
  }

  private glide(from: number, to: number, index: number, dwell: boolean) {
    this.env.cancel(this.glideId);
    const steps = Math.max(1, Math.round(Math.abs(to - from) / Math.max(1, (this.env.stops()[1] ?? 1) - (this.env.stops()[0] ?? 0))));
    const duration = Math.min(GLIDE_MAX_MS, GLIDE_MS * Math.sqrt(steps));
    const start = this.env.now();
    this.target = index;
    this.busyUntil = dwell ? start + duration + DWELL_MS : start + duration;
    const tick = () => {
      const t = Math.min(1, (this.env.now() - start) / duration);
      this.env.scrollTo(from + (to - from) * easeInOut(t));
      if (t < 1) this.glideId = this.env.frame(tick);
      else {
        this.target = -1;
        this.busyUntil = dwell ? this.env.now() + DWELL_MS : this.env.now();
      }
    };
    tick();
  }

  /** After a native scroll stopped (no glide running): if it rests between two stops, settle on the nearest. */
  settle() {
    if (this.gliding() || this.env.locked()) return;
    const stops = this.env.stops();
    const y = this.env.scrollY();
    // below the last stop is the footer — the page rests there as the browser left it
    if (!stops.length || y > stops[stops.length - 1] + 2) return;
    const near = stepAt(y, stops);
    if (Math.abs(stops[near] - y) > 2) this.go(near, 'settle');
  }

  stop() {
    this.env.cancel(this.glideId);
    this.target = -1;
  }
}

/** Keys the landing steps with, and where they go (null = not ours). */
export function keyStep(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>, current: number, last: number): number | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case 'PageDown':
    case 'ArrowDown':
      return current + 1;
    case 'PageUp':
    case 'ArrowUp':
      return current - 1;
    case ' ':
    case 'Spacebar':
      return e.shiftKey ? current - 1 : current + 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/** Typing, choosing or reading inside these keeps its own keys. */
export function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[role="dialog"], [role="alertdialog"]')) return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return !!target.closest('input, textarea, select, [role="listbox"], [role="list"][tabindex], [role="slider"]');
}

/** A wheel event's delta in pixels (Firefox may report lines or pages). */
export function wheelPixels(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, page: number): number {
  if (e.deltaMode === 1) return e.deltaY * 16;
  if (e.deltaMode === 2) return e.deltaY * page;
  return e.deltaY;
}
