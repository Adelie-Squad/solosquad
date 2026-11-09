// 자리를 비운 동안 (DESIGN.md `### 대시보드`): the one sentence on top of the digest. Built from the
// engine's counts — no model writes it in v2.1 (an 임원-written brief is v2.2).
import type { Digest } from '../api/types.gen';
import type { Locale, MessageKey, Translate } from '../i18n';

type Clause = 'done' | 'failed' | 'mine' | 'others' | 'calendar' | 'decided';

const CLAUSE_KEYS: Record<Clause, { mid: MessageKey; end: MessageKey }> = {
  done: { mid: 'digest.done.mid', end: 'digest.done.end' },
  failed: { mid: 'digest.failed.mid', end: 'digest.failed.end' },
  mine: { mid: 'digest.mine.mid', end: 'digest.mine.end' },
  others: { mid: 'digest.others.mid', end: 'digest.others.end' },
  calendar: { mid: 'digest.calendar.mid', end: 'digest.calendar.end' },
  decided: { mid: 'digest.decided.mid', end: 'digest.decided.end' },
};

/** At most this many parts in the sentence — the groups below carry the rest. */
const MAX_CLAUSES = 3;

/** What finished: conversations and workflow runs, and the scheduled runs that went well. */
export function doneCount(d: Pick<Digest, 'counts' | 'scheduled'>): number {
  return d.counts.finished + d.scheduled.filter((s) => s.status === 'success').length;
}

/** Is there anything to say? */
export function hasNews(d: Digest): boolean {
  const c = d.counts;
  return c.finished + c.failed + c.approvals_mine + c.approvals_others + c.decided + c.scheduled + c.calendar > 0;
}

/** "3시간" · "3 hours" · "3小时" — the length of the window, in the largest whole unit. */
export function durationText(seconds: number, locale: Locale): string {
  const s = Math.max(60, seconds);
  const [value, unit] = s >= 86400 ? [Math.floor(s / 86400), 'day'] : s >= 3600 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 60), 'minute'];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

/**
 * "자리를 비운 3시간 동안 4건이 끝났고, 2건이 대표님 승인을 기다려요." The parts come in the order
 * that matters to the person (what finished, what failed, what waits for them …), up to three.
 * `who` is how the sentence names the reader (ko only — en/zh say "you").
 */
export function digestHeadline(d: Digest, t: Translate, locale: Locale, who: string): string {
  const counts: [Clause, number][] = [
    ['done', doneCount(d)],
    ['failed', d.counts.failed],
    ['mine', d.counts.approvals_mine],
    ['others', d.counts.approvals_others],
    ['calendar', d.counts.calendar],
    ['decided', d.counts.decided],
  ];
  const parts = counts.filter(([, n]) => n > 0).slice(0, MAX_CLAUSES);
  const duration = durationText(d.until - (d.since ?? d.until), locale);
  if (parts.length === 0) return t('digest.quiet', { duration });
  const body = parts
    .map(([clause, n], i) => {
      const text = t(i === parts.length - 1 ? CLAUSE_KEYS[clause].end : CLAUSE_KEYS[clause].mid, { n, who });
      if (i === 0) return text;
      return `${t(i === parts.length - 1 ? 'digest.sepLast' : 'digest.sep')}${text}`;
    })
    .join('');
  return d.basis === 'acknowledged' ? t('digest.headlineSince', { body }) : t('digest.headline', { duration, body });
}
