// The content each landing section centres in its scene (DESIGN.md `## 랜딩` — 장면), and the HTML
// half of what the penguin does with it. The penguin walks to a spot picked from the content's box
// (staging.ts `spotFor`). Marks the canvas reads: `data-content` = the centred block the penguin
// stands by, `data-front` = what hides the penguin's body behind it (`ground` = and everything under
// it), `data-hand="L|R"` = where a wing goes, `data-rod` = the scroll rod, `data-stamp-target` =
// where the stamp lands, `data-gaze` = what the penguin looks at. Without acting (no 3D yet, the
// stacked page) every act is its plain, finished composition. The content itself never moves with
// the penguin — no nudge, no shake (user, 2026-11-09).
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n, type MessageKey } from '../i18n';
import { ICON, type IconName } from '../icons';
import { agentName } from '../lib/agentNames';
import { teamName } from '../lib/names';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import { ACT_DELAY_MS, cues, now, RELAY, STAMP_APPROVED_MS, STAMP_IMPACT_MS, type StampState } from './acting';
import { AGENT_COUNT, byId, TEAMS } from './catalog';
import { LandingOrgChart } from './LandingOrgChart';
import { PEOPLE, PersonFace } from './people';
import { DOMAINS, TIER, TIER_LABEL, WORKFLOW_EXAMPLES, type Domain, type WorkflowExample } from './workflows';

export interface ActProps {
  /** The section is on stage. */
  on: boolean;
  /** The 3D penguin is drawn and acting (live landing, motion welcome). */
  acting: boolean;
}

/** The three kinds of small business the landing speaks to, as the icons the page draws them with. */
export const DOMAIN_ICON: Record<Domain, IconName> = { logistics: 'logistics', commerce: 'commerce', it: 'itService' };

/** Starts the wave on the card each time the section comes in (the canvas plays it from `waveAt`). */
function useWave(on: boolean, acting: boolean) {
  useLayoutEffect(() => {
    if (on && acting) cues.waveAt = now() + ACT_DELAY_MS;
  }, [on, acting]);
}

/**
 * 시작: the company card — "your company", the three domains it can be (물류 · 커머스 · IT 서비스, an
 * icon and a word each — 2026-11-14, in place of the four promise chips), and the AI team in one
 * row with two team members; the penguin's first entrance lands on its top edge and it waves from
 * behind its upper right.
 */
export function CompanyAct({ on, acting }: ActProps) {
  const { t } = useI18n();
  useWave(on, acting);
  const agents = TEAMS.flatMap((g) => g.agents);
  return (
    <div className="landing-act is-sign is-company" data-content data-front="ground" data-testid="landing-company">
      <p className="landing-mono landing-company-name">{t('landing.hero.card')}</p>
      <ul className="landing-domains" data-testid="landing-domains">
        {DOMAINS.map((d) => {
          const Icon = ICON[DOMAIN_ICON[d]];
          return (
            <li key={d} data-domain={d}>
              <Icon size={22} />
              <span>{t(`landing.domain.${d}`)}</span>
            </li>
          );
        })}
      </ul>
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
    </div>
  );
}

/**
 * The pointing (the gap chart and the price cards): `cues.relayAt` starts the far wing out to the
 * mark (`data-hand`), and `pointing` is on while the wing is there — the spot it points at lights up
 * and the penguin looks at it (`data-gaze`). Once each time the section comes in.
 */
function usePointing(on: boolean, acting: boolean) {
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
  return pointing;
}

/** The gap chart's lines (viewBox 400 × 240): one start, the AI team climbing, the subscription staying flat. */
export const GAP = {
  start: { x: 40, y: 176 },
  team: { x: 316, y: 52 },
  sub: { x: 316, y: 164 },
  bracket: 334,
} as const;

/**
 * 왜 지금: two companies from the same point — the one that hands its work to an AI team climbs, the
 * one that only pays for a subscription stays flat — and the gap between them, which the penguin
 * points at from beside the chart's right edge. A picture, not data: no axis, no numbers (the copy
 * makes no statistical claim). Four words on it: AI 팀 · 구독만 · 격차 · 지금.
 */
