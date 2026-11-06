// Test data for whole screens: an engine answer for every API the screens read, routed by
// the path after its scope (`/api/o/<org>/w/<ws>/agents` → `/agents`). Each test overrides
// what it is about; the rest only has to be well-formed.
import { vi } from 'vitest';
import type {
  AccessPolicy,
  Agent,
  ApprovalItem,
  ApprovalPolicyRow,
  Artifact,
  Budget,
  ConnectionOut,
  Me,
  OrgChart,
  OrgPerson,
  PnlData,
  ProfileResponse,
  PublicUser,
  ScheduleList,
  ScreenResponse,
  SnapshotSettings,
  WidgetSpec,
  WorkflowList,
  WorkList,
} from '../src/api/types.gen';
import { approval, me } from './helpers';

/** A staff member of tesla — the whole org, no team yet. */
export const staffMe: Me = me({
  user: { id: 'u-2', username: 'kim', display: 'Kim', role: 'staff', locale: 'ko', two_factor: true, disabled: false, title: '', teams: [], assignments: [{ org: 'tesla', workspace: null, role: 'staff' }] },
  scopes: [{ org: 'tesla', display: 'Tesla', role: 'staff', whole_org: true, workspaces: [{ name: 'charging', display: 'charging', role: 'staff', running: true }] }],
});

/** The customer's owner, with the same single workspace (so the two see the same screens). */
export const ownerMe: Me = me({
  scopes: [{ org: 'tesla', display: 'Tesla', role: 'owner', whole_org: true, workspaces: [{ name: 'charging', display: 'charging', role: 'owner', running: true }] }],
});

export const agent = (name: string, team: string | null, words: Partial<Agent> = {}): Agent => ({
  name,
  description: `${name} — routing text`,
  display_name: {},
  summary: {},
  team,
  layer: 'package',
  appearance: null,
  working_on: [],
  ...words,
});

export const connection = (over: Partial<ConnectionOut> = {}): ConnectionOut => ({
  id: 'claude-max',
  kind: 'subscription',
  provider: 'anthropic',
  harness: 'claude-code',
  models: ['sonnet'],
  active: true,
  slots: 1,
  monthly_budget_usd: 100,
  network: 'external',
  entity: { name: 'Moa Korea Co.', country: 'KR', controlled_by: null },
  secret_last4: null,
  eligible: true,
  eligibility_reason: null,
  eligibility_source: null,
  source: 'org',
  ...over,
});

const line = { spent_usd: 12, budget_usd: 100, remaining_usd: 88, warning: false, exhausted: false };

export const budget = (over: Partial<Budget> = {}): Budget => ({
  month_start: Date.UTC(2026, 10, 1) / 1000,
  warn_at: 0.8,
  org: line,
  connections: [{ ...line, id: 'claude-max' }],
  ...over,
});

export const PNL: PnlData = {
  period: '2026-10-01 ~ 2026-11-05',
  currency: 'KRW',
  revenue: 2_000_000,
  expenses: 550_000,
  net_income: 1_450_000,
  by_account: [
    { account: '상품매출', type: 'revenue', amount: 2_000_000 },
    { account: '배송비', type: 'expense', amount: 250_000 },
    { account: '광고비', type: 'expense', amount: 300_000 },
  ],
  by_month: [
    { month: '2026-10', revenue: 1_200_000, expenses: 450_000, net: 750_000 },
    { month: '2026-11', revenue: 800_000, expenses: 100_000, net: 700_000 },
  ],
  needs_review: [{ row: 7, reason: '금액을 읽을 수 없음', value: 'abc' }],
  rows: 7,
  summary: '순이익 1,450,000',
};

export const pnlArtifact = (over: Partial<Artifact> = {}): Artifact => ({
  id: 'art-pnl-1',
  kind: 'finance.pnl',
  title: '손익표',
  data: PNL as unknown as Artifact['data'],
  thread_id: 'wf-th-1',
  run_id: 'run-wf-1',
  workflow: 'monthly-pnl',
  needs_review: true,
  reviewed_by: null,
  created: Date.UTC(2026, 10, 6) / 1000,
  schema_version: 1,
  ...over,
});

