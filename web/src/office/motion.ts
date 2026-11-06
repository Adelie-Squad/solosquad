// In-place motion per state (guide §9 · DESIGN.md 상태 → 모션). Agents never walk; the pose
// eases towards these targets. With reduced motion the time is frozen: a still pose per state.
import type { AgentStatus } from './state';

export interface Pose {
  hop: number;
  lean: number;
  sway: number;
  squash: number;
  wl: number;
  wr: number;
  wfx: number;
  look: number;
}

export const REST: Pose = { hop: 0, lean: 0, sway: 0, squash: 0, wl: 0.15, wr: 0.15, wfx: 0, look: 0 };

/** Still poses for `prefers-reduced-motion` — each state stays readable without moving. */
export const STILL: Record<AgentStatus, Pose> = {
  idle: REST,
  thinking: { ...REST, lean: -0.04, wl: 0.12, wr: 0.12, look: 0.022 },
  typing: { ...REST, lean: 0.1, wl: 0.4, wr: 0.4, wfx: -0.75, look: -0.01 },
  waiting: { ...REST, wl: 0.18, wr: 2.35, look: 0.01 },
  done: { ...REST, wl: 1.3, wr: 1.3, look: 0.015 },
  error: { ...REST, lean: 0.24, wl: 0.05, wr: 0.05, look: -0.03 },
};

/** `evening` turns idle into dozing (head drops and lifts) instead of breathing. */
export function target(status: AgentStatus, t: number, phase: number, evening: boolean): Pose {
  const p = phase;
  switch (status) {
    case 'typing': {
      const k = t * 13 + p;
      return {
        lean: 0.1,
        sway: 0,
        hop: Math.abs(Math.sin(k)) * 0.012,
        squash: 0,
        wl: 0.32 + Math.max(0, Math.sin(k)) * 0.18,
        wr: 0.32 + Math.max(0, -Math.sin(k)) * 0.18,
        wfx: -0.75,
        look: -0.01,
      };
    }
    case 'thinking':
      return { lean: -0.04, sway: Math.sin(t * 1.5 + p) * 0.11, hop: 0, squash: Math.sin(t * 2 + p) * 0.012, wl: 0.12, wr: 0.12, wfx: 0, look: 0.022 };
    case 'waiting': {
      const h = Math.max(0, Math.sin(t * 5 + p));
      return { lean: 0, sway: 0, hop: h * 0.06, squash: 0, wl: 0.18, wr: 2.35 + Math.sin(t * 9 + p) * 0.35, wfx: 0, look: 0.01 };
    }
    case 'done': {
      const s = Math.sin(t * 6.5 + p);
      return {
        lean: 0,
        sway: 0,
        hop: Math.max(0, s) * 0.26,
        squash: s < -0.6 ? (-0.6 - s) * 0.18 : 0,
        wl: 1.3 + Math.sin(t * 13) * 0.35,
        wr: 1.3 + Math.sin(t * 13 + 1) * 0.35,
        wfx: 0,
        look: 0.015,
      };
    }
    case 'error':
      return { ...STILL.error, sway: Math.sin(t * 0.7 + p) * 0.015 };
    case 'idle':
    default:
      if (evening) {
        // nodding off: the head sinks slowly, then jerks back up
        const cycle = ((t * 0.32 + p * 0.1) % 1 + 1) % 1;
        const sink = cycle < 0.85 ? cycle / 0.85 : 1 - (cycle - 0.85) / 0.15;
        return { ...REST, lean: 0.04 + sink * 0.22, wl: 0.08, wr: 0.08, look: -0.02 };
      }
      return { ...REST, squash: Math.sin(t * 1.6 + p) * 0.01 };
  }
}

/** Frame-rate independent easing towards the target (k = 1 − e^(−9·dt)). */
export function ease(from: Pose, to: Pose, dt: number): Pose {
  const k = 1 - Math.exp(-9 * dt);
  const out = { ...from };
  for (const key of Object.keys(to) as (keyof Pose)[]) out[key] = from[key] + (to[key] - from[key]) * k;
  return out;
}
