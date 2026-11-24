// The content each landing section centres in its scene (DESIGN.md `## 랜딩` — 장면), and the HTML
// half of what the penguin does with it. The penguin walks to a spot picked from the content's box
// (staging.ts `spotFor`). Marks the canvas reads: `data-content` = the centred block the penguin
// stands by, `data-front` = what hides the penguin's body behind it (`ground` = and everything under
// it), `data-hand="L|R"` = where a wing goes, `data-rod` = the scroll rod, `data-stamp-target` =
// where the stamp lands, `data-gaze` = what the penguin looks at. Without acting (no 3D yet, the
// stacked page) every act is its plain, finished composition. The content itself never moves with
// the penguin — no nudge, no shake (user, 2026-11-09).
import { useEffect, useLayoutEffect, type CSSProperties, type ReactNode } from 'react';
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n, type MessageKey } from '../i18n';
import { ICON, type IconName } from '../icons';
import { agentName } from '../lib/agentNames';
import { teamName } from '../lib/names';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import { cues, easeOut, RELAY, UNROLL_MS } from './acting';
import { flowAt, flowLength, flowStill, type FlowFrame } from './flow';
import { useProgress } from './progress';
import { GAP_DRAW_MS, sceneMs, workflowAt } from './scene';
import { byId } from './catalog';
import { LandingOrgChart } from './LandingOrgChart';
import { TIER, TIER_LABEL, WORKFLOW_EXAMPLES, type Domain, type WorkflowExample } from './workflows';

export interface ActProps {
  /** The section is on stage. */
  on: boolean;
  /** The 3D penguin is drawn and acting (live landing, motion welcome). */
  acting: boolean;
}

/** The three kinds of small business the landing speaks to, as the icons the page draws them with. */
export const DOMAIN_ICON: Record<Domain, IconName> = { logistics: 'logistics', commerce: 'commerce', it: 'itService' };

/**
 * 시작 (2026-11-24 — "첫번째 섹션은 인포그래픽 제거하고 펭귄만 조금 큰 사이즈로"): no card, only the
 * penguin, a little larger than in the other sections — an empty box the size of the penguin
 * (`data-stand`: its feet at the middle of the bottom edge, staging.ts `standSpot`). It waves. Nothing
 * stands in front of it, so nothing hides it.
 */
export function StandAct(_props: ActProps) {
  return <div className="landing-act is-stand" data-content data-stand aria-hidden="true" data-testid="landing-hero-penguin" />;
}

/**
 * The pointing (the gap chart and the price cards), by the scene's act ms (scene.ts — the scroll
 * through the section): the far wing goes out to the mark (`data-hand`), and while it is there the
 * spot it points at lights up and the penguin looks at it (`data-gaze`). Rewinds with the scroll.
 */
