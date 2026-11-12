import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, setCsrf } from '../api/client';
import { errorCode, errorKey } from '../api/errors';
import { keys, useHealth } from '../api/queries';
import type { Me } from '../api/types.gen';
import { LocalePicker } from '../components/LocalePicker';
import { Mascot } from '../characters/PenguinIcon';
import { ICON } from '../icons';
import { useI18n, type MessageKey } from '../i18n';
import { loginWithPasskey, passkeySupported, showPasskeyButton } from './passkeys';

/** A refused login, by its code (generic on purpose server-side) → the person's language. */
export function authReason(err: unknown): MessageKey {
  if (!(err instanceof ApiError)) return 'auth.failed';
  switch (errorCode(err)) {
    case 'login_throttled':
      return 'auth.throttled';
    case 'otp_required':
      return 'auth.needCode';
    case 'otp_invalid':
      return 'auth.wrongCode';
    case 'login_failed':
      return 'auth.wrong';
    case 'passkey_not_recognised':
      return 'passkey.notRecognised';
    case 'network_blocked':
      return 'auth.blocked';
    case null:
      return 'auth.failed';
    default:
      return errorKey(err);
  }
}

/** Login — account + one-time code (decision 41). A first login without a code goes to enrolment. */
export function Login() {
  const { t } = useI18n();
  const qc = useQueryClient();
  // `?u=<id>` — the marketing site's login router passes the ID it was given on (decision 62)
  const [params] = useSearchParams();
  const [username, setUsername] = useState(() => (params.get('u') ?? '').slice(0, 120));
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [askCode, setAskCode] = useState(true);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const health = useHealth();
  const [refused, setRefused] = useState(false);
  const passkeyButton = showPasskeyButton({
    officeAllows: health.data?.passkeys,
    browserSupports: passkeySupported(),
    refused,
  });

  const withPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await loginWithPasskey();
      setCsrf(me.csrf);
      qc.setQueryData(keys.me, me);
    } catch (err) {
      if (errorCode(err) === 'passkeys_unavailable') setRefused(true); // no public_url
      else if (err instanceof ApiError) setError(authReason(err));
      else setError('passkey.cancelled'); // the person closed the browser's sheet
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>('/auth/login', { username, password, otp: otp || undefined });
      setCsrf(me.csrf);
      qc.setQueryData(keys.me, me);
    } catch (err) {
      const reason = authReason(err);
      if (reason === 'auth.needCode') setAskCode(true);
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <Mascot size={56} />
          <div>
            <h1>SoloSquad</h1>
            <p>{t('auth.subtitle')}</p>
          </div>
        </div>
        <label className="field">
          <span>{t('auth.username')}</span>
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {askCode && (
          <label className="field">
            <span>{t('auth.code')}</span>
            <small>{t('auth.codeHint')}</small>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {t(error)}
          </p>
        )}
        <button className="btn is-primary is-block" disabled={busy}>
          {busy ? t('common.wait') : t('auth.login')}
        </button>
        {passkeyButton && (
          <>
            <div className="auth-or">
              <span>{t('auth.or')}</span>
            </div>
            <button type="button" className="btn is-block with-icon" disabled={busy} onClick={() => void withPasskey()} data-testid="passkey-login">
              <ICON.passkey />
              {t('passkey.login')}
            </button>
          </>
        )}
        <p className="auth-hint">{t('auth.firstHint')}</p>
        <LocalePicker />
      </form>
    </div>
  );
}
