// The landing's sections and how the scroll position picks one (DESIGN.md `## 랜딩`). What the
// penguin does in each is acting.ts; how a gesture moves between them is dwell.ts.
import type { MessageKey } from '../i18n';

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

/**
 * The slide for a scroll position: the stop marker (one per section, `stops` = their offsets from
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
