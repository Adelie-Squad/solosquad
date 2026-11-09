// Which wing acts on a section's content, how the body turns for it, the path the wing takes to get
// there, and when it may be drawn in front of the content (DESIGN.md `## 랜딩` — 먼 쪽 날개 · 가장자리를
// 돌아서). User, 2026-11-10: "펭귄의 팔이 인포그래픽 요소를 뚫고 나오거든 … 펭귄 팔이 요소의 앞으로 돌아서
// 액션하도록 · 타이핑할 때도 요소 뒤에서 손이 위로 올라와서 앞으로 건너오는 식으로", then the same day: "펭귄
// 팔은 내용이랑 먼 쪽의 팔을 써야 하지 않을까? 몸이 돌아나오면서."
//
// - The acting wing is the one AWAY from the content (from the screen-space relation of the
//   content to the penguin, never a fixed side): content on the reader's left → the penguin's left
//   wing (L — the penguin faces the reader, so its left wing is on the reader's right), content on
//   the reader's right → its right wing (R). The body turns towards the content (`actYaw`) so that
//   wing swings round in front of the body to act. The near wing stays tucked at the side, behind
//   the content's hidden zone, and is never drawn over the content.
// - The acting wing goes rest → `via` (just outside the content's edge, on the shoulder's side) →
//   the target. It is drawn in front only once the whole wing (shoulder → tip, on screen) is clear
//   of the content rectangle — so at the moment the pass changes nothing of the wing is over the
//   content and no segment ever seems to come through the card. Going back, it returns behind
//   once it is clear again, outside the edge.
//
// Plain numbers, no three.js and no DOM, so the choice and the switch are testable.
import type { SectionId } from './sections';

export type Side = 'L' | 'R';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The wing on the target's side: the penguin's right wing (R) is on the reader's left. */
export function nearWing(penguinX: number, targetX: number): Side {
  return targetX < penguinX ? 'R' : 'L';
}

export const otherWing = (s: Side): Side => (s === 'L' ? 'R' : 'L');

/** The wing away from the content — the one that acts (the body turns so it comes round in front). */
export function farWing(penguinX: number, contentCentreX: number): Side {
  return otherWing(nearWing(penguinX, contentCentreX));
}

/**
 * Which wing acts where the penguin is beside the content: the far one by default (user,
 * 2026-11-10). The approval card is the exception, measured in the browser: the stamp is held above
 * the button, and on this penguin (short flippers at face height on a wide body) the far wing would
 * have to stretch to ~1.7× its length and cross the eyes to get there from outside the corner — so
 * the near wing stamps, coming round the card's left edge from outside it (its shoulder stands
 * outside the edge, staging.ts). Re-check when the redesigned (taller) penguin lands.
 */
export const ARM_CHOICE = { what: 'far', team: 'far', control: 'near' } as const satisfies Partial<Record<SectionId, 'far' | 'near'>>;

/**
 * The wings that act in a section (and so the only ones that may come in front of its content).
 * - hero: both — the prompt box is in front of the penguin's middle; the hands come up from behind
 *   it, over the top edge, and type.
 * - what · team: the wing away from the content (the relay to card 1, the rod's knob); the near one
 *   stays tucked. control: the near wing (`ARM_CHOICE`); the far one stays at rest.
 * - start: both — the far (outside) wing waves, the near one rests on the top edge.
 * `wave` = which wing waves in `start`.
 */
export function actingWings(id: SectionId, penguinX: number, contentCentreX: number): { wings: Side[]; wave: Side | null } {
  switch (id) {
    case 'hero':
      return { wings: ['L', 'R'], wave: null };
    case 'start':
      return { wings: ['L', 'R'], wave: farWing(penguinX, contentCentreX) };
    default:
      return { wings: [ARM_CHOICE[id] === 'near' ? nearWing(penguinX, contentCentreX) : farWing(penguinX, contentCentreX)], wave: null };
  }
}

/**
 * The turn of the body towards the content while acting (rad, + = towards the reader's right),
 * on top of the spot's own turn, eased in with the acting. Enough for the far wing to come round in
 * front of the body, little enough that the face stays well in view (`MAX_TURN` in all). Only where
 * the far wing reaches across the body (the relay); none in the hero and the last card (the penguin
 * is behind the content, facing the reader), none on the scroll (the far wing is already on the
 * rod's side; turning would hide the peeking face) and none for the near-wing stamp.
 */
export const ACT_YAW = 0.5;
export const MAX_TURN = 0.72;
export function actYaw(id: SectionId, penguinX: number, contentCentreX: number): number {
  if (id !== 'what') return 0;
  return Math.sign(contentCentreX - penguinX) * ACT_YAW;
}

