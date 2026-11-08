// The content each landing section centres in its scene (DESIGN.md `## 랜딩` — 장면), and the HTML
// half of what the penguin does with it. The penguin walks to a spot picked from the content's box
// (staging.ts `spotFor`). Marks the canvas reads: `data-content` = the centred block the penguin
// stands by, `data-front` = what hides the penguin's body behind it (`ground` = and everything under
// it), `data-hand="L|R"` = where a wing goes, `data-rod` = the scroll rod, `data-stamp-target` =
// where the stamp lands, `data-gaze` = what the penguin looks at. Without acting (no 3D yet, the
// stacked page) every act is its plain, finished composition. The content itself never moves with
// the penguin — no nudge, no shake (user, 2026-11-09).
import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n, type MessageKey } from '../i18n';
import { ICON } from '../icons';
import { agentName } from '../lib/agentNames';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import { ACT_DELAY_MS, cues, now, RELAY, RELAY_STEPS, STAMP_APPROVED_MS, STAMP_IMPACT_MS, type StampState } from './acting';
import { AGENT_COUNT, byId, TEAMS } from './catalog';
import { LandingOrgChart } from './LandingOrgChart';
import { PromptTyper } from './PromptTyper';

export interface ActProps {
  /** The section is on stage. */
  on: boolean;
  /** The 3D penguin is drawn and acting (live landing, motion welcome). */
  acting: boolean;
}

/** Hero: the prompt box, centred; the penguin pretends to type over its top edge while it types. */
export function PromptAct({ on, acting, still }: ActProps & { still: boolean }) {
  const live = on && acting;
  const onTyping = useCallback(
    (typing: boolean) => {
      cues.typing = live && typing;
    },
    [live],
  );
  useLayoutEffect(() => {
    if (!live) cues.typing = false;
  }, [live]);
  return (
    <div className="landing-act is-prompt" data-content data-front="ground">
      <PromptTyper still={still} onTyping={onTyping} />
    </div>
  );
}

const STEPS: { title: MessageKey; body: MessageKey }[] = [
  { title: 'landing.what.step1.title', body: 'landing.what.step1.body' },
  { title: 'landing.what.step2.title', body: 'landing.what.step2.body' },
  { title: 'landing.what.step3.title', body: 'landing.what.step3.body' },
];

/** The agents step 2 hands the work to — three teams, three colours. */
const HANDS_TO = ['finance', 'data-analyst', 'creative'];

export type RelayStep = 'waiting' | 'on' | 'done';
/** Card `i` when the relay is at `at` (-1 … 3). */
export const relayStep = (i: number, at: number): RelayStep => (at > i ? 'done' : at === i ? 'on' : 'waiting');

/**
 * What it does — a relay: the penguin hands the request to card 1, and the cards light up one after
 * another as the request goes through (accent = working, ok = done — the same words as the app's
 * colours). Played once each time the section comes in; without acting, all three are done.
 */
