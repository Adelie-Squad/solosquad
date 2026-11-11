// What the landing penguin does with each section's content (DESIGN.md `## 랜딩` — 연기). The HTML
// act (Acts.tsx) and the 3D penguin (MascotCanvas) play the same timelines from these numbers: the
// HTML starts a timeline and writes its start time here (`cues`), the canvas reads it every frame.
// No three.js here — the curves are plain functions, so the timing is testable.
//
// Calm on purpose (user, 2026-11-09: "캐릭터가 너무 빠르게 움직이지 않도록 · 몸이 덜덜 떨리고 손이 너무 빠르게
// 움직이고 프롬프트 창이 흔들리는거 안 그러도록"): every curve is smooth (no per-frame noise), the
// content never moves with the penguin (no nudge, no shake), the only repeating motion is the
// typing patter (staging.ts `STROKE_RATE`, 3–4 strokes a second).
import { MOVE_MS } from './staging';
import type { ActId } from './sections';

/** Start times (`performance.now()` ms) of the timelines that are playing — one landing per page. */
export const cues = {
  /** The prompt box is typing (the wings patter) — eased in and out by the canvas. */
  typing: false,
  /** The wing pointing at the price card, from `relayAt`. */
  relayAt: -Infinity,
  /** The stamp: raise · strike · lift, from `stampAt`. */
  stampAt: -Infinity,
  /** The scroll: the paper starts to unroll at `unrollAt`. */
  unrollAt: -Infinity,
  /** The wave on the company card and the last card, from `waveAt`. */
  waveAt: -Infinity,
};

export const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

export function resetCues() {
  cues.typing = false;
  cues.relayAt = -Infinity;
  cues.stampAt = -Infinity;
  cues.unrollAt = -Infinity;
  cues.waveAt = -Infinity;
}

/**
 * The clip under the wings in every act: `idle` (a slow breath). The office's `typing` clip is not
 * used here — it bobs the body six times a second and flaps the wings, made for a desk-sized
 * penguin; at landing size it read as trembling (the 2026-11-09 "덜덜 떨림").
 */
export const ACT_CLIP = {
  wave: 'idle',
  type: 'idle',
  unroll: 'idle',
  stamp: 'idle',
  point: 'idle',
} as const satisfies Record<ActId, string>;

/** How long after a slide comes in its act starts (ms) — after the penguin has walked over. */
export const ACT_DELAY_MS = MOVE_MS + 120;

/** The wings glide between marks at this rate (1/s) and come in and out at that one. */
export const WING_GLIDE = 6;
export const WING_WEIGHT_RATE = 4;

// ── point: the wing out to a price card ────────────────────────────────

/** The wing reaches card 1, then the cards light up in turn (ms from `relayAt`). */
export const RELAY = {
  /** the wing reaches card 1 */
  reach: 650,
  /** a card stays lit this long before the request moves on */
  step: 1100,
  /** the wing goes back to rest after handing over */
  release: 600,
} as const;
export const RELAY_STEPS = 3;

/** -1 = not started, 0 … 2 = that card is lit (the ones before it done), 3 = all done. */
export function relayAt(ms: number): number {
  if (ms < RELAY.reach) return -1;
  return Math.min(RELAY_STEPS, Math.floor((ms - RELAY.reach) / RELAY.step));
}

/** The handing wing: out to card 1, a beat there, back to rest (0 … 1). */
export function relayHand(ms: number): number {
  if (ms < 0) return 0;
  if (ms < RELAY.reach) return easeInOut(ms / RELAY.reach);
  const back = ms - RELAY.reach - 350;
  if (back < 0) return 1;
  return 1 - easeInOut(back / RELAY.release);
}

// ── unroll: the scroll ──────────────────────────────────────────

/** The paper comes down over this long (landing.css `--unroll` transition), a small settle at the end. */
export const UNROLL_MS = 1600;
/** The wing on the rod's knob gives it a small tug as the paper lets go (fraction of the height). */
export const TUG = 0.02;
export function tugAt(ms: number): number {
  if (ms < 0 || ms > 700) return 0;
  return Math.sin((ms / 700) * Math.PI) * TUG;
}

