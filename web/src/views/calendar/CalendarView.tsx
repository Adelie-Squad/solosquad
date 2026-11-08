// 일정 (decision 60 · DESIGN.md `### 일정`): the whole account's calendar — month · week · list,
// work events per business and the person's own personal events. The address keeps the view, the
// day and the filters (`/calendar?view=week&date=2026-11-14&kind=work`), and `item=<id>` opens a
// sheet, so a link or a reload lands on the same thing.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorText } from '../../api/errors';
import { calendarApi, useCalendar, useCalendarAction, useCalendarLabels } from '../../api/queries';
import type { CalendarItem, CalendarTodo } from '../../api/types.gen';
import { Modal } from '../../components/Modal';
import { Loading, QueryError } from '../../components/Status';
import { useI18n } from '../../i18n';
import { ICON } from '../../icons';
import {
  addDays,
  agenda,
  colorOf,
  dayText,
  entriesOn,
  iso,
  monthGrid,
  periodText,
  rangeOf,
  readQuery,
  sameMonth,
  step,
  timeOf,
  VIEWS,
  weekDays,
  weekdayNames,
  writeQuery,
  type CalQuery,
  type CalView,
  type DayEntry,
} from '../../lib/calendar';
import { orgName } from '../../lib/names';
import { useSession } from '../../session';
import { CalendarSettings } from './CalendarSettings';
import { Dot, useLabelMaps } from './common';
import { ItemDrawer } from './ItemDrawer';

const MONTH_MAX = 3;

