import { useState } from 'react';
import { useAction, useKeys, useOrgChart, usePeople, useScopedApi } from '../api/queries';
import type { AgentCard, OrgPerson, Person } from '../api/types.gen';
import { Loading, QueryError } from '../components/Status';
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { readable } from '../lib/names';
import { ScopeEyebrow } from '../components/ScopeEyebrow';
import { useOrgOwner } from '../scope';

/**
 * Org chart — agents and people on one page (decision 55 · I37). Each team: its agents
 * (decision 58 — no lead) and its people. The owner edits a person's title and teams in this
 * org (`/api/o/<org>/people`); the teams are what lets staff approve that team's cards.
 */
export function OrgChartView() {
  const { t } = useI18n();
  const isOwner = useOrgOwner();
  const chart = useOrgChart();
  const people = usePeople(isOwner);
  const [editing, setEditing] = useState<OrgPerson | null>(null);
  const byId = new Map((people.data ?? []).map((p) => [p.id, p]));

  if (chart.isPending) return <div className="view"><Loading /></div>;
  if (chart.error) return <div className="view"><QueryError error={chart.error} /></div>;
  const data = chart.data;

  const personRow = (p: Person) => (
    <li key={p.id} className="org-person">
      <span className="org-avatar">{p.role === 'owner' ? <ICON.owner /> : <ICON.person />}</span>
      <span className="org-person-main">
        <strong>{p.display}</strong>
        <span className="dash-hint">
          {p.title || t('org.noTitle')} · {p.role === 'owner' ? t('role.owner') : t('role.staff')}
        </span>
      </span>
      {isOwner && p.role !== 'owner' && byId.has(p.id) && (
        <button className="btn is-small" onClick={() => setEditing(byId.get(p.id) ?? null)}>
          {t('common.edit')}
        </button>
      )}
    </li>
  );

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <ScopeEyebrow />
          <h1>{t('org.title')}</h1>
          <p>{t('org.lead')}</p>
        </div>
      </header>

      {data.owners.length > 0 && (
        <section className="panel org-owners">
          <h2 className="panel-title">{t('role.owner')}</h2>
          <ul className="org-people">{data.owners.map(personRow)}</ul>
        </section>
      )}

      <div className="org-grid">
        {data.teams.map((team) => (
          <section key={team.name} className="panel org-team">
            <h2 className="panel-title">{readable(team.name)}</h2>
            <p className="settings-group">{t('org.agents', { n: team.agents.length })}</p>
            <ul className="org-agents">
              {team.agents.map((a) => (
                <AgentRow key={a.name} agent={a} team={team.name} />
              ))}
            </ul>
            <p className="settings-group">{t('org.people', { n: team.people.length })}</p>
            {team.people.length ? <ul className="org-people">{team.people.map(personRow)}</ul> : <p className="dash-hint">{t('org.noPeople')}</p>}
          </section>
        ))}
      </div>

      {data.unassigned.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">{t('org.unassigned')}</h2>
          <p className="dash-hint">{t('org.unassignedHint')}</p>
          <ul className="org-people">{data.unassigned.map(personRow)}</ul>
        </section>
      )}

      {editing && (
        <PersonEditor person={editing} teams={data.teams.map((tm) => tm.name)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function AgentRow({ agent, team }: { agent: AgentCard; team: string }) {
  return (
    <li className="org-agent">
      <AgentIcon agent={agent.name} team={team} size={28} label="" />
      <span className="org-agent-main">
        <strong>{agent.name}</strong>
        {/* the role description is long engine text — two lines here, the whole of it on hover */}
        {agent.description && (
          <span className="dash-hint org-agent-desc" title={agent.description}>
            {agent.description}
          </span>
        )}
      </span>
    </li>
  );
}

function PersonEditor({ person, teams, onClose }: { person: OrgPerson; teams: string[]; onClose: () => void }) {
  const keys = useKeys();
  const { org: orgApi } = useScopedApi();
  const { t } = useI18n();
  const [title, setTitle] = useState(person.title);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(person.teams));
  const save = useAction(
    () => orgApi.patch<OrgPerson>(`/people/${encodeURIComponent(person.id)}`, { title, teams: [...chosen] }),
    [keys.orgChart, keys.people, keys.approvals],
  );
  const flip = (name: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="command-overlay is-modal" onMouseDown={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-label={t('org.editTitle', { name: person.display })}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <h2>{t('org.editTitle', { name: person.display })}</h2>
        <label className="field">
          <span>{t('org.jobTitle')}</span>
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <fieldset className="field">
          <legend>{t('org.teams')}</legend>
          <p className="dash-hint">{t('org.teamsHint')}</p>
          <div className="perm-chips">
            {teams.map((name) => (
              <button type="button" key={name} className={`perm-chip ${chosen.has(name) ? 'is-on' : ''}`} aria-pressed={chosen.has(name)} onClick={() => flip(name)}>
                {readable(name)}
              </button>
            ))}
          </div>
        </fieldset>
        {save.error && <p className="form-error">{t('common.failed')}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn is-primary" disabled={save.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
