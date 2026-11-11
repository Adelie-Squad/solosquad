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
import { teamName } from '../lib/names';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import { ACT_DELAY_MS, cues, now, RELAY, STAMP_APPROVED_MS, STAMP_IMPACT_MS, type StampState } from './acting';
import { AGENT_COUNT, byId, TEAMS } from './catalog';
import { LandingOrgChart } from './LandingOrgChart';
import { PEOPLE, PersonFace } from './people';
import { PromptTyper } from './PromptTyper';
import { TIER, TIER_LABEL, TIER_REASON, WORKFLOW_EXAMPLES, type WorkflowExample } from './workflows';

export interface ActProps {
  /** The section is on stage. */
  on: boolean;
  /** The 3D penguin is drawn and acting (live landing, motion welcome). */
  acting: boolean;
}

const CHIPS: MessageKey[] = ['landing.hero.chip.server', 'landing.hero.chip.region', 'landing.hero.chip.lang', 'landing.hero.chip.setup'];

/** Starts the wave on the card each time the section comes in (the canvas plays it from `waveAt`). */
function useWave(on: boolean, acting: boolean) {
  useLayoutEffect(() => {
    if (on && acting) cues.waveAt = now() + ACT_DELAY_MS;
  }, [on, acting]);
}

/**
 * 시작: the company card — "your company", the fifteen agents and two team members in one row, and
 * what the build promises; the penguin's first entrance lands on its top edge and it waves from
 * behind its upper right.
 */