/** ≤ 860px: the phone layout (DESIGN.md `## 레이아웃`) — the list is the default view there. */
export function usePhone(): boolean {
  const query = '(max-width: 860px)';
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [phone, setPhone] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const on = () => setPhone(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return phone;
}

export function CalendarView() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const today = iso(new Date());
  const q = readQuery(params, today);
  const phone = usePhone();
  const view: CalView = q.view ?? (phone ? 'list' : 'month');
  const range = rangeOf(view, q.date);
  const data = useCalendar({
    from: range.from,
    to: range.to,
    kind: q.kind ?? undefined,
    org: q.org ?? undefined,
    category: q.cat ?? undefined,
    tag: q.tag ?? undefined,
    done: q.done ? undefined : false,
    undated: view === 'list' ? true : undefined,
  });
  const labels = useCalendarLabels();
  const maps = useLabelMaps(labels.data?.labels);
  const openId = params.get('item');
  const [quick, setQuick] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  const set = (patch: Partial<CalQuery> & { item?: string | null }) => {
    const next = writeQuery(patch, params);
    if ('item' in patch) {
      if (patch.item) next.set('item', patch.item);
      else next.delete('item');
    }
    setParams(next, { replace: !('date' in patch || 'view' in patch) });
  };

  const items = data.data?.items ?? [];
  const todos = data.data?.todos ?? [];
  const itemById = useMemo(() => new Map<string, CalendarItem>([...(data.data?.context ?? []), ...items].map((i) => [i.id, i])), [data.data, items]);
  const colour = (i: CalendarItem) => colorOf(i, maps.byId, itemById);
  const crumb = (i: CalendarItem) => {
    const parent = i.parent_id ? itemById.get(i.parent_id) : undefined;
    const where = i.kind === 'personal' ? t('calendar.personalCrumb') : orgName(me.scopes, i.org ?? '');
    return parent ? `${where} › ${parent.title}` : where;
  };
  const open = (id: string) => set({ item: id });
  // 구분 and tags belong to one scope (a business, or my personal events): their chips show once
  // the filter has narrowed to one — two businesses' "서류" are different labels
  const onlyOrg = q.org ?? (me.scopes.length === 1 && q.kind === 'work' ? me.scopes[0].org : null);
  const labelScope = (l: { scope_kind: string; scope: string }) => (q.kind === 'personal' ? l.scope_kind === 'user' : !!onlyOrg && l.scope_kind === 'org' && l.scope === onlyOrg);
  const filterCats = maps.all.filter((l) => l.type === 'category' && !l.archived && labelScope(l));
  const filterTags = maps.all.filter((l) => l.type === 'tag' && !l.archived && labelScope(l));

  return (
    <div className="view calendar-view">
      <header className="view-header">
        <div>
          <h1>{t('nav.calendar')}</h1>
          <p>{t('calendar.lead')}</p>
        </div>
        <button className="btn is-primary with-icon" onClick={() => setQuick(q.date)}>
          <ICON.new />
          {t('calendar.new')}
        </button>
      </header>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="icon-btn" aria-label={t('calendar.prev')} title={t('calendar.prev')} onClick={() => set({ date: step(view, q.date, -1) })}>
            <ICON.prev />
          </button>
          <button className="btn is-small" onClick={() => set({ date: today })}>
            {t('calendar.today')}
          </button>
          <button className="icon-btn" aria-label={t('calendar.next')} title={t('calendar.next')} onClick={() => set({ date: step(view, q.date, 1) })}>
            <ICON.more />
          </button>
          <h2 className="cal-period" aria-live="polite">
            {periodText(view, q.date, locale)}
          </h2>
        </div>
        <div className="cal-tools">
          <div className="segmented" role="tablist" aria-label={t('calendar.views')}>
            {VIEWS.map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'is-active' : ''} onClick={() => set({ view: v })}>
                {t(`calendar.view.${v}`)}
              </button>
            ))}
          </div>
          <button className="btn is-small with-icon" onClick={() => setSettings(true)}>
            <ICON.settings />
            {t('calendar.settings')}
          </button>
        </div>
      </div>

      <div className="filter-chips" role="group" aria-label={t('calendar.filters')}>
        {(['work', 'personal'] as const).map((k) => (
          <button key={k} className={`chip-toggle ${q.kind === k ? 'is-on' : ''}`} aria-pressed={q.kind === k} onClick={() => set({ kind: q.kind === k ? null : k, cat: null, tag: null })}>
            {k === 'personal' && <ICON.person size={14} aria-hidden />}
            {t(`calendar.kind.${k}`)}
          </button>
        ))}
        {me.scopes.length > 1 &&
          q.kind !== 'personal' &&
          me.scopes.map((o) => (
            <button key={o.org} className={`chip-toggle ${q.org === o.org ? 'is-on' : ''}`} aria-pressed={q.org === o.org} onClick={() => set({ org: q.org === o.org ? null : o.org, cat: null, tag: null })}>
              {orgName(me.scopes, o.org)}
            </button>
          ))}
        {filterCats.map((l) => (
          <button key={l.id} className={`chip-toggle ${q.cat === l.id ? 'is-on' : ''}`} aria-pressed={q.cat === l.id} onClick={() => set({ cat: q.cat === l.id ? null : l.id })}>
            <Dot color={l.color} />
            {l.name}
          </button>
        ))}
        {filterTags.map((l) => (
          <button key={l.id} className={`chip-toggle is-tag ${q.tag === l.id ? 'is-on' : ''}`} aria-pressed={q.tag === l.id} onClick={() => set({ tag: q.tag === l.id ? null : l.id })}>
            <ICON.tag size={12} aria-hidden />
            {l.name}
          </button>
        ))}
        <button className={`chip-toggle ${q.done ? 'is-on' : ''}`} aria-pressed={q.done} onClick={() => set({ done: !q.done })}>
          <ICON.check size={14} aria-hidden />
          {t('calendar.showDone')}
        </button>
      </div>

      {data.isPending ? (
        <Loading />
      ) : data.error ? (
        <QueryError error={data.error} />
      ) : view === 'month' ? (
        <MonthView day={q.date} today={today} items={items} todos={todos} itemById={itemById} colour={colour} onOpen={open} onAdd={setQuick} onMore={(d) => set({ view: 'list', date: d })} locale={locale} />
      ) : view === 'week' ? (
        <WeekView day={q.date} today={today} items={items} todos={todos} itemById={itemById} colour={colour} onOpen={open} onAdd={setQuick} locale={locale} />
      ) : (
        <ListView from={range.from} to={range.to} today={today} items={items} todos={todos} itemById={itemById} colour={colour} crumb={crumb} onOpen={open} locale={locale} />
      )}

      {quick && <QuickAdd day={quick} defaultOrg={q.org} onClose={() => setQuick(null)} onCreated={(id) => { setQuick(null); open(id); }} />}
      {openId && <ItemDrawer id={openId} onClose={() => set({ item: null })} onOpen={open} />}
      {settings && <CalendarSettings onClose={() => setSettings(false)} />}
    </div>
  );
}

