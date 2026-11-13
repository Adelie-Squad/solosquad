// 회사 = the customer's legal entities (user 2026-11-14 — "어 여러 개 등록할 수 있어": a Korean HQ and a
// Chinese sourcing subsidiary are two 법인 of one customer). core.db `entities` via `/api/entities`:
// everyone reads the list, the owner adds, edits, makes one the 대표 법인 and removes one nothing
// uses. Each 사업 runs under one entity (설정 › 연결, 소속 법인) and each AI account is held by one
// (보유 법인) — the region rules judge both (decision 45). The add/edit modal asks the country first
// (한국 by default) and takes the registration number like the demo request form: a Korean number is
// digits with its hyphens put in (개인 사업자 10 · 법인 13, check digit), China's code 18 upper-case
// characters — the same rules file as the marketing Worker (marketing/scripts/lib/company-no.mjs).
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { checkCompanyNo, displayCompanyNo, formatCompanyNo, kindForCountry, maxDigits, takesLetters, type CompanyNoKind } from '../../../../marketing/scripts/lib/company-no.mjs';
import { api, ApiError } from '../../api/client';
import { errorCode, errorText } from '../../api/errors';
import { keys, useAction, useEntities } from '../../api/queries';
import type { EntityList, LegalEntity } from '../../api/types.gen';
import { DigitsInput } from '../../components/DigitsInput';
import { Modal } from '../../components/Modal';
import { Loading, QueryError } from '../../components/Status';
import { useI18n, type MessageKey, type Translate } from '../../i18n';
import { ICON } from '../../icons';
import { countryName, countryOptions } from '../../lib/countries';
import { useSession } from '../../session';

const HOME = 'KR';
type Kind = NonNullable<LegalEntity['kind']>;
type KoreanKind = 'sole_proprietor' | 'corporation';
type Field = 'country' | 'kind' | 'registration_no' | 'name' | 'representative' | 'address' | 'controlled_by';

/** The number's kind for a country and a Korean pick (the marketing form's rule). */
const numberKind = (country: string, kind: KoreanKind): CompanyNoKind => kindForCountry(country.toLowerCase(), kind === 'corporation' ? 'corporate' : 'business');

/** 사업자등록번호 · 법인등록번호 · 统一社会信用代码 · another country's number, by kind. */
export const registrationLabel = (kind: string | null | undefined): MessageKey => `company.registration.${(kind ?? 'foreign') as CompanyNoKind}`;

export function kindLabel(e: Pick<LegalEntity, 'kind'>, t: Translate): string {
  return e.kind ? t(`company.kind.${e.kind}`) : '—';
}

/** The entity's name for a select: "모아리빙 주식회사 · 대표 법인". */
export const entityOption = (e: LegalEntity, t: Translate) => (e.is_primary ? `${e.name || '—'} · ${t('company.primary')}` : e.name || '—');

export function CompanySettings() {
  const q = useEntities();
  if (q.isPending) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  return <EntityListPanel entities={q.data.entities} />;
}

