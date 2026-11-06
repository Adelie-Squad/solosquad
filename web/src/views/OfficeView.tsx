import { useLinks } from '../scope';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAgents, useApprovals } from '../api/queries';
import type { Agent, ApprovalItem } from '../api/types.gen';
import { AgentIcon } from '../characters/PenguinIcon';
import { lookOf } from '../characters/roster';
import { JobList } from '../components/JobList';
import { LiveModal } from '../components/LiveModal';
import { QuickChat } from '../components/QuickChat';
import { Loading, QueryError } from '../components/Status';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { readable } from '../lib/names';
import { useJobs } from '../live/jobs';
import { useLive } from '../live/LiveProvider';
import { ENTRY } from '../office/layout';
import { OfficeStage, STATUS_CHIP, STATUS_LABEL } from '../office/OfficeStage';
import { agentStatuses, nextChange, type AgentStatus } from '../office/state';
import { useTheme } from '../theme';

const LIVE_KEY = 'solosquad.office.live';

function readLiveOpen(): boolean {
  try {
    return localStorage.getItem(LIVE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Re-render when a status can change by time alone (done → idle after 10 s …). */
function useStatusClock(next: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (next === null) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(50, next - Date.now() + 20));
    return () => window.clearTimeout(id);
  }, [next, now]);
  return now;
}

/**
 * The office — every team on its keycap island, Chief in the middle (DESIGN.md `## 사무실 장면`).
 * Who is doing what comes from the engine (`/api/agents` · approvals · the event stream) through
 * one pure adapter; the 3D scene, the name tags and the list below all show the same answer.
 */
