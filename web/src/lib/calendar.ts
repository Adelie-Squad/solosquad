// The calendar's date arithmetic and view state (decision 60 · DESIGN.md `### 일정`).
// Dates travel as the engine keeps them: `YYYY-MM-DD` (all day) or `YYYY-MM-DDTHH:MM`
// (local time) — never timestamps, so a day stays the day it was written on.
import type { CalendarItem, CalendarLabel, CalendarTodo } from '../api/types.gen';

export type CalView = 'month' | 'week' | 'list';
export const VIEWS: CalView[] = ['month', 'week', 'list'];
export const PALETTE = ['blue', 'teal', 'green', 'gold', 'orange', 'rose', 'gray'] as const;
export type PaletteKey = (typeof PALETTE)[number];

const pad = (n: number) => String(n).padStart(2, '0');

/** A local date → `YYYY-MM-DD`. */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` (or the date part of a date-time) → a local Date at midnight. */
export function parseDay(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isDay(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDay(s).getTime());
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function addMonths(day: string, n: number): string {
  const d = parseDay(day);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return iso(target);
}

/** Monday-first weeks — the week the day is in starts on its Monday. */
export function weekStart(day: string): string {
  const d = parseDay(day);
  const back = (d.getDay() + 6) % 7;
  return addDays(day, -back);
}

/** The six-week grid a month view draws (Monday first), padded with the neighbours' days. */
export function monthGrid(day: string): string[] {
  const d = parseDay(day);
  const first = iso(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The days a view asks the engine for (inclusive). The list (agenda) shows 30 days ahead. */
export function rangeOf(view: CalView, day: string): { from: string; to: string } {
  if (view === 'month') {
    const g = monthGrid(day);
    return { from: g[0], to: g[g.length - 1] };
  }
  if (view === 'week') {
    const w = weekDays(day);
    return { from: w[0], to: w[6] };
  }
  return { from: day, to: addDays(day, 30) };
}

/** Prev / next for a view. */
export function step(view: CalView, day: string, dir: -1 | 1): string {
  if (view === 'month') return addMonths(day, dir);
  if (view === 'week') return addDays(day, 7 * dir);
  return addDays(day, 30 * dir);
}

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

/** The first and last day an item covers (an undated item covers none). */
export function span(item: Pick<CalendarItem, 'start' | 'end'>): [string, string] | null {
  if (!item.start) return null;
  const first = item.start.slice(0, 10);
  const last = (item.end ?? item.start).slice(0, 10);
  return [first, last < first ? first : last];
}

export const covers = (item: Pick<CalendarItem, 'start' | 'end'>, day: string) => {
  const s = span(item);
  return !!s && s[0] <= day && day <= s[1];
};

/** A day in the reader's language — `11월 14일 (금)` · `Fri, Nov 14`. */
export function dayText(day: string, locale: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', weekday: 'short' }): string {
  return parseDay(day).toLocaleDateString(locale, opts);
}

/** Weekday names, Monday first, short. */
export function weekdayNames(locale: string): string[] {
  return weekDays('2026-11-09').map((d) => parseDay(d).toLocaleDateString(locale, { weekday: 'short' }));
}

/** The title over a view — a month, a week's span, or the list's start. */
export function periodText(view: CalView, day: string, locale: string): string {
  if (view === 'month') return parseDay(day).toLocaleDateString(locale, { year: 'numeric', month: 'long' });
  const r = rangeOf(view, day);
  return `${dayText(r.from, locale, { month: 'short', day: 'numeric' })} – ${dayText(r.to, locale, { month: 'short', day: 'numeric' })}`;
}

/** `14:00` of a date-time, null for a whole day. */
export const timeOf = (when: string | null | undefined) => (when && when.includes('T') ? when.slice(11, 16) : null);

export interface DayEntry {
  kind: 'item' | 'todo';
  id: string;
  item: CalendarItem;
  todo?: CalendarTodo;
  /** First day of a multi-day item (its title is written there; the others continue it). */
  starts: boolean;
}

/** What one day shows: items covering it (timed ones by time), then to-dos due that day. */
export function entriesOn(day: string, items: CalendarItem[], todos: CalendarTodo[], itemById: Map<string, CalendarItem>): DayEntry[] {
  const its = items
    .filter((i) => covers(i, day))
    .sort((a, b) => (timeOf(a.start) ?? '').localeCompare(timeOf(b.start) ?? '') || a.position - b.position)
    .map<DayEntry>((i) => ({ kind: 'item', id: i.id, item: i, starts: span(i)?.[0] === day }));
  const tds = todos
    .filter((t) => t.due && t.due.slice(0, 10) === day && itemById.has(t.item_id))
    .map<DayEntry>((t) => ({ kind: 'todo', id: t.id, item: itemById.get(t.item_id)!, todo: t, starts: true }));
  return [...its, ...tds];
}

/** The colour key an entry is drawn with — its 구분's, else (a sub-item) its parent's, else gray. */
export function colorOf(item: CalendarItem, labels: Map<string, CalendarLabel>, itemById: Map<string, CalendarItem>): PaletteKey {
  const own = item.category_id ? labels.get(item.category_id) : undefined;
  if (own) return own.color;
  const parent = item.parent_id ? itemById.get(item.parent_id) : undefined;
  const inherited = parent?.category_id ? labels.get(parent.category_id) : undefined;
  return inherited?.color ?? 'gray';
}

/** Address state of `/calendar` — the view, the day, and the filters (query string). */
export interface CalQuery {
  view: CalView | null;
  date: string;
  kind: 'work' | 'personal' | null;
  org: string | null;
  cat: string | null;
  tag: string | null;
  done: boolean;
}

export function readQuery(params: URLSearchParams, today: string): CalQuery {
  const v = params.get('view');
  const k = params.get('kind');
  const d = params.get('date');
  return {
    view: VIEWS.includes(v as CalView) ? (v as CalView) : null,
    date: isDay(d) ? d : today,
    kind: k === 'work' || k === 'personal' ? k : null,
    org: params.get('org') || null,
    cat: params.get('cat') || null,
    tag: params.get('tag') || null,
    done: params.get('done') !== '0',
  };
}

export function writeQuery(q: Partial<CalQuery>, base: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  const set = (k: string, v: string | null | undefined) => (v ? out.set(k, v) : out.delete(k));
  if ('view' in q) set('view', q.view);
  if ('date' in q) set('date', q.date);
  if ('kind' in q) set('kind', q.kind);
  if ('org' in q) set('org', q.org);
  if ('cat' in q) set('cat', q.cat);
  if ('tag' in q) set('tag', q.tag);
  if ('done' in q) set('done', q.done ? null : '0');
  return out;
}

/** Group an agenda by day — undated top-level items at the end. */
export function agenda(from: string, to: string, items: CalendarItem[], todos: CalendarTodo[], itemById: Map<string, CalendarItem>) {
  const days: { day: string; entries: DayEntry[] }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const entries = entriesOn(d, items, todos, itemById).filter((e) => e.kind === 'todo' || e.starts || d === from);
    if (entries.length) days.push({ day: d, entries });
  }
  const undated = items.filter((i) => !i.start && !i.parent_id);
  return { days, undated };
}