export const screenOf = (name: string, widgets: WidgetSpec[]): ScreenResponse => ({
  name,
  source: 'default',
  screen: { format_version: 1, title: null, widgets },
  error: null,
});

/** The engine's default screens (python `screens.py DEFAULTS`). */
export const SCREENS: Record<string, ScreenResponse> = {
  // the first screen (2026-11-07 — home became the dashboard; `home` is the engine's alias for it)
  dashboard: screenOf('dashboard', [
    { widget: 'stats', version: 1 },
    { widget: 'todo', version: 1 },
    { widget: 'office', version: 1 },
    { widget: 'artifact-latest', version: 1, kind: 'finance.pnl' },
    { widget: 'schedule', version: 1 },
    { widget: 'budget', version: 1 },
  ]),
  artifacts: screenOf('artifacts', [
    { widget: 'artifact-latest', version: 1, kind: 'finance.pnl' },
    { widget: 'artifact-list', version: 1 },
  ]),
};

const WORKFLOWS: WorkflowList = {
  errors: [],
  workflows: [
    {
      name: 'monthly-pnl',
      title: 'Monthly P&L',
      description: 'ledger in, P&L out',
      schedule: null,
      team: 'business',
      inputs: [{ name: 'ledger', type: 'upload', label: 'Ledger', accept: ['xlsx', 'csv'], required: true }],
      steps: [
        { id: 'compute', type: 'tool', title: 'compute' },
        { id: 'review', type: 'approval', title: 'Check the P&L' },
      ],
      enabled: true,
      last_run: null,
    },
  ],
};

const SCHEDULES: ScheduleList = {
  timezone: 'Asia/Seoul',
  errors: [],
  schedules: [
    { id: 'cron:sales-goal', kind: 'goal', name: 'sales-goal', title: 'sales-goal', schedule: '30 8 * * 1-5', enabled: true, next_run: Date.UTC(2026, 10, 9, 23, 30) / 1000, last_run: null, workflow: null },
  ],
};

/** What the agents did (`GET …/work`): the P&L run waiting at its approval step, a finished chat. */
const WORK: WorkList = {
  items: [
    {
      source: 'workflow',
      thread_id: 'wf-th-1',
      run_id: 'run-wf-1',
      title: 'Monthly P&L',
      workflow: 'monthly-pnl',
      cron: null,
      status: 'interrupted',
      created: Date.UTC(2026, 10, 6) / 1000,
      ended: null,
      agents: [],
      step: 1,
      steps: 2,
      current_step: 'Check the P&L',
      artifacts: [{ id: 'art-pnl-1', kind: 'finance.pnl', title: '손익표', needs_review: true }],
    },
    {
      source: 'chat',
      thread_id: 'th-1',
      run_id: 'run-1',
      title: 'Compare suppliers',
      workflow: null,
      cron: null,
      status: 'success',
      created: Date.UTC(2026, 10, 6) / 1000,
      ended: Date.UTC(2026, 10, 6) / 1000,
      agents: ['chief'],
      step: null,
      steps: null,
      current_step: null,
      artifacts: [],
    },
  ],
};

const CHART: OrgChart = {
  owners: [{ id: 'u-1', display: 'Boss', title: '', role: 'owner' }],
  teams: [
    { name: 'core', agents: [{ name: 'chief', description: '', display_name: {}, summary: {}, appearance: null }], people: [] },
    { name: 'business', agents: [], people: [{ id: 'u-2', display: 'Kim', title: 'Analyst', role: 'staff' }] },
  ],
  unassigned: [],
};

const PEOPLE: OrgPerson[] = [{ id: 'u-2', username: 'kim', display: 'Kim', role: 'staff', title: 'Analyst', teams: ['business'], workspaces: null }];

const USERS: PublicUser[] = [
  { id: 'u-1', username: 'boss', display: 'Boss', role: 'owner', locale: 'ko', two_factor: true, disabled: false, title: '', teams: [], assignments: [] },
  { id: 'u-2', username: 'kim', display: 'Kim', role: 'staff', locale: 'ko', two_factor: true, disabled: false, title: '', teams: [], assignments: [{ org: 'tesla', workspace: null, role: 'staff' }] },
];