export const pointingAt = (ms: number) => ms >= RELAY.reach && ms < RELAY.reach + RELAY.step + RELAY.release;

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
export function GapAct({ acting }: ActProps) {
  const { t } = useI18n();
  const p = useProgress('problem');
  const ms = acting ? sceneMs('problem', p) : GAP_DRAW_MS + RELAY.reach + RELAY.step + RELAY.release;
  // the lines draw in first (by the scroll), then the penguin points at the gap
  const drawn = Math.min(1, ms / GAP_DRAW_MS);
  const pointing = acting && pointingAt(ms - GAP_DRAW_MS);
  const line = { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - drawn };
  // the words and the bracket come once the lines are nearly there
  const shown = Math.max(0, Math.min(1, (drawn - 0.6) / 0.4));
  const { start, team, sub, bracket } = GAP;
  const pct = (x: number, y: number) => ({ left: `${(x / 400) * 100}%`, top: `${(y / 240) * 100}%` });
  return (
    <div className="landing-act is-relay is-gap" data-content data-front data-testid="landing-gap">
      <figure className={`landing-gap ${pointing ? 'is-on' : ''}`} aria-label={t('landing.problem.chart')}>
        <div className="landing-gap-plot">
        <svg className="landing-gap-lines" viewBox="0 0 400 240" aria-hidden="true">
          <line className="landing-gap-axis" x1={start.x} y1={208} x2={372} y2={208} />
          <path className="landing-gap-sub" d={`M${start.x} ${start.y} C 140 174, 230 168, ${sub.x} ${sub.y}`} {...line} />
          <path className="landing-gap-team" d={`M${start.x} ${start.y} C 150 172, 240 128, ${team.x} ${team.y}`} {...line} />
          <path className="landing-gap-bracket" d={`M${bracket - 8} ${team.y + 4} H${bracket} V${sub.y - 4} H${bracket - 8}`} data-gaze={pointing ? '' : undefined} opacity={shown} />
          <circle className="landing-gap-start" cx={start.x} cy={start.y} r={5} />
          <circle className="landing-gap-end is-team" cx={team.x} cy={team.y} r={5} />
          <circle className="landing-gap-end is-sub" cx={sub.x} cy={sub.y} r={5} />
        </svg>
        <span className="landing-gap-label is-team" style={{ ...pct(team.x, team.y), opacity: shown }}>
          <span className="landing-gap-faces" aria-hidden="true">
            {['finance', 'marketer', 'researcher'].map((id) => (
              <AgentIcon key={id} agent={id} size={20} label="" />
            ))}
          </span>
          {t('landing.problem.chart.team')}
        </span>
        <span className="landing-gap-label is-sub" style={{ ...pct(sub.x, sub.y), opacity: shown }}>
          <ICON.subscription size={18} />
          {t('landing.problem.chart.sub')}
        </span>
        <span className="landing-gap-label is-gap" style={{ ...pct(bracket, (team.y + sub.y) / 2), opacity: shown }}>
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
export function ScrollAct({ acting, onOpen }: ActProps & { onOpen: (at: string | null) => void }) {
  const p = useProgress('org');
  // the paper comes down as the page scrolls through the section (rewinds); not acting: unrolled
  const unroll = acting ? easeOut(Math.min(1, sceneMs('org', p) / UNROLL_MS)) : 1;
  return (
    <div className="landing-act is-scroll" data-content>
      <span className="landing-rod" data-rod aria-hidden="true" />
      <div className="landing-scroll" style={{ '--unroll': unroll } as CSSProperties}>
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
 * One example workflow on a card (2026-11-14 ②): its tabs (the live page — one card, three stops),
 * the prompt box where the request to Chief types itself in, Chief handing each agent its piece of
 * work (a line drawn out to the agent, a short task chip set down beside it — one after another),
 * then the two approvals — the team's, then the owner's, whose approve button takes the stamp's mark
 * (a UI animation; the penguin's act here is the typing). Every row's room is kept from the start,
 * so the card never changes size (the penguin's spot is read from it). `f` = where the timeline is.
 */
function WorkflowCard({ w, f, tabs }: { w: WorkflowExample; f: FlowFrame; tabs?: ReactNode }) {
  const { t, locale } = useI18n();
  const approved = f.stamp === 'approved';
  const team = TIER[w.team.category];
  const owner = TIER[w.owner.category];
  const chief = byId('chief');
  const ask = Array.from(t(w.ask));
  const typed = ask.slice(0, f.typed).join('');
  return (
    <figure
      className={`landing-preview landing-approval landing-workflow is-${f.stamp}`}
      data-testid="landing-workflow"
      data-workflow={w.id}
      data-state={f.stamp}
      aria-labelledby={`landing-workflow-${w.id}`}
    >
      <div className="landing-workflow-head">
        {tabs ?? <span className="landing-workflow-name">{t(w.name)}</span>}
        <span className="landing-mono landing-preview-tag">{t('landing.preview.example')}</span>
      </div>
      <h3 id={`landing-workflow-${w.id}`} className="sr-only">
        {t(w.name)} · {t(w.title)}
      </h3>
      {/* screen readers get the whole flow at once; the typing and the hand-out are for the eye */}
      <p className="sr-only">
        {t('landing.workflows.ask')}: {t(w.ask)} — {w.split.map((s) => `${agentName(s.agent, locale, byId(s.agent))} · ${t(s.text)}`).join(', ')}
      </p>
      <div className="landing-workflow-ask" data-testid="landing-workflow-ask" aria-hidden="true">
        <p className="landing-mono landing-workflow-to">
          <ICON.ask />
          {t('landing.workflows.to')}
        </p>
        <p className="landing-workflow-typed">
          {typed}
          {f.typing && <span className="landing-caret" />}
        </p>
      </div>
      <div className="landing-workflow-split" aria-hidden="true" data-testid="landing-workflow-split">
        <span className="landing-workflow-chief">
          <AgentIcon agent="chief" team="core" size={28} label="" />
          <b>{agentName('chief', locale, chief)}</b>
        </span>
        <ol className="landing-workflow-pieces">
          {w.split.map((s, i) => (
            <li key={s.text} className={`is-${f.pieces[i]}`} data-state={f.pieces[i]}>
              <AgentIcon agent={s.agent} size={20} label="" />
              <b>{agentName(s.agent, locale, byId(s.agent))}</b>
              <span className="landing-task-chip">
                <span>{t(s.text)}</span>
                {f.pieces[i] === 'done' && <ICON.check size={14} />}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className={`landing-workflow-gate ${f.team ? 'is-up' : ''}`} data-tier={team} data-category={w.team.category}>
        <span className={`chip ${team === 'owner' ? 'is-warn' : 'is-accent'}`}>
          {team === 'team' && <ICON.person size={14} />}
          {t(TIER_LABEL[team])} · {teamName(w.team.team, t)}
        </span>
        <b className="landing-workflow-gate-words">{t(w.team.text)}</b>
      </div>
      <div className={`landing-workflow-gate ${f.team ? 'is-up' : ''}`} data-tier={owner} data-category={w.owner.category}>
        <span className={`chip ${owner === 'owner' ? 'is-warn' : 'is-accent'}`}>
          <ICON.owner size={14} />
          {t(TIER_LABEL[owner])}
        </span>
        <b className="landing-workflow-gate-words">{t(w.owner.text)}</b>
        <span className={`chip ${approved ? STATUS_CHIP.done : STATUS_CHIP.waiting}`}>{t(approved ? 'landing.workflows.approved' : STATUS_LABEL.waiting)}</span>
      </div>
      <div className="landing-approval-actions" aria-hidden="true">
        {/* the mark sits outside the button (a button clips what overflows it) */}
        <span className="landing-approve-wrap">
          <span className="btn is-primary landing-approve">{t('approvals.approve')}</span>
          <span className="landing-stamp-mark" data-testid="landing-stamp-mark" />
        </span>
        <span className="btn landing-decline">{t('approvals.decline')}</span>
      </div>
    </figure>
  );
}

/**
 * The card's timeline at `local` (0 … 1 through its third of the workflows' block — scene.ts
 * `workflowAt`): by the scroll, so it rewinds; tells the canvas whether the box is typing
 * (`cues.typing` — the penguin's patter). Not acting: the finished picture.
 */
function useFlow(live: boolean, w: WorkflowExample, local: number): FlowFrame {
  const { t } = useI18n();
  const chars = Array.from(t(w.ask)).length;
  const pieces = w.split.length;
  const f = live ? flowAt(local * flowLength(chars, pieces), chars, pieces) : flowStill(chars, pieces);
  useLayoutEffect(() => {
    cues.typing = live && f.typing;
  }, [live, f.typing]);
  useEffect(() => () => void (cues.typing = false), []);
  return f;
}

/**
 * 워크플로우: the workflow card, centred — three stops, one workflow each (`at`), the card the same
 * size for all three. The penguin stands behind the card's top edge, over the prompt box, and
 * pretends to type while the request types itself in (the `type` act); then Chief hands out the work
 * and the approvals follow on the card. The stacked page shows the three cards one under another
 * (no tabs), finished. `onPick` = a tab was pressed (the live page moves to that stop).
 */
export function WorkflowAct({ acting, stacked, onPick }: ActProps & { stacked: boolean; onPick?: (i: number) => void }) {
  const { t } = useI18n();
  const p = useProgress('workflows');
  const live = acting && !stacked;
  // a third of the block per example (scene.ts) — finished while the penguin is not acting yet
  const sweep = workflowAt(p, WORKFLOW_EXAMPLES.length);
  const at = stacked ? 0 : sweep.at;
  const local = live ? sweep.local : 1;
  const w = WORKFLOW_EXAMPLES[at] ?? WORKFLOW_EXAMPLES[0];
  const f = useFlow(live, w, local);
  if (stacked) {
    return (
      <div className="landing-act is-flow is-stacked" data-content data-front>
        {WORKFLOW_EXAMPLES.map((x) => (
          <WorkflowCard key={x.id} w={x} f={flowStill(1e6, x.split.length)} />
        ))}
      </div>
    );
  }
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
    <div className="landing-act is-flow" data-content data-front="ground">
      <WorkflowCard key={w.id} w={w} f={f} tabs={tabs} />
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
export function PricingAct({ acting }: ActProps) {
  const { t } = useI18n();
  const p = useProgress('pricing');
  const pointing = acting && pointingAt(sceneMs('pricing', p));
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
export function SignAct({ cta }: ActProps & { cta: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="landing-act is-sign" data-content data-front="ground">
      <p className="landing-statement">{t('landing.statement')}</p>
      {cta}
    </div>
  );
}
