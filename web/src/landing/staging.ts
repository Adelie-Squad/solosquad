// Where the landing penguin stands in each section and how it gets there (DESIGN.md `## 랜딩` —
// 자리). The content of a section is centred in its scene; the penguin moves to a spot picked from
// that content's rectangle, one per act (sections.ts `ActId`): above the prompt box (type — 맡기기),
// beside the price cards (point — 가격), peeking over the paper's upper-left corner (unroll — 조직도),
// just outside the workflow card's lower-left corner (stamp — 워크플로우), popping up behind the
// card's upper-right (wave — the company card at the start and the last card). Plain numbers, no
// three.js and no DOM, so every spot, the move between them and the motion limits are testable.
import type { ActId } from './sections';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The penguin on the page: `x` · `y` = the point between its feet (client px), `h` = its height
 * (px), `lean` = a sideways tilt about the feet (rad, + = the head goes to the reader's left),
 * `turn` = the body turned (rad, + = towards the reader's right).
 */
export interface Spot {
  x: number;
  y: number;
  h: number;
  lean: number;
  turn: number;
}

/**
 * Where things are on the penguin, as fractions of its height from the top of its head (measured
 * on penguin.glb in the landing frame): the eyes, the shoulders (wing roots), the beak, and half
 * its width with the wings. `shoulderX` = how far a shoulder is from the middle, sideways (facing
 * the reader); `face` = half the face's width and how far the face sits in front of the body's
 * axis (a turn moves it sideways by `face.depth · sin(turn)`).
 */
export const BODY = { eyes: 0.3, shoulder: 0.4, beak: 0.385, halfWidth: 0.34, shoulderX: 0.27, face: { half: 0.15, depth: 0.25 } } as const;

/** Where the middle of the face is on screen for a body turned by `turn` (+ = towards the reader's right). */
export const faceX = (x: number, h: number, turn: number) => x + BODY.face.depth * Math.sin(turn) * h;

/** How far past the content's side edge a near shoulder stands (fraction of the height) — for the near-wing stamp. */
export const SHOULDER_CLEAR = 0.08;
/** From the content's side edge to the feet so that the near shoulder is `SHOULDER_CLEAR` outside it. */
export const besideEdge = (turn: number) => BODY.shoulderX * Math.cos(turn) + SHOULDER_CLEAR;

/** The penguin's height for a scene box — the same in every section of one screen. */
export function penguinHeight(scene: { width: number; height: number }, mobile: boolean): number {
  return mobile ? Math.min(scene.height * 0.36, scene.width * 0.46, 190) : Math.min(scene.height * 0.36, scene.width * 0.4, 320);
}

const right = (b: Box) => b.left + b.width;
const bottom = (b: Box) => b.top + b.height;
const cx = (b: Box) => b.left + b.width / 2;

/**
 * The spot for an act, from the section's centred content box `c` and the penguin's height `h`.
 * - type: centred over the prompt box, shoulders just above its top edge (the wings rest on it),
 *   the feet hidden behind it.
 * - point: desktop = standing beside the price cards' right edge, shoulders level with their top,
 *   turned to them; the body turns further to act (arms.ts `actYaw`) and the far (left — the
 *   reader's right) wing comes down round in front of the belly — below the face — to card 1's
 *   lower right; phone = over the cards' upper right.
 * - unroll: behind the paper's upper-left corner, leaning out to the left so the face peeks over the
 *   rod; the body stays behind the paper.
 * - stamp: just outside the workflow card's lower-left corner, turned to the card, the near (left — the
 *   reader's right) shoulder outside the card's left edge so that wing comes round it with the stamp
 *   to the approve button (arms.ts `ARM_CHOICE`; a phone: a smaller penguin).
 * - wave: behind the card's upper right, head and shoulders above its top edge.
 */
export function spotFor(id: ActId, c: Box, h: number, mobile: boolean): Spot {
  switch (id) {
    case 'type':
      return { x: cx(c), y: c.top + (1 - BODY.shoulder - 0.1) * h, h, lean: 0, turn: 0 };
    case 'point':
      return mobile ? { x: right(c) - 0.42 * h, y: c.top + 0.52 * h, h, lean: 0, turn: -0.15 } : { x: right(c) + 0.24 * h, y: c.top + 0.6 * h, h, lean: 0, turn: -0.18 };
    case 'unroll':
      return { x: c.left + (mobile ? 0.38 : 0.3) * h, y: c.top + 0.54 * h, h, lean: 0.32, turn: -0.1 };
    case 'stamp':
      if (mobile) {
        // a phone has no room at the card's side for a full-size penguin: a smaller one, and the card
        // sits to the right of the middle (landing.css) so the two of them are centred together
        const s = 0.8 * h;
        return { x: c.left - besideEdge(0.5) * s, y: bottom(c) + 0.3 * s, h: s, lean: 0, turn: 0.5 };
      }
      return { x: c.left - besideEdge(0.5) * h, y: bottom(c) + 0.34 * h, h, lean: 0, turn: 0.5 };
    case 'wave':
      return { x: right(c) - (mobile ? 0.42 : 0.24) * h, y: c.top + 0.5 * h, h, lean: mobile ? 0 : -0.05, turn: -0.12 };
  }
}

/** How far a block's centre is from its area's centre (px) — 0, 0 = centred. */
export function centreOffset(block: Box, area: Box): { x: number; y: number } {
  return { x: block.left + block.width / 2 - (area.left + area.width / 2), y: block.top + block.height / 2 - (area.top + area.height / 2) };
}

/** Where the head is (client px) — the gaze is measured from here. */
export function headOf(s: Spot): { x: number; y: number } {
  const up = (1 - BODY.eyes) * s.h;
  return { x: s.x - Math.sin(s.lean) * up, y: s.y - Math.cos(s.lean) * up };
}

// ── the move between sections ──────────────────────────────────────────

/** The move from one spot to the next (ms) — eased, about as long as the page's glide (dwell.ts GLIDE_MS). */
export const MOVE_MS = 720;
/** A small hop over the way (fraction of the height) and a lean into the direction of travel (rad). */
export const MOVE_ARC = 0.05;
export const MOVE_LEAN = 0.07;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Smooth start, smooth stop (no jerk at either end). */
export const easeInOutCubic = (x: number) => {
  const v = clamp01(x);
  return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2;
};

/** The penguin `ms` into a move from `from` to `to` (both may keep changing — read them each frame). */
export function moveAt(from: Spot, to: Spot, ms: number): Spot {
  if (ms >= MOVE_MS) return to;
  const p = clamp01(ms / MOVE_MS);
  const e = easeInOutCubic(p);
  const bump = Math.sin(p * Math.PI);
  const lerp = (a: number, b: number) => a + (b - a) * e;
  const h = lerp(from.h, to.h);
  const dir = Math.sign(to.x - from.x);
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y) - MOVE_ARC * h * bump,
    h,
    lean: lerp(from.lean, to.lean) - dir * MOVE_LEAN * bump,
    turn: lerp(from.turn, to.turn),
  };
}

// ── type: pretending to type ───────────────────────────────────────────

/**
 * Key strokes per second, both wings together (they alternate). Not one per character — a steady,
 * small, slightly quick patter above the keys. The limit is 3–4 (DESIGN.md `## 랜딩` 모션 한도).
 */
export const STROKE_RATE = 3.5;
export const STROKE_LIMITS = { min: 3, max: 4 } as const;
/** How deep a stroke goes (fraction of the penguin's height) and how far the wing lifts between strokes. */
export const STROKE_DEPTH = 0.03;
export const STROKE_LIFT = 0.012;

/**
 * One wing's stroke at `seconds`: 0 (up) … 1 (down on the key), smooth (sin²), the two wings half a
 * cycle apart — so strokes fall at `STROKE_RATE` per second in all, alternating.
 */
export function strokeAt(seconds: number, side: 'L' | 'R'): number {
  const phase = seconds * (STROKE_RATE / 2) * 2 * Math.PI + (side === 'L' ? Math.PI : 0);
  const s = Math.sin(phase);
  return s > 0 ? s * s : 0;
}