export function GapAct({ on, acting }: ActProps) {
  const { t } = useI18n();
  const pointing = usePointing(on, acting);
  const { start, team, sub, bracket } = GAP;
  const pct = (x: number, y: number) => ({ left: `${(x / 400) * 100}%`, top: `${(y / 240) * 100}%` });
  return (
    <div className="landing-act is-relay is-gap" data-content data-front data-testid="landing-gap">
      <figure className={`landing-gap ${pointing ? 'is-on' : ''}`} aria-label={t('landing.problem.chart')}>
        <div className="landing-gap-plot">
        <svg className="landing-gap-lines" viewBox="0 0 400 240" aria-hidden="true">
          <line className="landing-gap-axis" x1={start.x} y1={208} x2={372} y2={208} />
          <path className="landing-gap-sub" d={`M${start.x} ${start.y} C 140 174, 230 168, ${sub.x} ${sub.y}`} />
          <path className="landing-gap-team" d={`M${start.x} ${start.y} C 150 172, 240 128, ${team.x} ${team.y}`} />
          <path className="landing-gap-bracket" d={`M${bracket - 8} ${team.y + 4} H${bracket} V${sub.y - 4} H${bracket - 8}`} data-gaze={pointing ? '' : undefined} />
          <circle className="landing-gap-start" cx={start.x} cy={start.y} r={5} />
          <circle className="landing-gap-end is-team" cx={team.x} cy={team.y} r={5} />
          <circle className="landing-gap-end is-sub" cx={sub.x} cy={sub.y} r={5} />
        </svg>
        <span className="landing-gap-label is-team" style={pct(team.x, team.y)}>
          <span className="landing-gap-faces" aria-hidden="true">
            {['finance', 'marketer', 'researcher'].map((id) => (
              <AgentIcon key={id} agent={id} size={20} label="" />
            ))}
          </span>
          {t('landing.problem.chart.team')}
        </span>
        <span className="landing-gap-label is-sub" style={pct(sub.x, sub.y)}>
          <ICON.subscription size={18} />
          {t('landing.problem.chart.sub')}
        </span>
        <span className="landing-gap-label is-gap" style={pct(bracket, (team.y + sub.y) / 2)}>
          {t('landing.problem.chart.gap')}
        </span>
        <span className="landing-gap-label is-now" style={pct(start.x, 208)}>
          {t('landing.problem.chart.now')}
        </span>
        <span className="landing-hand is-gap" style={pct(bracket, (team.y + sub.y) / 2)} data-hand="R" aria-hidden="true" />
        </div>
      </figure>
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
 * One example workflow on a card, drawn as a flow (2026-11-14 — the old 맡기기 section folded in):
 * its tabs (the live page — one card, three stops), the one-line request to Chief, Chief handing it
 * out to three agents (a short piece of work each), and the two approvals — the team's, then the
 * owner's with the approve button at the card's lower left, where the penguin's stamp lands. Few
 * words: no step sentences, no reasons (the message beside the card says why it stops). Every card
 * has the same rows, so the button sits at the same place in all three.
 */
function WorkflowCard({ w, state, tabs }: { w: WorkflowExample; state: StampState; tabs?: ReactNode }) {
  const { t, locale } = useI18n();
  const approved = state === 'approved';
  const team = TIER[w.team.category];
  const owner = TIER[w.owner.category];
  const chief = byId('chief');
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
      <h3 id={`landing-workflow-${w.id}`} className="sr-only">
        {t(w.name)} · {t(w.title)}
      </h3>
      <p className="landing-workflow-ask" data-testid="landing-workflow-ask">
        <ICON.ask />
        <span className="sr-only">{t('landing.workflows.ask')}: </span>
        <span>{t(w.ask)}</span>
      </p>
      <div className="landing-workflow-split">
        <span className="landing-workflow-chief">
          <AgentIcon agent="chief" team="core" size={28} label="" />
          <b>{agentName('chief', locale, chief)}</b>
        </span>
        <ol className="landing-workflow-pieces">
          {w.split.map((s) => (
            <li key={s.text}>
              <AgentIcon agent={s.agent} size={20} label={agentName(s.agent, locale, byId(s.agent))} />
              <span>{t(s.text)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="landing-workflow-gate" data-tier={team} data-category={w.team.category}>
        <span className={`chip ${team === 'owner' ? 'is-warn' : 'is-accent'}`}>
          {team === 'team' && <ICON.person size={14} />}
          {t(TIER_LABEL[team])} · {teamName(w.team.team, t)}
        </span>
        <b className="landing-workflow-gate-words">{t(w.team.text)}</b>
      </div>
      <div className="landing-workflow-gate" data-tier={owner} data-category={w.owner.category}>
        <span className={`chip ${owner === 'owner' ? 'is-warn' : 'is-accent'}`}>
          <ICON.owner size={14} />
          {t(TIER_LABEL[owner])}
        </span>
        <b className="landing-workflow-gate-words">{t(w.owner.text)}</b>
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
  { name: 'landing.pricing.usage.name', body: 'landing.pricing.usage.body', price: 'landing.pricing.usage.price', note: 'landing.pricing.usage.note' },
];

/**
 * 가격: the three price cards, centred a little left so the penguin stands beside their right edge;
 * its far wing comes round in front of the belly to card 1 (the build price) and rests there a
 * moment, then goes back. Played once each time the section comes in.
 */
export function PricingAct({ on, acting }: ActProps) {
  const { t } = useI18n();
  const pointing = usePointing(on, acting);
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
