// The landing's sections, how scroll picks one, and what the mascot does in each (DESIGN.md
// `## 랜딩`). Clip names are the office's state clips (asset contract §6) — the landing adds no
// clips of its own, only the turn and the wing it presents with (MascotCanvas).
import type { MessageKey } from '../i18n';
import type { ClipName } from '../office/contract';

export type SectionId = 'hero' | 'what' | 'team' | 'control' | 'start';

export interface Section {
  id: SectionId;
  label: MessageKey;
}

export const SECTIONS: Section[] = [
  { id: 'hero', label: 'landing.section.hero' },
  { id: 'what', label: 'landing.section.what' },
  { id: 'team', label: 'landing.section.team' },
  { id: 'control', label: 'landing.section.control' },
  { id: 'start', label: 'landing.section.start' },
];

export const sectionAnchor = (id: SectionId) => `landing-${id}`;

/** `01` … `05` — the progress nav's numbers. */
export const sectionIndex = (id: SectionId) => String(SECTIONS.findIndex((s) => s.id === id) + 1).padStart(2, '0');

/**
 * The slide for a scroll position: the snap marker (one per section, `stops` = their offsets from
 * the top of the page, ascending) nearest to `scrollY`. Halfway between two markers is the later
 * one, so a slide changes at the middle of its step — never before the scroll has gone half a step.
 */
export function stepAt(scrollY: number, stops: number[]): number {
  if (!stops.length) return 0;
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - scrollY) <= Math.abs(stops[best] - scrollY)) best = i;
  }
  return best;
}

/**
 * The clip for a section, `seconds` after it came in. "What it does" thinks, then types; the
 * others hold one state.
 */
export function clipForSection(id: SectionId, seconds: number): ClipName {
  switch (id) {
    case 'hero':
      return 'idle';
    case 'what':
      return seconds < THINK_SECONDS ? 'thinking' : 'typing';
    case 'team':
      return 'idle';
    case 'control':
      return 'waiting';
    case 'start':
      return 'done';
  }
}

export const THINK_SECONDS = 1.8;

/** The first hello: one wave (the `waiting` raise — there is no separate wave clip) before idling. */
export const GREETING: ClipName = 'waiting';
export const GREETING_SECONDS = 2.4;

/**
 * Presenting: when a slide comes in, the penguin turns to its content and points at it with the
 * wing on that side, then turns back to the reader. `PRESENT_SECONDS` is the whole gesture; the
 * content appears in step with it (`--present-delay` in landing.css, `PRESENT_DELAY_MS`).
 */
export const PRESENT_SECONDS = 1.6;
export const PRESENT_DELAY_MS = 220;

/** 0 → 1 → 0 over the gesture: up fast (≈ 0.35 s), held, eased back down. */
export function presentWeight(t: number): number {
  if (t <= 0 || t >= PRESENT_SECONDS) return 0;
  const up = 0.35;
  const hold = 1.0;
  if (t < up) return easeOut(t / up);
  if (t < hold) return 1;
  return 1 - easeInOut((t - hold) / (PRESENT_SECONDS - hold));
}

const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
