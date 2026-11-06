// The org chart as a picture (DESIGN.md `## 컴포넌트` — 조직도 인포그래픽): the owner and
// Chief on top, the departments branching below, each with its team colour and its agents
// and people. Nodes show an icon, a name and a status tag only — everything else is in the
// modal a node opens. The structure is nested lists, so it reads as one without the lines.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Agent, AgentCard, OrgChart as OrgChartData, Person } from '../api/types.gen';
import { AgentIcon } from '../characters/PenguinIcon';
import { teamColor } from '../characters/colors';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName } from '../lib/agentNames';
import { readable } from '../lib/names';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import { ENTRY } from '../office/layout';
import type { AgentStatus } from '../office/state';

/** Below this many pixels per department the branches stack in one column. */
const MIN_COLUMN = 200;

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
  const wrap = useRef<HTMLDivElement>(null);
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
      name: readable(tm.name),
      team: tm.name,
      agents: tm.agents.filter((a) => a.name !== ENTRY),
      people: tm.people,
    }))
    .filter((d) => d.agents.length || d.people.length);
  if (chart.unassigned.length) {
    depts.push({ key: '__unassigned', name: t('org.unassigned'), team: null, agents: [], people: chart.unassigned });
  }

  // side by side while each department gets MIN_COLUMN px, else one column (lines never break)
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setStacked(el.clientWidth / Math.max(1, depts.length) < MIN_COLUMN);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [depts.length]);

  const agentNode = (a: AgentCard, team: string | null) => {
    const st = statuses[a.name] ?? 'idle';
    const name = nameOf(a);
    return (
      <button
        type="button"
        className="org-node"
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

  const personNode = (p: Person, team: string | null) => {
    const role = p.role === 'owner' ? t('role.owner') : t('role.staff');
    return (
      <button type="button" className="org-node is-person" onClick={() => onPerson(p, team)} aria-label={`${p.display} · ${role}`}>
        <span className="org-node-avatar">{p.role === 'owner' ? <ICON.owner /> : <ICON.person />}</span>
        <span className="org-node-name" title={p.display}>
          {p.display}
        </span>
        <span className="chip is-quiet">{role}</span>
      </button>
    );
  };

  return (
    <div ref={wrap} className={`orgchart ${stacked ? 'is-stacked' : 'is-rows'}`} data-testid="orgchart">
      <ul className="orgchart-root" aria-label={t('nav.org')}>
        <li className="orgchart-top-item">
          <ul className="orgchart-top" aria-label={t('org.top')}>
            {chart.owners.map((p) => (
              <li key={p.id}>{personNode(p, null)}</li>
            ))}
            <li>{agentNode(chiefCard, 'core')}</li>
          </ul>
          {depts.length > 0 && (
            <ul className="orgchart-depts" aria-label={t('org.departments')}>
              {depts.map((d) => (
                <li key={d.key} className="orgchart-dept" style={{ '--team': teamColor(d.team) } as CSSProperties}>
                  <div className="orgchart-dept-head">
                    <span className="orgchart-dept-dot" aria-hidden />
                    <strong>{d.name}</strong>
                    <span className="orgchart-dept-count">{t('org.deptCount', { n: d.agents.length + d.people.length })}</span>
                  </div>
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
          )}
        </li>
      </ul>
    </div>
  );
}
