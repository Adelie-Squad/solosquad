// 구분 · 태그 관리 (DESIGN.md `### 일정` 설정 패널): per business (work) and for my personal events —
// add, rename, recolour from the fixed palette, archive. Plus how much agents may read of my
// personal events. Labels are never deleted: an archived one stays on the events that carry it.
import { useState, type FormEvent } from 'react';
import { errorText } from '../../api/errors';
import { calendarApi, useCalendarAction, useCalendarLabels } from '../../api/queries';
import type { CalendarLabel } from '../../api/types.gen';
import { Modal } from '../../components/Modal';
import { Loading, QueryError } from '../../components/Status';
import { useI18n } from '../../i18n';
import { ICON } from '../../icons';
import { PALETTE, type PaletteKey } from '../../lib/calendar';
import { orgName } from '../../lib/names';
import { useSession } from '../../session';
import { AgentAccessPanel, Dot } from './common';
import { ViewOnlyArea } from '../../shell/surface';

export function CalendarSettings({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const q = useCalendarLabels();
  const labels = q.data?.labels ?? [];
  const scopes: { key: string; title: string; org: string | null }[] = [
    ...me.scopes.map((o) => ({ key: `org:${o.org}`, title: t('calendar.scopeWork', { name: orgName(me.scopes, o.org) }), org: o.org })),
    ...(me.user ? [{ key: 'user', title: t('calendar.scopePersonal'), org: null }] : []),
  ];
  const [tab, setTab] = useState(scopes[0]?.key ?? 'user');
  const current = scopes.find((s) => s.key === tab) ?? scopes[0];
  const mine = labels.filter((l) => (current?.org ? l.scope_kind === 'org' && l.scope === current.org : l.scope_kind === 'user'));
  return (
    <Modal label={t('calendar.settingsTitle')} onClose={onClose} className="cal-settings">
      <h2 className="modal-title">{t('calendar.settingsTitle')}</h2>
      <p className="hint">{t('calendar.labelsHint')}</p>
      <ViewOnlyArea name="calendar.settings" inline>
      {scopes.length > 1 && (
        <div className="segmented cal-scope-tabs" role="tablist" aria-label={t('calendar.business')}>
          {scopes.map((s) => (
            <button key={s.key} role="tab" aria-selected={s.key === current?.key} className={s.key === current?.key ? 'is-active' : ''} onClick={() => setTab(s.key)} title={s.title}>
              {s.title}
            </button>
          ))}
        </div>
      )}
      {current?.org && q.data?.preset_errors[current.org] && (
        <p className="hint with-icon">
          <ICON.warn size={14} className="warn-icon" />
          {t('calendar.presetError')}
        </p>
      )}
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <QueryError error={q.error} />
      ) : (
        current && (
          <div className="cal-label-groups">
            <LabelGroup type="category" title={t('calendar.categories')} labels={mine.filter((l) => l.type === 'category')} org={current.org} />
            <LabelGroup type="tag" title={t('calendar.tags')} labels={mine.filter((l) => l.type === 'tag')} org={current.org} />
          </div>
        )
      )}
      {current && !current.org && <AgentAccessPanel compact />}
      </ViewOnlyArea>
    </Modal>
  );
}

function LabelGroup({ type, title, labels, org }: { type: 'category' | 'tag'; title: string; labels: CalendarLabel[]; org: string | null }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const create = useCalendarAction((body: Record<string, unknown>) => calendarApi.createLabel(body));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const color = PALETTE[labels.length % PALETTE.length];
    create.mutate(org ? { type, org, name: name.trim(), color } : { type, personal: true, name: name.trim(), color }, { onSuccess: () => setName('') });
  };
  return (
    <section className="cal-label-group" aria-label={title} data-testid={`labels-${type}`}>
      <h3 className="panel-title">{title}</h3>
      <ul className="cal-label-list">
        {labels.map((l) => (
          <LabelRow key={l.id} label={l} />
        ))}
      </ul>
      <form className="cal-inline-add" onSubmit={submit}>
        <ICON.new size={14} aria-hidden />
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={type === 'category' ? t('calendar.addCategory') : t('calendar.addTag')} aria-label={type === 'category' ? t('calendar.addCategory') : t('calendar.addTag')} />
      </form>
      {create.error && (
        <p className="form-error" role="alert">
          {errorText(create.error, t)}
        </p>
      )}
    </section>
  );
}

function LabelRow({ label }: { label: CalendarLabel }) {
  const { t } = useI18n();
  const update = useCalendarAction((body: Record<string, unknown>) => calendarApi.updateLabel(label.id, body));
  return (
    <li className={`cal-label-row ${label.archived ? 'is-archived' : ''}`}>
      <Dot color={label.color} />
      <input
        className="cal-label-name"
        defaultValue={label.name}
        aria-label={t('calendar.labelName')}
        maxLength={40}
        onBlur={(e) => e.target.value.trim() && e.target.value !== label.name && update.mutate({ name: e.target.value.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="cal-swatches" role="radiogroup" aria-label={t('calendar.color')}>
        {PALETTE.map((c: PaletteKey) => (
          <button
            key={c}
            role="radio"
            aria-checked={label.color === c}
            className={`cal-swatch ${label.color === c ? 'is-on' : ''}`}
            data-color={c}
            aria-label={t(`calendar.color.${c}`)}
            title={t(`calendar.color.${c}`)}
            onClick={() => label.color !== c && update.mutate({ color: c })}
          />
        ))}
      </div>
      {label.archived && <span className="chip is-quiet">{t('calendar.archived')}</span>}
      <button className="btn is-small" onClick={() => update.mutate({ archived: !label.archived })}>
        {label.archived ? t('calendar.unarchive') : t('calendar.archive')}
      </button>
      {update.error && (
        <p className="form-error" role="alert">
          {errorText(update.error, t)}
        </p>
      )}
    </li>
  );
}
