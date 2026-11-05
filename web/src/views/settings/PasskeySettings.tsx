import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { keys, useAction, useHealth, usePasskeys } from '../../api/queries';
import type { Ok } from '../../api/types.gen';
import { defaultPasskeyName, passkeySupported, registerPasskey } from '../../auth/passkeys';
import { useI18n, type MessageKey } from '../../i18n';

/** My passkeys — list, add one for this device, remove one (decision 46 W3). */
export function PasskeySettings() {
  const { t, fmt } = useI18n();
  const health = useHealth();
  const list = usePasskeys();
  const [name, setName] = useState(defaultPasskeyName);
  const [error, setError] = useState<MessageKey | null>(null);
  const add = useAction(() => registerPasskey(name.trim() || defaultPasskeyName()), [keys.passkeys]);
  const remove = useAction((id: string) => api.del<Ok>(`/me/passkeys/${encodeURIComponent(id)}`), [keys.passkeys]);
  const canAdd = !!health.data?.passkeys && passkeySupported();

  return (
    <section className="settings-body passkeys" aria-label={t('passkey.title')}>
      <h2 className="panel-title">🔑 {t('passkey.title')}</h2>
      <p className="settings-hint">{t('passkey.lead')}</p>
      {(list.data ?? []).length === 0 ? (
        <p className="dash-hint">{t('passkey.none')}</p>
      ) : (
        <ul className="run-list">
          {(list.data ?? []).map((pk) => (
            <li key={pk.id} className="run-row">
              <strong>{pk.name}</strong>
              <span className="dash-hint">
                {t('passkey.added', { when: fmt.date(pk.created) })}
                {' · '}
                {pk.last_used ? t('passkey.lastUsed', { when: fmt.relative(pk.last_used) }) : t('passkey.neverUsed')}
              </span>
              <button
                className="btn is-small"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(t('passkey.confirmRemove', { name: pk.name }))) {
                    setError(null);
                    remove.mutate(pk.id, { onError: () => setError('common.failed') });
                  }
                }}
              >
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canAdd ? (
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            add.mutate(undefined, {
              onError: (err) => setError(err instanceof ApiError ? 'passkey.notAccepted' : 'passkey.cancelled'),
            });
          }}
        >
          <input aria-label={t('passkey.name')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="btn is-primary" disabled={add.isPending}>
            + {t('passkey.add')}
          </button>
        </form>
      ) : (
        <p className="dash-hint">{health.data?.passkeys ? t('passkey.browserUnsupported') : t('passkey.officeOff')}</p>
      )}
      {error && <p className="form-error">{t(error)}</p>}
    </section>
  );
}
