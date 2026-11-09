// 자리를 비운 동안 (DESIGN.md `### 대시보드` · PRD v2.1.0 digest): what happened between the person's
// last visit and now, in one sentence and a few short groups — and the approvals that wait for
// them, answerable right here, because getting those confirmations is what the screen is for.
// The engine decides the window (`GET /api/me/digest`); 확인했어요 moves it.
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ackDigest, keys, useDigest } from '../../api/queries';
import type { Digest, DigestWork, WorkArtifact } from '../../api/types.gen';
import { ApprovalCard } from '../../components/ApprovalCard';
import { useI18n } from '../../i18n';
import { ICON } from '../../icons';
import { useAgentName } from '../../lib/agentNames';
import { dayText, timeOf } from '../../lib/calendar';
import { digestHeadline, hasNews } from '../../lib/digest';
import { shownName } from '../../lib/names';
import { useSession } from '../../session';
import { scheduleTitle } from '../ScheduleView';
import { RUN_STATUS } from '../WorkflowsView';
import { workHref } from '../TasksView';
import { WsScope, wsLinks } from './WsScope';

interface Where {
  org: string;
  workspace: string;
}

function useWhere() {
  const { me } = useSession();
  return (w: Where) => {
    const o = me.scopes.find((s) => s.org === w.org);
    const ws = o?.workspaces.find((x) => x.name === w.workspace);
    return `${shownName(w.org, o?.display)} · ${shownName(w.workspace, ws?.display)}`;
  };
}

function Group({ title, tone, count, shown, children, testid }: { title: string; tone?: string; count: number; shown: number; children: ReactNode; testid: string }) {
  const { t } = useI18n();
  return (
    <section className="digest-group" data-testid={testid}>
      <h3 className="digest-group-title">
        {title}
        <span className={`chip ${tone ?? ''}`}>{count}</span>
      </h3>
      {children}
      {count > shown && <p className="dash-hint">{t('digest.more', { n: count - shown })}</p>}
    </section>
  );
}

function Made({ items, org, ws }: { items: WorkArtifact[]; org: string; ws: string }) {
  const { t } = useI18n();
  const to = wsLinks(org, ws);
  if (items.length === 0) return null;
  return (
    <span className="work-made">
      {items.map((a) => (
        <Link key={a.id} className="chip work-artifact" to={to(`/tasks/artifacts/${a.id}`)}>
          <ICON.artifacts size={12} />
          {a.title}
          {a.needs_review && <span className="work-artifact-flag">{t('artifact.needsReviewShort')}</span>}
        </Link>
      ))}
    </span>
  );
}

function WorkLine({ w, failed }: { w: DigestWork; failed?: boolean }) {
  const { t, fmt } = useI18n();
  const where = useWhere();
  const nameOf = useAgentName();
  const Icon = failed ? ICON.error : ICON.done;
  return (
    <li className="digest-row">
      <Icon className={`digest-row-icon ${failed ? 'is-danger' : 'is-ok'}`} aria-hidden />
      <span className="digest-row-body">
        <Link className="digest-row-title" to={workHref(w, wsLinks(w.org, w.workspace))}>
          {w.title || t('chat.untitled')}
        </Link>
        <span className="digest-row-meta">
          {w.agents.length > 0 && <span>{w.agents.map(nameOf).join(', ')}</span>}
          <span className="from-scope">{where(w)}</span>
          <span>{fmt.relative(w.ended)}</span>
        </span>
        {failed && w.error && <span className="digest-row-error">{w.error}</span>}
        <Made items={w.artifacts} org={w.org} ws={w.workspace} />
      </span>
    </li>
  );
}

