// The landing's three example workflows (PRD v2.1.0 §3.5.2 ④ — 재무 관리 · 상품 소싱 · SNS 마케팅):
// what the agents do (four steps, each with the agent who does it), what people do, and the two
// approvals that stop the run — one a team approves, one only the owner does. The approval tiers come
// from the category, the same table the engine recommends (`python/src/solosquad/approvals.py`
// `RECOMMENDED`, decision 51 — the landing test compares them). Examples only: no real company,
// amounts or usage numbers.
import type { MessageKey } from '../i18n';
import type { WorkflowId } from './sections';

/** The approval categories the examples use and their recommended tier (approvals.py `RECOMMENDED`). */
export const TIER = { payment: 'owner', purchase: 'owner', review: 'team', publish: 'team' } as const;
export type Category = keyof typeof TIER;

export interface WorkflowExample {
  id: WorkflowId;
  name: MessageKey;
  title: MessageKey;
  steps: { text: MessageKey; agent: string }[];
  people: MessageKey;
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
    steps: [
      { text: 'landing.workflows.finance.step.1', agent: 'finance' },
      { text: 'landing.workflows.finance.step.2', agent: 'finance' },
      { text: 'landing.workflows.finance.step.3', agent: 'data-analyst' },
      { text: 'landing.workflows.finance.step.4', agent: 'finance' },
    ],
    people: 'landing.workflows.finance.people',
    team: { text: 'landing.workflows.finance.team', category: 'review', team: 'business' },
    owner: { text: 'landing.workflows.finance.owner', category: 'payment' },
  },
  {
    id: 'sourcing',
    name: 'landing.workflows.sourcing.name',
    title: 'landing.workflows.sourcing.title',
    steps: [
      { text: 'landing.workflows.sourcing.step.1', agent: 'researcher' },
      { text: 'landing.workflows.sourcing.step.2', agent: 'data-analyst' },
      { text: 'landing.workflows.sourcing.step.3', agent: 'finance' },
      { text: 'landing.workflows.sourcing.step.4', agent: 'sales' },
    ],
    people: 'landing.workflows.sourcing.people',
    team: { text: 'landing.workflows.sourcing.team', category: 'review', team: 'business' },
    owner: { text: 'landing.workflows.sourcing.owner', category: 'purchase' },
  },
  {
    id: 'sns',
    name: 'landing.workflows.sns.name',
    title: 'landing.workflows.sns.title',
    steps: [
      { text: 'landing.workflows.sns.step.1', agent: 'data-analyst' },
      { text: 'landing.workflows.sns.step.2', agent: 'marketer' },
      { text: 'landing.workflows.sns.step.3', agent: 'creative' },
      { text: 'landing.workflows.sns.step.4', agent: 'marketer' },
    ],
    people: 'landing.workflows.sns.people',
    team: { text: 'landing.workflows.sns.team', category: 'publish', team: 'brand' },
    owner: { text: 'landing.workflows.sns.owner', category: 'payment' },
  },
];

export const TIER_LABEL: Record<'owner' | 'team', MessageKey> = { owner: 'landing.workflows.tier.owner', team: 'landing.workflows.tier.team' };
export const TIER_REASON: Record<'owner' | 'team', MessageKey> = { owner: 'landing.workflows.reason.owner', team: 'landing.workflows.reason.team' };
