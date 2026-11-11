// Section 3 of the landing (DESIGN.md `## 랜딩` — 조직도): the bundled team as the in-app org chart
// draws it (`### 조직도`) — the owner, Chief under them, the teams side by side below, joined by the
// same connector lines (components/orgGeometry.ts; one indented column on a phone), names in the
// reader's language — and, under the business and brand teams, an example team member (a round
// person, never a penguin; no name — PRD §3.5.2 ③: people and agents on one chart). Before login there is no live state, so the nodes carry no status chip and
// are plain rows. Each team (and the top row) is one button that opens the team modal at that team:
// the agent cards side by side, scrolling sideways. On the live landing the chart is the paper the
// penguin unrolls (Acts.tsx `ScrollAct`).
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AgentIcon } from '../characters/PenguinIcon';
import { teamColor } from '../characters/colors';
import { Modal } from '../components/Modal';
import { OrgLines } from '../components/OrgLines';
import { useOrgLayout } from '../components/orgGeometry';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName } from '../lib/agentNames';
import { teamName } from '../lib/names';
import { AGENT_COUNT, TEAMS } from './catalog';
import { TeamStrip } from './TeamStrip';
import { PEOPLE, PersonFace } from './people';

/** Which team the modal opened at: a team id, `null` for all of them, `undefined` = closed. */
export type TeamModalAt = string | null | undefined;

/** The team modal and a way to open it — the org chart's rows and the "see all" button share it. */
export function useTeamModal(): { open: (at: string | null) => void; modal: ReactNode } {
  const { t } = useI18n();
  const [at, setAt] = useState<TeamModalAt>(undefined);
  const title = t('landing.team.title', { n: AGENT_COUNT, teams: TEAMS.length });
  const modal =
    at === undefined ? null : (
      <Modal label={title} onClose={() => setAt(undefined)} className="landing-team-modal">
        <header className="landing-team-modal-head">
          <h2>{title}</h2>
          <p>{t('landing.org.note')}</p>
        </header>
        <TeamStrip start={at} />
      </Modal>
    );
  return { open: setAt, modal };
}

export function LandingOrgChart({ onOpen }: { onOpen: (at: string | null) => void }) {
  const { t, locale } = useI18n();
  const chief = TEAMS.find((g) => g.team === 'core')?.agents[0];
  const teams = TEAMS.filter((g) => g.team !== 'core');
  const ref = useRef<HTMLDivElement>(null);
  // the paper holds two columns at most (2 + 2); narrower than two readable columns it is the tree
  const { mode, cols, lines, size } = useOrgLayout(ref, { count: teams.length, min: 150, gap: 12, max: 2, treeBelow: 400, key: locale, topAt: 'pin' });

  return (
    <div ref={ref} className="landing-org" data-testid="landing-org" data-layout={mode} style={{ '--org-cols': cols } as CSSProperties}>
      <button type="button" className="landing-org-top" onClick={() => onOpen('core')} aria-label={`${t('org.top')} · ${t('landing.team.open')}`}>
        <span className="landing-org-node" data-org="owner">
          <span className="landing-org-avatar" aria-hidden="true">
            <ICON.owner />
          </span>
          {t('role.owner')}
        </span>
        {chief && (
          <span className="landing-org-node" data-org="chief">
            <AgentIcon agent={chief.id} team="core" size={20} label="" />
            {agentName(chief.id, locale, chief)}
          </span>
        )}
      </button>
      <ul className="landing-org-teams" aria-label={t('org.departments')}>
        {teams.map((g) => {
          const name = teamName(g.team, t);
          return (
            <li key={g.team} data-org="dept" style={{ '--team': teamColor(g.team) } as CSSProperties}>
              <button
                type="button"
                className="landing-org-team"
                onClick={() => onOpen(g.team)}
                aria-label={`${name} ${t('org.deptCount', { n: g.agents.length })} · ${t('landing.team.open')}`}
              >
                <span className="landing-org-label">
                  <span className="landing-dot" data-org-pin aria-hidden="true" />
                  {name}
                  <span className="landing-org-count">{t('org.deptCount', { n: g.agents.length })}</span>
                </span>
                <span className="landing-org-members">
                  {g.agents.map((a) => (
                    <span className="landing-org-node" key={a.id}>
                      <AgentIcon agent={a.id} team={a.team} size={20} label="" />
                      <span className="landing-org-name">{agentName(a.id, locale, a)}</span>
                    </span>
                  ))}
                  {(PEOPLE as readonly string[]).includes(g.team) && (
                    <span className="landing-org-node is-person" data-person>
                      <PersonFace size={20} />
                      <span className="landing-org-name">{t('landing.org.person')}</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <OrgLines lines={lines} size={size} />
    </div>
  );
}
