// Section 3 of the landing (DESIGN.md `## 랜딩` — 팀): the bundled team as the in-app org chart
// draws it (`### 조직도`) — the owner and Chief on top, the teams side by side below, names in the
// reader's language. Before login there is no live state, so the nodes carry no status chip and
// are plain rows. Each team (and the top row) is one button that opens the team modal at that team:
// the agent cards side by side, scrolling sideways.
import { useState, type CSSProperties } from 'react';
import { AgentIcon } from '../characters/PenguinIcon';
import { teamColor } from '../characters/colors';
import { Modal } from '../components/Modal';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName } from '../lib/agentNames';
import { teamName } from '../lib/names';
import { AGENT_COUNT, TEAMS } from './catalog';
import { TeamStrip } from './TeamStrip';

export function LandingOrgChart({ style }: { style?: (i: number) => CSSProperties }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const chief = TEAMS.find((g) => g.team === 'core')?.agents[0];
  const teams = TEAMS.filter((g) => g.team !== 'core');
  const title = t('landing.team.title', { n: AGENT_COUNT, teams: TEAMS.length });

  return (
    <>
      <div className="landing-org" data-testid="landing-org">
        <button type="button" className="landing-org-top" style={style?.(0)} onClick={() => setOpen('core')} aria-label={`${t('org.top')} · ${t('landing.team.open')}`}>
          <span className="landing-org-label">{t('org.top')}</span>
          <span className="landing-org-pair">
            <span className="landing-org-node">
              <span className="landing-org-avatar" aria-hidden="true">
                <ICON.owner />
              </span>
              {t('role.owner')}
            </span>
            {chief && (
              <span className="landing-org-node">
                <AgentIcon agent={chief.id} team="core" size={20} label="" />
                {agentName(chief.id, locale, chief)}
              </span>
            )}
          </span>
        </button>
        <ul className="landing-org-teams" aria-label={t('org.departments')}>
          {teams.map((g, i) => {
            const name = teamName(g.team, t);
            return (
              <li key={g.team} style={{ ...style?.(i + 1), '--team': teamColor(g.team) } as CSSProperties}>
                <button
                  type="button"
                  className="landing-org-team"
                  onClick={() => setOpen(g.team)}
                  aria-label={`${name} ${t('org.deptCount', { n: g.agents.length })} · ${t('landing.team.open')}`}
                >
                  <span className="landing-org-label">
                    <span className="landing-dot" aria-hidden="true" />
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
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn landing-org-all" style={style?.(teams.length + 1)} onClick={() => setOpen(null)}>
          <ICON.team />
          {t('landing.team.all')}
        </button>
      </div>
      {open !== undefined && (
        <Modal label={title} onClose={() => setOpen(undefined)} className="landing-team-modal">
          <header className="landing-team-modal-head">
            <h2>{title}</h2>
            <p>{t('landing.team.lead')}</p>
          </header>
          <TeamStrip start={open} />
        </Modal>
      )}
    </>
  );
}