interface ViewProps {
  today: string;
  items: CalendarItem[];
  todos: CalendarTodo[];
  itemById: Map<string, CalendarItem>;
  colour: (i: CalendarItem) => ReturnType<typeof colorOf>;
  onOpen: (id: string) => void;
  locale: string;
}

function Entry({ e, colour, onOpen, showTime = true }: { e: DayEntry; colour: ViewProps['colour']; onOpen: (id: string) => void; showTime?: boolean }) {
  const { t } = useI18n();
  const i = e.item;
  const personal = i.kind === 'personal';
  if (e.kind === 'todo' && e.todo) {
    return (
      <button className={`cal-entry is-todo ${e.todo.done ? 'is-done' : ''} ${personal ? 'is-personal' : ''}`} data-color={colour(i)} onClick={() => onOpen(i.id)} aria-label={t('calendar.open', { title: `${e.todo.title} · ${i.title}` })} title={`${e.todo.title} · ${i.title}`}>
        {e.todo.done ? <ICON.done size={14} aria-hidden /> : <ICON.todo size={14} aria-hidden />}
        <span className="cal-entry-title">{e.todo.title}</span>
      </button>
    );
  }
  const time = showTime ? timeOf(i.start) : null;
  // a long span names itself where it starts and at the start of each week; between, a slim bar
  const slim = !e.starts && !e.weekStart;
  return (
    <button
      className={`cal-entry ${personal ? 'is-personal' : ''} ${e.starts ? '' : 'is-continued'} ${slim ? 'is-slim' : ''} ${i.status === 'done' || i.status === 'canceled' ? 'is-done' : ''}`}
      data-color={colour(i)}
      onClick={() => onOpen(i.id)}
      aria-label={t('calendar.open', { title: i.title })}
      title={i.title}
    >
      {personal && <ICON.person size={12} aria-hidden />}
      {time && <span className="cal-entry-time">{time}</span>}
      <span className="cal-entry-title">{i.title}</span>
    </button>
  );
}

/** Arrow keys move between days of a grid; Enter on a day adds an event on it. */
function moveFocus(e: KeyboardEvent<HTMLElement>, cols: number) {
  const target = e.target as HTMLElement;
  const day = target.dataset.day;
  if (!day) return;
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
  if (delta === undefined) return;
  e.preventDefault();
  const next = e.currentTarget.querySelector<HTMLElement>(`[data-day="${addDays(day, delta)}"]`);
  next?.focus();
}

