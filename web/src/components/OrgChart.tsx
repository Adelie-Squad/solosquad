// The org chart (DESIGN.md `### 조직도`): the owner on top, Chief under them, then the departments
// side by side as columns, each listing its agents and people below it — joined by connector lines
// (orgGeometry.ts: 대표 → 임원 → a bus per row of columns → each team; inside a team a spine with a tick
// to each member). On a narrow chart it is one indented column. Nodes show an icon, a name and a
// status tag only; everything else is in the modal a node opens. Nested lists carry the structure
// for screen readers; the lines are decorative.
import { useRef, type CSSProperties } from 'react';
import type { Agent, AgentCard, OrgChart as OrgChartData, Person } from '../api/types.gen';
import { AgentIcon } from '../characters/PenguinIcon';
import { teamColor } from '../characters/colors';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName } from '../lib/agentNames';
import { teamName } from '../lib/names';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import { ENTRY } from '../office/layout';
import type { AgentStatus } from '../office/state';
import { OrgLines } from './OrgLines';
import { useOrgLayout } from './orgGeometry';

/** Team columns: the smallest width and the gap (`.orgchart-depts`), and the width under which the chart is a tree. */
const COLUMN_MIN = 190;
const COLUMN_GAP = 20;
const TREE_BELOW = 560;


interface Dept {
  key: string;
  name: string;
  team: string | null;
  agents: AgentCard[];
  people: Person[];
}

export interface OrgChartProps {
  chart: OrgChartData;
  /** The workspace's agents — their display names in the reader's language. */
  agents: Agent[];
  statuses: Record<string, AgentStatus>;
  onAgent: (name: string) => void;
  onPerson: (person: Person, team: string | null) => void;
  onPoint?: (name: string | null) => void;
}

export function OrgChart({ chart, agents, statuses, onAgent, onPerson, onPoint = () => {} }: OrgChartProps) {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const known = new Map(agents.map((a) => [a.name, a]));
  const nameOf = (a: AgentCard) => agentName(a.name, locale, known.get(a.name) ?? a);

  // Chief sits on top with the owner; a team holding only Chief does not become a department.
  const chiefCard: AgentCard = chart.teams.flatMap((tm) => tm.agents).find((a) => a.name === ENTRY) ?? {
    name: ENTRY,
    description: '',
    display_name: known.get(ENTRY)?.display_name ?? {},
    summary: known.get(ENTRY)?.summary ?? {},
    appearance: null,
  };
  const depts: Dept[] = chart.teams
    .map((tm) => ({
      key: tm.name,
      name: teamName(tm.name, t),
      team: tm.name,
      agents: tm.agents.filter((a) => a.name !== ENTRY),
      people: tm.people,
    }))
    .filter((d) => d.agents.length || d.people.length);
  if (chart.unassigned.length) {
    depts.push({ key: '__unassigned', name: t('org.unassigned'), team: null, agents: [], people: chart.unassigned });
  }

  const key = `${locale}|${chart.owners.length}|${depts.map((d) => `${d.key}:${d.agents.length}:${d.people.length}`).join(',')}`;
  const { mode, cols, lines, size } = useOrgLayout(ref, { count: depts.length, min: COLUMN_MIN, gap: COLUMN_GAP, treeBelow: TREE_BELOW, key });

  const agentNode = (a: AgentCard, team: string | null, org?: 'chief') => {
    const st = statuses[a.name] ?? 'idle';
    const name = nameOf(a);
    return (
      <button
        type="button"
        className="org-node"
        data-org={org}
        onClick={() => onAgent(a.name)}
        onMouseEnter={() => onPoint(a.name)}
        onMouseLeave={() => onPoint(null)}
        onFocus={() => onPoint(a.name)}
        onBlur={() => onPoint(null)}
        aria-label={`${name} · ${t(STATUS_LABEL[st])}`}
      >
        <AgentIcon agent={a.name} team={team} size={28} label="" />
        <span className="org-node-name" title={name}>
          {name}
        </span>
        <span className={`chip ${STATUS_CHIP[st]}`}>{t(STATUS_LABEL[st])}</span>
      </button>
    );
  };

  const personNode = (p: Person, team: string | null, org?: 'owner') => {
    const role = p.role === 'owner' ? t('role.owner') : t('role.staff');
    return (
      <button type="button" className="org-node is-person" data-org={org} onClick={() => onPerson(p, team)} aria-label={`${p.display} · ${role}`}>
        <span className="org-node-avatar">{p.role === 'owner' ? <ICON.owner /> : <ICON.person />}</span>
        <span className="org-node-name" title={p.display}>
          {p.display}
        </span>
        <span className="chip is-quiet">{role}</span>
      </button>
    );
  };

  return (
    <div ref={ref} className="orgchart" data-testid="orgchart" data-layout={mode} style={{ '--org-cols': cols } as CSSProperties}>
      <OrgLines lines={lines} size={size} />
      <ul className="orgchart-rows" aria-label={t('nav.org')}>
        <li className="orgchart-row">
          <ul className="orgchart-top" aria-label={t('org.top')}>
            {chart.owners.map((p) => (
              <li key={p.id}>{personNode(p, null, 'owner')}</li>
            ))}
            <li className="orgchart-top-chief">{agentNode(chiefCard, 'core', 'chief')}</li>
          </ul>
        </li>
        {depts.length > 0 && (
          <li className="orgchart-row">
            <ul className="orgchart-depts" aria-label={t('org.departments')}>
              {depts.map((d) => (
                <li key={d.key} className="orgchart-dept" data-org="dept" style={{ '--team': teamColor(d.team) } as CSSProperties}>
                  <p className="orgchart-label">
                    <span className="orgchart-label-dot" data-org-pin aria-hidden />
                    <span>{d.name}</span>
                    <span className="orgchart-count">{t('org.deptCount', { n: d.agents.length + d.people.length })}</span>
                  </p>
                  <ul className="orgchart-members" aria-label={d.name}>
                    {d.agents.map((a) => (
                      <li key={a.name}>{agentNode(a, d.team)}</li>
                    ))}
                    {d.people.map((p) => (
                      <li key={p.id}>{personNode(p, d.team)}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </div>
  );
}
