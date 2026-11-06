import { useLinks } from '../scope';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { errorText } from '../api/errors';
import { useAction, useApprovals, useKeys, useScopedApi, useWorkflowRuns, useWorkflows, useWorkflowState } from '../api/queries';
import type { Run, Upload, WorkflowRunCreated, WorkflowSummary } from '../api/types.gen';
import { ApprovalCard } from '../components/ApprovalCard';
import { Loading, Placeholder, QueryError, SavedLine } from '../components/Status';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { cronText } from '../lib/cron';
import { readable } from '../lib/names';
import { useOrgOwner } from '../scope';

export const RUN_STATUS: Record<Run['status'], { label: MessageKey; chip: string }> = {
  pending: { label: 'run.pending', chip: '' },
  running: { label: 'run.running', chip: 'is-accent' },
  interrupted: { label: 'run.interrupted', chip: 'is-warn' },
  success: { label: 'run.success', chip: 'is-ok' },
  error: { label: 'run.error', chip: 'is-danger' },
  cancelled: { label: 'run.cancelled', chip: '' },
};

/** The two views of the workflows screen — the workflows, and their schedule (2026-11-07). */
export function WorkflowTabs({ current }: { current: 'workflows' | 'schedule' }) {
  const { w: toWs } = useLinks();
  const { t } = useI18n();
  const tabs = [
    { id: 'workflows', to: toWs('/workflows'), label: t('workflows.tabFlows'), icon: ICON.workflows },
    { id: 'schedule', to: toWs('/schedule'), label: t('schedule.tab'), icon: ICON.schedule },
  ] as const;
  return (
    <nav className="segmented wf-tabs" aria-label={t('workflows.views')}>
      {tabs.map((tab) => (
        <Link key={tab.id} to={tab.to} className={`with-icon ${current === tab.id ? 'is-active' : ''}`} aria-current={current === tab.id ? 'page' : undefined}>
          <tab.icon />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Workflows — list, switch (owner), run with an upload, and each run's status (I12 · I26 · I27). */
export function WorkflowsView() {
  const { w: toWs } = useLinks();
  const { name } = useParams<{ name?: string }>();
  const { t, fmt } = useI18n();
  const q = useWorkflows();

  if (q.isPending) return <div className="view"><Loading /></div>;
  if (q.error) return <div className="view"><QueryError error={q.error} /></div>;
  const list = q.data.workflows;
  if (!name && list.length) return <Navigate to={toWs(`/workflows/${list[0].name}`)} replace />;
  const current = list.find((w) => w.name === name);

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('workflows.title')}</h1>
          <p>{t('workflows.lead')}</p>
        </div>
        <WorkflowTabs current="workflows" />
      </header>
      {q.data.errors.length > 0 && <Placeholder title={t('workflows.brokenFiles')} detail={q.data.errors.join(' · ')} />}
      {list.length === 0 ? (
        <div className="panel empty">{t('workflows.none')}</div>
      ) : (
        <nav className="wf-cards" aria-label={t('workflows.title')}>
          {list.map((w) => (
            <Link key={w.name} to={toWs(`/workflows/${w.name}`)} className={`panel wf-card ${w.name === name ? 'is-selected' : ''}`}>
              <span className="wf-card-icon">
                <ICON.workflows size={20} />
              </span>
              <span className="wf-card-body">
                <strong>{w.title}</strong>
                <span className="wf-card-meta">
                  {w.enabled ? t('workflows.on') : t('workflows.off')}
                  {w.last_run ? ` · ${t('workflows.lastRun', { when: fmt.relative(w.last_run.created) })}` : ''}
                </span>
              </span>
            </Link>
          ))}
        </nav>
      )}
      {current ? <WorkflowDetail key={current.name} wf={current} /> : name && <div className="panel empty">{t('workflows.notFound')}</div>}
    </div>
  );
}

function WorkflowDetail({ wf }: { wf: WorkflowSummary }) {
  const keys = useKeys();
  const { w: toWs } = useLinks();
  const { org: orgApi } = useScopedApi();
  const { t, fmt, locale } = useI18n();
  const isOwner = useOrgOwner();
  const runs = useWorkflowRuns(wf.name);
  const toggle = useAction((on: boolean) => orgApi.patch<WorkflowSummary>(`/workflows/${wf.name}`, { enabled: on }), [keys.workflows, keys.schedules]);

  return (
    <>
      <section className="panel wf-detail">
        <header className="wf-detail-head">
          <span className="wf-detail-icon">
            <ICON.workflows size={24} />
          </span>
          <div className="wf-detail-title">
            <h2>{wf.title}</h2>
            <p>{wf.description}</p>
          </div>
          {isOwner && (
            <button
              className="toggle"
              role="switch"
              aria-checked={wf.enabled}
              aria-label={t('workflows.switch', { name: wf.title })}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(!wf.enabled)}
            />
          )}
        </header>
        <div className="wf-meta">
          {wf.team && (
            <span className="chip">
              <ICON.team size={14} />
              {readable(wf.team)}
            </span>
          )}
          {wf.schedule && (
            <Link className="chip" to={toWs('/schedule')} title={wf.schedule}>
              <ICON.schedule size={14} />
              {cronText(wf.schedule, locale, t)}
            </Link>
          )}
          <span className={`chip ${wf.enabled ? 'is-ok' : ''}`}>{wf.enabled ? t('workflows.on') : t('workflows.off')}</span>
        </div>
        <ol className="pipeline">
          {wf.steps.map((s) => (
            <li key={s.id} className={`pipe-step is-idle ${s.type === 'approval' ? 'has-approval' : ''}`}>
              <span className="pipe-name">{s.title}</span>
              {s.type === 'approval' && (
                <span className="pipe-approval">
                  <ICON.person size={14} />
                  {t('workflows.approvalStep')}
                </span>
              )}
            </li>
          ))}
        </ol>
        <RunForm wf={wf} />
      </section>

      <section className="panel">
        <h2 className="panel-title">{t('workflows.recent')}</h2>
        {runs.isPending ? (
          <Loading />
        ) : (runs.data ?? []).length === 0 ? (
          <p className="dash-hint">{t('workflows.noRuns')}</p>
        ) : (
          <ul className="run-list">
            {(runs.data ?? []).map((r) => (
              <li key={r.id}>
                <Link to={toWs(`/workflows/${wf.name}/runs/${r.thread_id}`)} className="run-row">
                  <span className={`chip ${RUN_STATUS[r.status].chip}`}>{t(RUN_STATUS[r.status].label)}</span>
                  <span>{fmt.dateTime(r.created)}</span>
                  <span className="dash-hint">{r.source ?? ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Inputs → (upload files first) → run. The file goes to the engine, never anywhere else. */
function RunForm({ wf }: { wf: WorkflowSummary }) {
  const keys = useKeys();
  const { w: toWs } = useLinks();
  const { ws: wsApi } = useScopedApi();
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const inputs: Record<string, unknown> = {};
      for (const input of wf.inputs) {
        if (input.type === 'upload') {
          const file = files[input.name];
          if (!file) continue;
          const up = await wsApi.upload<Upload>('/uploads', file, { filename: file.name });
          inputs[input.name] = up.id;
        } else if (values[input.name] !== undefined && values[input.name] !== '') {
          inputs[input.name] = input.type === 'number' ? Number(values[input.name]) : values[input.name];
        }
      }
      const run = await wsApi.post<WorkflowRunCreated>(`/workflows/${wf.name}/run`, { inputs });
      await qc.invalidateQueries({ queryKey: keys.workflowRuns() });
      navigate(toWs(`/workflows/${wf.name}/runs/${run.thread_id}`));
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const ready = wf.inputs.every((i) => !i.required || (i.type === 'upload' ? !!files[i.name] : !!values[i.name]));

  return (
    <form className="run-form" onSubmit={submit}>
      {wf.inputs.map((input) => (
        <label key={input.name} className="field">
          <span>
            {input.label || input.name}
            {input.required ? ' *' : ''}
          </span>
          {input.type === 'upload' ? (
            <input
              type="file"
              accept={input.accept.map((a) => `.${a.replace(/^\./, '')}`).join(',')}
              onChange={(e) => setFiles((f) => ({ ...f, [input.name]: e.target.files?.[0] ?? null }))}
            />
          ) : (
            <input
              type={input.type === 'number' ? 'number' : 'text'}
              value={values[input.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [input.name]: e.target.value }))}
            />
          )}
          {input.type === 'upload' && <small className="dash-hint">{t('workflows.uploadHint', { types: input.accept.join(', ') })}</small>}
        </label>
      ))}
      {error && <p className="form-error">{error}</p>}
      <button className="btn is-primary" disabled={busy || !ready || !wf.enabled}>
        {busy ? t('common.wait') : t('workflows.runNow')}
      </button>
      {!wf.enabled && <span className="dash-hint">{t('workflows.offHint')}</span>}
    </form>
  );
}

/** One workflow run: where it is, what it waits for, what it made. */
export function WorkflowRunView() {
  const { w: toWs } = useLinks();
  const { name = '', tid } = useParams<{ name: string; tid: string }>();
  const { t } = useI18n();
  const wfs = useWorkflows();
  const state = useWorkflowState(tid);
  const runs = useWorkflowRuns(name);
  const approvals = useApprovals();
  const wf = wfs.data?.workflows.find((w) => w.name === name);
  const run = (runs.data ?? []).find((r) => r.thread_id === tid);
  const waiting = (approvals.data ?? []).filter((a) => a.source === 'workflow' && a.thread_id === tid);

  if (state.isPending || wfs.isPending) return <div className="view"><Loading /></div>;
  if (state.error) return <div className="view"><QueryError error={state.error} /></div>;
  const v = state.data.values;
  const step = v.step ?? 0;
  const status = v.status;
  const stepClass = (i: number) => {
    if (status === 'done' || i < step) return 'is-done';
    if (i === step) return waiting.length ? 'is-waiting' : status === 'declined' ? 'is-pending' : 'is-current';
    return 'is-pending';
  };

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <p className="crumb">
            <Link className="with-icon" to={toWs(`/workflows/${name}`)}>
              <ICON.back />
              {wf?.title ?? name}
            </Link>
          </p>
          <h1>{t('workflows.runTitle', { name: wf?.title ?? name })}</h1>
        </div>
        {run && <span className={`chip ${RUN_STATUS[run.status].chip}`}>{t(RUN_STATUS[run.status].label)}</span>}
      </header>
      <section className="panel wf-detail">
        <ol className="pipeline">
          {(wf?.steps ?? []).map((s, i) => (
            <li key={s.id} className={`pipe-step ${stepClass(i)} ${s.type === 'approval' ? 'has-approval' : ''}`}>
              <span className="pipe-name">{s.title}</span>
              {s.type === 'approval' && (
                <span className="pipe-approval">
                  <ICON.person size={14} />
                  {t('workflows.approvalStep')}
                </span>
              )}
            </li>
          ))}
        </ol>
        {status === 'done' && <SavedLine text={t('workflows.done')} />}
        {status === 'declined' && <p className="warn-line">{t('workflows.declined')}</p>}
        {run?.status === 'error' && <p className="form-error">{run.error}</p>}
      </section>
      {waiting.map((a) => (
        <ApprovalCard key={a.run_id} item={a} />
      ))}
      {v.artifacts.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">{t('workflows.made')}</h2>
          <ul className="run-list">
            {v.artifacts.map((id) => (
              <li key={id}>
                <Link className="run-row" to={toWs(`/tasks/artifacts/${id}`)}>
                  <ICON.artifacts className="run-row-icon" />
                  <span className="run-row-title is-id">{id}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
