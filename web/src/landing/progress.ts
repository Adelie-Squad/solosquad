// How far the page is through each section's block (scene.ts `progressOf`) — written by the landing
// on every scroll frame, read by the acts that draw by it (the gap graph, the paper, the workflow
// card, the price card), each one re-rendering only when its own section's value changes.
import { useSyncExternalStore } from 'react';
import type { SectionId } from './sections';

const values = new Map<SectionId, number>();
const listeners = new Set<() => void>();

/** Set a section's progress (rounded to 1/1000 — finer changes would only re-render for nothing). */
export function setProgress(id: SectionId, p: number) {
  const v = Math.round(p * 1000) / 1000;
  if (values.get(id) === v) return;
  values.set(id, v);
  for (const l of listeners) l();
}

export function resetProgress() {
  values.clear();
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A section's progress through its block, 0 … 1 (0 until the landing has measured it). */
export function useProgress(id: SectionId): number {
  return useSyncExternalStore(subscribe, () => values.get(id) ?? 0, () => 0);
}
