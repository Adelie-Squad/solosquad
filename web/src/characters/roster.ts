// Who wears what (DESIGN.md `## 에이전트 캐릭터` — decision 58, 15 roles, no team leads).
// The body is shared; a role is told apart only by its prop. An id the table does not know
// (a customer's own role) wears a scarf in its team's colour.

export type Prop =
  | 'crown-bowtie'
  | 'clipboard'
  | 'beret'
  | 'round-glasses'
  | 'chart'
  | 'beanie'
  | 'headset'
  | 'cube'
  | 'hardhat'
  | 'magnifier'
  | 'tie'
  | 'card'
  | 'gold-glasses'
  | 'megaphone'
  | 'brush'
  | 'scarf';

export interface RosterEntry {
  team: string;
  prop: Prop;
}

export const ROSTER: Record<string, RosterEntry> = {
  chief: { team: 'core', prop: 'crown-bowtie' },
  'product-manager': { team: 'product', prop: 'clipboard' },
  'product-designer': { team: 'product', prop: 'beret' },
  researcher: { team: 'product', prop: 'round-glasses' },
  'data-analyst': { team: 'product', prop: 'chart' },
  'frontend-engineer': { team: 'engineering', prop: 'beanie' },
  'backend-engineer': { team: 'engineering', prop: 'headset' },
  'data-engineer': { team: 'engineering', prop: 'cube' },
  infra: { team: 'engineering', prop: 'hardhat' },
  'quality-assurance': { team: 'engineering', prop: 'magnifier' },
  'business-strategy': { team: 'business', prop: 'tie' },
  sales: { team: 'business', prop: 'card' },
  finance: { team: 'business', prop: 'gold-glasses' },
  marketer: { team: 'brand', prop: 'megaphone' },
  creative: { team: 'brand', prop: 'brush' },
};

/** Earlier names of the same roles (decision 58 renames, and the v2.0 bundle) — they keep
 * their prop while an org still uses the old id. */
export const ALIASES: Record<string, string> = {
  'infra-security': 'infra',
  'creative-designer': 'creative',
  qa: 'quality-assurance',
  frontend: 'frontend-engineer',
  backend: 'backend-engineer',
  pm: 'product-manager',
  designer: 'product-designer',
  research: 'researcher',
  'data-analytics': 'data-analyst',
  strategy: 'business-strategy',
  'finance-ops': 'finance',
};

export function canonical(agent: string): string {
  return ROSTER[agent] ? agent : (ALIASES[agent] ?? agent);
}

/** The look of an agent: its prop from the table, its team from the engine when known. */
export function lookOf(agent: string, team?: string | null): RosterEntry {
  const known = ROSTER[canonical(agent)];
  return { team: team ?? known?.team ?? '', prop: known?.prop ?? 'scarf' };
}
