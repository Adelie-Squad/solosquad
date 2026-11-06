import { useAction, useKeys, useSchedules, useScopedApi } from '../api/queries';
import type { ScheduleEntry, WorkflowSummary } from '../api/types.gen';
import { Loading, Placeholder, QueryError } from '../components/Status';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { cronText } from '../lib/cron';
import { readable } from '../lib/names';
import { useOrgOwner } from '../scope';
import { RUN_STATUS, WorkflowTabs } from './WorkflowsView';

export const SCHEDULE_KIND: Record<ScheduleEntry['kind'], MessageKey> = {
  workflow: 'schedule.kind.workflow',
  goal: 'schedule.kind.goal',
  routine: 'schedule.kind.routine',
};

/** The schedule's name as people read it: a workflow's title, a cron file's readable name. */
export const scheduleTitle = (s: Pick<ScheduleEntry, 'kind' | 'title' | 'name'>) => (s.kind === 'workflow' ? s.title : readable(s.name));

/**
 * The schedule view of the workflows (2026-11-07 — the scheduler joined the workflows): every
 * run this workspace makes on its own — workflow schedules, standing goals, routines — when it
 * fires next and how it went last time. The owner switches a workflow's schedule here; staff read.
 */
export function ScheduleView() {
  const { t } = useI18n();
  const q = useSchedules();
  const isOwner = useOrgOwner();

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('workflows.title')}</h1>
          <p>
            {q.data ? t('schedule.lead', { tz: q.data.timezone }) : ''}
            {!isOwner && q.data ? ` ${t('schedule.staffNote')}` : ''}
          </p>
        </div>
        <WorkflowTabs current="schedule" />
      </header>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <QueryError error={q.error} />
      ) : (
        <>
          {q.data.errors.length > 0 && <Placeholder title={t('schedule.brokenFiles')} detail={q.data.errors.join(' · ')} />}
          {q.data.schedules.length === 0 ? (
            <div className="panel empty">{t('schedule.none')}</div>
          ) : (
            <ul className="panel schedule-list" data-testid="schedule-list">
              {q.data.schedules.map((s) => (
                <ScheduleRow key={s.id} item={s} canSwitch={isOwner && s.workflow !== null} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ScheduleRow({ item: s, canSwitch }: { item: ScheduleEntry; canSwitch: boolean }) {
  const keys = useKeys();
  const { org: orgApi } = useScopedApi();
  const { t, fmt, locale } = useI18n();
  const toggle = useAction((on: boolean) => orgApi.patch<WorkflowSummary>(`/workflows/${s.workflow}`, { enabled: on }), [keys.schedules, keys.workflows]);
  const title = scheduleTitle(s);
  return (
    <li className={`schedule-row ${s.enabled ? '' : 'is-off'}`} data-testid="schedule-row">
      <span className="schedule-icon" aria-hidden>
        {s.kind === 'workflow' ? <ICON.workflows size={18} /> : <ICON.schedule size={18} />}
      </span>
      <span className="schedule-body">
        <span className="schedule-title">
          <strong>{title}</strong>
          <span className="chip">{t(SCHEDULE_KIND[s.kind])}</span>
        </span>
        <span className="schedule-cadence" title={s.schedule}>
          {cronText(s.schedule, locale, t)}
        </span>
        <span className="schedule-meta">
          {s.next_run != null ? (
            <span title={fmt.dateTime(s.next_run)}>{t('schedule.next', { when: fmt.relative(s.next_run) })}</span>
          ) : (
            <span>{s.enabled ? t('schedule.noNext') : t('workflows.off')}</span>
          )}
          {s.last_run ? (
            <span className="with-icon">
              {t('schedule.lastRun', { when: fmt.relative(s.last_run.created) })}
              <span className={`chip ${RUN_STATUS[s.last_run.status].chip}`}>{t(RUN_STATUS[s.last_run.status].label)}</span>
            </span>
          ) : (
            <span>{t('schedule.never')}</span>
          )}
        </span>
      </span>
      <span className="schedule-switch">
        {canSwitch ? (
          <button
            className="toggle"
            role="switch"
            aria-checked={s.enabled}
            aria-label={t('workflows.switch', { name: title })}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(!s.enabled)}
          />
        ) : (
          <span className={`chip ${s.enabled ? 'is-ok' : ''}`} title={s.workflow === null ? t('schedule.fileSwitch') : undefined}>
            {s.enabled ? t('workflows.on') : t('workflows.off')}
          </span>
        )}
      </span>
    </li>
  );
}
