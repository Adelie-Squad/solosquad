// The landing's sections and what the mascot does in each (DESIGN.md `## 랜딩`). Clip names are
// the office's state clips (asset contract §6) — the landing adds no motion of its own.
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

/** `01` … `05`. */
export const sectionIndex = (id: SectionId) => String(SECTIONS.findIndex((s) => s.id === id) + 1).padStart(2, '0');

/**
 * The clip for a section at a scroll progress (0 = its top at the middle of the viewport,
 * 1 = its bottom there). "What it does" thinks first and types in its second half.
 */
export function clipForSection(id: SectionId, progress: number): ClipName {
  switch (id) {
    case 'hero':
      return 'idle';
    case 'what':
      return progress < 0.5 ? 'thinking' : 'typing';
    case 'team':
      return 'idle';
    case 'control':
      return 'waiting';
    case 'start':
      return 'done';
  }
}

/** The first hello: one wave (the `waiting` raise — there is no separate wave clip) before idling. */
export const GREETING: ClipName = 'waiting';
export const GREETING_SECONDS = 2.4;
