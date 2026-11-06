import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAction, useConnections, useKeys, useScopedApi } from '../api/queries';
import type { ConnectionOut, Ok } from '../api/types.gen';
import { Loading, QueryError } from '../components/Status';
import { useI18n } from '../i18n';
import { useOrgOwner } from '../scope';

const KINDS: ConnectionOut['kind'][] = ['api_key', 'subscription', 'local_llm'];

/**
 * LLM connections — which accounts the agents run on, whose legal entity holds them, and
 * whether the region rule allows them (decision 45 · I23 · I32). Everyone sees the list;
 * adding, switching and removing are the owner's.
 */
export function ConnectionsView() {
  const keys = useKeys();
  const { org: orgApi } = useScopedApi();
  const { t, fmt } = useI18n();
  const isOwner = useOrgOwner();
  const q = useConnections();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = useAction((c: ConnectionOut) => orgApi.patch<ConnectionOut>(`/connections/${c.id}`, { active: !c.active }), [keys.connections, keys.budget]);
  const remove = useAction((id: string) => orgApi.del<Ok>(`/connections/${id}`), [keys.connections, keys.budget]);
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.failed'));

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('connections.title')}</h1>
          <p>{t('connections.lead')}</p>
        </div>
        {isOwner && !adding && (
          <button className="btn is-primary" onClick={() => setAdding(true)}>
            + {t('connections.add')}
          </button>
        )}
      </header>
      {adding && isOwner && <AddConnection onDone={() => setAdding(false)} />}
      {error && <p className="form-error">{error}</p>}
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <QueryError error={q.error} />
      ) : q.data.length === 0 ? (
        <div className="panel empty">{t('connections.none')}</div>
      ) : (
        <div className="stack">
          {q.data.map((c) => (
            <article key={c.id} className={`panel conn ${c.active ? '' : 'is-off'}`}>
              <header className="conn-head">
                <strong>{c.id}</strong>
                <span className="chip">{t(`connections.kind.${c.kind}`)}</span>
                <span className="chip">
                  {c.provider} · {c.harness}
                </span>
                <span className={`chip ${c.active ? 'is-ok' : ''}`}>{c.active ? t('connections.active') : t('connections.inactive')}</span>
                {c.source === 'core' && <span className="chip is-muted">{t('connections.fromCore')}</span>}
                {isOwner && c.source !== 'core' && (
                  <span className="conn-actions">
                    <button
                      className="toggle"
                      role="switch"
                      aria-checked={c.active}
                      aria-label={t('connections.toggle', { id: c.id })}
                      onClick={() => {
                        setError(null);
                        toggle.mutate(c, { onError });
                      }}
                    />
                    <button
                      className="btn is-small is-danger"
                      onClick={() => {
                        if (window.confirm(t('connections.confirmRemove', { id: c.id }))) remove.mutate(c.id, { onError });
                      }}
                    >
                      {t('common.remove')}
                    </button>
                  </span>
                )}
              </header>
              <dl className="conn-facts">
                <dt>{t('connections.models')}</dt>
                <dd>{c.models.length ? c.models.join(', ') : '—'}</dd>
                <dt>{t('connections.entity')}</dt>
                <dd>
                  {c.entity ? `${c.entity.name} (${c.entity.country}${c.entity.controlled_by ? ` · ${t('connections.controlledBy', { country: c.entity.controlled_by })}` : ''})` : t('connections.noEntity')}
                </dd>
                <dt>{t('connections.budget')}</dt>
                <dd>{c.monthly_budget_usd != null ? fmt.usd(c.monthly_budget_usd) : t('connections.noBudget')}</dd>
                <dt>{t('connections.secret')}</dt>
                <dd>{c.secret_last4 ? `••••${c.secret_last4}` : '—'}</dd>
                <dt>{t('connections.eligibility')}</dt>
                <dd>
                  {c.eligible ? (
                    <span className="chip is-ok">✓ {t('connections.eligible')}</span>
                  ) : (
                    <span className="eligibility-reason">
                      <span className="chip is-danger">✕ {t('connections.ineligible')}</span> {c.eligibility_reason}
                      {c.eligibility_source && <span className="dash-hint"> — {c.eligibility_source}</span>}
                    </span>
                  )}
                </dd>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AddConnection({ onDone }: { onDone: () => void }) {
  const keys = useKeys();
  const { org: orgApi } = useScopedApi();
  const { t } = useI18n();
  const [form, setForm] = useState({
    id: '',
    kind: 'api_key' as ConnectionOut['kind'],
    provider: 'anthropic',
    harness: 'lite',
    models: '',
    secret: '',
    secret_env: '',
    monthly_budget_usd: '',
    entity_name: '',
    entity_country: '',
    entity_controlled_by: '',
  });
  const [error, setError] = useState<string | null>(null);
  const add = useAction(
    () =>
      orgApi.post<ConnectionOut>('/connections', {
        id: form.id.trim(),
        kind: form.kind,
        provider: form.provider.trim(),
        harness: form.harness.trim(),
        models: form.models.split(',').map((m) => m.trim()).filter(Boolean),
        secret: form.secret || undefined,
        secret_env: form.secret_env || undefined,
        monthly_budget_usd: form.monthly_budget_usd ? Number(form.monthly_budget_usd) : undefined,
        entity: form.entity_name
          ? {
              name: form.entity_name.trim(),
              country: form.entity_country.trim().toUpperCase(),
              controlled_by: form.entity_controlled_by.trim().toUpperCase() || null,
            }
          : undefined,
      }),
    [keys.connections, keys.budget],
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    add.mutate(undefined, {
      onSuccess: onDone,
      // 422 = the region rule refused it; the reason and its source come from the engine
      // 400 "entity that holds" = C18, no holder for a key that reaches a provider
      onError: (err) =>
        setError(
          err instanceof ApiError
            ? err.message.includes('entity that holds')
              ? t('connections.entityRequired')
              : err.message
            : t('common.failed'),
        ),
    });
  };

  return (
    <form className="panel form-grid" onSubmit={submit}>
      <h2 className="panel-title">{t('connections.add')}</h2>
      <label className="field">
        <span>{t('connections.id')} *</span>
        <input value={form.id} onChange={set('id')} required pattern="[A-Za-z0-9._-]+" />
      </label>
      <label className="field">
        <span>{t('connections.kindLabel')}</span>
        <select value={form.kind} onChange={set('kind')}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`connections.kind.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('connections.provider')}</span>
        <input value={form.provider} onChange={set('provider')} />
      </label>
      <label className="field">
        <span>{t('connections.harness')}</span>
        <input value={form.harness} onChange={set('harness')} />
      </label>
      <label className="field">
        <span>{t('connections.models')}</span>
        <input value={form.models} onChange={set('models')} placeholder="model-a, model-b" />
      </label>
      <label className="field">
        <span>{t('connections.secret')}</span>
        <input type="password" autoComplete="off" value={form.secret} onChange={set('secret')} />
        <small className="dash-hint">{t('connections.secretHint')}</small>
      </label>
      <label className="field">
        <span>{t('connections.secretEnv')}</span>
        <input value={form.secret_env} onChange={set('secret_env')} placeholder="ANTHROPIC_API_KEY" />
      </label>
      <label className="field">
        <span>{t('connections.budget')} (USD)</span>
        <input type="number" min="0" step="1" value={form.monthly_budget_usd} onChange={set('monthly_budget_usd')} />
      </label>
      <fieldset className="field">
        <legend>{t('connections.entity')}</legend>
        <p className="dash-hint">{t('connections.entityHint')}</p>
        <input placeholder={t('connections.entityName')} value={form.entity_name} onChange={set('entity_name')} />
        <input placeholder={t('connections.entityCountry')} value={form.entity_country} onChange={set('entity_country')} maxLength={2} />
        <input placeholder={t('connections.entityControl')} value={form.entity_controlled_by} onChange={set('entity_controlled_by')} maxLength={2} />
      </fieldset>
      {error && <p className="form-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="btn is-primary" disabled={add.isPending}>
          {t('connections.add')}
        </button>
      </div>
    </form>
  );
}
