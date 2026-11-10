// 회사 (user 2026-11-11 — "'회사' 탭 새로 만들어서 … 법인인지 개인인지, 법인명/상호, 대표자, 소재지 까지.
// 기존 서버 나라랑 모델 계정 보유 법인 판단은 여기서 진행"). The customer company in core.db
// (`/api/company`): the owner edits it, everyone else reads it. Its 소재지 country (and a 법인's
// 지배 회사 나라) is the account holder every connection is judged on (decision 45).
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { errorCode, errorText } from '../../api/errors';
import { keys, useCompany } from '../../api/queries';
import type { Company } from '../../api/types.gen';
import { Loading, QueryError, SavedLine } from '../../components/Status';
import { useI18n } from '../../i18n';
import { useSession } from '../../session';

type Kind = NonNullable<Company['kind']>;
type Field = 'kind' | 'name' | 'representative' | 'country' | 'address' | 'controlled_by';

export function CompanySettings() {
  const q = useCompany();
  if (q.isPending) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  return <CompanyForm key={JSON.stringify(q.data)} company={q.data} />;
}

function CompanyForm({ company }: { company: Company }) {
  const { t } = useI18n();
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const ro = !isOwner;
  const [form, setForm] = useState({
    kind: (company.kind ?? '') as Kind | '',
    name: company.name,
    representative: company.representative,
    country: company.country ?? '',
    address: company.address,
    controlled_by: company.controlled_by ?? '',
  });
  const [problem, setProblem] = useState<{ field: Field | null; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: Field, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
    if (problem?.field === k) setProblem(null);
  };

  const save = async () => {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      const next = await api.put<Company>('/company', {
        kind: form.kind || null,
        name: form.name,
        representative: form.representative,
        country: form.country.trim().toUpperCase() || null,
        address: form.address,
        controlled_by: form.kind === 'corporation' ? form.controlled_by.trim().toUpperCase() || null : null,
      });
      qc.setQueryData(keys.company, next);
      void qc.invalidateQueries({ predicate: (query) => query.queryKey.includes('connections') });
      setSaved(true);
    } catch (err) {
      const field = err instanceof ApiError && typeof err.params.field === 'string' ? (err.params.field as Field) : null;
      const code = errorCode(err);
      setProblem({ field: field ?? (code === 'company_kind_invalid' ? 'kind' : code === 'company_control_corporation_only' ? 'controlled_by' : null), text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  };

  const err = (f: Field) =>
    problem?.field === f ? (
      <small id={`company-${f}-error`} className="form-error">
        {problem.text}
      </small>
    ) : null;
  const aria = (f: Field) => ({ 'aria-invalid': problem?.field === f || undefined, 'aria-describedby': problem?.field === f ? `company-${f}-error` : undefined });
  const nameLabel = form.kind ? t(`company.name.${form.kind}`) : t('company.name');

  return (
    <form
      className="panel settings-body"
      aria-labelledby="company-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 id="company-title" className="panel-title">
        {t('settings.company')}
      </h2>
      <p className="settings-hint">{t('company.lead')}</p>
      {ro && <p className="settings-note">{t('settings.readOnly')}</p>}
      {!company.complete && <p className="dash-hint">{t('company.incomplete')}</p>}
      <fieldset className="company-grid" disabled={ro}>
        <div className="field">
          <label htmlFor="company-kind">{t('company.kind')}</label>
          <select id="company-kind" value={form.kind} onChange={(e) => set('kind', e.target.value)} {...aria('kind')}>
            <option value="">{t('company.kindNone')}</option>
            <option value="corporation">{t('company.kind.corporation')}</option>
            <option value="sole_proprietor">{t('company.kind.sole_proprietor')}</option>
          </select>
          {err('kind')}
        </div>
        <div className="field">
          <label htmlFor="company-name">{nameLabel}</label>
          <input id="company-name" value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} {...aria('name')} />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor="company-representative">{t('company.representative')}</label>
          <input id="company-representative" value={form.representative} maxLength={60} onChange={(e) => set('representative', e.target.value)} {...aria('representative')} />
          {err('representative')}
        </div>
      </fieldset>
      <fieldset className="company-grid" disabled={ro}>
        <legend className="panel-title">{t('company.location')}</legend>
        <div className="field">
          <label htmlFor="company-country">{t('company.country')}</label>
          <input id="company-country" value={form.country} maxLength={2} placeholder="KR" autoComplete="country" onChange={(e) => set('country', e.target.value)} {...aria('country')} />
          {err('country')}
        </div>
        <div className="field is-wide">
          <label htmlFor="company-address">{t('company.address')}</label>
          <textarea id="company-address" rows={3} value={form.address} maxLength={500} autoComplete="street-address" onChange={(e) => set('address', e.target.value)} {...aria('address')} />
          {err('address')}
        </div>
        {form.kind === 'corporation' && (
          <div className="field">
            <label htmlFor="company-controlled_by">{t('company.controlledBy')}</label>
            <input
              id="company-controlled_by"
              value={form.controlled_by}
              maxLength={2}
              placeholder="—"
              aria-describedby="company-controlled_by-hint"
              onChange={(e) => set('controlled_by', e.target.value)}
              aria-invalid={problem?.field === 'controlled_by' || undefined}
            />
            <small id="company-controlled_by-hint" className="dash-hint">
              {t('company.controlledByHint')}
            </small>
            {err('controlled_by')}
          </div>
        )}
      </fieldset>
      {problem && !problem.field && <p className="form-error">{problem.text}</p>}
      {saved && <SavedLine />}
      {!ro && (
        <div>
          <button className="btn is-primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      )}
    </form>
  );
}
