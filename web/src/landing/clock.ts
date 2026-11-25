// The act clock (DESIGN.md `## 랜딩`, 2026-11-26 — user: "스크롤할 때 애니메이션이 스크롤 정도에 따라 가지
// 말고, 섹션에 도달하면 정해진 속도와 모션에 맞춰서 애니메이션을 해. 그게 끝나기 전에 스크롤을 내려서 다음 섹션
// 가면 모션 중단하고 내려가게"). The scroll still moves the page, pins the scenes and walks the penguin
// between them; the acts run on time: when a section becomes the one holding the screen (and, in the
// workflows, when the page enters another example's third), its clock starts from 0 and the act
// plays at its own speed — however fast the page is scrolled, never rewound. Leaving stops it: a
// section above the current one shows its finished picture, one below its starting one; coming back
// plays it again from the start.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { now } from './acting';
import { SECTIONS, type SectionId } from './sections';

/** A breath after a section arrives before its act begins (ms) — the penguin is still walking over. */
export const ACT_LEAD_MS = 500;

/** The section whose act is playing, which example (the workflows), and when its clock started. */
export const clock = { section: null as SectionId | null, sub: 0, startedAt: -Infinity };

const listeners = new Set<() => void>();
let version = 0;

/** A section (and example) arrives: its clock starts now. The same one again changes nothing. */
export function startAct(section: SectionId | null, sub = 0, at = now()) {
  if (clock.section === section && clock.sub === sub) return;
  clock.section = section;
  clock.sub = sub;
  clock.startedAt = at;
  version++;
  for (const l of listeners) l();
}

export function resetClock() {
  startAct(null, 0, -Infinity);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const order = (id: SectionId) => SECTIONS.findIndex((s) => s.id === id);

/**
 * Where a section's act is, in ms: the elapsed time since its clock started (less the lead) while it
 * is the current one; `Infinity` (finished) for a section above the current one; 0 (not begun) below.
 */
export function actMsOf(id: SectionId, t = now()): number {
  const cur = clock.section;
  if (cur === id) return Math.max(0, t - clock.startedAt - ACT_LEAD_MS);
  if (cur === null) return 0;
  return order(id) < order(cur) ? Infinity : 0;
}

/**
 * A section's act ms for a component, ticking every frame while its act runs (up to `length` ms,
 * then still). `sub` = which example is up, for the workflows.
 */
export function useActMs(id: SectionId, length: number): { ms: number; sub: number } {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const [, tick] = useState(0);
  const running = clock.section === id;
  const ms = actMsOf(id);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const step = () => {
      tick((n) => n + 1);
      if (actMsOf(id) <= length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running, id, length, clock.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ms, sub: clock.section === id ? clock.sub : ms === Infinity ? -1 : 0 };
}