export function OfficeView() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const agents = useAgents();
  const approvals = useApprovals();
  const live = useLive();
  const { jobs, doneToday } = useJobs();
  const [selected, setSelected] = useState<string | null>(null);
  const [pointed, setPointed] = useState<string | null>(null);
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

  const list = useMemo(() => agents.data ?? [], [agents.data]);
  const pending = useMemo(() => approvals.data ?? [], [approvals.data]);
  const input = { agents: list, approvals: pending, activity: live.activity, outcomes: live.outcomes, now: Date.now() };
  const now = useStatusClock(nextChange(input));
  const statuses = useMemo(
    () => agentStatuses({ ...input, now }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, pending, live.activity, live.outcomes, now],
  );
  const seats = useMemo(() => list.map((a) => ({ name: a.name, team: a.team })), [list]);

  if (agents.isPending) return <div className="view"><Loading /></div>;
  if (agents.error) return <div className="view"><QueryError error={agents.error} /></div>;

  const running = jobs.filter((j) => j.status === 'running').length;
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
  const select = (name: string) => (name === ENTRY ? setQuickChat(true) : setSelected(name));
  const roster = <AgentRoster agents={list} statuses={statuses} onSelect={select} onPoint={setPointed} />;
  const chosen = list.find((a) => a.name === selected) ?? null;

  return (
    <div className={`view is-wide office ${liveOpen ? 'is-split-wide' : ''} ${fullscreen ? 'is-fullscreen' : ''}`} ref={officeRef}>
      <header className="view-header">
        <div>
          <h1>{t('office.title')}</h1>
          <p>{t('office.lead')}</p>
        </div>
        <div className="office-actions">
          <button className="btn with-icon" onClick={toggleFullscreen}>
            {fullscreen ? <ICON.exitFullscreen /> : <ICON.fullscreen />}
            {fullscreen ? t('office.exitFullscreen') : t('office.fullscreen')}
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
        <span className={pending.length > 0 ? 'is-warn' : ''}>
          <b>{pending.length}</b> {t('office.needsAnswer')}
        </span>
        <span>
          <b>{doneToday}</b> {t('office.doneToday')}
        </span>
      </div>

      <div className={`office-body ${liveOpen ? 'is-split' : ''}`}>
        <div className="office-main">
          <OfficeStage agents={seats} statuses={statuses} theme={theme} onSelect={select} fallback={roster} highlight={pointed} />
        </div>
        {liveOpen && (
          <aside className="office-live" aria-label={t('office.live')}>
            <header className="office-live-head">
              <strong>
                <span className="live-dot btn-dot" /> {t('office.live')}
              </strong>
              <span className="office-live-count">{t('office.liveCount', { running, queued: jobs.length - running })}</span>
              <button className="btn" onClick={() => setLiveModal(true)}>
                {t('office.enlarge')}
              </button>
              <button className="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={toggleLive}>
                <ICON.close />
              </button>
            </header>
            <JobList jobs={jobs} compact />
          </aside>
        )}
      </div>

      {/* what the scene shows, for screen readers and as the plain list */}
      <section className="panel office-roster" aria-live="polite">
        <h2 className="panel-title">{t('office.everyone')}</h2>
        {roster}
      </section>

      {liveModal && <LiveModal jobs={jobs} doneToday={doneToday} onClose={() => setLiveModal(false)} />}
      {quickChat && <QuickChat agent={ENTRY} onClose={() => setQuickChat(false)} />}
      {chosen && (
        <AgentSheet
          agent={chosen}
          status={statuses[chosen.name] ?? 'idle'}
          waiting={pending.filter((a) => a.card.agent === chosen.name)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** Teams · agents · status chips — the scene's content as a list (also the WebGL fallback). */
function AgentRoster({
  agents,
  statuses,
  onSelect,
  onPoint = () => {},
}: {
  agents: Agent[];
  statuses: Record<string, AgentStatus>;
  onSelect: (n: string) => void;
  onPoint?: (n: string | null) => void;
}) {
  const { t } = useI18n();
  const teams = new Map<string, Agent[]>();
  for (const a of agents) {
    const key = a.name === ENTRY ? '' : (a.team ?? '—');
    teams.set(key, [...(teams.get(key) ?? []), a]);
  }
  return (
    <div className="roster">
      {[...teams.entries()].map(([team, members]) => (
        <div key={team} className="roster-team">
          <p className="settings-group">{readable(team || 'core')}</p>
          <ul>
            {members.map((a) => {
              const st = statuses[a.name] ?? 'idle';
              return (
                <li key={a.name}>
                  <button
                    className="roster-row"
                    onClick={() => onSelect(a.name)}
                    onMouseEnter={() => onPoint(a.name)}
                    onMouseLeave={() => onPoint(null)}
                    onFocus={() => onPoint(a.name)}
                    onBlur={() => onPoint(null)}
                  >
                    <AgentIcon agent={a.name} team={a.team ?? lookOf(a.name).team} size={28} label="" />
                    <strong>{a.name}</strong>
                    <span className={`chip ${STATUS_CHIP[st]}`}>{t(STATUS_LABEL[st])}</span>
                    <span className="dash-hint">{a.working_on.map((w) => w.title).filter(Boolean).join(', ')}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AgentSheet({ agent, status, waiting, onClose }: { agent: Agent; status: AgentStatus; waiting: ApprovalItem[]; onClose: () => void }) {
  const { w: toWs, o: toOrg } = useLinks();
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="command-overlay is-sheet" onMouseDown={onClose}>
      <aside className="agent-sheet" role="dialog" aria-label={agent.name} onMouseDown={(e) => e.stopPropagation()}>
        <header className="agent-sheet-head">
          <AgentIcon agent={agent.name} team={agent.team} size={40} label="" />
          <div>
            <h2>{agent.name}</h2>
            <div className="agent-roles">
              {agent.team && <span className="chip">{readable(agent.team)}</span>}
              <span className={`chip ${STATUS_CHIP[status]}`}>{t(STATUS_LABEL[status])}</span>
            </div>
          </div>
          <button className="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            <ICON.close size={18} />
          </button>
        </header>
        <div className="agent-sheet-body">
          {agent.description && <p className="agent-now">{agent.description}</p>}
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
          <p className="settings-group">{t('office.now')}</p>
          {agent.working_on.length ? (
            <ul className="agent-members">
              {agent.working_on.map((w) => (
                <li key={w.run_id}>
                  <Link className="chip is-accent" to={toWs(`/chat/${w.thread_id}`)}>
                    <ICON.run size={12} />
                    {w.title ?? w.thread_id}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash-hint">{t('office.idle')}</p>
          )}
          <div className="agent-links">
            <Link className="btn" to={toOrg('/org')}>
              {t('nav.org')}
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
