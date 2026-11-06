// State → clip (DESIGN.md `## 사무실 장면` — 상태 → 동작, asset contract §6). The motion itself
// lives in penguin.glb; this only picks the clip, the blend time and each agent's start phase.
import type { ClipName } from './contract';
import type { AgentStatus } from './state';

/** Seconds a clip change blends over — no snapping between poses. */
export const CROSSFADE = 0.25;

/** The clip for a state; the evening's idle is the doze (falls back to idle when absent). */
export function clipFor(status: AgentStatus, evening: boolean, has: (clip: ClipName) => boolean = () => true): ClipName {
  if (status === 'idle' && evening && has('idle_doze')) return 'idle_doze';
  return status;
}

/** A stable 0..1 start phase per agent, so a full office does not breathe in step. */
export function phaseOf(name: string, index: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (((h >>> 0) % 1000) / 1000 + index * 0.37) % 1;
}

/** Reduced motion: each state's still pose is its clip's first frame (contract: a loop starts on its key pose). */
export const STILL_TIME = 0;
