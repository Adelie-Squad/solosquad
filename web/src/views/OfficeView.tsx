import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAgents, useApprovals, useTeams } from '../api/queries';
import type { Agent, ApprovalItem } from '../api/types.gen';
import { DESK_LOOKS, IsoAgentIcon, IsoOffice, type Look, type StationState, type StationView } from '../components/IsoOffice';
import { JobList } from '../components/JobList';
import { LiveModal } from '../components/LiveModal';
import { QuickChat } from '../components/QuickChat';
import { Loading, QueryError } from '../components/Status';
import { useI18n } from '../i18n';
import { useJobs } from '../live/jobs';

const ENTRY = 'chief';
const LIVE_KEY = 'solosquad.office.live';

function readLiveOpen(): boolean {
  try {
    return localStorage.getItem(LIVE_KEY) !== '0';
  } catch {
    return true;
  }
}

interface Seat {
  key: string;
  agent: Agent | null;
  /** The team at this desk (none for Chief). */
  team: string | null;
  look: Look;
  state: StationState;
  waiting: ApprovalItem[];
}

function seatState(working: boolean, waiting: number): StationState {
  if (working) return 'working';
  return waiting > 0 ? 'waiting' : 'idle';
}

/**
 * The office — Chief at the front desk and up to three teams at theirs, drawn with the
 * prototype's isometric scene; who is working comes from the engine (`/api/agents`), who is
 * waiting for an answer from the approval cards, and the live panel from the event stream.
 */