export function AwayDigest({ onShowWaiting }: { onShowWaiting: () => void }) {
  const { t, fmt, locale } = useI18n();
  const { me, user } = useSession();
  const where = useWhere();
  const qc = useQueryClient();
  const digest = useDigest(!me.local);
  const [acked, setAcked] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const d: Digest | undefined = digest.data;
  if (!d || me.local) return null;

  if (d.basis === 'first') {
    return (
      <section className="panel digest is-welcome" aria-labelledby="digest-title" data-testid="digest">
        <h2 className="panel-title" id="digest-title">
          {t('digest.title')}
        </h2>
        <p className="digest-headline" data-testid="digest-headline">
          {t('digest.welcome')}
        </p>
      </section>
    );
  }

  const news = hasNews(d);
  // just acknowledged (or nothing new since): nothing to say
  if (acked !== null && acked >= d.until - 1) return null;
  if (!news && d.basis === 'acknowledged') return null;

  const owner = user?.role === 'owner';
  const who = owner ? t('digest.whoOwner') : t('digest.whoPerson');
  const headline = digestHeadline(d, t, locale, who);
  if (!news) {
    return (
      <p className="dash-hint digest-quiet notice-line" data-testid="digest-quiet">
        <ICON.done className="digest-row-icon is-ok" aria-hidden />
        {headline}
      </p>
    );
  }

  const acknowledge = async () => {
    setError(false);
    try {
      await ackDigest(d.until);
      setAcked(d.until);
      await qc.invalidateQueries({ queryKey: keys.digest });
    } catch {
      setError(true);
    }
  };

  return (
    <section className="panel digest" aria-labelledby="digest-title" data-testid="digest">
      <header className="digest-head">
        <h2 className="panel-title" id="digest-title">
          {t('digest.title')}
        </h2>
        {d.since != null && d.basis === 'away' && (
          <time className="dash-hint" dateTime={new Date(d.since * 1000).toISOString()}>
            {t('digest.lastVisit', { when: fmt.dateTime(d.since) })}
          </time>
        )}
      </header>
      <p className="digest-headline" data-testid="digest-headline">
        {headline}
      </p>

      {d.counts.approvals_mine > 0 && (
        <Group title={t('digest.group.approve')} tone="is-warn" count={d.counts.approvals_mine} shown={d.approvals_mine.length} testid="digest-approve">
          <div className="stack">
            {d.approvals_mine.map((a) => (
              <WsScope key={`${a.org}-${a.workspace}-${a.run_id}`} org={a.org} ws={a.workspace}>
                <ApprovalCard item={a} compact from={<span className="from-scope">{where(a)}</span>} />
              </WsScope>
            ))}
          </div>
        </Group>
      )}
      {d.counts.approvals_others > 0 && (
        <p className="dash-hint digest-others">
          <ICON.locked size={14} aria-hidden />
          <button type="button" className="link-button" onClick={onShowWaiting}>
            {t('digest.othersLine', { n: d.counts.approvals_others })}
          </button>
        </p>
      )}

      {d.counts.finished > 0 && (
        <Group title={t('digest.group.done')} tone="is-ok" count={d.counts.finished} shown={d.finished.length} testid="digest-done">
          <ul className="digest-list">
            {d.finished.map((w) => (
              <WorkLine key={`${w.org}-${w.workspace}-${w.thread_id}`} w={w} />
            ))}
          </ul>
        </Group>
      )}

      {d.counts.failed > 0 && (
        <Group title={t('digest.group.failed')} tone="is-danger" count={d.counts.failed} shown={d.failed.length} testid="digest-failed">
          <ul className="digest-list">
            {d.failed.map((w) => (
              <WorkLine key={`${w.org}-${w.workspace}-${w.run_id}`} w={w} failed />
            ))}
          </ul>
        </Group>
      )}

      {d.counts.scheduled > 0 && (
        <Group title={t('schedule.tab')} count={d.counts.scheduled} shown={d.scheduled.length} testid="digest-scheduled">
          <ul className="digest-list">
            {d.scheduled.map((s) => {
              const status = RUN_STATUS[s.status];
              return (
                <li key={`${s.org}-${s.workspace}-${s.run_id}`} className="digest-row">
                  <ICON.schedule className="digest-row-icon" aria-hidden />
                  <span className="digest-row-body">
                    <span className="digest-row-title">{scheduleTitle({ kind: s.kind === 'workflow' ? 'workflow' : 'routine', title: s.title, name: s.name })}</span>
                    <span className="digest-row-meta">
                      <span className="from-scope">{where(s)}</span>
                      <span>{fmt.relative(s.created)}</span>
                    </span>
                    <Made items={s.artifacts} org={s.org} ws={s.workspace} />
                  </span>
                  <span className={`chip ${status.chip}`}>{t(status.label)}</span>
                </li>
              );
            })}
          </ul>
        </Group>
      )}

      {d.counts.calendar > 0 && (
        <Group title={t('digest.group.calendar')} count={d.counts.calendar} shown={d.calendar.length} testid="digest-calendar">
          <ul className="digest-list">
            {d.calendar.map((c) => (
              <li key={`${c.type}-${c.id}`} className="digest-row">
                {c.type === 'todo' ? <ICON.todo className="digest-row-icon" aria-hidden /> : <ICON.calendar className="digest-row-icon" aria-hidden />}
                <span className="digest-row-body">
                  <Link className="digest-row-title" to={`/calendar?view=list&date=${c.when.slice(0, 10)}&item=${c.item_id}`}>
                    {c.title}
                  </Link>
                  <span className="digest-row-meta">
                    {c.item_title && <span>{c.item_title}</span>}
                    <span>
                      {dayText(c.when.slice(0, 10), locale)}
                      {timeOf(c.when) ? ` ${timeOf(c.when)}` : ''}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Group>
      )}

      {d.counts.decided > 0 && (
        <Group title={t('digest.group.decided')} count={d.counts.decided} shown={d.decided.length} testid="digest-decided">
          <ul className="digest-list">
            {d.decided.map((x) => (
              <li key={`${x.org}-${x.workspace}-${x.thread_id}-${x.ts}`} className="digest-row">
                <ICON.person className="digest-row-icon" aria-hidden />
                <span className="digest-row-body">
                  <span className="digest-row-title">{x.title || t('chat.untitled')}</span>
                  <span className="digest-row-meta">
                    <span>
                      {x.decision === 'approved'
                        ? t('digest.approvedBy', { who: x.approver })
                        : x.decision === 'declined'
                          ? t('digest.declinedBy', { who: x.approver })
                          : t('digest.answeredBy', { who: x.approver })}
                    </span>
                    <span className="from-scope">{where(x)}</span>
                    <span>{fmt.relative(x.ts)}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Group>
      )}

      <footer className="digest-foot">
        {d.cost.spent_usd > 0 ? <span className="dash-hint">{t('digest.cost', { usd: fmt.usd(d.cost.spent_usd) })}</span> : <span />}
        <button type="button" className="btn with-icon" onClick={acknowledge} data-testid="digest-ack">
          <ICON.check />
          {t('digest.ack')}
        </button>
      </footer>
      {error && <p className="form-error">{t('common.failed')}</p>}
    </section>
  );
}