export function CompanyAct({ on, acting }: ActProps) {
  const { t } = useI18n();
  useWave(on, acting);
  const agents = TEAMS.flatMap((g) => g.agents);
  return (
    <div className="landing-act is-sign is-company" data-content data-front="ground" data-testid="landing-company">
      <p className="landing-mono landing-company-name">{t('landing.hero.card')}</p>
      <div className="landing-faces" aria-hidden="true">
        <span className="landing-faces-row">
          {agents.map((a) => (
            <AgentIcon key={a.id} agent={a.id} team={a.team} size={28} label="" />
          ))}
          {PEOPLE.map((team) => (
            <PersonFace key={team} />
          ))}
        </span>
        <span className="landing-faces-label">{t('landing.hero.faces', { n: AGENT_COUNT })}</span>
      </div>
      <ul className="landing-chips">
        {CHIPS.map((k) => (
          <li key={k} className="chip">
            {t(k)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 맡기기: the prompt box and the split under it, centred; the penguin patters over its top edge while it types. */
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

/**
 * 조직도: the org chart (agents and team members) on a scroll's paper, centred. The penguin peeks over
 * the paper's upper-left corner, its wing on the rod's knob, and the paper unrolls downwards.
 * `--unroll` (landing.css) is how far it is down; the rod is 3D.
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
 * One example workflow on a card: its tabs (the live page — one card, three stops), the four steps
 * the agents do (each with its agent), what people do, and the two approvals at the bottom — the
 * team's, then the owner's with the approve button at the card's lower left, where the penguin's
 * stamp lands. Every card has the same rows, so the button sits at the same place in all three.
 */
function WorkflowCard({ w, state, tabs }: { w: WorkflowExample; state: StampState; tabs?: ReactNode }) {
  const { t, locale } = useI18n();
  const approved = state === 'approved';
  const team = TIER[w.team.category];
  const owner = TIER[w.owner.category];
  return (
    <figure
      className={`landing-preview landing-approval landing-workflow is-${state}`}
      data-front
      data-testid="landing-workflow"
      data-workflow={w.id}
      data-state={state}
      aria-labelledby={`landing-workflow-${w.id}`}
    >
      <div className="landing-workflow-head">
        {tabs ?? <span className="landing-workflow-name">{t(w.name)}</span>}
        <span className="landing-mono landing-preview-tag">{t('landing.preview.example')}</span>
      </div>
      <h3 id={`landing-workflow-${w.id}`} className="landing-workflow-title">
        {t(w.title)}
      </h3>
      <div className="landing-workflow-part">
        <p className="landing-mono landing-workflow-label">{t('landing.workflows.agents')}</p>
        <ol className="landing-workflow-steps">
          {w.steps.map((s) => (
            <li key={s.text}>
              <AgentIcon agent={s.agent} size={20} label={agentName(s.agent, locale, byId(s.agent))} />
              <span>{t(s.text)}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="landing-workflow-people">
        <ICON.person />
        <b>{t('landing.workflows.people')}</b>
        <span>{t(w.people)}</span>
      </p>
      <div className="landing-workflow-gate" data-tier={team} data-category={w.team.category}>
        <span className={`chip ${team === 'owner' ? 'is-warn' : 'is-accent'}`}>
          {t(TIER_LABEL[team])} · {teamName(w.team.team, t)}
        </span>
        <span className="landing-workflow-gate-words">
          <b>{t(w.team.text)}</b>
          <span>{t(TIER_REASON[team])}</span>
        </span>
      </div>
      <div className="landing-workflow-gate" data-tier={owner} data-category={w.owner.category}>
        <span className={`chip ${owner === 'owner' ? 'is-warn' : 'is-accent'}`}>{t(TIER_LABEL[owner])}</span>
        <span className="landing-workflow-gate-words">
          <b>{t(w.owner.text)}</b>
          <span>{t(TIER_REASON[owner])}</span>
        </span>
        <span className={`chip ${approved ? STATUS_CHIP.done : STATUS_CHIP.waiting}`}>{t(approved ? 'landing.workflows.approved' : STATUS_LABEL.waiting)}</span>
      </div>
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
  );
}

/**
 * 워크플로우: the workflow card, centred — three stops, one workflow each (`at`), the card the same
 * size and in the same place for all three, so only its content fades and the penguin stays put. From
 * just outside the card's lower-left corner the penguin raises a stamp and brings it down on the
 * owner's approve button — again at every stop. The stacked page shows the three cards one under
 * another (no tabs). `onPick` = a tab was pressed (the live page moves to that stop).
 */
export function WorkflowAct({ on, acting, at, stacked, onPick }: ActProps & { at: number; stacked: boolean; onPick?: (i: number) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<StampState>('waiting');
  useLayoutEffect(() => {
    if (!on || !acting) return;
    setState('waiting');
    cues.stampAt = now() + ACT_DELAY_MS;
    const timers = [window.setTimeout(() => setState('pressed'), ACT_DELAY_MS + STAMP_IMPACT_MS), window.setTimeout(() => setState('approved'), ACT_DELAY_MS + STAMP_APPROVED_MS)];
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [on, acting, at]);
  if (stacked) {
    return (
      <div className="landing-act is-stamp is-stacked" data-content>
        {WORKFLOW_EXAMPLES.map((w) => (
          <WorkflowCard key={w.id} w={w} state="waiting" />
        ))}
      </div>
    );
  }
  const w = WORKFLOW_EXAMPLES[at] ?? WORKFLOW_EXAMPLES[0];
  const tabs = (
    <span className="landing-workflow-tabs" role="tablist" aria-label={t('landing.workflows.tabs')}>
      {WORKFLOW_EXAMPLES.map((x, i) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={i === at}
          className={i === at ? 'is-on' : ''}
          onClick={() => onPick?.(i)}
          data-testid={`landing-workflow-tab-${x.id}`}
        >
          {t(x.name)}
        </button>
      ))}
    </span>
  );
  return (
    <div className="landing-act is-stamp" data-content>
      <WorkflowCard key={w.id} w={w} state={state} tabs={tabs} />
    </div>
  );
}

const PRICES: { name: MessageKey; body: MessageKey; price: MessageKey; note?: MessageKey }[] = [
  { name: 'landing.pricing.setup.name', body: 'landing.pricing.setup.body', price: 'landing.pricing.setup.price', note: 'landing.pricing.vat' },
  { name: 'landing.pricing.call.name', body: 'landing.pricing.call.body', price: 'landing.pricing.call.price' },
  { name: 'landing.pricing.usage.name', body: 'landing.pricing.usage.body', price: 'landing.pricing.usage.price' },
];

/**
 * 가격: the three price cards, centred a little left so the penguin stands beside their right edge;
 * its far wing comes round in front of the belly to card 1 (the build price) and rests there a
 * moment, then goes back. Played once each time the section comes in.
 */
export function PricingAct({ on, acting }: ActProps) {
  const { t } = useI18n();
  const [pointing, setPointing] = useState(false);
  useLayoutEffect(() => {
    if (!on || !acting) {
      setPointing(false);
      return;
    }
    cues.relayAt = now() + ACT_DELAY_MS;
    const timers = [window.setTimeout(() => setPointing(true), ACT_DELAY_MS + RELAY.reach), window.setTimeout(() => setPointing(false), ACT_DELAY_MS + RELAY.reach + RELAY.step + RELAY.release)];
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [on, acting]);
  return (
    <div className="landing-act is-relay is-pricing" data-content data-front data-testid="landing-pricing">
      <ol className="landing-prices">
        {PRICES.map((p, i) => (
          <li key={p.name} className={`landing-price ${i === 0 && pointing ? 'is-on' : ''}`} data-gaze={i === 0 && pointing ? '' : undefined}>
            <div className="landing-price-words">
              <h3>{t(p.name)}</h3>
              <p>{t(p.body)}</p>
            </div>
            <p className="landing-price-amount">
              <b>{t(p.price)}</b>
              {p.note && <span>{t(p.note)}</span>}
            </p>
            {i === 0 && <span className="landing-hand is-card" data-hand="R" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * 문의: the last card — the product line and the two buttons, centred; the penguin pops up behind its
 * upper right and waves.
 */
export function SignAct({ on, acting, cta }: ActProps & { cta: ReactNode }) {
  const { t } = useI18n();
  useWave(on, acting);
  return (
    <div className="landing-act is-sign" data-content data-front="ground">
      <p className="landing-statement">{t('landing.statement')}</p>
      {cta}
    </div>
  );
}
