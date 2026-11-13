// The landing's sections, their stops and how the scroll position picks one (DESIGN.md `## 랜딩`,
// PRD v2.1.0 §3.5 — decision 61; the story re-cut 2026-11-14: who it is for → the problem and why
// now → the AI team → the workflows (the old 맡기기 folded in) → pricing → contact). A section is
// one slide; most hold one stop, the workflows hold three (재무 관리 → 상품 소싱 → SNS 마케팅 — the same card, its content changes, the penguin stays).
// What the penguin does in each is its `act` (acting.ts · staging.ts · arms.ts); how a gesture moves
// between the stops is dwell.ts.
import type { MessageKey } from '../i18n';

export type SectionId = 'hero' | 'problem' | 'org' | 'workflows' | 'pricing' | 'contact';

/**
 * What the penguin does with a section's content — one staging per act, shared where two sections
 * stage alike (the company card at the start and the last card both get the wave; the gap chart and
 * the price cards both get the pointing): `wave` = behind the card's upper right, waving ·
 * `unroll` = peeking over the paper, unrolling it · `stamp` = outside the card's lower-left corner,
 * stamping the owner's approval · `point` = beside the content's right edge, pointing at one spot ·
 * `type` = over a prompt box, typing — the workflow card since 2026-11-14 ② (its prompt box is the
 * card's top row; the stamp on the owner's approval is then a UI animation, one act per section).
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
  { id: 'problem', label: 'landing.section.problem', act: 'point' },
  { id: 'org', label: 'landing.section.org', act: 'unroll' },
  { id: 'workflows', label: 'landing.section.workflows', act: 'type', stops: WORKFLOWS },
  { id: 'pricing', label: 'landing.section.pricing', act: 'point' },
  { id: 'contact', label: 'landing.section.contact', act: 'wave' },
];

export const sectionAnchor = (id: SectionId) => `landing-${id}`;

/** Anchors of sections that are gone, and where they lead now (the 맡기기 section is part of the workflows). */
export const MOVED_ANCHORS: Record<string, string> = { 'landing-delegate': 'landing-workflows' };

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