function MonthView({ day, onAdd, onMore, ...p }: ViewProps & { day: string; onAdd: (d: string) => void; onMore: (d: string) => void }) {
  const { t } = useI18n();
  const grid = monthGrid(day);
  const names = weekdayNames(p.locale);
  return (
    <div className="cal-month" role="grid" aria-label={periodText('month', day, p.locale)} onKeyDown={(e) => moveFocus(e, 7)} data-testid="month">
      <div className="cal-weekdays" role="row">
        {names.map((n, i) => (
          <span key={i} role="columnheader">
            {n}
          </span>
        ))}
      </div>
      {Array.from({ length: 6 }, (_, w) => (
        <div key={w} className="cal-week-row" role="row">
          {grid.slice(w * 7, w * 7 + 7).map((d) => {
            const entries = entriesOn(d, p.items, p.todos, p.itemById);
            return (
              <div key={d} role="gridcell" className={`cal-day ${sameMonth(d, day) ? '' : 'is-other'} ${d === p.today ? 'is-today' : ''}`} aria-label={t('calendar.dayLabel', { date: dayText(d, p.locale), n: entries.length })}>
                <button className="cal-day-num" data-day={d} tabIndex={d === day ? 0 : -1} aria-label={t('calendar.addOn', { date: dayText(d, p.locale) })} title={t('calendar.addOn', { date: dayText(d, p.locale) })} onClick={() => onAdd(d)}>
                  {Number(d.slice(8, 10))}
                </button>
                <div className="cal-day-entries">
                  {entries.slice(0, MONTH_MAX).map((e) => (
                    <Entry key={`${e.kind}-${e.id}`} e={e} colour={p.colour} onOpen={p.onOpen} />
                  ))}
                  {entries.length > MONTH_MAX && (
                    <button className="cal-more" onClick={() => onMore(d)}>
                      {t('calendar.more', { n: entries.length - MONTH_MAX })}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekView({ day, onAdd, ...p }: ViewProps & { day: string; onAdd: (d: string) => void }) {
  const { t } = useI18n();
  const days = weekDays(day);
  return (
    <div className="cal-weekview" role="grid" aria-label={periodText('week', day, p.locale)} onKeyDown={(e) => moveFocus(e, 1)} data-testid="week">
      <div className="cal-week-cols" role="row">
        {days.map((d) => {
          const entries = entriesOn(d, p.items, p.todos, p.itemById);
          const allDay = entries.filter((e) => e.kind === 'item' && !timeOf(e.item.start));
          const timed = entries.filter((e) => e.kind === 'item' && timeOf(e.item.start));
          const tds = entries.filter((e) => e.kind === 'todo');
          return (
            <div key={d} role="gridcell" className={`cal-week-col ${d === p.today ? 'is-today' : ''}`}>
              <button className="cal-week-head" data-day={d} tabIndex={d === day ? 0 : -1} aria-label={t('calendar.addOn', { date: dayText(d, p.locale) })} title={t('calendar.addOn', { date: dayText(d, p.locale) })} onClick={() => onAdd(d)}>
                <span className="cal-week-name">{dayText(d, p.locale, { weekday: 'short' })}</span>
                <span className="cal-week-num">{Number(d.slice(8, 10))}</span>
              </button>
              <div className="cal-day-entries">
                {[...allDay, ...timed, ...tds].map((e) => (
                  <Entry key={`${e.kind}-${e.id}`} e={e} colour={p.colour} onOpen={p.onOpen} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ from, to, crumb, ...p }: ViewProps & { from: string; to: string; crumb: (i: CalendarItem) => string }) {
  const { t } = useI18n();
  const toggle = useCalendarAction(({ id, done }: { id: string; done: boolean }) => calendarApi.updateTodo(id, { done }));
  const { days, undated } = agenda(from, to, p.items, p.todos, p.itemById);
  if (days.length === 0 && undated.length === 0) return <p className="panel empty">{t('calendar.empty')}</p>;
  const row = (e: DayEntry) => {
    const i = e.item;
    if (e.kind === 'todo' && e.todo) {
      const td = e.todo;
      return (
        <li key={`t-${td.id}`} className={`cal-agenda-row is-todo ${td.done ? 'is-done' : ''}`}>
          <button
            className="icon-btn cal-check"
            role="checkbox"
            aria-checked={td.done}
            aria-label={td.done ? t('calendar.markOpen', { title: td.title }) : t('calendar.markDone', { title: td.title })}
            title={td.done ? t('calendar.markOpen', { title: td.title }) : t('calendar.markDone', { title: td.title })}
            onClick={() => toggle.mutate({ id: td.id, done: !td.done })}
          >
            {td.done ? <ICON.done size={18} /> : <ICON.todo size={18} />}
          </button>
          <button className="cal-agenda-main" onClick={() => p.onOpen(i.id)}>
            <span className="cal-agenda-title">{td.title}</span>
            <span className="dash-hint">
              {t('calendar.todo')} · {crumb(i)} › {i.title}
            </span>
          </button>
        </li>
      );
    }
    const time = timeOf(i.start);
    return (
      <li key={`i-${i.id}`} className={`cal-agenda-row ${i.kind === 'personal' ? 'is-personal' : ''} ${i.status === 'done' ? 'is-done' : ''}`} data-color={p.colour(i)}>
        <span className="cal-agenda-time">{time ?? t('calendar.allDay')}</span>
        <button className="cal-agenda-main" onClick={() => p.onOpen(i.id)}>
          <span className="cal-agenda-title">
            {i.kind === 'personal' && <ICON.person size={14} aria-hidden />}
            {i.title}
          </span>
          <span className="dash-hint">{crumb(i)}</span>
        </button>
      </li>
    );
  };
  return (
    <div className="cal-agenda" data-testid="list">
      {days.map(({ day, entries }) => (
        <section key={day} className="cal-agenda-day" aria-label={dayText(day, p.locale)}>
          <h3 className={`cal-agenda-date ${day === p.today ? 'is-today' : ''}`}>{dayText(day, p.locale, { month: 'long', day: 'numeric', weekday: 'short' })}</h3>
          <ul>{entries.map(row)}</ul>
        </section>
      ))}
      {undated.length > 0 && (
        <section className="cal-agenda-day" aria-label={t('calendar.undated')}>
          <h3 className="cal-agenda-date">{t('calendar.undated')}</h3>
          <ul>{undated.map((i) => row({ kind: 'item', id: i.id, item: i, starts: true }))}</ul>
        </section>
      )}
    </div>
  );
}

/** Quick add — a title, work or personal, the business, the day and (optionally) a time. */
function QuickAdd({ day, defaultOrg, onClose, onCreated }: { day: string; defaultOrg: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const canPersonal = !!me.user;
  const [kind, setKind] = useState<'work' | 'personal'>(me.scopes.length ? 'work' : 'personal');
  const [org, setOrg] = useState(defaultOrg ?? me.scopes[0]?.org ?? '');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(day);
  const [end, setEnd] = useState('');
  const [time, setTime] = useState('');
  const create = useCalendarAction((body: Record<string, unknown>) => calendarApi.createItem(body));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = time ? `${start}T${time}` : start;
    const en = end ? (time ? `${end}T${time}` : end) : null;
    create.mutate({ kind, org: kind === 'work' ? org : undefined, title, start: s || null, end: en }, { onSuccess: (it) => onCreated(it.id) });
  };
  return (
    <Modal label={t('calendar.new')} onClose={onClose} className="cal-quick">
      <form className="cal-quick-form" onSubmit={submit} data-testid="quick-add">
        <h2 className="modal-title">{t('calendar.new')}</h2>
        <label className="field">
          <span>{t('calendar.title')}</span>
          <input ref={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('calendar.titlePlaceholder')} maxLength={200} required />
        </label>
        {canPersonal && me.scopes.length > 0 && (
          <div className="segmented" role="radiogroup" aria-label={t('calendar.filters')}>
            {(['work', 'personal'] as const).map((k) => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'is-active' : ''} onClick={() => setKind(k)}>
                {t(`calendar.kind.${k}`)}
              </button>
            ))}
          </div>
        )}
        {kind === 'work' && me.scopes.length > 1 && (
          <label className="field">
            <span>{t('calendar.business')}</span>
            <select value={org} onChange={(e) => setOrg(e.target.value)}>
              {me.scopes.map((o) => (
                <option key={o.org} value={o.org}>
                  {orgName(me.scopes, o.org)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'personal' && <p className="hint">{t('calendar.personalHint')}</p>}
        <div className="cal-fields">
          <label className="field">
            <span>{t('calendar.start')}</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('calendar.end')}</span>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('calendar.time')}</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title={t('calendar.timeHint')} />
          </label>
        </div>
        {create.error && (
          <p className="form-error" role="alert">
            {errorText(create.error, t)}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn is-primary" disabled={!title.trim() || create.isPending}>
            {t('calendar.add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
