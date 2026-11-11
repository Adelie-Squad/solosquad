// The org chart inside the office (DESIGN.md `## 컴포넌트` — 조직도 인포그래픽): owner and
// Chief on top, departments below, nodes = icon + name + status; a node opens the modal.
// Agent names come from SKILL.md (`display_name`) or the id made readable — never the id.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { Agent, OrgChart as OrgChartData } from '../src/api/types.gen';
import { AgentModal, PersonModal } from '../src/components/AgentModal';
import { OrgChart } from '../src/components/OrgChart';
import { ApiError } from '../src/api/client';
import { errorText } from '../src/api/errors';
import { translate, type Vars } from '../src/i18n';
import type { MessageKey } from '../src/i18n';
import { agentName, agentSummary, readableId } from '../src/lib/agentNames';
import { teamName } from '../src/lib/names';
import { legacyTarget, ScopeLayout } from '../src/shell/ScopeLayout';
import { visibleNav } from '../src/shell/nav';
import { approval, me, renderWith } from './helpers';

const agent = (name: string, team: string | null, words: Partial<Agent> = {}): Agent => ({
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

const AGENTS: Agent[] = [
  agent('chief', 'core', { display_name: { ko: 'Chief', en: 'Chief' } }),
  agent('backend-engineer', 'engineering', {
    display_name: { ko: '백엔드 엔지니어', en: 'Backend Engineer' },
    summary: { ko: '서버를 만들어요. 운영 데이터를 바꾸기 전에는 승인을 받아요.', en: 'Builds the servers. Asks before changing live data.' },
  }),
  agent('quality-assurance', 'engineering'),
  agent('sales', 'business'),
];

const card = (a: Agent) => ({ name: a.name, description: a.description, display_name: a.display_name, summary: a.summary, appearance: null });

const CHART: OrgChartData = {
  owners: [{ id: 'u-1', display: 'Elon', title: '', role: 'owner' }],
  teams: [
    { name: 'core', agents: [card(AGENTS[0])], people: [] },
    { name: 'engineering', agents: [card(AGENTS[1]), card(AGENTS[2])], people: [{ id: 'u-2', display: 'Gwynne', title: 'COO', role: 'staff' }] },
    { name: 'business', agents: [card(AGENTS[3])], people: [] },
  ],
  unassigned: [],
};

/** jsdom has no EventSource; the shell opens one per workspace. */
class QuietEventSource {
  onopen = null;
  onmessage = null;
  onerror = null;
  addEventListener() {}
  close() {}
}
(globalThis as { EventSource?: unknown }).EventSource ??= QuietEventSource;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('agent names', () => {
  it('uses the display name in the reader’s language, else the id made readable', () => {
    expect(agentName('backend-engineer', 'en', AGENTS[1])).toBe('Backend Engineer');
    expect(agentName('backend-engineer', 'ko', AGENTS[1])).toBe('백엔드 엔지니어');
    expect(agentName('backend-engineer', 'zh-CN', AGENTS[1])).toBe('Backend Engineer'); // falls back to en
    expect(agentName('quality-assurance', 'ko', AGENTS[2])).toBe('Quality Assurance');
    expect(agentName('chief', 'ko')).toBe('Chief');
    expect(agentName('data_engineer', 'ko')).toBe('Data Engineer');
    expect(readableId('finance: brief')).toBe('finance: brief'); // not an id — shown as it is
    expect(agentSummary('en', AGENTS[1])).toBe('Builds the servers. Asks before changing live data.');
    expect(agentSummary('en', AGENTS[2])).toBeUndefined();
  });
});

describe('org chart infographic', () => {
  it('draws the owner and Chief on top and the departments below, as nested lists of buttons', () => {
    const onAgent = vi.fn();
    const onPerson = vi.fn();
    renderWith(<OrgChart chart={CHART} agents={AGENTS} statuses={{ 'backend-engineer': 'typing' }} onAgent={onAgent} onPerson={onPerson} />, 'en');
    const top = screen.getByRole('list', { name: 'Owner and Chief' });
    expect(within(top).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Elon · Owner', 'Chief · Idle']);
    const depts = screen.getByRole('list', { name: 'Teams' });
    // core holds only Chief, who is on top — it is not a department of its own
    expect(within(depts).getAllByRole('list').map((l) => l.getAttribute('aria-label'))).toEqual(['Engineering', 'Business']);
    const engineering = screen.getByRole('list', { name: 'Engineering' });
    const nodes = within(engineering).getAllByRole('button');
    expect(nodes.map((b) => b.textContent)).toEqual(['Backend EngineerWorking', 'Quality AssuranceIdle', 'GwynneTeam member']);
    expect(screen.queryByText(/backend-engineer|quality-assurance/)).toBeNull(); // no ids on screen
    expect(screen.queryByText(/routing text/)).toBeNull(); // the description lives in the modal only
    fireEvent.click(nodes[0]);
    expect(onAgent).toHaveBeenCalledWith('backend-engineer');
    fireEvent.click(nodes[2]);
    expect(onPerson).toHaveBeenCalledWith(CHART.teams[1].people[0], 'engineering');
  });
});

describe('team and agent names follow the reader’s language', () => {
  const pm = agent('product-manager', 'product', {
    display_name: { ko: '프로덕트 매니저', en: 'Product Manager', 'zh-CN': '产品经理' },
  });
  const mover = agent('route-planner', 'logistics'); // a customer's own agent in a team of its own
  const chart: OrgChartData = {
    owners: [],
    teams: [
      { name: 'core', agents: [card(AGENTS[0])], people: [] },
      { name: 'product', agents: [card(pm)], people: [] },
      { name: 'engineering', agents: [card(AGENTS[1])], people: [] },
      { name: 'business', agents: [card(AGENTS[3])], people: [] },
      { name: 'brand', agents: [], people: [{ id: 'u-3', display: 'Kim', title: '', role: 'staff' }] },
      { name: 'logistics', agents: [card(mover)], people: [] },
    ],
    unassigned: [],
  };
  const labels = () =>
    within(screen.getByRole('list', { name: /^(Teams|팀|团队)$/ }))
      .getAllByRole('list')
      .map((l) => l.getAttribute('aria-label'));

  it.each([
    ['ko', ['프로덕트', '엔지니어링', '비즈니스', '브랜드', 'Logistics'], '프로덕트 매니저'],
    ['en', ['Product', 'Engineering', 'Business', 'Brand', 'Logistics'], 'Product Manager'],
    ['zh-CN', ['产品', '工程', '商务', '品牌', 'Logistics'], '产品经理'],
  ] as const)('%s', (locale, teams, pmName) => {
    renderWith(<OrgChart chart={chart} agents={[AGENTS[0], pm, AGENTS[1], AGENTS[3], mover]} statuses={{}} onAgent={() => {}} onPerson={() => {}} />, locale);
    expect(labels()).toEqual(teams);
    expect(screen.getByText(pmName)).toBeTruthy();
    expect(screen.getByText('Chief')).toBeTruthy(); // the persona keeps its name
    expect(screen.getByText('Route Planner')).toBeTruthy(); // no display name — the id made readable
    expect(screen.queryByText(/product-manager|route-planner|logistics/)).toBeNull();
  });

  it('names a team the same way everywhere, with the id made readable for a team of a customer’s own', () => {
    const t = (key: MessageKey, vars?: Vars) => translate('ko', key, vars);
    expect(teamName('core', t)).toBe('경영');
    expect(teamName('engineering', (key) => translate('zh-CN', key))).toBe('工程');
    expect(teamName('core', (key) => translate('en', key))).toBe('Leadership');
    expect(teamName('field_ops', t)).toBe('Field Ops');
    expect(teamName('constructor', t)).toBe('Constructor'); // not looked up on the object's prototype
    const err = new ApiError(403, 'this approval needs team business', 'approval_needs_team', { team: 'business' });
    expect(errorText(err, t)).toBe('비즈니스 팀원이나 대표만 승인할 수 있어요.');
  });

  it('shows the team chip of the agent modal in the reader’s language', () => {
    renderWith(<AgentModal agent={AGENTS[1]} status="idle" waiting={[]} onClose={() => {}} />, 'ko');
    const dialog = screen.getByRole('dialog', { name: '백엔드 엔지니어' });
    expect(within(dialog).getByText('엔지니어링')).toBeTruthy();
  });
});

describe('agent and person modal', () => {
  it('shows the role summary, the status and what waits for an answer', () => {
    const onClose = vi.fn();
    renderWith(<AgentModal agent={{ ...AGENTS[1], working_on: [{ thread_id: 't1', run_id: 'r1', title: 'Fix the API' }] }} status="typing" waiting={[]} onClose={onClose} />, 'en');
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    expect(within(dialog).getByText('Builds the servers. Asks before changing live data.')).toBeTruthy();
    expect(within(dialog).getByText('Working')).toBeTruthy();
    expect(within(dialog).getByText('Engineering')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: /Fix the API/ }).getAttribute('href')).toBe('/o/tesla/w/charging/chat/t1');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['ko', '승인 대기 2건', '과제에서 처리'],
    ['en', '2 waiting for approval', 'Handle in Tasks'],
    ['zh-CN', '待审批 2 项', '在任务中处理'],
  ] as const)('%s: approvals waiting for the agent read as a plain row with a warn icon, linking to Tasks', (locale, label, link) => {
    renderWith(<AgentModal agent={AGENTS[1]} status="waiting" waiting={[approval(), approval({ run_id: 'r-2' })]} onClose={() => {}} />, locale);
    const bar = screen.getByTestId('approval-bar');
    expect(bar.textContent).toContain(label);
    expect(bar.querySelector('svg.lucide-triangle-alert')).toBeTruthy(); // the warn icon, not a band of colour
    const go = within(bar).getByRole('link', { name: link });
    expect(go.getAttribute('href')).toBe('/o/tesla/w/charging/tasks');
    expect(go.className).not.toContain('is-primary'); // the modal's one primary action stays "talk to"
  });

  it('lets the owner edit a person’s title and teams; others only read', () => {
    const person = CHART.teams[1].people[0];
    const editable = { id: 'u-2', username: 'gwynne', display: 'Gwynne', role: 'staff' as const, title: 'COO', teams: ['engineering'], workspaces: null };
    renderWith(<PersonModal person={person} team="engineering" editable={editable} teams={['engineering', 'business']} onClose={() => {}} />, 'en');
    expect(screen.getByText('COO')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Business' }).getAttribute('aria-pressed')).toBe('false');
    cleanup();
    renderWith(<PersonModal person={person} team="engineering" editable={null} teams={['engineering']} onClose={() => {}} />, 'en');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe('the org chart moved into the office', () => {
  function Where() {
    const l = useLocation();
    return <p data-testid="where">{l.pathname}</p>;
  }

  it('has no menu tile of its own and sends old addresses to the office', () => {
    expect(visibleNav(true).map((n) => n.to)).not.toContain('/org');
    expect(legacyTarget('/org', { org: 'tesla', ws: 'charging' })).toBe('/o/tesla/w/charging/office');
    renderWith(
      <Routes>
        <Route path="o/:org/*" element={<ScopeLayout />} />
        <Route path="o/:org/w/:ws/office" element={<Where />} />
      </Routes>,
      'en',
      { path: '/o/tesla/org', me: me() },
    );
    expect(screen.getByTestId('where').textContent).toBe('/o/tesla/w/charging/office');
  });
});
