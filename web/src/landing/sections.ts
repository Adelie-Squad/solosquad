// The landing's sections, their stops and how the scroll position picks one (DESIGN.md `## 랜딩`,
// PRD v2.1.0 §3.5 — decision 61). A section is one slide; most hold one stop, the workflows hold
// three (재무 관리 → 상품 소싱 → SNS 마케팅 — the same card, its content changes, the penguin stays).
// What the penguin does in each is its `act` (acting.ts · staging.ts · arms.ts); how a gesture moves
// between the stops is dwell.ts.
import type { MessageKey } from '../i18n';

export type SectionId = 'hero' | 'delegate' | 'org' | 'workflows' | 'pricing' | 'contact';

/**
 * What the penguin does with a section's content — one staging per act, shared where two sections
 * stage alike (the company card at the start and the last card both get the wave):
 * `wave` = behind the card's upper right, waving · `type` = over the prompt box, typing ·
 * `unroll` = peeking over the paper, unrolling it · `stamp` = outside the card's lower-left corner,
 * stamping the owner's approval · `point` = beside the cards' right edge, pointing at one.
 */
export type ActId = 'wave' | 'type' | 'unroll' | 'stamp' | 'point';

export type WorkflowId = 'finance' | 'sourcing' | 'sns';
export const WORKFLOWS: WorkflowId[] = ['finance', 'sourcing', 'sns'];

export interface Section {
  id: SectionId;
  label: MessageKey;
  act: ActId;
  /** More than one stop: the stops' names (their anchors are `landing-<id>-<stop>`, the first one `landing-<id>`). */
  stops?: readonly string[];
}

export const SECTIONS: Section[] = [
  { id: 'hero', label: 'landing.section.hero', act: 'wave' },
  { id: 'delegate', label: 'landing.section.delegate', act: 'type' },
  { id: 'org', label: 'landing.section.org', act: 'unroll' },
  { id: 'workflows', label: 'landing.section.workflows', act: 'stamp', stops: WORKFLOWS },
  { id: 'pricing', label: 'landing.section.pricing', act: 'point' },
  { id: 'contact', label: 'landing.section.contact', act: 'wave' },
];

export const sectionAnchor = (id: SectionId) => `landing-${id}`;

/** One place the page stops at: a section, and which of its stops (0 for most). */
export interface Stop {
  section: SectionId;
  sub: number;
  anchor: string;
}

export const STOPS: Stop[] = SECTIONS.flatMap((s) =>
  (s.stops ?? ['']).map((name, sub) => ({ section: s.id, sub, anchor: sub === 0 ? sectionAnchor(s.id) : `${sectionAnchor(s.id)}-${name}` })),
);

/** The stop a section starts at. */
export const firstStop = (id: SectionId) => STOPS.findIndex((s) => s.section === id);

export const actOf = (id: SectionId): ActId => SECTIONS.find((s) => s.id === id)!.act;

/**
 * The stop for a scroll position: the stop marker (`stops` = their offsets from the top of the
 * page, ascending) nearest to `scrollY`. Halfway between two markers is the later one, so a slide
 * changes at the middle of its step — never before the scroll has gone half a step.
 */
export function stepAt(scrollY: number, stops: number[]): number {
  if (!stops.length) return 0;
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - scrollY) <= Math.abs(stops[best] - scrollY)) best = i;
  }
  return best;
}
