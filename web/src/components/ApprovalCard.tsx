import { useLinks } from '../scope';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { errorText } from '../api/errors';
import { decide, type Decision, useAction, useKeys, useScopedApi } from '../api/queries';
import type { ApprovalItem } from '../api/types.gen';
import { categoryLabel, useI18n, type MessageKey } from '../i18n';
import { AgentIcon } from '../characters/PenguinIcon';
import { ICON } from '../icons';
import { useAgentName } from '../lib/agentNames';
import { readable } from '../lib/names';

/** Why this person cannot answer the card — the same rule the server applies (decision 51). */
export function blockedReason(item: ApprovalItem): { key: MessageKey; team?: string } | null {
  if (item.can_approve) return null;
  if (item.tier === 'owner') return { key: 'approvals.needsOwner' };
  return item.card.team ? { key: 'approvals.needsTeam', team: item.card.team } : { key: 'approvals.needsOwner' };
}

const RISK: Record<string, string> = { high: 'is-danger', medium: 'is-warn', low: 'is-ok' };
const RISK_LABEL: Record<string, MessageKey> = { high: 'risk.high', medium: 'risk.medium', low: 'risk.low' };

/**
 * One approval card (W12 + decision 51): what is asked, who asked, its category and tier.
 * Approve / decline appear only when the server says this person may answer
 * (`can_approve`); otherwise the reason is shown instead.
 */
export function ApprovalCard({ item, compact = false }: { item: ApprovalItem; compact?: boolean }) {
  const keys = useKeys();
  const { w: toWs } = useLinks();
  const { scope } = useScopedApi();
  const { t, locale, fmt } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const answer = useAction((value: Decision) => decide(scope, item, value), [keys.approvals, keys.runs, keys.workflowRuns()]);
  const nameOf = useAgentName();
  const blocked = blockedReason(item);
  const card = item.card;
  const workflowLink = item.source === 'workflow' && card.workflow ? `/workflows/${card.workflow}/runs/${item.thread_id}` : null;

  const run = (value: Decision) => {
    setError(null);
    answer.mutate(value, {
      onError: (e) => setError(e instanceof ApiError ? errorText(e, t) : t('common.failed')),
    });
  };

  return (
    <article className={`panel approval-card ${compact ? 'is-compact' : ''}`} data-testid="approval-card">
      <header className="approval-card-head">
        <AgentIcon agent={card.agent && !card.agent.startsWith('workflow:') ? card.agent : 'workflow'} team={card.team} size={28} label="" />
        <strong className="approval-title">{card.title}</strong>
        <span className="approval-chips">
          <span className="chip">{categoryLabel(locale, card.category)}</span>
          <span className={`chip ${item.tier === 'owner' ? 'is-accent' : ''}`}>
            {item.tier === 'owner' ? t('tier.owner') : t('tier.team')}
            {card.team ? ` · ${readable(card.team)}` : ''}
          </span>
          <span className={`chip ${RISK[card.risk] ?? ''}`}>{t('approvals.risk', { risk: RISK_LABEL[card.risk] ? t(RISK_LABEL[card.risk]) : card.risk })}</span>
        </span>
      </header>
      {card.summary && <p className="approval-summary">{card.summary}</p>}
      <p className="approval-meta">
        {item.source === 'workflow' ? t('approvals.fromWorkflow', { name: card.workflow ?? '' }) : t('approvals.fromAgent', { name: nameOf(card.agent) })}
        {' · '}
        {fmt.relative(item.created)}
        {workflowLink && (
          <>
            {' · '}
            <Link to={workflowLink}>{t('approvals.openRun')}</Link>
          </>
        )}
        {item.source === 'company' && (
          <>
            {' · '}
            <Link to={toWs(`/chat/${item.thread_id}`)}>{t('approvals.openChat')}</Link>
          </>
        )}
      </p>
      {blocked ? (
        <p className="approval-blocked with-icon" data-testid="approval-blocked">
          <ICON.locked />
          {t(blocked.key, { team: blocked.team ? readable(blocked.team) : '' })}
        </p>
      ) : (
        <div className="approval-actions">
          <button className="btn is-primary" disabled={answer.isPending} onClick={() => run('approved')}>
            {t('approvals.approve')}
          </button>
          <button className="btn" disabled={answer.isPending} onClick={() => run('declined')}>
            {t('approvals.decline')}
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </article>
  );
}
