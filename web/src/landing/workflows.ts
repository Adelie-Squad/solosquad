// The landing's three example workflows (PRD v2.1.0 §3.5.2 ④ — 재무 관리 · 상품 소싱 · SNS 마케팅),
// drawn as a flow since 2026-11-14 (the old 맡기기 section folded in): the one-line request to Chief,
// the three pieces Chief hands out (each with the agent who does it), and the two approvals that
// stop the run — one a team approves, one only the owner does. The three are examples any kind of
// business uses (the domains — 물류 · 커머스 · IT 서비스 — are in the AI 팀 section, 2026-11-14). The approval tiers come
// from the category, the same table the engine recommends (`python/src/solosquad/approvals.py`
// `RECOMMENDED`, decision 51 — the landing test compares them). Examples only: no real company,
// amounts or usage numbers.
import type { MessageKey } from '../i18n';
import type { WorkflowId } from './sections';

/** The three kinds of small business the landing speaks to (2026-11-14). */
export type Domain = 'logistics' | 'commerce' | 'it';
export const DOMAINS: Domain[] = ['logistics', 'commerce', 'it'];

/** The approval categories the examples use and their recommended tier (approvals.py `RECOMMENDED`). */
export const TIER = { payment: 'owner', purchase: 'owner', review: 'team', publish: 'team' } as const;
export type Category = keyof typeof TIER;

export interface WorkflowExample {
  id: WorkflowId;
  name: MessageKey;
  title: MessageKey;
  /** The one-line request to Chief. */
  ask: MessageKey;
  /** What Chief hands out: three pieces of work, each with its agent. */
  split: { text: MessageKey; agent: string }[];
  /** Stops for a team member of `team` (the team approval). */
  team: { text: MessageKey; category: Category; team: string };
  /** Stops for the owner — where the penguin stamps. */
  owner: { text: MessageKey; category: Category };
}

export const WORKFLOW_EXAMPLES: WorkflowExample[] = [
  {
    id: 'finance',
    name: 'landing.workflows.finance.name',
    title: 'landing.workflows.finance.title',
    ask: 'landing.workflows.finance.ask',
    split: [
      { text: 'landing.workflows.finance.out.1', agent: 'finance' },
      { text: 'landing.workflows.finance.out.2', agent: 'data-analyst' },
      { text: 'landing.workflows.finance.out.3', agent: 'finance' },
    ],
    team: { text: 'landing.workflows.finance.team', category: 'review', team: 'business' },
    owner: { text: 'landing.workflows.finance.owner', category: 'payment' },
  },
  {
    id: 'sourcing',
    name: 'landing.workflows.sourcing.name',
    title: 'landing.workflows.sourcing.title',
    ask: 'landing.workflows.sourcing.ask',
    split: [
      { text: 'landing.workflows.sourcing.out.1', agent: 'researcher' },
      { text: 'landing.workflows.sourcing.out.2', agent: 'data-analyst' },
      { text: 'landing.workflows.sourcing.out.3', agent: 'sales' },
    ],
    team: { text: 'landing.workflows.sourcing.team', category: 'review', team: 'business' },
    owner: { text: 'landing.workflows.sourcing.owner', category: 'purchase' },
  },
  {
    id: 'sns',
    name: 'landing.workflows.sns.name',
    title: 'landing.workflows.sns.title',
    ask: 'landing.workflows.sns.ask',
    split: [
      { text: 'landing.workflows.sns.out.1', agent: 'marketer' },
      { text: 'landing.workflows.sns.out.2', agent: 'creative' },
      { text: 'landing.workflows.sns.out.3', agent: 'marketer' },
    ],
    team: { text: 'landing.workflows.sns.team', category: 'publish', team: 'brand' },
    owner: { text: 'landing.workflows.sns.owner', category: 'payment' },
  },
];

export const TIER_LABEL: Record<'owner' | 'team', MessageKey> = { owner: 'landing.workflows.tier.owner', team: 'landing.workflows.tier.team' };
