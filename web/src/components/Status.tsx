import { ApiError } from '../api/client';
import { useI18n, type MessageKey } from '../i18n';

export function Loading() {
  const { t } = useI18n();
  return <div className="panel empty">{t('common.loading')}</div>;
}

/** What a failed request means to a person (decision 57): outside the assignments or gone =
 * "no such page" (the server answers both with the same 404), a workspace whose runtime is
 * down = "not started yet", a network the office does not accept = the network notice. */
export function errorKey(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return 'common.failed';
  if (error.status === 404) return error.message === 'Not Found' ? 'scope.notFoundTitle' : 'common.notEnabled';
  if (error.status === 503) return 'scope.notStartedTitle';
  if (error.status === 403) return /network|connections from here/i.test(error.message) ? 'scope.network' : 'common.denied';
  return 'common.failed';
}

export function QueryError({ error }: { error: unknown }) {
  const { t } = useI18n();
  return (
    <div className="panel empty" role="alert">
      {t(errorKey(error))}
    </div>
  );
}

/** A widget or screen this web cannot draw — visible, never a crash (I30 · K35). */
export function Placeholder({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="panel placeholder" data-testid="placeholder">
      <strong>⚠️ {title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
