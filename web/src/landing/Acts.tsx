// The content each landing section puts in front of the penguin (DESIGN.md `## 랜딩` — 장면), and the
// HTML half of what the penguin does with it. Each act sits in the section's scene box, which lies
// exactly over the penguin, so the content overlaps the penguin's lower half and the wings reach
// it. Marks the canvas reads: `data-hand="L|R"` = where a wing goes, `data-front` = the content in
// front of the penguin (the canvas hides the body behind it), `data-rod` = the scroll rod,
// `data-stamp-target` = where the stamp lands. Without acting (no 3D yet, the stacked page) every
// act is its plain, finished composition.
import { useCallback, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n, type MessageKey } from '../i18n';
import { agentName } from '../lib/agentNames';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import { ACT_DELAY_MS, cues, FLIP_STEP_MS, now, STAMP_APPROVED_MS, STAMP_IMPACT_MS, type StampState } from './acting';
import { byId } from './catalog';
import { LandingOrgChart } from './LandingOrgChart';
import { PromptTyper } from './PromptTyper';

export interface ActProps {
  /** The section is on stage. */
  on: boolean;
  /** The 3D penguin is drawn and acting (live landing, motion welcome). */
  acting: boolean;
}

/** Where the two wings rest on the content: the penguin's left wing is on the reader's right. */
function Hands() {
  return (
    <>
      <span className="landing-hand is-l" data-hand="L" aria-hidden="true" />
      <span className="landing-hand is-r" data-hand="R" aria-hidden="true" />
    </>
  );
}

/** Hero: the prompt box in front of the penguin; it taps a key for every character typed. */
export function PromptAct({ on, acting, still }: ActProps & { still: boolean }) {
  const [taps, setTaps] = useState(0);
  const onType = useCallback(
    (typed: number) => {
      if (!on || !acting) return;
      cues.tapAt = now();
      cues.tapSide = typed % 2 ? 'R' : 'L';
      setTaps(typed);
    },
    [on, acting],
  );
  return (
    <div className="landing-act is-prompt" data-tap={taps ? (taps % 2 ? 'a' : 'b') : undefined} data-front>
      <Hands />
      <PromptTyper still={still} onType={onType} />
    </div>
  );
}

const STEPS: { title: MessageKey; body: MessageKey }[] = [
  { title: 'landing.what.step1.title', body: 'landing.what.step1.body' },
  { title: 'landing.what.step2.title', body: 'landing.what.step2.body' },
  { title: 'landing.what.step3.title', body: 'landing.what.step3.body' },
];

/** What it does: the penguin holds up the three-step board and turns its cards over one by one. */
export function StepsAct({ on, acting }: ActProps) {
  const { t } = useI18n();
  useLayoutEffect(() => {
    if (on && acting) cues.flipAt = now() + ACT_DELAY_MS;
  }, [on, acting]);
  return (
    <div className="landing-act is-board" data-front>
      <Hands />
      <ol className="landing-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} style={{ '--flip-at': `${ACT_DELAY_MS + i * FLIP_STEP_MS}ms` } as CSSProperties}>
            <span className="landing-mono landing-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{t(s.title)}</h3>
            <p>{t(s.body)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Team: the penguin holds a scroll by its rod and lets the paper unroll downwards; the org chart is
 * on the paper. The paper's revealed height is `--unroll` (landing.css), the rod is 3D.
 */
export function ScrollAct({ on, acting, onOpen }: ActProps & { onOpen: (at: string | null) => void }) {
  useLayoutEffect(() => {
    if (on && acting) cues.unrollAt = now() + ACT_DELAY_MS;
  }, [on, acting]);
  return (
    <div className="landing-act is-scroll">
      <span className="landing-rod" data-rod aria-hidden="true" />
      <div className="landing-scroll">
        <span className="landing-scroll-extent" data-front aria-hidden="true" />
        <div className="landing-scroll-sheet">
          <LandingOrgChart onOpen={onOpen} />
        </div>
        <span className="landing-scroll-roll" data-front aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * Approval: an approval card in front of the penguin. It raises a stamp and brings it down on the
 * approve button — the button presses, the card shakes once, an ink mark stays and the card turns
 * approved. Played once each time the section comes in.
 */
export function StampAct({ on, acting }: ActProps) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<StampState>('waiting');
  useLayoutEffect(() => {
    if (!on || !acting) return;
    setState('waiting');
    cues.stampAt = now() + ACT_DELAY_MS;
    const timers = [window.setTimeout(() => setState('pressed'), ACT_DELAY_MS + STAMP_IMPACT_MS), window.setTimeout(() => setState('approved'), ACT_DELAY_MS + STAMP_APPROVED_MS)];
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [on, acting]);
  const approved = state === 'approved';
  return (
    <div className="landing-act is-stamp">
      <figure className={`landing-preview landing-approval is-${state}`} data-front data-testid="landing-approval" data-state={state} aria-label={t('landing.preview.approvals')}>
        <span className="landing-hand is-l" data-hand="L" aria-hidden="true" />
        <div className="landing-approval-head">
          <AgentIcon agent="finance" size={28} label="" />
          <span className="landing-live-text">
            <b>{t('landing.control.approval')}</b>
            <span>{agentName('finance', locale, byId('finance'))}</span>
          </span>
          <span className={`chip ${approved ? STATUS_CHIP.done : STATUS_CHIP.waiting}`}>{t(approved ? 'landing.control.approved' : STATUS_LABEL.waiting)}</span>
        </div>
        {/* the buttons come right under the head — within reach of the stamp */}
        <div className="landing-approval-actions" aria-hidden="true">
          <span className="btn is-primary landing-approve" data-stamp-target>
            {t('approvals.approve')}
            <span className="landing-stamp-mark" data-testid="landing-stamp-mark" />
          </span>
          <span className="btn landing-decline">{t('approvals.decline')}</span>
        </div>
        <figcaption className="landing-approval-foot">
          <span className="landing-approval-reason">{t('landing.control.reason')}</span>
          <span className="landing-mono landing-preview-tag">{t('landing.preview.example')}</span>
        </figcaption>
      </figure>
    </div>
  );
}

/** Start: the penguin holds the product line and the one button up like a sign. */
export function SignAct({ cta }: { cta: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="landing-act is-sign" data-front>
      <Hands />
      <p className="landing-statement">{t('landing.statement')}</p>
      {cta}
    </div>
  );
}
