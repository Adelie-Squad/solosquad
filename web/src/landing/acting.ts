// What the landing penguin does with each section's content (DESIGN.md `## 랜딩` — 연기). The HTML
// act (Acts.tsx) and the 3D penguin (MascotCanvas) play the same timelines from these numbers: the
// HTML starts a timeline and writes its start time here (`cues`), the canvas reads it every frame.
// No three.js here — the curves are plain functions, so the timing is testable.
import type { SectionId } from './sections';

/** Start times (`performance.now()` ms) of the timelines that are playing — one landing per page. */
export const cues = {
  /** The last key tap in the prompt box, and which wing makes it. */
  tapAt: -Infinity,
  tapSide: 'R' as 'L' | 'R',
  /** The step board: the first card flips at `flipAt`, the next ones `FLIP_STEP_MS` apart. */
  flipAt: -Infinity,
  /** The stamp: raise · strike · lift, from `stampAt`. */
  stampAt: -Infinity,
  /** The scroll: the paper starts to unroll at `unrollAt`. */
  unrollAt: -Infinity,
};

export const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

export function resetCues() {
  cues.tapAt = -Infinity;
  cues.flipAt = -Infinity;
  cues.stampAt = -Infinity;
  cues.unrollAt = -Infinity;
}

/** The clip each act plays under the wings (the wings themselves follow the content). */
export const ACT_CLIP = {
  hero: 'typing',
  what: 'idle',
  team: 'idle',
  control: 'idle',
  start: 'idle',
} as const satisfies Record<SectionId, string>;

/** How long after a slide comes in its act starts (ms) — after the slide has faded in. */
export const ACT_DELAY_MS = 520;

// ── hero: typing on the prompt box ─────────────────────────────────────

/** One key tap: down quickly, back up a little slower (ms). */
export const TAP_MS = 150;

/** 0 → 1 → 0 over a tap; peaks at 35 % (the wing is down on the box). */
export function tapPulse(ms: number): number {
  if (ms < 0 || ms >= TAP_MS) return 0;
  const x = ms / TAP_MS;
  return x < 0.35 ? easeOut(x / 0.35) : 1 - easeInOut((x - 0.35) / 0.65);
}

// ── what: flipping the three step cards ─────────────────────────────────

export const FLIP_STEP_MS = 520;
export const FLIP_MS = 460;
/** The flipping wing's lift: up before the card turns, down as it lands (0 … 1). */
export function flipLift(ms: number): number {
  if (ms < -180 || ms > FLIP_MS) return 0;
  if (ms < 0) return easeOut((ms + 180) / 180);
  return 1 - easeInOut(ms / FLIP_MS);
}

// ── team: unrolling the scroll ──────────────────────────────────────────

/** The paper comes down over this long (landing.css `--unroll` transition), a small settle at the end. */
export const UNROLL_MS = 1250;

// ── control: the stamp ─────────────────────────────────────────────────

export const STAMP = {
  /** lift the stamp up, past where it will strike from (anticipation) */
  raise: 460,
  /** a held breath at the top */
  cock: 220,
  /** down — fast, accelerating */
  strike: 110,
  /** on the card */
  hold: 170,
  /** back up to rest, a small overshoot */
  lift: 480,
} as const;

/** The moment the stamp meets the card (ms from the start). */
export const STAMP_IMPACT_MS = STAMP.raise + STAMP.cock + STAMP.strike;
/** The card shows approved a beat after the hit. */
export const STAMP_APPROVED_MS = STAMP_IMPACT_MS + 240;
export const STAMP_TOTAL_MS = STAMP_IMPACT_MS + STAMP.hold + STAMP.lift;
/** The card shakes this long from the hit. */
export const SHAKE_MS = 260;

/**
 * The stamp's height above the button (world units of the penguin, ≈ 0.78 tall): resting while
 * held, higher at the top of the raise, 0 on the card.
 */
export const STAMP_REST = 0.085;
export const STAMP_TOP = 0.16;

export function stampLift(ms: number): number {
  if (ms < 0) return STAMP_REST;
  let t = ms;
  if (t < STAMP.raise) return lerp(STAMP_REST, STAMP_TOP, easeOutBack(t / STAMP.raise, 1.2));
  t -= STAMP.raise;
  if (t < STAMP.cock) return STAMP_TOP + Math.sin((t / STAMP.cock) * Math.PI) * 0.006;
  t -= STAMP.cock;
  if (t < STAMP.strike) return lerp(STAMP_TOP, 0, easeIn(t / STAMP.strike));
  t -= STAMP.strike;
  if (t < STAMP.hold) return 0;
  t -= STAMP.hold;
  if (t < STAMP.lift) return lerp(0, STAMP_REST, easeOutBack(t / STAMP.lift, 1.4));
  return STAMP_REST;
}

/**
 * At rest the stamp is held off to the side of the button (1), so it does not sit on the card's
 * words; it comes over the button while rising (0) and goes back aside as it lifts.
 */
export function stampAside(ms: number): number {
  if (ms < 0 || ms >= STAMP_TOTAL_MS) return 1;
  if (ms < STAMP.raise) return 1 - easeInOut(ms / STAMP.raise);
  if (ms < STAMP_IMPACT_MS + STAMP.hold) return 0;
  return easeInOut((ms - STAMP_IMPACT_MS - STAMP.hold) / STAMP.lift);
}

/** The stamp leans back as it rises and straightens for the strike (rad). */
export function stampTilt(ms: number): number {
  if (ms < 0 || ms > STAMP_TOTAL_MS) return 0;
  if (ms < STAMP.raise + STAMP.cock) return -0.28 * easeOut(Math.min(1, ms / STAMP.raise));
  if (ms < STAMP_IMPACT_MS) return -0.28 * (1 - easeIn((ms - STAMP.raise - STAMP.cock) / STAMP.strike));
  return 0;
}

/** The penguin's body at the hit: squashed down and out, then a small rebound (scale Y; X·Z keep the volume). */
export function squashAt(ms: number): number {
  const t = ms - STAMP_IMPACT_MS;
  if (t < 0 || t > 260) return 1;
  if (t < 70) return 1 - 0.07 * easeOut(t / 70);
  if (t < 170) return 0.93 + 0.1 * easeInOut((t - 70) / 100);
  return 1.03 - 0.03 * easeInOut((t - 170) / 90);
}

/** What the card shows `ms` into the stamp. */
export type StampState = 'waiting' | 'pressed' | 'approved';
export function stampState(ms: number): StampState {
  if (ms < STAMP_IMPACT_MS) return 'waiting';
  if (ms < STAMP_APPROVED_MS) return 'pressed';
  return 'approved';
}

// ── easing ──────────────────────────────────────────────────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 2;
export const easeIn = (x: number) => clamp01(x) ** 3;
export const easeInOut = (x: number) => {
  const v = clamp01(x);
  return v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2;
};
/** Overshoots past 1 and comes back — `s` is how far. */
export const easeOutBack = (x: number, s = 1.70158) => {
  const v = clamp01(x) - 1;
  return 1 + (s + 1) * v * v * v + s * v * v;
};
