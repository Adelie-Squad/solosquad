// The item detail (DESIGN.md `### 일정` 항목 시트): breadcrumbs 사업 › 항목 › 세부 항목, the title,
// dates, status, 구분 and tags, notes, the sub-items, and the 할 일 checklist with inline add and
// check. Every change saves at once (no save button) and refreshes the calendar.
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '../../api/client';
import { errorText } from '../../api/errors';
import { calendarApi, scopedKeys, useCalendarAction, useCalendarItem, useCalendarLabels } from '../../api/queries';
import type { CalendarItem, CalendarTodo, OrgPerson } from '../../api/types.gen';
import { Loading, QueryError } from '../../components/Status';
import { useI18n } from '../../i18n';
import { ICON } from '../../icons';
import { useSurface } from '../../shell/surface';
import { colorOf, timeOf } from '../../lib/calendar';
import { orgName } from '../../lib/names';
import { apiPath } from '../../scope';
import { useSession } from '../../session';
import { Dot, Sheet, STATUS_KEYS, useLabelMaps } from './common';

export function ItemDrawer({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const q = useCalendarItem(id);
  const title = q.data?.item.title ?? t('calendar.item');
  return (
    <Sheet label={title} onClose={onClose}>
      {q.isPending ? <Loading /> : q.error ? <QueryError error={q.error} /> : <Body key={id} detail={q.data} onOpen={onOpen} onClose={onClose} />}
    </Sheet>
  );
}

type Detail = NonNullable<ReturnType<typeof useCalendarItem>['data']>;

function Body({ detail, onOpen, onClose }: { detail: Detail; onOpen: (id: string) => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { me, user } = useSession();
  const { item, parent, children, todos, child_todos } = detail;
  const labels = useCalendarLabels();
  const maps = useLabelMaps(labels.data?.labels);
  const itemById = new Map<string, CalendarItem>([item, ...(parent ? [parent] : []), ...children].map((i) => [i.id, i]));
  const update = useCalendarAction((body: Record<string, unknown>) => calendarApi.updateItem(item.id, body));
  const remove = useCalendarAction(() => calendarApi.deleteItem(item.id));
  const addChild = useCalendarAction((title: string) => calendarApi.createItem({ parent_id: item.id, title }));
  const addLabel = useCalendarAction((name: string) =>
    calendarApi.createLabel(item.kind === 'personal' ? { type: 'tag', personal: true, name } : { type: 'tag', org: item.org, name }),
  );
  const people = useQuery({
    queryKey: [...scopedKeys({ org: item.org ?? '', ws: '' }).people],
    queryFn: () => api.get<OrgPerson[]>(apiPath.org(item.org ?? '', '/people')),
    enabled: item.kind === 'work' && !!item.org,
  });
  const [newTag, setNewTag] = useState('');
  const viewOnly = useSurface().viewOnly;
  const locked = (key: string) => !!viewOnly?.locked(key);
  const [newSub, setNewSub] = useState('');
  const err = update.error ?? remove.error ?? addChild.error ?? addLabel.error;

  const save = (body: Record<string, unknown>) => update.mutate(body);
  const timed = !item.all_day;
  const cats = maps.forItem(item, 'category', item.category_id ? [item.category_id] : []);
  const tags = maps.forItem(item, 'tag', item.tag_ids);
  const toggleTag = (tid: string) => save({ tag_ids: item.tag_ids.includes(tid) ? item.tag_ids.filter((x) => x !== tid) : [...item.tag_ids, tid] });
  const createTag = async (e: FormEvent) => {
    e.preventDefault();
    const name = newTag.trim();
    if (!name) return;
    const found = tags.find((l) => l.name === name);
    const label = found ?? (await addLabel.mutateAsync(name));
    setNewTag('');
    if (!item.tag_ids.includes(label.id)) save({ tag_ids: [...item.tag_ids, label.id] });
  };
  const setWhen = (field: 'start' | 'end', value: string) => {
    if (field === 'start' && item.end && value && item.end < value) save({ start: value || null, end: value || null });
    else save({ [field]: value || null });
  };
  const setAllDay = (allDay: boolean) => {
    const day = (s: string | null) => (s ? s.slice(0, 10) : null);
    if (allDay) save({ start: day(item.start), end: day(item.end) });
    else save({ start: item.start ? `${day(item.start)}T09:00` : null, end: item.end ? `${day(item.end)}T10:00` : item.start ? `${day(item.start)}T10:00` : null });
  };

  const crumbs = item.kind === 'personal' ? t('calendar.personalCrumb') : orgName(me.scopes, item.org ?? '');

  return (
    <div className="cal-detail" data-testid="item-drawer">
      <nav className="cal-crumbs" aria-label={t('calendar.item')}>
        <ol>
          <li>{crumbs}</li>
          {parent && (
            <li>
              <button className="link-btn" onClick={() => onOpen(parent.id)}>
                {parent.title}
              </button>
            </li>
          )}
          <li aria-current="page">{item.title}</li>
        </ol>
      </nav>
      {item.kind === 'personal' && (
        <p className="hint with-icon">
          <ICON.locked size={14} />
          {t('calendar.personalHint')}
        </p>
      )}

      <label className="field">
        <span>{t('calendar.title')}</span>
        <input
          className="cal-title-input"
          defaultValue={item.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== item.title && save({ title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>

      <div className="cal-fields">
        <label className="field">
          <span>{t('calendar.start')}</span>
          <input type={timed ? 'datetime-local' : 'date'} value={item.start ?? ''} onChange={(e) => setWhen('start', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('calendar.end')}</span>
          <input type={timed ? 'datetime-local' : 'date'} value={item.end ?? ''} min={item.start ?? undefined} onChange={(e) => setWhen('end', e.target.value)} />
        </label>
        <label className="field is-inline">
          <input type="checkbox" checked={!timed} onChange={(e) => setAllDay(e.target.checked)} />
          <span>{t('calendar.allDay')}</span>
        </label>
        <label className="field">
          <span>{t('calendar.status')}</span>
          <select value={item.status} onChange={(e) => save({ status: e.target.value })}>
            {(Object.keys(STATUS_KEYS) as CalendarItem['status'][]).map((s) => (
              <option key={s} value={s}>
                {t(STATUS_KEYS[s])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('calendar.category')}</span>
          <span className="cal-select-with-dot">
            <Dot color={colorOf(item, maps.byId, itemById)} />
            <select value={item.category_id ?? ''} onChange={(e) => save({ category_id: e.target.value || null })} data-testid="category-select">
              <option value="">{t('calendar.noCategory')}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <div className="field">
        <span>{t('calendar.tags')}</span>
        <div className="cal-tags" role="group" aria-label={t('calendar.tags')}>
          {tags.map((l) => {
            const on = item.tag_ids.includes(l.id);
            return (
              <button key={l.id} className={`chip-toggle ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => toggleTag(l.id)}>
                <Dot color={l.color} />
                {l.name}
              </button>
            );
          })}
          <form className="cal-inline-add" onSubmit={createTag}>
            <ICON.tag size={14} aria-hidden />
            <input disabled={locked('calendar.labels.create')} value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder={t('calendar.tagPlaceholder')} aria-label={t('calendar.newTag')} maxLength={40} />
          </form>
        </div>
      </div>

      <label className="field">
        <span>{t('calendar.notes')}</span>
        <textarea rows={3} defaultValue={item.notes} placeholder={t('calendar.notesPlaceholder')} onBlur={(e) => e.target.value !== item.notes && save({ notes: e.target.value })} />
      </label>

      {!item.parent_id && (
        <section className="cal-section" aria-labelledby="cal-subs">
          <h3 id="cal-subs" className="panel-title">
            {t('calendar.subItems')}
          </h3>
          {children.length === 0 ? (
            <p className="dash-hint">{t('calendar.noSubs')}</p>
          ) : (
            <ul className="cal-subs">
              {children.map((c) => {
                const mine = child_todos.filter((td) => td.item_id === c.id);
                return (
                  <li key={c.id}>
                    <button className="cal-sub-row" onClick={() => onOpen(c.id)}>
                      <Dot color={colorOf(c, maps.byId, itemById)} personal={c.kind === 'personal'} />
                      <span className="cal-sub-title">{c.title}</span>
                      {c.start && (
                        <span className="dash-hint">
                          {c.start.slice(5, 10).replace('-', '/')}
                          {timeOf(c.start) ? ` ${timeOf(c.start)}` : ''}
                          {c.end && c.end.slice(0, 10) !== c.start.slice(0, 10) ? ` – ${c.end.slice(5, 10).replace('-', '/')}` : ''}
                        </span>
                      )}
                      {mine.length > 0 && <span className="chip">{t('calendar.todoCount', { done: mine.filter((m) => m.done).length, all: mine.length })}</span>}
                      <span className={`chip ${c.status === 'done' ? 'is-ok' : c.status === 'active' ? 'is-accent' : ''}`}>{t(STATUS_KEYS[c.status])}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="cal-inline-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (newSub.trim()) addChild.mutate(newSub.trim(), { onSuccess: () => setNewSub('') });
            }}
          >
            <ICON.new size={14} aria-hidden />
            <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder={t('calendar.subPlaceholder')} aria-label={t('calendar.addSub')} />
          </form>
        </section>
      )}

      <Todos item={item} todos={todos} people={item.kind === 'personal' ? (user ? [{ id: user.id, name: user.display || user.username }] : []) : (people.data ?? []).map((p) => ({ id: p.id, name: p.display || p.username }))} locale={locale} />

      {err && (
        <p className="form-error" role="alert">
          {errorText(err, t)}
        </p>
      )}
      <div className="cal-detail-foot">
        <button
          className="btn with-icon is-danger-text"
          disabled={locked('calendar.delete')}
          title={locked('calendar.delete') ? viewOnly?.note : undefined}
          onClick={() => {
            if (window.confirm(t('calendar.deleteConfirm'))) remove.mutate(undefined, { onSuccess: () => (parent ? onOpen(parent.id) : onClose()) });
          }}
        >
          <ICON.remove />
          {t('calendar.delete')}
        </button>
      </div>
    </div>
  );
}

/** The 할 일 checklist — check, add with Enter, a due day and who does it. */
export function Todos({ item, todos, people }: { item: CalendarItem; todos: CalendarTodo[]; people: { id: string; name: string }[]; locale?: string }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const add = useCalendarAction((body: Record<string, unknown>) => calendarApi.createTodo(item.id, body));
  const change = useCalendarAction(({ id, body }: { id: string; body: Record<string, unknown> }) => calendarApi.updateTodo(id, body));
  const drop = useCalendarAction((id: string) => calendarApi.deleteTodo(id));
  const done = todos.filter((td) => td.done).length;
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && title.trim()) {
      e.preventDefault();
      add.mutate({ title: title.trim() }, { onSuccess: () => setTitle('') });
    }
  };
  const err = add.error ?? change.error ?? drop.error;
  const viewOnly = useSurface().viewOnly;
  const locked = (key: string) => !!viewOnly?.locked(key);
  return (
    <section className="cal-section" aria-labelledby="cal-todos" data-testid="todos">
      <h3 id="cal-todos" className="panel-title with-count">
        {t('calendar.todos')}
        {todos.length > 0 && <span className="chip">{`${done}/${todos.length}`}</span>}
      </h3>
      {todos.length === 0 && <p className="dash-hint">{t('calendar.noTodos')}</p>}
      <ul className="cal-todos">
        {todos.map((td) => {
          const checked = change.variables?.id === td.id && change.isPending ? !!change.variables.body.done : td.done;
          return (
            <li key={td.id} className={`cal-todo ${checked ? 'is-done' : ''}`}>
              <button
                className="icon-btn cal-check"
                role="checkbox"
                aria-checked={checked}
                aria-label={checked ? t('calendar.markOpen', { title: td.title }) : t('calendar.markDone', { title: td.title })}
                title={checked ? t('calendar.markOpen', { title: td.title }) : t('calendar.markDone', { title: td.title })}
                onClick={() => change.mutate({ id: td.id, body: { done: !td.done } })}
              >
                {checked ? <ICON.done size={18} /> : <ICON.todo size={18} />}
              </button>
              <span className="cal-todo-title">{td.title}</span>
              <input type="date" className="cal-todo-due" aria-label={t('calendar.due')} title={t('calendar.due')} value={td.due ?? ''} onChange={(e) => change.mutate({ id: td.id, body: { due: e.target.value || null } })} />
              <select className="cal-todo-who is-small" aria-label={t('calendar.assignee')} value={td.assignee_id ?? ''} onChange={(e) => change.mutate({ id: td.id, body: { assignee_id: e.target.value || null } })}>
                <option value="">{t('calendar.nobody')}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="icon-btn" disabled={locked('calendar.todos.delete')} aria-label={t('calendar.removeTodo', { title: td.title })} title={t('calendar.removeTodo', { title: td.title })} onClick={() => drop.mutate(td.id)}>
                <ICON.remove size={14} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="cal-inline-add">
        <ICON.new size={14} aria-hidden />
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onKey} placeholder={t('calendar.todoPlaceholder')} aria-label={t('calendar.addTodo')} />
      </div>
      {err && (
        <p className="form-error" role="alert">
          {errorText(err, t)}
        </p>
      )}
    </section>
  );
}