export function StepsAct({ on, acting }: ActProps) {
  const { t, locale } = useI18n();
  const [at, setAt] = useState(RELAY_STEPS);
  useLayoutEffect(() => {
    if (!on || !acting) {
      setAt(RELAY_STEPS);
      return;
    }
    setAt(-1);
    const start = now() + ACT_DELAY_MS;
    cues.relayAt = start;
    const timers = [0, 1, 2, 3].map((i) => window.setTimeout(() => setAt(i), ACT_DELAY_MS + RELAY.reach + i * RELAY.step));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [on, acting]);
  return (
    <div className="landing-act is-relay" data-content data-front data-relay={at}>
      <ol className="landing-steps">
        {STEPS.map((s, i) => {
          const state = relayStep(i, at);
          return (
            <li key={s.title} className={`landing-step is-${state}`} data-state={state} data-gaze={state === 'on' ? '' : undefined}>
              <span className="landing-step-badge" aria-hidden="true">
                {state === 'done' ? <ICON.check /> : String(i + 1).padStart(2, '0')}
              </span>
              <div className="landing-step-words">
                <h3>{t(s.title)}</h3>
                <p>{t(s.body)}</p>
              </div>
              <div className="landing-step-proof" aria-hidden="true">
                {i === 0 && (
                  <span className="landing-ask">
                    <ICON.ask />
                    {t('landing.prompt.1')}
                  </span>
                )}
                {i === 1 && (
                  <span className="landing-handoff">
                    <AgentIcon agent="chief" team="core" size={28} label="" />
                    <ICON.forward />
                    {HANDS_TO.map((id) => (
                      <AgentIcon key={id} agent={id} size={28} label="" />
                    ))}
                  </span>
                )}
                {i === 2 && (
                  <span className="landing-artifact">
                    <ICON.artifacts />
                    {t('landing.what.artifact')}
                    <span className="landing-artifact-by">{agentName('finance', locale, byId('finance'))}</span>
                  </span>
                )}
              </div>
              {i === 0 && <span className="landing-hand is-card" data-hand="R" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Team: the org chart on a scroll's paper, centred. The penguin peeks over the paper's upper-left
 * corner, its wing on the rod's knob, and the paper unrolls downwards. `--unroll` (landing.css) is
 * how far it is down; the rod is 3D.
 */
export function ScrollAct({ on, acting, onOpen }: ActProps & { onOpen: (at: string | null) => void }) {
  useLayoutEffect(() => {
    if (on && acting) cues.unrollAt = now() + ACT_DELAY_MS;
  }, [on, acting]);
  return (
    <div className="landing-act is-scroll" data-content>
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
 * Approval: the approval card, centred. From just outside its lower-left corner the penguin raises
 * a stamp and brings it down on the approve button — the button presses, an ink ring stays and the
 * card turns approved. The card itself stays still. Played once each time the section comes in.
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
    <div className="landing-act is-stamp" data-content>
      <figure className={`landing-preview landing-approval is-${state}`} data-front data-testid="landing-approval" data-state={state} aria-label={t('landing.preview.approvals')}>
        <div className="landing-approval-head">
          <AgentIcon agent="finance" size={28} label="" />
          <span className="landing-live-text">
            <b>{t('landing.control.approval')}</b>
            <span>{agentName('finance', locale, byId('finance'))}</span>
          </span>
          <span className={`chip ${approved ? STATUS_CHIP.done : STATUS_CHIP.waiting}`}>{t(approved ? 'landing.control.approved' : STATUS_LABEL.waiting)}</span>
        </div>
        <figcaption className="landing-approval-foot">
          <span className="landing-approval-reason">{t('landing.control.reason')}</span>
          <span className="landing-mono landing-preview-tag">{t('landing.preview.example')}</span>
        </figcaption>
        {/* the buttons at the bottom left — where the penguin's stamp reaches from the corner */}
        <div className="landing-approval-actions" aria-hidden="true">
          {/* the mark sits outside the button (a button clips what overflows it) */}
          <span className="landing-approve-wrap">
            <span className="btn is-primary landing-approve" data-stamp-target>
              {t('approvals.approve')}
            </span>
            <span className="landing-stamp-mark" data-testid="landing-stamp-mark" />
          </span>
          <span className="btn landing-decline">{t('approvals.decline')}</span>
        </div>
      </figure>
    </div>
  );
}

/**
 * Start: the product line, the whole team's faces and one big button on a card, centred; the
 * penguin pops up behind its upper right and waves.
 */
export function SignAct({ on, acting, cta }: ActProps & { cta: ReactNode }) {
  const { t } = useI18n();
  useLayoutEffect(() => {
    if (on && acting) cues.waveAt = now() + ACT_DELAY_MS;
  }, [on, acting]);
  const agents = TEAMS.flatMap((g) => g.agents);
  return (
    <div className="landing-act is-sign" data-content data-front="ground">
      <p className="landing-statement">{t('landing.statement')}</p>
      <div className="landing-faces" aria-hidden="true">
        <span className="landing-faces-row">
          {agents.map((a) => (
            <AgentIcon key={a.id} agent={a.id} team={a.team} size={28} label="" />
          ))}
        </span>
        <span className="landing-faces-label">{t('landing.team.title', { n: AGENT_COUNT, teams: TEAMS.length })}</span>
      </div>
      {cta}
    </div>
  );
}