const POLICY: ApprovalPolicyRow[] = [
  { category: 'review', label: '검토 · 확인', tier: 'team', recommended: 'team', deviates: false },
  { category: 'transfer', label: '송금', tier: 'owner', recommended: 'owner', deviates: false },
];

const ACCESS: AccessPolicy = { require_login: true, two_factor: true, allowed_networks: [] };

const PROFILE: ProfileResponse = {
  profile: {
    schema_version: 1,
    server: { country: 'KR', cloud: 'aws', region: 'ap-northeast-2', access: 'internet' },
    entities: [{ id: 'kr', name: 'Moa Korea Co.', country: 'KR', controlled_by: null }],
    languages: { default: 'ko', enabled: ['ko', 'en'] },
    privacy: { regimes: ['PIPA'], reviewer: 'Kim' },
  },
  checklist: [],
};

const SNAPSHOT: SnapshotSettings = { type: 'dir', endpoint: null, region: 'auto', bucket: null, prefix: 'solosquad', path: '/backups', keep_days: 30, has_secret: false };

/** Every API a screen reads, keyed by the path after its scope. */
export function engineData(over: Record<string, unknown> = {}, who: 'owner' | 'staff' = 'staff'): Record<string, unknown> {
  const owner = who === 'owner';
  return {
    '/me': owner ? ownerMe : staffMe,
    '/health': { ok: true, passkeys: false },
    '/me/passkeys': [],
    '/settings': { locale: 'ko' },
    '/access': ACCESS,
    '/profile': PROFILE,
    '/snapshot': SNAPSHOT,
    '/users': USERS,
    '/teams': [],
    '/org-chart': CHART,
    '/people': PEOPLE,
    '/approval-policy': POLICY,
    '/connections': [connection(), connection({ id: 'from-core', source: 'core' })],
    '/agents': [agent('chief', 'core'), agent('finance', 'business')],
    '/threads': [],
    '/runs': [],
    '/approvals': [
      approval({ tier: 'team', can_approve: owner, run_id: 'run-team' }, { title: 'review the P&L', team: 'business' }),
      approval({ tier: 'owner', can_approve: owner, run_id: 'run-owner', thread_id: 'th-2' }, { title: 'send the payment', category: 'transfer', team: 'business' }),
    ] satisfies ApprovalItem[],
    '/budget': budget(),
    '/workflows': WORKFLOWS,
    '/workflow-runs': [],
    '/artifacts': [pnlArtifact()],
    '/artifacts/art-pnl-1': pnlArtifact(),
    '/uploads': [],
    '/schedules': SCHEDULES,
    '/work': WORK,
    ...Object.fromEntries(Object.entries(SCREENS).map(([k, v]) => [`/screens/${k}`, v])),
    ...over,
  };
}

/** `/api/o/tesla/w/charging/agents?x=1` → `/agents`. */
export function routeOf(url: string): string {
  const path = url.split('?')[0].replace(/^\/api/, '');
  return path.replace(/^\/o\/[^/]+\/w\/[^/]+/, '').replace(/^\/o\/[^/]+/, '');
}

/** Stub `fetch` with `data`: `'PATCH /me'` (a function of the body → JSON, or a Response)
 * answers that method,
 * a bare path answers GET. Anything else is a 404, so a missing fixture shows up. */
export function stubEngine(data: Record<string, unknown>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const answer = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body });
    const key = routeOf(url);
    const handler = data[`${method} ${key}`];
    if (typeof handler === 'function') {
      const out = (handler as (b: unknown) => unknown)(body);
      return out instanceof Response ? out : answer(out);
    }
    if (method === 'GET' && key in data) return answer(data[key]);
    return new Response(JSON.stringify({ error: 'no fixture', code: 'not_found', params: {} }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, calls };
}

/** jsdom has no EventSource; the shell opens one per running workspace. */
export class QuietEventSource {
  onopen = null;
  onmessage = null;
  onerror = null;
  addEventListener() {}
  close() {}
}