export function OfficeView() {
  const { t, fmt } = useI18n();
  const agents = useAgents();
  const teams = useTeams();
  const approvals = useApprovals();
  const { jobs, doneToday } = useJobs();
  const [selected, setSelected] = useState<Seat | null>(null);
  const [liveOpen, setLiveOpen] = useState(readLiveOpen);
  const [liveModal, setLiveModal] = useState(false);
  const [quickChat, setQuickChat] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const officeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === officeRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  if (agents.isPending || teams.isPending) return <div className="view"><Loading /></div>;
  if (agents.error) return <div className="view"><QueryError error={agents.error} /></div>;

  const byName = new Map((agents.data ?? []).map((a) => [a.name, a]));
  const pending = approvals.data ?? [];
  const chief = byName.get(ENTRY) ?? null;
  const chiefWaiting = pending.filter((a) => a.source === 'company' && (a.card.agent === ENTRY || !a.card.team));
  const master: Seat = {
    key: ENTRY,
    agent: chief,
    team: null,
    look: 'master',
    state: seatState(!!chief?.working_on.length, chiefWaiting.length),
    waiting: chiefWaiting,
  };
  const desks: Seat[] = (teams.data ?? []).slice(0, DESK_LOOKS.length).map((team, i) => {
    const members = (agents.data ?? []).filter((a) => a.team === team.name || a.name === team.main);
    const waiting = pending.filter((a) => a.card.team === team.name);
    return {
      key: team.name,
      agent: (team.main && byName.get(team.main)) || members[0] || null,
      team: team.name,
      look: DESK_LOOKS[i],
      state: seatState(members.some((m) => m.working_on.length > 0), waiting.length),
      waiting,
    };
  });

  const tag = (seat: Seat, icon: string, onClick: () => void) => {
    const name = seat.team ?? seat.agent?.name ?? ENTRY;
    const working = seat.agent?.working_on[0]?.title;
    const detail = working ? t('office.workingOn', { name, what: working }) : t('office.idleAs', { name });
    const alert = seat.waiting.length ? t('office.waitingN', { n: seat.waiting.length }) : null;
    return (
      <NameTag icon={icon} name={name} detail={detail} alert={alert} working={seat.state === 'working'} onClick={onClick} />
    );
  };

  const stations: StationView[] = desks.map((d) => ({
    look: d.look as StationView['look'],
    state: d.state,
    onSelect: () => setSelected(d),
    tag: tag(d, '🧑‍💼', () => setSelected(d)),
  }));

  const running = jobs.filter((j) => j.status === 'running').length;
  const waitingTotal = pending.length;
  const toggleLive = () =>
    setLiveOpen((open) => {
      try {
        localStorage.setItem(LIVE_KEY, open ? '0' : '1');
      } catch {
        // not remembered; still toggles now
      }
      return !open;
    });
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void officeRef.current?.requestFullscreen?.();
  };
  const seated = new Set([ENTRY, ...desks.map((d) => d.agent?.name)]);
  const others = (agents.data ?? []).filter((a) => !seated.has(a.name));

  return (
    <div className={`view is-wide office ${liveOpen ? 'is-split-wide' : ''} ${fullscreen ? 'is-fullscreen' : ''}`} ref={officeRef}>
      <header className="view-header">
        <div>
          <h1>{t('office.title')}</h1>
          <p>{t('office.lead')}</p>
        </div>
        <div className="office-actions">
          <span className="office-clock">{fmt.time(Date.now() / 1000)}</span>
          <button className="btn" onClick={toggleFullscreen}>
            {fullscreen ? t('office.exitFullscreen') : `⛶ ${t('office.fullscreen')}`}
          </button>
          <button className={`btn ${liveOpen ? 'is-primary' : ''}`} aria-pressed={liveOpen} onClick={toggleLive}>
            <span className="live-dot btn-dot" /> {t('office.live')} {running}
          </button>
        </div>
      </header>

      <div className="office-stats">
        <span>
          <b>{running}</b> {t('job.running')}
        </span>
        <span className={waitingTotal > 0 ? 'is-warn' : ''}>
          <b>{waitingTotal}</b> {t('office.needsAnswer')}
        </span>
        <span>
          <b>{doneToday}</b> {t('office.doneToday')}
        </span>
      </div>

      <div className={`office-body ${liveOpen ? 'is-split' : ''}`}>
        <div className="office-main">
          <IsoOffice
            stations={stations}
            master={{ state: master.state, tag: tag(master, '👑', () => setQuickChat(true)), onSelect: () => setQuickChat(true) }}
          />
        </div>
        {liveOpen && (
          <aside className="office-live" aria-label={t('office.live')}>
            <header className="office-live-head">
              <strong>
                <span className="live-dot btn-dot" /> {t('office.live')}
              </strong>
              <span className="office-live-count">
                {t('office.liveCount', { running, queued: jobs.length - running })}
              </span>
              <button className="btn" onClick={() => setLiveModal(true)}>
                {t('office.enlarge')}
              </button>
              <button className="icon-btn" aria-label={t('common.close')} onClick={toggleLive}>
                ✕
              </button>
            </header>
            <JobList jobs={jobs} compact />
          </aside>
        )}
      </div>

      {others.length > 0 && (
        <section className="panel office-roster">
          <h2 className="panel-title">{t('office.others')}</h2>
          <ul>
            {others.map((a) => (
              <li key={a.name}>
                <span className={`live-dot ${a.working_on.length ? '' : 'is-idle'}`} />
                <strong>{a.name}</strong>
                {a.team && <span className="chip">{a.team}</span>}
                <span className="dash-hint">
                  {a.working_on.length ? a.working_on.map((w) => w.title).join(', ') : t('office.idle')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {liveModal && <LiveModal jobs={jobs} doneToday={doneToday} onClose={() => setLiveModal(false)} />}
      {quickChat && <QuickChat agent={chief?.name ?? ENTRY} onClose={() => setQuickChat(false)} />}
      {selected && <AgentSheet seat={selected} all={agents.data ?? []} onClose={() => setSelected(null)} />}
    </div>
  );
}

function NameTag({
  icon,
  name,
  detail,
  alert,
  working,
  onClick,
}: {
  icon: string;
  name: string;
  detail: string;
  alert: string | null;
  working: boolean;
  onClick?: () => void;
}) {
  const label = [detail, alert].filter(Boolean).join(' · ');
  return (
    <button className="iso-tag" onClick={onClick} disabled={!onClick} title={label} aria-label={label}>
      <span className="iso-tag-pill">
        <span aria-hidden>{icon}</span>
        {name}
        {alert && (
          <span className="iso-tag-alert" aria-hidden>
            !
          </span>
        )}
      </span>
      {working && (
        <span className="iso-tag-bar is-indeterminate" aria-hidden>
          <span style={{ width: '40%' }} />
        </span>
      )}
    </button>
  );
}

function AgentSheet({ seat, all, onClose }: { seat: Seat; all: Agent[]; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const members = seat.team ? all.filter((a) => a.team === seat.team || a.name === seat.agent?.name) : seat.agent ? [seat.agent] : [];

  return (
    <div className="command-overlay is-sheet" onMouseDown={onClose}>
      <aside className="agent-sheet" role="dialog" aria-label={seat.team ?? seat.key} onMouseDown={(e) => e.stopPropagation()}>
        <header className="agent-sheet-head">
          <IsoAgentIcon look={seat.look} state={seat.state} />
          <div>
            <h2>{seat.team ?? seat.key}</h2>
            <p>{seat.agent ? t('office.leadAgent', { name: seat.agent.name }) : ''}</p>
          </div>
          <button className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="agent-sheet-body">
          {seat.waiting.length > 0 && (
            <div className="approval-bar">
              <span>👤 {t('office.waitingN', { n: seat.waiting.length })}</span>
              <Link className="btn is-primary" to="/approvals">
                {t('office.goAnswer')}
              </Link>
            </div>
          )}
          <p className="settings-group">{t('office.members')}</p>
          <ul className="agent-members">
            {members.map((a) => (
              <li key={a.name}>
                <strong>{a.name}</strong>
                {a.description && <p className="dash-hint">{a.description}</p>}
                {a.working_on.map((w) => (
                  <Link key={w.run_id} className="chip is-accent" to={`/chat/${w.thread_id}`}>
                    ▶ {w.title ?? w.thread_id}
                  </Link>
                ))}
              </li>
            ))}
          </ul>
          <div className="agent-links">
            <Link className="btn" to="/org">
              {t('nav.org')}
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
