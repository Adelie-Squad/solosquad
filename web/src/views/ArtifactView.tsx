import { useLinks } from '../scope';
import { Link, useParams } from 'react-router-dom';

import { useAction, useArtifact, useKeys, useScopedApi } from '../api/queries';
import type { Artifact } from '../api/types.gen';
import { ArtifactBody } from '../components/ArtifactBody';
import { Loading, QueryError } from '../components/Status';
import { useI18n } from '../i18n';

/** One work product — the P&L table, a brief … — and its "needs review" mark (W11 · W14). */
export function ArtifactView() {
  const keys = useKeys();
  const { w: toWs } = useLinks();
  const { ws: wsApi } = useScopedApi();
  const { id } = useParams<{ id: string }>();
  const { t, fmt } = useI18n();
  const q = useArtifact(id);
  const review = useAction(() => wsApi.post<Artifact>(`/artifacts/${id}/review`), [keys.artifacts]);

  if (q.isPending) return <div className="view"><Loading /></div>;
  if (q.error) return <div className="view"><QueryError error={q.error} /></div>;
  const a = q.data;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <p className="crumb">
            <Link to={toWs('/screens/artifacts')}>← {t('nav.artifacts')}</Link>
          </p>
          <h1>{a.title}</h1>
          <p>
            {fmt.dateTime(a.created)}
            {a.workflow && (
              <>
                {' · '}
                <Link to={a.thread_id ? toWs(`/workflows/${a.workflow}/runs/${a.thread_id}`) : toWs(`/workflows/${a.workflow}`)}>{a.workflow}</Link>
              </>
            )}
            {a.reviewed_by && ` · ${t('artifact.reviewedBy', { name: a.reviewed_by })}`}
          </p>
        </div>
        {a.needs_review ? (
          <button className="btn is-primary" disabled={review.isPending} onClick={() => review.mutate(undefined)}>
            ✓ {t('artifact.markReviewed')}
          </button>
        ) : (
          <span className="chip is-ok">✓ {t('artifact.reviewed')}</span>
        )}
      </header>
      {a.needs_review && <div className="approval-bar"><span>⚠️ {t('artifact.needsReview')}</span></div>}
      {review.error && <p className="form-error">{t('common.failed')}</p>}
      <section className="panel">
        <ArtifactBody artifact={a} />
      </section>
    </div>
  );
}
