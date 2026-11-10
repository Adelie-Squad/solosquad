// The landing penguin's entrance (DESIGN.md `## 랜딩` — 첫 등장). User, 2026-11-10: "로딩할 때 3d 펭귄 몸통이
// 3d 구 형태에서 바운스되면서 늘어나면서 몸통이 되도록". When the 3D penguin first draws, its body is a clay
// ball that drops in, squashes on contact, stretches up and settles into the penguin; the face, beak,
// wings and feet grow out of the ball while it stretches. Once per page load; reduced motion never
// sees it (that page is the stacked 2D one, and the canvas skips it too).
//
// Plain numbers, no three.js: the canvas (morph.ts) turns `introAt` into a vertex blend (each
// vertex from a sphere round the body's centre to its place) and a squash/stretch of the root.

/** The beats (ms from the first frame). Total 1150 — inside the asked 0.9–1.3 s. */
export const INTRO = {
  /** the ball drops in from above (gravity: easing in), popping from nothing to full size on the way */
  fall: 340,
  /** it lands and squashes (~15 %) — the anticipation of the stretch */
  squash: 120,
  /** it springs up past its height (stretch) while turning into the penguin */
  stretch: 240,
  /** a small overshoot back under */
  recoil: 180,
  /** and settles */
  settle: 270,
} as const;
export const INTRO_MS = INTRO.fall + INTRO.squash + INTRO.stretch + INTRO.recoil + INTRO.settle;

/** How flat the ball gets on contact, how far past its height it stretches, how far it dips back. */
export const SQUASH_MAX = 0.15;
export const STRETCH_MAX = 0.14;
export const RECOIL = 0.04;
/** How high above its resting place the ball comes in from (fraction of the penguin's height). */
export const DROP = 0.3;

export interface IntroPose {
  /** 0 = a ball, 1 = the penguin's own shape (the body). */
  morph: number;
  /** The same for the face, beak, wings and feet — later, so they grow out of the ball. */
  parts: number;
  /** Vertical scale of the whole penguin about the ball's contact point (volume kept: sideways = 1/√sy). */
  sy: number;
  /** Overall size — 0 → 1 as the ball pops in. */
  size: number;
  /** Height above the resting place (fraction of the penguin's height). */
  lift: number;
  done: boolean;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeIn = (x: number) => clamp01(x) ** 2;
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 2;
const easeInOut = (x: number) => {
  const v = clamp01(x);
  return v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2;
};
const smooth = (a: number, b: number, x: number) => {
  const v = clamp01((x - a) / (b - a));
  return v * v * (3 - 2 * v);
};

export const REST: IntroPose = { morph: 1, parts: 1, sy: 1, size: 1, lift: 0, done: true };

/** The entrance `ms` after the first frame. */
export function introAt(ms: number): IntroPose {
  if (ms >= INTRO_MS) return REST;
  const t = Math.max(0, ms);
  const a = INTRO.fall;
  const b = a + INTRO.squash;
  const c = b + INTRO.stretch;
  const d = c + INTRO.recoil;
  let sy = 1;
  if (t < a) sy = 1 + 0.05 * easeIn(t / a); // a falling ball draws out a little
  else if (t < b) sy = 1.05 - (0.05 + SQUASH_MAX) * easeOut((t - a) / INTRO.squash);
  else if (t < c) sy = 1 - SQUASH_MAX + (SQUASH_MAX + STRETCH_MAX) * easeOut((t - b) / INTRO.stretch);
  else if (t < d) sy = 1 + STRETCH_MAX - (STRETCH_MAX + RECOIL) * easeInOut((t - c) / INTRO.recoil);
  else sy = 1 - RECOIL + RECOIL * easeInOut((t - d) / INTRO.settle);
  // the ball turns into the body from the push-off to the top of the recoil; the parts follow
  const morph = smooth(b - 20, d, t);
  const parts = smooth(b + 160, d + 40, t);
  const size = easeOut(t / 180);
  const lift = t < a ? DROP * (1 - easeIn(t / a)) : 0;
  return { morph, parts, sy, size, lift, done: false };
}

let played = false;

/**
 * Should the entrance play now? Once per page load — a remount (StrictMode, a theme change, coming
 * back from the stacked page) shows the penguin as it is. Never under reduced motion.
 */
export function claimIntro(reduced: boolean): boolean {
  if (reduced || played) return false;
  played = true;
  return true;
}

/** For tests: forget that it played. */
export function resetIntro() {
  played = false;
}
