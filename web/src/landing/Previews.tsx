// Small still compositions of the app's own screens for the landing (DESIGN.md `## 랜딩`): the
// office's live work, an approval card, the monthly P&L. Labelled as an example and holding no
// money figures or customer names — the shapes of the screens, not anyone's numbers.
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { agentName } from '../lib/agentNames';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import type { AgentStatus } from '../office/state';
import { byId } from './catalog';

function Frame({ title, icon: Icon, children }: { title: string; icon: (typeof ICON)[keyof typeof ICON]; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <figure className="landing-preview">
      <figcaption className="landing-preview-head">
        <span className="landing-preview-title">
          <Icon />
          {title}
        </span>
        <span className="landing-mono landing-preview-tag">{t('landing.preview.example')}</span>
      </figcaption>
      {children}
    </figure>
  );
}

const LIVE: { agent: string; task: MessageKey; status: AgentStatus }[] = [
  { agent: 'finance', task: 'landing.preview.task.finance', status: 'typing' },
  { agent: 'creative', task: 'landing.preview.task.creative', status: 'thinking' },
  { agent: 'data-analyst', task: 'landing.preview.task.analyst', status: 'done' },
];

export function LivePreview() {
  const { t, locale } = useI18n();
  return (
    <Frame title={t('landing.preview.live')} icon={ICON.office}>
      <ul className="landing-live">
        {LIVE.map((row) => (
          <li key={row.agent}>
            <AgentIcon agent={row.agent} size={28} label="" />
            <span className="landing-live-text">
              <b>{agentName(row.agent, locale, byId(row.agent))}</b>
              <span>{t(row.task)}</span>
            </span>
            <span className={`chip ${STATUS_CHIP[row.status]}`}>{t(STATUS_LABEL[row.status])}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function ApprovalPreview() {
  const { t, locale } = useI18n();
  return (
    <Frame title={t('landing.preview.approvals')} icon={ICON.approvals}>
      <div className="landing-approval">
        <div className="landing-approval-head">
          <AgentIcon agent="finance" size={28} label="" />
          <span className="landing-live-text">
            <b>{t('landing.control.approval')}</b>
            <span>{agentName('finance', locale, byId('finance'))}</span>
          </span>
          <span className={`chip ${STATUS_CHIP.waiting}`}>{t(STATUS_LABEL.waiting)}</span>
        </div>
        <p className="landing-approval-reason">{t('landing.control.reason')}</p>
        <div className="landing-approval-actions" aria-hidden="true">
          <span className="btn is-primary">{t('approvals.approve')}</span>
          <span className="btn">{t('approvals.decline')}</span>
        </div>
      </div>
    </Frame>
  );
}

/** Bar heights only (relative, 0–1) — a still shape of the screen, not data. */
const SHAPE: [number, number][] = [
  [0.52, 0.4],
  [0.6, 0.44],
  [0.56, 0.47],
  [0.7, 0.5],
  [0.78, 0.52],
  [0.86, 0.55],
];

export function PnlPreview() {
  const { t } = useI18n();
  return (
    <Frame title={t('landing.control.pnl')} icon={ICON.report}>
      <div className="landing-pnl" aria-hidden="true">
        {SHAPE.map(([rev, exp], i) => (
          <span className="landing-pnl-month" key={i}>
            <span className="landing-pnl-bar is-revenue" style={{ height: `${rev * 100}%` }} />
            <span className="landing-pnl-bar is-expense" style={{ height: `${exp * 100}%` }} />
          </span>
        ))}
      </div>
      <p className="landing-pnl-legend">
        <span>
          <span className="landing-pnl-key is-revenue" aria-hidden="true" />
          {t('pnl.revenue')}
        </span>
        <span>
          <span className="landing-pnl-key is-expense" aria-hidden="true" />
          {t('pnl.expenses')}
        </span>
      </p>
    </Frame>
  );
}
