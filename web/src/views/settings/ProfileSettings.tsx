import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { keys, useProfile } from '../../api/queries';
import type { CustomerProfile, ProfileEntity, ProfileResponse } from '../../api/types.gen';
import { Loading, QueryError } from '../../components/Status';
import { LOCALE_NAMES, LOCALES, useI18n, type Locale, type MessageKey } from '../../i18n';
import { useSession } from '../../session';

const ITEMS: Record<string, MessageKey> = {
  server_country: 'profile.item.server_country',
  cloud: 'profile.item.cloud',
  cloud_access: 'profile.item.cloud_access',
  entities: 'profile.item.entities',
  languages: 'profile.item.languages',
  privacy: 'profile.item.privacy',
};

/** The customer profile (decision 50) — everyone reads it; the owner edits. */
export function ProfileSettings() {
  const q = useProfile();
  if (q.isPending) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  return <ProfileForm key={JSON.stringify(q.data.profile)} data={q.data} />;
}

function ProfileForm({ data }: { data: ProfileResponse }) {
  const { t } = useI18n();
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const p = data.profile;
  const [server, setServer] = useState({
    country: p.server.country ?? '',
    cloud: p.server.cloud ?? '',
    region: p.server.region ?? '',
    access: p.server.access ?? '',
  });
  const [entities, setEntities] = useState<ProfileEntity[]>(p.entities);
  const [langDefault, setLangDefault] = useState<Locale>(p.languages.default);
  const [enabled, setEnabled] = useState<Set<Locale>>(() => new Set(p.languages.enabled));
  const [regimes, setRegimes] = useState(p.privacy.regimes.join(', '));
  const [reviewer, setReviewer] = useState(p.privacy.reviewer ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const ro = !isOwner;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const body: Partial<CustomerProfile> = {
      server: {
        country: server.country.trim() || null,
        cloud: server.cloud.trim() || null,
        region: server.region.trim() || null,
        access: server.access.trim() || null,
      },
      entities: entities.map((e) => ({ ...e, controlled_by: e.controlled_by || null })),
      languages: { default: langDefault, enabled: LOCALES.filter((l) => enabled.has(l)) },
      privacy: {
        regimes: regimes.split(',').map((r) => r.trim()).filter(Boolean),
        reviewer: reviewer.trim() || null,
      },
    };
    try {
      const next = await api.put<ProfileResponse>('/profile', body);
      qc.setQueryData(keys.profile, next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  };

  const setEntity = (i: number, patch: Partial<ProfileEntity>) =>
    setEntities((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <section className="panel settings-body">
      <p className="settings-hint">{t('profile.lead')}</p>
      <ul className="checklist" aria-label={t('profile.checklist')}>
        {data.checklist.map((c) => (
          <li key={c.item} className={c.done ? 'is-done' : 'is-missing'}>
            <span aria-hidden>{c.done ? '✓' : '○'}</span> {ITEMS[c.item] ? t(ITEMS[c.item]) : c.label}
            {!c.done && <span className="chip is-warn">{t('profile.missing')}</span>}
          </li>
        ))}
      </ul>
      {ro && <p className="settings-note">{t('settings.readOnly')}</p>}

      <fieldset className="form-grid" disabled={ro}>
        <legend className="panel-title">{t('profile.server')}</legend>
        <label className="field">
          <span>{t('profile.country')}</span>
          <input value={server.country} maxLength={2} placeholder="KR" onChange={(e) => setServer({ ...server, country: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('profile.cloud')}</span>
          <input value={server.cloud} placeholder="aws · gcp · ncp" onChange={(e) => setServer({ ...server, cloud: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('profile.region')}</span>
          <input value={server.region} placeholder="ap-northeast-2" onChange={(e) => setServer({ ...server, region: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('profile.access')}</span>
          <input value={server.access} onChange={(e) => setServer({ ...server, access: e.target.value })} />
          <small>{t('profile.accessHint')}</small>
        </label>
      </fieldset>

      <fieldset className="settings-body" disabled={ro}>
        <legend className="panel-title">{t('profile.entities')}</legend>
        <p className="dash-hint">{t('profile.entitiesHint')}</p>
        {entities.map((e, i) => (
          <div key={i} className="form-row entity-row">
            <input aria-label={t('profile.entityId')} placeholder={t('profile.entityId')} value={e.id} onChange={(ev) => setEntity(i, { id: ev.target.value })} />
            <input aria-label={t('connections.entityName')} placeholder={t('connections.entityName')} value={e.name} onChange={(ev) => setEntity(i, { name: ev.target.value })} />
            <input aria-label={t('connections.entityCountry')} placeholder="KR" maxLength={2} value={e.country} onChange={(ev) => setEntity(i, { country: ev.target.value })} />
            <input aria-label={t('connections.entityControl')} placeholder="—" maxLength={2} value={e.controlled_by ?? ''} onChange={(ev) => setEntity(i, { controlled_by: ev.target.value })} />
            {!ro && (
              <button type="button" className="btn is-small" onClick={() => setEntities((l) => l.filter((_, j) => j !== i))}>
                {t('common.remove')}
              </button>
            )}
          </div>
        ))}
        {!ro && (
          <button type="button" className="btn is-small" onClick={() => setEntities((l) => [...l, { id: '', name: '', country: '', controlled_by: null }])}>
            + {t('profile.addEntity')}
          </button>
        )}
      </fieldset>

      <fieldset className="form-grid" disabled={ro}>
        <legend className="panel-title">{t('profile.languages')}</legend>
        <label className="field">
          <span>{t('profile.defaultLanguage')}</span>
          <select value={langDefault} onChange={(e) => setLangDefault(e.target.value as Locale)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>{t('profile.enabledLanguages')}</span>
          <div className="perm-chips">
            {LOCALES.map((l) => (
              <button
                type="button"
                key={l}
                className={`perm-chip ${enabled.has(l) ? 'is-on' : ''}`}
                aria-pressed={enabled.has(l)}
                onClick={() =>
                  setEnabled((s) => {
                    const next = new Set(s);
                    if (next.has(l)) next.delete(l);
                    else next.add(l);
                    return next;
                  })
                }
              >
                {LOCALE_NAMES[l]}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="form-grid" disabled={ro}>
        <legend className="panel-title">{t('profile.privacy')}</legend>
        <label className="field">
          <span>{t('profile.regimes')}</span>
          <input value={regimes} placeholder="PIPA, PIPL" onChange={(e) => setRegimes(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('profile.reviewer')}</span>
          <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
          <small>{t('profile.reviewerHint')}</small>
        </label>
      </fieldset>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="ok-line">✓ {t('common.saved')}</p>}
      {isOwner && (
        <button className="btn is-primary" disabled={busy} onClick={() => void save()}>
          {t('common.save')}
        </button>
      )}
    </section>
  );
}
