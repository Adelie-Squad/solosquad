// One modal for an agent or a person (DESIGN.md `## 컴포넌트` — 에이전트 · 사람 모달), opened
// from the org chart and from the office scene. The org chart nodes show only a name and a
// status; what the agent does, what it works on and what waits for an answer live here.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAction, useKeys, useScopedApi } from '../api/queries';
import type { Agent, ApprovalItem, OrgPerson, Person } from '../api/types.gen';
import { AgentIcon } from '../characters/PenguinIcon';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { agentName, agentSummary } from '../lib/agentNames';
import { readable } from '../lib/names';
import { STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import type { AgentStatus } from '../office/state';
import { useLinks } from '../scope';

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="command-overlay is-modal" onMouseDown={onClose}>
      <div className="dialog is-wide entity-modal" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn entity-modal-close" aria-label={t('common.close')} title={t('common.close')} onClick={onClose} autoFocus>
          <ICON.close size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

export function AgentModal({
  agent,
  status,
  waiting,
  onTalk,
  onClose,
}: {
  agent: Agent;
  status: AgentStatus;
  waiting: ApprovalItem[];
  /** Chief only — start a conversation from here. */
  onTalk?: () => void;
  onClose: () => void;
}) {
  const { w: toWs } = useLinks();
  const { t, locale } = useI18n();
  const name = agentName(agent.name, locale, agent);
  const summary = agentSummary(locale, agent);
  return (
    <Modal label={name} onClose={onClose}>
      <header className="entity-modal-head">
        <span className="entity-modal-portrait">
          <AgentIcon agent={agent.name} team={agent.team} size={64} label="" />
        </span>
        <div className="entity-modal-title">
          <h2>{name}</h2>
          <div className="entity-modal-chips">
            {agent.team && <span className="chip">{readable(agent.team)}</span>}
            <span className={`chip ${STATUS_CHIP[status]}`}>{t(STATUS_LABEL[status])}</span>
          </div>
        </div>
      </header>
      <section className="entity-modal-section">
        <h3 className="settings-group">{t('agent.role')}</h3>
        <p className="entity-modal-summary">{summary ?? t('agent.noSummary')}</p>
      </section>
      {waiting.length > 0 && (
        <div className="approval-bar">
          <span className="with-icon">
            <ICON.person />
            {t('office.waitingN', { n: waiting.length })}
          </span>
          <Link className="btn is-primary" to={toWs('/approvals')}>
            {t('office.goAnswer')}
          </Link>
        </div>
      )}
      <section className="entity-modal-section">
        <h3 className="settings-group">{t('office.now')}</h3>
        {agent.working_on.length ? (
          <ul className="entity-modal-work">
            {agent.working_on.map((w) => (
              <li key={w.run_id}>
                <Link className="chip is-accent" to={toWs(`/chat/${w.thread_id}`)}>
                  <ICON.run size={12} />
                  {w.title || t('chat.untitled')}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dash-hint">{t('job.none')}</p>
        )}
      </section>
      {onTalk && (
        <div className="dialog-actions is-start">
          <button type="button" className="btn is-primary with-icon" onClick={onTalk}>
            <ICON.chat />
            {t('chat.talkTo', { name })}
          </button>
        </div>
      )}
    </Modal>
  );
}

/**
 * A person: title, department and role. The org's owner edits the title and the teams here
 * (`/api/o/<org>/people`) — the teams decide which team-approval cards the person may answer.
 */
export function PersonModal({
  person,
  team,
  editable,
  teams,
  onClose,
}: {
  person: Person;
  team: string | null;
  /** The person as this org stores them — given only to the org's owner. */
  editable: OrgPerson | null;
  teams: string[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const role = person.role === 'owner' ? t('role.owner') : t('role.staff');
  const memberOf = editable?.teams ?? (team ? [team] : []);
  return (
    <Modal label={person.display} onClose={onClose}>
      <header className="entity-modal-head">
        <span className="entity-modal-portrait is-person">{person.role === 'owner' ? <ICON.owner size={32} /> : <ICON.person size={32} />}</span>
        <div className="entity-modal-title">
          <h2>{person.display}</h2>
          <div className="entity-modal-chips">
            <span className="chip is-quiet">{role}</span>
          </div>
        </div>
      </header>
      {editing && editable ? (
        <PersonForm person={editable} teams={teams} onDone={() => setEditing(false)} />
      ) : (
        <>
          <dl className="entity-modal-facts">
            <dt>{t('org.jobTitle')}</dt>
            <dd>{person.title || t('org.noTitle')}</dd>
            <dt>{t('org.teams')}</dt>
            <dd>{memberOf.length ? memberOf.map(readable).join(', ') : t('org.unassigned')}</dd>
          </dl>
          {editable && person.role !== 'owner' && (
            <div className="dialog-actions is-start">
              <button type="button" className="btn with-icon" onClick={() => setEditing(true)}>
                <ICON.draft />
                {t('common.edit')}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function PersonForm({ person, teams, onDone }: { person: OrgPerson; teams: string[]; onDone: () => void }) {
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
    <form
      className="settings-body"
      aria-label={t('org.editTitle', { name: person.display })}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: onDone });
      }}
    >
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
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="btn is-primary" disabled={save.isPending}>
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}
