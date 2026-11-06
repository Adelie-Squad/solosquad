// A five-field crontab as a sentence people read ("매주 월요일 오전 9시", "Weekdays at 8:30 AM").
// Covers the shapes schedules are written in; anything else is named a custom schedule with the
// expression beside it, never guessed. Times and weekday names come from Intl, so the three
// languages share one parser.
import type { Locale, Translate } from '../i18n';

const DAY_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const num = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

/** `1-5`, `1,3,5`, `mon-fri`, `7` → weekday numbers 0 (Sunday) … 6, or null if it is not a list of days. */
export function weekdays(field: string): number[] | null {
  const day = (s: string): number | null => {
    const n = num(s) ?? DAY_NAMES[s.toLowerCase()];
    if (n === undefined || n === null || n > 7) return null;
    return n % 7;
  };
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [a, b] = part.split('-');
    const from = day(a);
    if (from === null) return null;
    if (b === undefined) {
      out.add(from);
      continue;
    }
    const raw = num(b) ?? DAY_NAMES[b.toLowerCase()];
    if (raw === undefined || raw === null || raw > 7) return null;
    const to = raw === 7 ? 7 : raw;
    if (to < from) return null;
    for (let d = from; d <= to; d++) out.add(d % 7);
  }
  return [...out].sort((x, y) => x - y);
}

/** "오전 9시" · "9 AM" · "上午9时" — a wall-clock time in the schedule's own time zone. */
export function clock(locale: Locale, hour: number, minute: number): string {
  const at = new Date(Date.UTC(2026, 0, 5, hour, minute));
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: minute ? '2-digit' : undefined, timeZone: 'UTC' }).format(at);
}

/** 0 = Sunday → "일요일" · "Sunday" · "星期日". */
export function dayName(locale: Locale, day: number): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + day)));
}

export function cronText(expr: string, locale: Locale, t: Translate): string {
  const fields = expr.trim().split(/\s+/);
  const custom = t('cron.custom', { expr: expr.trim() });
  if (fields.length !== 5) return custom;
  const [mi, ho, dom, mon, dow] = fields;
  const minute = num(mi);
  const hour = num(ho);
  const every = (f: string) => f.match(/^\*\/(\d+)$/)?.[1];

  if (mon !== '*') return custom;
  if (every(mi) && ho === '*' && dom === '*' && dow === '*') return t('cron.everyMinutes', { n: Number(every(mi)) });
  if (minute === null || minute > 59) return custom;
  if (ho === '*' && dom === '*' && dow === '*') return t('cron.hourly', { minute: String(minute).padStart(2, '0') });
  if (every(ho) && minute === 0 && dom === '*' && dow === '*') return t('cron.everyHours', { n: Number(every(ho)) });
  if (hour === null || hour > 23) return custom;
  const time = clock(locale, hour, minute);
  if (dom === '*' && dow === '*') return t('cron.daily', { time });
  if (dom === '*') {
    const days = weekdays(dow);
    if (!days || days.length === 0) return custom;
    if (days.length === 7) return t('cron.daily', { time });
    if (days.join() === '1,2,3,4,5') return t('cron.weekdays', { time });
    if (days.join() === '0,6') return t('cron.weekends', { time });
    // Monday first, Sunday last — how people list a week
    const ordered = [...days.filter((d) => d !== 0), ...days.filter((d) => d === 0)];
    return t('cron.weekly', { days: ordered.map((d) => dayName(locale, d)).join(t('cron.and')), time });
  }
  const day = num(dom);
  if (dow === '*' && day !== null && day >= 1 && day <= 31) return t('cron.monthly', { day, time });
  return custom;
}