/** The body's whole turn: the spot's and the acting one, within natural limits (the face stays visible). */
export const bodyTurn = (spotTurn: number, act: number) => Math.max(-MAX_TURN, Math.min(MAX_TURN, spotTurn + act));

/**
 * How far a clay wing may stretch along its length to reach (1 = its own length). The far wing
 * reaches across the body, so it may need a little more than its own length; never more than this.
 */
export const MAX_STRETCH = 1.55;
export function stretchFor(distance: number, length: number): number {
  if (length <= 0) return 1;
  return Math.max(1, Math.min(MAX_STRETCH, (distance / length) * 1.02));
}

const inside = (p: Pt, r: Rect) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;

/** Is the point outside the rectangle (on its edge counts as outside)? */
export const outside = (p: Pt, r: Rect) => !inside(p, r);

/** Does the segment a → b touch the inside of the rectangle? (Liang–Barsky clip.) */
export function segmentHits(a: Pt, b: Pt, r: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - r.left],
    [dx, r.right - a.x],
    [-dy, a.y - r.top],
    [dy, r.bottom - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-9;
}

/** Do two rectangles overlap (touching edges do not)? — a held prop must be clear of the content too. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * The waypoint just outside the content's edge that the wing goes round: on the side the shoulder
 * is on (above the top edge for a penguin behind the content, beside the left or right edge for one
 * standing at its side), level with the target, `margin` px out. A shoulder inside the rectangle
 * takes the nearest edge.
 */
export function viaPoint(r: Rect, shoulder: Pt, to: Pt, margin: number): Pt {
  const clampX = (x: number) => Math.max(r.left - margin, Math.min(r.right + margin, x));
  const clampY = (y: number) => Math.max(r.top - margin, Math.min(r.bottom + margin, y));
  // outside: round the edge the shoulder is furthest beyond (beside the cards → their side edge,
  // behind and above them → the top edge)
  const out = [
    { d: r.top - shoulder.y, via: { x: clampX(to.x), y: r.top - margin } },
    { d: r.left - shoulder.x, via: { x: r.left - margin, y: clampY(to.y) } },
    { d: shoulder.x - r.right, via: { x: r.right + margin, y: clampY(to.y) } },
    { d: shoulder.y - r.bottom, via: { x: clampX(to.x), y: r.bottom + margin } },
  ].filter((e) => e.d >= 0);
  if (out.length) return out.reduce((a, b) => (b.d > a.d ? b : a)).via;
  const top = shoulder.y - r.top;
  const left = shoulder.x - r.left;
  const right = r.right - shoulder.x;
  const best = Math.min(top, left, right, r.bottom - shoulder.y);
  if (best === top) return { x: clampX(to.x), y: r.top - margin };
  if (best === left) return { x: r.left - margin, y: clampY(to.y) };
  if (best === right) return { x: r.right + margin, y: clampY(to.y) };
  return { x: clampX(to.x), y: r.bottom + margin };
}

export interface ArmPath {
  from: Pt;
  via: Pt;
  to: Pt;
}

/** How far out of the edge the wing goes round (fraction of the penguin's height). */
export const EDGE_MARGIN = 0.06;
/** The trip rest → round the edge → target (ms) — calm, like the walk. */
export const ARM_MS = 760;

const ease = (x: number) => {
  const v = Math.max(0, Math.min(1, x));
  return v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2;
};

/**
 * The wing tip `u` along its path (0 = at rest, 1 = on the target): the first half from rest out
 * to `via`, the second from `via` in to the target, each eased so it slows at the edge.
 */
export function pathAt(p: ArmPath, u: number): Pt {
  if (u <= 0.5) {
    const e = ease(u / 0.5);
    return { x: p.from.x + (p.via.x - p.from.x) * e, y: p.from.y + (p.via.y - p.from.y) * e };
  }
  const e = ease((u - 0.5) / 0.5);
  return { x: p.via.x + (p.to.x - p.via.x) * e, y: p.via.y + (p.to.y - p.via.y) * e };
}

/**
 * The wing's pass this frame: in front (true) or behind the content (false).
 * - `u` = how far along its path, `du` = which way it is going (+ out to the target, − back).
 * - `clear` = the whole wing (shoulder → tip, on screen) is off the content rectangle.
 * - `shoulderOut` = the shoulder itself is outside it — a wing rooted behind the content can never
 *   come in front of it.
 * On the way out it switches to front at the first clear frame and stays; on the way back it
 * switches behind at the first clear frame past the edge (`u` < 0.5). Never front at rest.
 */
export function nextFront(prev: boolean, u: number, du: number, clear: boolean, shoulderOut: boolean): boolean {
  if (u <= 0 || !shoulderOut) return false;
  if (du > 0) return prev || clear;
  if (du < 0) return prev && !(clear && u < 0.5);
  return prev;
}