// ── stamp: the owner's approval ────────────────────────────────────────────────

export const STAMP = {
  /** lift the stamp up, past where it will strike from (anticipation) */
  raise: 620,
  /** a held breath at the top */
  cock: 280,
  /** down — decisive, accelerating, but not a blur */
  strike: 150,
  /** on the card */
  hold: 240,
  /** back up to rest, a small overshoot */
  lift: 620,
} as const;

/** The moment the stamp meets the card (ms from the start). */
export const STAMP_IMPACT_MS = STAMP.raise + STAMP.cock + STAMP.strike;
/** The card shows approved a beat after the hit. */
export const STAMP_APPROVED_MS = STAMP_IMPACT_MS + 260;
export const STAMP_TOTAL_MS = STAMP_IMPACT_MS + STAMP.hold + STAMP.lift;

/**
 * The stamp's height above the button (world units of the penguin, ≈ 0.78 tall): resting while
 * held, higher at the top of the raise, 0 on the card.
 */
export const STAMP_REST = 0.085;
export const STAMP_TOP = 0.13;

export function stampLift(ms: number): number {
  if (ms < 0) return STAMP_REST;
  let t = ms;
  if (t < STAMP.raise) return lerp(STAMP_REST, STAMP_TOP, easeOutBack(t / STAMP.raise, 1.1));
  t -= STAMP.raise;
  if (t < STAMP.cock) return STAMP_TOP;
  t -= STAMP.cock;
  if (t < STAMP.strike) return lerp(STAMP_TOP, 0, easeIn(t / STAMP.strike));
  t -= STAMP.strike;
  if (t < STAMP.hold) return 0;
  t -= STAMP.hold;
  if (t < STAMP.lift) return lerp(0, STAMP_REST, easeOutBack(t / STAMP.lift, 1.2));
  return STAMP_REST;
}

/**
 * At rest the stamp is held off to the side of the button (1), towards the penguin, so it does not
 * sit on the card's words; it comes over the button while rising (0) and goes back as it lifts.
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
  if (ms < STAMP.raise + STAMP.cock) return -0.22 * easeOut(Math.min(1, ms / STAMP.raise));
  if (ms < STAMP_IMPACT_MS) return -0.22 * (1 - easeIn((ms - STAMP.raise - STAMP.cock) / STAMP.strike));
  return 0;
}

/** The squash at the hit — subtle (4 %), volume kept; the only body deformation on the page. */
export const SQUASH = 0.04;
export function squashAt(ms: number): number {
  const t = ms - STAMP_IMPACT_MS;
  if (t < 0 || t > 320) return 1;
  if (t < 90) return 1 - SQUASH * easeOut(t / 90);
  return 1 - SQUASH * (1 - easeInOut((t - 90) / 230));
}

/** What the card shows `ms` into the stamp. */
export type StampState = 'waiting' | 'pressed' | 'approved';
export function stampState(ms: number): StampState {
  if (ms < STAMP_IMPACT_MS) return 'waiting';
  if (ms < STAMP_APPROVED_MS) return 'pressed';
  return 'approved';
}

// ── wave ───────────────────────────────────────────────────────────

/** Two and a half slow waves, then the wing settles (the rate is well under the typing limit). */
export const WAVE_HZ = 1.2;
export const WAVE_MS = 2100;
/** How far the waving wing swings sideways (fraction of the height). */
export const WAVE_SWING = 0.06;

/** The waving wing's swing (-1 … 1) and how raised it is (0 … 1), `ms` from `waveAt`. */
export function waveAt(ms: number): { swing: number; raise: number } {
  if (ms < 0) return { swing: 0, raise: 0 };
  const raise = ms < 400 ? easeInOut(ms / 400) : ms < WAVE_MS ? 1 : 1 - easeInOut((ms - WAVE_MS) / 500);
  const env = ms < WAVE_MS ? Math.min(1, ms / 400) : 0;
  return { swing: Math.sin((ms / 1000) * WAVE_HZ * 2 * Math.PI) * env, raise: Math.max(0, raise) };
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