function EntityListPanel({ entities }: { entities: LegalEntity[] }) {
  const { t, locale } = useI18n();
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<LegalEntity | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const after = [keys.entities, keys.company];
  // the connections' verdicts follow the entities (every org's list)
  const refresh = () => qc.invalidateQueries({ predicate: (query) => query.queryKey.includes('connections') || query.queryKey.includes('entity') });
  const primary = useAction(async (e: LegalEntity) => {
    const list = await api.post<EntityList>(`/entities/${e.id}/primary`);
    qc.setQueryData(keys.entities, list);
    void refresh();
    return list;
  }, after);
  const remove = useAction((e: LegalEntity) => api.del(`/entities/${e.id}`), after);
  const onError = (err: unknown) => setError(errorText(err, t));

  return (
    <section className="panel settings-body" aria-labelledby="company-title">
      <div className="members-head">
        <div>
          <h2 id="company-title" className="panel-title">
            {t('settings.company')}
          </h2>
          <p className="settings-hint">{t('company.lead')}</p>
        </div>
        {isOwner && (
          <button type="button" className="btn is-primary with-icon" onClick={() => setEditing('new')}>
            <ICON.new />
            {t('company.add')}
          </button>
        )}
      </div>
      {!isOwner && <p className="settings-note">{t('settings.readOnly')}</p>}
      {error && <p className="form-error">{error}</p>}
      {entities.length === 0 ? (
        <p className="empty">{t('company.none')}</p>
      ) : (
        <ul className="entity-list" aria-label={t('settings.company')}>
          {entities.map((e) => {
            const blockedId = `entity-${e.id}-blocked`;
            return (
              <li key={e.id} className="entity-row" data-entity={e.id}>
                <div className="entity-main">
                  <div className="entity-title">
                    <strong className="entity-name">{e.name || '—'}</strong>
                    {e.is_primary && <span className="chip is-accent">{t('company.primary')}</span>}
                    {!e.complete && <span className="chip is-warn">{t('company.incompleteChip')}</span>}
                  </div>
                  <p className="entity-facts">
                    <span>{kindLabel(e, t)}</span>
                    <span>{countryName(e.country, locale)}</span>
                    <span>
                      {t(registrationLabel(e.registration_kind ?? kindForCountry((e.country ?? HOME).toLowerCase(), e.kind === 'corporation' ? 'corporate' : 'business')))}{' '}
                      <span className="entity-number">{e.registration_no ? displayCompanyNo(e.registration_no, e.registration_kind) : '—'}</span>
                    </span>
                  </p>
                  {isOwner && <p className="dash-hint">{t('company.usedBy', { businesses: e.businesses.length, connections: e.connections.length })}</p>}
                  {/* why 삭제 is off — read with the button (aria-describedby) */}
                  {isOwner && !e.removable && e.blocked_by && (
                    <p id={blockedId} className="dash-hint entity-blocked">
                      {t(`company.blocked.${e.blocked_by}`)}
                    </p>
                  )}
                </div>
                {isOwner && (
                  <div className="entity-actions">
                    {!e.is_primary && (
                      <button
                        type="button"
                        className="btn is-small"
                        disabled={primary.isPending}
                        onClick={() => {
                          setError(null);
                          if (window.confirm(t('company.confirmPrimary', { name: e.name }))) primary.mutate(e, { onError });
                        }}
                      >
                        {t('company.makePrimary')}
                      </button>
                    )}
                    <button type="button" className="btn is-small" onClick={() => setEditing(e)} aria-label={t('company.editOf', { name: e.name })}>
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="btn is-small is-danger"
                      disabled={!e.removable || remove.isPending}
                      aria-describedby={e.removable ? undefined : blockedId}
                      aria-label={t('company.removeOf', { name: e.name })}
                      onClick={() => {
                        setError(null);
                        if (window.confirm(t('company.confirmRemove', { name: e.name }))) remove.mutate(e, { onError, onSuccess: () => void refresh() });
                      }}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <EntityModal
          entity={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: keys.entities });
            void qc.invalidateQueries({ queryKey: keys.company });
            void refresh();
          }}
        />
      )}
    </section>
  );
}

interface Form {
  country: string;
  korean: KoreanKind;
  registration_no: string;
  name: string;
  representative: string;
  address: string;
  controlled_by: string;
}

const formOf = (e: LegalEntity | null): Form => ({
  country: e?.country ?? HOME,
  korean: e?.kind === 'sole_proprietor' ? 'sole_proprietor' : 'corporation',
  registration_no: e?.registration_no ?? '',
  name: e?.name ?? '',
  representative: e?.representative ?? '',
  address: e?.address ?? '',
  controlled_by: e?.controlled_by ?? '',
});

const PLACEHOLDER: Record<CompanyNoKind, string> = { business: '123-45-67890', corporate: '123456-1234567', uscc: '91110000XXXXXXXXXX', foreign: '' };

/**
 * 법인 추가 / 수정 — the shared Modal (focus kept inside, Esc closes, focus goes back to the button).
 * The country comes first: it picks 개인 사업자 · 법인 (한국 only) or 해외, the number's format and the
 * 지배 회사 나라 field (법인 · 해외). Checked here first with the marketing rules, then by the engine.
 */
export function EntityModal({ entity, onClose, onSaved }: { entity: LegalEntity | null; onClose: () => void; onSaved: (e: LegalEntity) => void }) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<Form>(() => formOf(entity));
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => countryOptions(locale), [locale]);
  const korean = form.country === HOME;
  const kind: Kind = korean ? form.korean : 'foreign';
  const noKind = numberKind(form.country, form.korean);
  const title = entity ? t('company.editTitle') : t('company.add');

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'country' || k === 'korean') {
        // a new country or kind keeps what it can of the number (the request form's rule)
        const nk = numberKind(next.country, next.korean);
        const kept = takesLetters(nk) ? next.registration_no : next.registration_no.replace(/\D/g, '');
        next.registration_no = kept.slice(0, maxDigits(nk));
      }
      return next;
    });
    const field: Field = k === 'korean' ? 'kind' : (k as Field);
    setProblems((p) => ({ ...p, [field]: undefined, ...(k === 'country' || k === 'korean' ? { registration_no: undefined } : {}) }));
  };

  const numberProblem = (): string | undefined => {
    if (!form.registration_no) return undefined;
    const checked = checkCompanyNo(form.registration_no, noKind);
    if (checked.ok) return undefined;
    if (checked.error === 'length') return noKind === 'foreign' ? t('company.registrationLength.foreign') : t('company.registrationLength', { n: maxDigits(noKind) });
    return t('company.registrationCheck');
  };

  const check = () => {
    const found: Partial<Record<Field, string>> = {};
    if (!form.name.trim()) found.name = t('error.entity_name_required');
    const no = numberProblem();
    if (no) found.registration_no = no;
    setProblems(found);
    return !Object.keys(found).length;
  };

  const save = async () => {
    setError(null);
    if (!check()) return;
    setBusy(true);
    const body = {
      kind,
      country: form.country,
      registration_no: form.registration_no,
      name: form.name,
      representative: form.representative,
      address: form.address,
      controlled_by: kind === 'sole_proprietor' ? null : form.controlled_by || null,
    };
    try {
      const saved = entity ? await api.patch<LegalEntity>(`/entities/${entity.id}`, body) : await api.post<LegalEntity>('/entities', body);
      onSaved(saved);
    } catch (err) {
      const field = err instanceof ApiError && typeof err.params.field === 'string' ? (err.params.field as Field) : null;
      const code = errorCode(err);
      const at: Field | null = field ?? (code === 'company_kind_invalid' ? 'kind' : code === 'entity_registration_invalid' ? 'registration_no' : null);
      if (at) setProblems({ [at]: errorText(err, t) });
      else setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const describe = (f: Field, hint?: string) => (problems[f] ? `entity-${f}-error` : hint);
  const err = (f: Field) =>
    problems[f] ? (
      <small id={`entity-${f}-error`} className="form-error">
        {problems[f]}
      </small>
    ) : null;
  const nameLabel = kind === 'sole_proprietor' ? t('company.name.sole_proprietor') : t('company.name.corporation');

  return (
    <Modal label={title} onClose={onClose} className="member-modal entity-modal" focusFirstField>
      <form
        className="settings-body"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="member-modal-title">{title}</h2>
        <p className="settings-hint">{t('company.modalHint')}</p>
        <div className="member-grid">
          <div className="field">
            <label htmlFor="entity-country">{t('company.country')}</label>
            <select id="entity-country" value={form.country} autoComplete="country" onChange={(e) => set('country', e.target.value)} aria-invalid={!!problems.country} aria-describedby={describe('country')}>
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
            {err('country')}
          </div>
          <div className="field">
            <span id="entity-kind-label">{t('company.kind')}</span>
            {korean ? (
              <div className="segmented" role="radiogroup" aria-labelledby="entity-kind-label" data-testid="entity-kind">
                {(['sole_proprietor', 'corporation'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={form.korean === k} className={form.korean === k ? 'is-active' : ''} onClick={() => set('korean', k)}>
                    {t(`company.kind.${k}`)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="entity-kind-fixed" aria-labelledby="entity-kind-label">
                {t('company.kind.foreign')}
              </p>
            )}
            {err('kind')}
          </div>
          <div className="field is-wide">
            <label htmlFor="entity-registration">{t(registrationLabel(noKind))}</label>
            <DigitsInput
              id="entity-registration"
              value={form.registration_no}
              onDigits={(d) => set('registration_no', d)}
              format={(d) => formatCompanyNo(d, noKind)}
              max={maxDigits(noKind)}
              letters={takesLetters(noKind)}
              placeholder={PLACEHOLDER[noKind]}
              aria-invalid={!!problems.registration_no || undefined}
              aria-describedby={describe('registration_no', 'entity-registration-hint')}
            />
            <small id="entity-registration-hint" className="dash-hint">
              {t(`company.registrationHint.${noKind}`)}
            </small>
            {err('registration_no')}
          </div>
          <div className="field">
            <label htmlFor="entity-name">{nameLabel}</label>
            <input id="entity-name" value={form.name} maxLength={120} autoComplete="organization" onChange={(e) => set('name', e.target.value)} aria-invalid={!!problems.name} aria-describedby={describe('name')} />
            {err('name')}
          </div>
          <div className="field">
            <label htmlFor="entity-representative">{t('company.representative')}</label>
            <input id="entity-representative" value={form.representative} maxLength={60} onChange={(e) => set('representative', e.target.value)} aria-invalid={!!problems.representative} aria-describedby={describe('representative')} />
            {err('representative')}
          </div>
          <div className="field is-wide">
            <label htmlFor="entity-address">{t('company.address')}</label>
            <textarea id="entity-address" rows={2} value={form.address} maxLength={500} autoComplete="street-address" onChange={(e) => set('address', e.target.value)} aria-invalid={!!problems.address} aria-describedby={describe('address')} />
            {err('address')}
          </div>
          {kind !== 'sole_proprietor' && (
            <div className="field is-wide">
              <label htmlFor="entity-controlled_by">{t('company.controlledBy')}</label>
              <select id="entity-controlled_by" value={form.controlled_by} onChange={(e) => set('controlled_by', e.target.value)} aria-invalid={!!problems.controlled_by} aria-describedby={describe('controlled_by', 'entity-controlled_by-hint')}>
                <option value="">{t('company.controlledByNone')}</option>
                {options
                  .filter((o) => o.code !== form.country)
                  .map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                    </option>
                  ))}
              </select>
              <small id="entity-controlled_by-hint" className="dash-hint">
                {t('company.controlledByHint')}
              </small>
              {err('controlled_by')}
            </div>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn is-primary" disabled={busy}>
            {entity ? t('common.save') : t('company.addButton')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
