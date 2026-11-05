import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError, setCsrf } from '../api/client';
import { keys, useHealth } from '../api/queries';
import type { Me } from '../api/types.gen';
import { LocalePicker } from '../components/LocalePicker';
import { useI18n, type MessageKey } from '../i18n';
import { loginWithPasskey, passkeySupported, showPasskeyButton } from './passkeys';

/** Server reasons (English, generic on purpose) → the person's language. */
export function authReason(err: unknown): MessageKey {
  const msg = err instanceof ApiError ? err.message : '';
  if (msg.includes('too many')) return 'auth.throttled';
  if (msg.includes('one-time code required')) return 'auth.needCode';
  if (msg.includes('wrong one-time code')) return 'auth.wrongCode';
  if (msg.includes('username or password')) return 'auth.wrong';
  if (msg.includes('passkey not recognised')) return 'passkey.notRecognised';
  if (err instanceof ApiError && err.status === 403) return 'auth.blocked';
  return 'auth.failed';
}

/** Login — account + one-time code (decision 41). A first login without a code goes to enrolment. */
export function Login() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
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
      if (err instanceof ApiError && err.status === 409) setRefused(true); // no public_url
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
          <img src="/icon.svg" alt="" width={44} height={44} />
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
            <button type="button" className="btn is-block" disabled={busy} onClick={() => void withPasskey()} data-testid="passkey-login">
              🔑 {t('passkey.login')}
            </button>
          </>
        )}
        <p className="auth-hint">{t('auth.firstHint')}</p>
        <LocalePicker />
      </form>
    </div>
  );
}
