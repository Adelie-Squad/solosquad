import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { errorCode, errorKey } from '../api/errors';
import { keys, useHealth } from '../api/queries';
import type { Ok, TotpBegin } from '../api/types.gen';
import { LocalePicker } from '../components/LocalePicker';
import { QrCode } from '../components/QrCode';
import { useI18n, type MessageKey } from '../i18n';
import { defaultPasskeyName, passkeySupported, registerPasskey, showPasskeyButton } from './passkeys';

type Method = 'passkey' | 'otp';

/** First login: set up a strong factor before anything else opens — a passkey, or a
 * one-time code from an authenticator app (decision 41 · 46 W3 · I19). */
export function Enrol() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const health = useHealth();
  const [refused, setRefused] = useState(false);
  const canPasskey = showPasskeyButton({ officeAllows: health.data?.passkeys, browserSupports: passkeySupported(), refused });
  const [chosen, setChosen] = useState<Method | null>(null);
  const method: Method = chosen ?? (canPasskey ? 'passkey' : 'otp');

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.setQueryData(keys.me, undefined);
    await qc.invalidateQueries({ queryKey: keys.me });
  };

  return (
    <div className="auth-page">
      <div className="auth-card is-wide">
        <h1>{canPasskey ? t('enrol.choose') : t('enrol.title')}</h1>
        {canPasskey && (
          <div className="segmented" role="tablist" aria-label={t('enrol.choose')}>
            <button role="tab" aria-selected={method === 'passkey'} className={method === 'passkey' ? 'is-active' : ''} onClick={() => setChosen('passkey')}>
              🔑 {t('passkey.title')}
            </button>
            <button role="tab" aria-selected={method === 'otp'} className={method === 'otp' ? 'is-active' : ''} onClick={() => setChosen('otp')}>
              🔢 {t('auth.code')}
            </button>
          </div>
        )}
        {method === 'passkey' && canPasskey ? (
          <PasskeyEnrol onRefused={() => setRefused(true)} />
        ) : (
          <OtpEnrol />
        )}
        <button type="button" className="btn is-block is-quiet" onClick={logout}>
          {t('nav.logout')}
        </button>
        <LocalePicker />
      </div>
    </div>
  );
}

function PasskeyEnrol({ onRefused }: { onRefused: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(defaultPasskeyName);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(name.trim() || defaultPasskeyName());
      await qc.invalidateQueries({ queryKey: keys.me }); // the session is now full
    } catch (err) {
      if (errorCode(err) === 'passkeys_unavailable') onRefused();
      else if (errorCode(err) === 'passkey_rejected') setError('passkey.notAccepted');
      else setError(err instanceof ApiError ? errorKey(err) : 'passkey.cancelled');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="settings-body" onSubmit={add}>
      <p className="settings-hint">{t('passkey.enrolLead')}</p>
      <label className="field">
        <span>{t('passkey.name')}</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      <button className="btn is-primary is-block" disabled={busy}>
        {busy ? t('common.wait') : t('passkey.create')}
      </button>
    </form>
  );
}

function OtpEnrol() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  // Once per mount — every call makes a new pending secret, so StrictMode's double effect
  // must not ask twice (the ref survives the simulated remount).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .post<TotpBegin>('/auth/totp/begin')
      .then((r) => setUri(r.uri))
      .catch(() => setError('enrol.beginFailed'));
  }, []);

  const secret = uri ? (new URL(uri).searchParams.get('secret') ?? '') : '';

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<Ok>('/auth/totp/confirm', { code });
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (err) {
      setError(errorCode(err) === 'otp_invalid' ? 'auth.wrongCode' : err instanceof ApiError ? errorKey(err) : 'auth.failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="settings-body" onSubmit={confirm}>
      <ol className="enrol-steps">
        <li>{t('enrol.step1')}</li>
        <li>{t('enrol.step2')}</li>
        <li>{t('enrol.step3')}</li>
      </ol>
      {uri ? (
        <div className="enrol-qr">
          <QrCode value={uri} label={t('enrol.qrLabel')} />
          <div>
            <p className="settings-hint">{t('enrol.manual')}</p>
            <code className="secret">{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </div>
        </div>
      ) : (
        !error && <p>{t('common.loading')}</p>
      )}
      <label className="field">
        <span>{t('auth.code')}</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      <button className="btn is-primary is-block" disabled={busy || code.length !== 6 || !uri}>
        {t('enrol.confirm')}
      </button>
    </form>
  );
}
