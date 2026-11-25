// Where the landing penguin looks (DESIGN.md `## 랜딩` — 시선). Plain numbers, no three.js, so the
// limits and the damping are testable. The eyes are part of the one body mesh (no eye bones) and the
// head bone would bend that mesh, so the look is shown by turning the whole penguin a little
// (`gazeTurn`, 2026-11-26), damped.

/** The cursor on the page, client px (the canvas measures it from the penguin's head). */
export interface Pointer {
  x: number;
  y: number;
}

/** A look request: -1 … 1 each way, measured from the head (left/up negative). */
export interface Aim {
  x: number;
  y: number;
}

export interface Look {
  /** Body turn (rad, + = towards screen right). */
  body: number;
  /** Head turn left/right on top of the body (rad). */
  yaw: number;
  /** Head nod (rad, + = looking down). */
  pitch: number;
}

/** Natural limits (rad): the head turns further than the body, and nods less than it turns. */
export const LIMITS = { body: 0.2, yaw: 0.55, pitch: 0.28 } as const;
/** Damping rate (1/s): about 0.45 s to settle — follows calmly, never snaps. */
export const DAMP = 5;
/** While the penguin acts, the cursor gets this share of the turn — the gaze never fights the acting. */
export const GAZE_ACTING = 0.55;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The look a pointer asks for: the head takes most of the turn, the body the rest. */
export function lookAt(p: Aim): Look {
  const x = clamp(p.x, -1, 1);
  const y = clamp(p.y, -1, 1);
  return { body: x * LIMITS.body, yaw: x * (LIMITS.yaw - LIMITS.body), pitch: y * LIMITS.pitch };
}

/**
 * How the look is shown (2026-11-26): as a rigid turn of the whole penguin — yaw (left/right) and a
 * small tilt (pitch) — never by bending a bone inside the body. The v3 penguin is one skinned body:
 * turning its head bone pulled the face and the upper body out of shape ("몸이랑 얼굴이 약간
 * 찌그러져있음"). A rotation of the whole model keeps every vertex where it is relative to the others.
 */
export const GAZE_TURN = { yaw: 0.8, pitch: 0.6 } as const;
export function gazeTurn(l: Look): { yaw: number; pitch: number } {
  return { yaw: (l.body + l.yaw) * GAZE_TURN.yaw, pitch: l.pitch * GAZE_TURN.pitch };
}

/** One damped step from `from` towards `to` over `dt` seconds. */
export function follow(from: Look, to: Look, dt: number, rate = DAMP): Look {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return {
    body: from.body + (to.body - from.body) * k,
    yaw: from.yaw + (to.yaw - from.yaw) * k,
    pitch: from.pitch + (to.pitch - from.pitch) * k,
  };
}

/** Touch devices have no cursor: a slow, small look around instead (two unrelated sines). */
export function wander(seconds: number): Aim {
  return { x: Math.sin(seconds * 0.45) * 0.55 + Math.sin(seconds * 0.17) * 0.2, y: Math.sin(seconds * 0.31 + 1.2) * 0.35 };
}

/**
 * Has the 3D penguin actually drawn? Until the renderer has issued draw calls (`calls` — last
 * frame's `gl.info.render.calls`) the stage is empty where the penguin goes (no 2D poster); if
 * nothing is drawn within `GIVE_UP_SECONDS` of frames the landing falls back to the stacked page
 * with the 2D penguin instead of keeping an empty layer.
 */
export const GIVE_UP_SECONDS = 4;

export function drawState(calls: number, secondsRunning: number): 'drawn' | 'waiting' | 'empty' {
  if (calls > 0) return 'drawn';
  return secondsRunning >= GIVE_UP_SECONDS ? 'empty' : 'waiting';
}
