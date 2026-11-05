import { ApiError } from '../api/client';
import { useI18n } from '../i18n';

export function Loading() {
  const { t } = useI18n();
  return <div className="panel empty">{t('common.loading')}</div>;
}

/** A query that failed. 404 from a feature switched off on this office reads differently. */
export function QueryError({ error }: { error: unknown }) {
  const { t } = useI18n();
  const off = error instanceof ApiError && error.status === 404;
  const denied = error instanceof ApiError && error.status === 403;
  return (
    <div className="panel empty" role="alert">
      {off ? t('common.notEnabled') : denied ? t('common.denied') : t('common.failed')}
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
