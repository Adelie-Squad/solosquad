import { useState, type FormEvent } from 'react';
import { errorText } from '../../api/errors';
import { useAction, useBusinessEntity, useConnections, useEntities, useKeys, useScopedApi } from '../../api/queries';
import type { BusinessEntity, ConnectionOut, LegalEntity, Ok } from '../../api/types.gen';
import { Loading, QueryError } from '../../components/Status';
import { useI18n, type Translate } from '../../i18n';
import { ICON } from '../../icons';
import { useOrgOwner } from '../../scope';
import { entityOption } from './CompanySettings';

const KINDS: ConnectionOut['kind'][] = ['api_key', 'subscription', 'local_llm'];

/** Why a connection is refused, in the reader's words — the codes the add form already shows
 * (`connection_ineligible_company` · `_server`), plus which entity the rule refused. */
export function ineligibleText(c: ConnectionOut, t: Translate): string {
  if (!c.eligibility_by || !c.eligibility_provider || !c.eligibility_country) return c.eligibility_reason ?? '';
  const vars = { provider: c.eligibility_provider, country: c.eligibility_country };
  if (c.eligibility_by === 'server') return t('error.connection_ineligible_server', vars);
  const base = t('error.connection_ineligible_company', vars);
  return c.eligibility_entity ? `${base} ${t('connections.refusedEntity', { entity: c.eligibility_entity })}` : base;
}

/**
 * LLM connections — which accounts the agents run on and whether the region rule allows them
 * (decision 45 · I23 · I32). Since 2026-11-14 (여러 법인) the 사업 has a 소속 법인 (top panel) and each
 * account a 보유 법인; the rule must hold for both. Everyone sees the list; adding, switching,
 * choosing the entities and removing are the owner's. Lives in Settings › Connections
 * (`/o/<org>/settings/connections`) since it is set up once and rarely visited.
 */
export function ConnectionsSettings() {
  const keys = useKeys();
  const { org: orgApi } = useScopedApi();
  const { t, fmt } = useI18n();
  const isOwner = useOrgOwner();
  const q = useConnections();
  const ents = useEntities();
  const entities = ents.data?.entities ?? [];
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = useAction((c: ConnectionOut) => orgApi.patch<ConnectionOut>(`/connections/${c.id}`, { active: !c.active }), [keys.connections, keys.budget]);
  const remove = useAction((id: string) => orgApi.del<Ok>(`/connections/${id}`), [keys.connections, keys.budget]);
  const holder = useAction(
    ({ c, entity_id }: { c: ConnectionOut; entity_id: number }) => orgApi.patch<ConnectionOut>(`/connections/${c.id}`, { entity_id }),
    [keys.connections, keys.budget, keys.entities],
  );
  const onError = (e: unknown) => setError(errorText(e, t));

  return (
    <div className="settings-stack">
      <header className="section-head">
        <p className="settings-hint">{t('connections.lead')}</p>
        {isOwner && !adding && (
          <button className="btn is-primary with-icon" onClick={() => setAdding(true)}>
            <ICON.new />
            {t('connections.add')}
          </button>
        )}
      </header>
      {entities.length > 0 && <BusinessEntityPanel entities={entities} />}
      {adding && isOwner && <AddConnection entities={entities} onDone={() => setAdding(false)} />}
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
                <strong className="conn-name">{c.id}</strong>
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
                <dt>{t('connections.budget')}</dt>
                <dd>{c.monthly_budget_usd != null ? fmt.usd(c.monthly_budget_usd) : t('connections.noBudget')}</dd>
                <dt>{t('connections.secret')}</dt>
                <dd>{c.secret_last4 ? `••••${c.secret_last4}` : '—'}</dd>
                {entities.length > 0 && (
                  <>
                    <dt>
                      <label htmlFor={`conn-${c.id}-owner`}>{t('connections.owner')}</label>
                    </dt>
                    <dd>
                      {isOwner && c.source !== 'core' ? (
                        <select
                          id={`conn-${c.id}-owner`}
                          className="is-small"
                          value={c.entity_id ?? ''}
                          disabled={holder.isPending}
                          onChange={(e) => {
                            setError(null);
                            holder.mutate({ c, entity_id: Number(e.target.value) }, { onError });
                          }}
                        >
                          {entities.map((e) => (
                            <option key={e.id} value={e.id}>
                              {entityOption(e, t)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span id={`conn-${c.id}-owner`}>{entityName(entities, c.entity_id)}</span>
                      )}
                    </dd>
                  </>
                )}
                <dt>{t('connections.eligibility')}</dt>
                <dd>
                  {c.eligible ? (
                    <span className="chip is-ok">
                      <ICON.done size={14} />
                      {t('connections.eligible')}
                    </span>
                  ) : (
                    <span className="eligibility-reason">
                      <span className="chip is-danger">
                        <ICON.error size={14} />
                        {t('connections.ineligible')}
                      </span>{' '}
                      {ineligibleText(c, t)}
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

const entityName = (entities: LegalEntity[], id: number | null) => entities.find((e) => e.id === id)?.name ?? '—';

/** 이 사업의 소속 법인 — every workspace of the 사업 runs under it (`PUT /o/<org>/entity`). */
function BusinessEntityPanel({ entities }: { entities: LegalEntity[] }) {
  const keys = useKeys();
  const { org: orgApi } = useScopedApi();
  const { t } = useI18n();
  const isOwner = useOrgOwner();
  const q = useBusinessEntity();
  const [error, setError] = useState<string | null>(null);
  const save = useAction((entity_id: number) => orgApi.put<BusinessEntity>('/entity', { entity_id }), [keys.orgEntity, keys.connections, keys.budget, keys.entities]);
  const current = q.data?.entity_id ?? null;
  return (
    <section className="panel business-entity">
      <div className="field">
        <label id="business-entity-label" htmlFor="business-entity">
          {t('connections.businessEntity')}
        </label>
        {isOwner ? (
          <select
            id="business-entity"
            value={current ?? ''}
            disabled={save.isPending || q.isPending}
            aria-describedby="business-entity-hint"
            onChange={(e) => {
              setError(null);
              save.mutate(Number(e.target.value), { onError: (err) => setError(errorText(err, t)) });
            }}
          >
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {entityOption(e, t)}
              </option>
            ))}
          </select>
        ) : (
          <strong id="business-entity">{entityName(entities, current)}</strong>
        )}
        <small id="business-entity-hint" className="dash-hint">
          {t('connections.businessEntityHint')}
        </small>
        {error && <small className="form-error">{error}</small>}
      </div>
    </section>
  );
}

function AddConnection({ entities, onDone }: { entities: LegalEntity[]; onDone: () => void }) {
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
    entity_id: '',
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
        entity_id: form.entity_id ? Number(form.entity_id) : undefined,
      }),
    [keys.connections, keys.budget],
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    add.mutate(undefined, {
      onSuccess: onDone,
      // connection_ineligible_* = the region rule refused it (provider · country in params);
      // company_required = C18, the 회사 has no country yet for a key that reaches a provider
      onError: (err) => setError(errorText(err, t)),
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
      {entities.length > 0 && (
        <label className="field">
          <span>{t('connections.owner')}</span>
          <select value={form.entity_id} onChange={set('entity_id')}>
            <option value="">{t('connections.ownerPrimary')}</option>
            {entities
              .filter((e) => !e.is_primary)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <p className="dash-hint is-wide">{t('connections.holderHint')}</p>
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
