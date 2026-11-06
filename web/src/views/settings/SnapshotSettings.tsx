import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { errorText } from '../../api/errors';
import { keys, useSnapshot } from '../../api/queries';
import type { SnapshotRunResult, SnapshotSettings as Target } from '../../api/types.gen';
import { Loading, QueryError } from '../../components/Status';
import { useI18n } from '../../i18n';
import { useSession } from '../../session';

type Kind = 'off' | 's3' | 'dir';

/** Daily snapshots to the customer's own storage (decision 54). The keys go into the office's
 * secret store; the screen only ever learns whether they are there. */
export function SnapshotSettings() {
  const q = useSnapshot();
  if (q.isPending) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  return <SnapshotForm key={JSON.stringify(q.data)} current={q.data} />;
}

function SnapshotForm({ current }: { current: Target }) {
  const { t } = useI18n();
  const { isOwner } = useSession();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(current.type ?? 'off');
  const [form, setForm] = useState({
    endpoint: current.endpoint ?? '',
    region: current.region,
    bucket: current.bucket ?? '',
    prefix: current.prefix,
    path: current.path ?? '',
    keep_days: String(current.keep_days),
  });
  const [access, setAccess] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<SnapshotRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ro = !isOwner;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await api.put<Target>('/snapshot', {
        type: kind === 'off' ? null : kind,
        ...form,
        keep_days: Number(form.keep_days) || 30,
        ...(access || secret ? { access_key: access, secret_key: secret } : {}),
      });
      qc.setQueryData(keys.snapshot, next);
      setAccess('');
      setSecret('');
      setSaved(true);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<SnapshotRunResult>('/snapshot/run'));
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel settings-body">
      <p className="settings-hint">{t('snapshot.lead')}</p>
      {ro && <p className="settings-note">{t('settings.readOnly')}</p>}
      <fieldset className="form-grid" disabled={ro}>
        <label className="field">
          <span>{t('snapshot.type')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="off">{t('snapshot.off')}</option>
            <option value="s3">{t('snapshot.s3')}</option>
            <option value="dir">{t('snapshot.dir')}</option>
          </select>
        </label>
        {kind === 's3' && (
          <>
            <label className="field">
              <span>{t('snapshot.endpoint')} *</span>
              <input value={form.endpoint} onChange={set('endpoint')} placeholder="https://s3.ap-northeast-2.amazonaws.com" />
            </label>
            <label className="field">
              <span>{t('snapshot.region')}</span>
              <input value={form.region} onChange={set('region')} />
            </label>
            <label className="field">
              <span>{t('snapshot.bucket')} *</span>
              <input value={form.bucket} onChange={set('bucket')} />
            </label>
            <label className="field">
              <span>{t('snapshot.prefix')}</span>
              <input value={form.prefix} onChange={set('prefix')} />
            </label>
            <div className="field">
              <span>{t('snapshot.keys')}</span>
              <span className={`chip ${current.has_secret ? 'is-ok' : 'is-warn'}`} data-testid="snapshot-keys">
                {current.has_secret ? t('snapshot.keysStored') : t('snapshot.keysMissing')}
              </span>
              {!ro && (
                <>
                  <input aria-label={t('snapshot.accessKey')} placeholder={t('snapshot.accessKey')} autoComplete="off" value={access} onChange={(e) => setAccess(e.target.value)} />
                  <input aria-label={t('snapshot.secretKey')} placeholder={t('snapshot.secretKey')} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
                  <small>{current.has_secret ? t('snapshot.keysReplaceHint') : t('snapshot.keysHint')}</small>
                </>
              )}
            </div>
          </>
        )}
        {kind === 'dir' && (
          <label className="field">
            <span>{t('snapshot.path')} *</span>
            <input value={form.path} onChange={set('path')} placeholder="/mnt/backup" />
          </label>
        )}
        {kind !== 'off' && (
          <label className="field">
            <span>{t('snapshot.keepDays')}</span>
            <input type="number" min={1} value={form.keep_days} onChange={set('keep_days')} />
          </label>
        )}
      </fieldset>
      {error && <p className="form-error">{error}</p>}
      {saved && <p className="ok-line">✓ {t('common.saved')}</p>}
      {result && (
        <p className="ok-line" data-testid="snapshot-result">
          {result.target
            ? `✓ ${t('snapshot.done', { files: result.files ?? 0, location: result.location ?? '' })}`
            : t('snapshot.skipped')}
          {result.pruned.length > 0 && ` · ${t('snapshot.pruned', { n: result.pruned.length })}`}
        </p>
      )}
      {isOwner && (
        <div className="dialog-actions is-start">
          <button className="btn is-primary" disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </button>
          <button className="btn" disabled={busy || !current.type} onClick={() => void runNow()}>
            {busy ? t('common.wait') : t('snapshot.runNow')}
          </button>
        </div>
      )}
      <p className="dash-hint">{t('snapshot.dailyHint')}</p>
    </section>
  );
}
