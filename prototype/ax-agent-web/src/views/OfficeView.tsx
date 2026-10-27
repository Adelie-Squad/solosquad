import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkerAvatar, type WorkerStatus } from '../components/WorkerAvatar';
import {
  AGENT_NAME,
  categoryById,
  mailMessages,
  officeAgents,
  roomColors,
  space,
  tasks,
  type CategoryId,
  type OfficeAgent,
} from '../data/dummy';
import { currentStep, type Job } from '../hooks/useLiveActivity';
import { tokens } from '../lib/format';
import { attentionFor } from '../lib/workflows';
import { useWorkspace } from '../workspace-context';
import './OfficeView.css';
import './views.css';

const AMBIENT_MS = 4000;
const COMPLETED_TODAY_BASE = 23; // 더미: 오늘 이전에 끝난 작업 수

// 방 배치 — 에이전트 3명인 방은 위 줄, 2명인 방은 아래 줄 (6칸 그리드)
const roomOrder: CategoryId[] = ['sourcing', 'marketing', 'finance', 'cs', 'logistics'];

/** 부서별 '확인 필요' — 무엇을 기다리는지 한 줄과 처리하러 갈 곳 */
interface Waiting {
  count: number;
  text: string;
  to: string;
}

interface DeskState {
  agent: OfficeAgent;
  status: WorkerStatus;
  bubble: string;
  job: Job | null;
  /** 이 에이전트 차례를 기다리는 작업 */
  next: Job | null;
}

/** 사무실 — 하루(마스터)와 부서 방의 워커 에이전트들이 일하는 모습. 대시보드는 버튼으로 연다 */
export function OfficeView() {
  const { jobs, canAccess, wf, finance } = useWorkspace();
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const officeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), AMBIENT_MS);
    const onFs = () => setFullscreen(document.fullscreenElement === officeRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearInterval(timer);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  const waiting: Record<CategoryId, Waiting> = {
    finance: {
      count: attentionFor('finance', wf, finance),
      text: '용도 확인이 필요한 입금이 있어요',
      to: '/app/workflows/finance',
    },
    sourcing: {
      count: attentionFor('sourcing', wf, finance),
      text: '공장 선택 · 통화 확인을 기다려요',
      to: '/app/workflows/sourcing',
    },
    marketing: { count: attentionFor('sns', wf, finance), text: '게시물 승인을 기다려요', to: '/app/workflows/sns' },
    cs: { count: mailMessages.filter((m) => m.needsReview).length, text: '답장 검토를 기다려요', to: '/app/mail' },
    logistics: {
      count: tasks.filter((t) => t.category === 'logistics' && t.assignee === '사장님' && t.status !== 'done').length,
      text: '주소가 불분명한 송장 확인을 기다려요',
      to: '/app/tasks',
    },
  };

  // 방의 첫 에이전트가 그 부서의 실시간 작업 · 확인 요청을 맡고, 나머지는 ambient 로 움직인다
  const deskFor = (agent: OfficeAgent, index: number): DeskState => {
    const job = index === 0 ? (jobs.find((j) => j.category === agent.category && j.status === 'running') ?? null) : null;
    const next = index === 0 ? (jobs.find((j) => j.category === agent.category && j.status === 'queued') ?? null) : null;
    const w = waiting[agent.category];
    if (job) return { agent, status: 'working', bubble: currentStep(job), job, next };
    if (index === 0 && w.count > 0) return { agent, status: 'waiting', bubble: `🙋 확인 필요 ${w.count}`, job, next };
    const seed = tick + agent.id.length + index;
    return {
      agent,
      status: seed % 3 === 0 ? 'idle' : 'working',
      bubble: agent.ambient[seed % agent.ambient.length],
      job,
      next,
    };
  };

  const desks = officeAgents.map((a) => {
    const index = officeAgents.filter((x) => x.category === a.category).indexOf(a);
    return deskFor(a, index);
  });
  const selected = desks.find((d) => d.agent.id === selectedId) ?? null;

  const visibleRooms = roomOrder.filter(canAccess);
  const running = jobs.filter((j) => j.status === 'running').length;
  const doneToday = COMPLETED_TODAY_BASE + jobs.filter((j) => j.status === 'done').length;
  const waitingTotal = visibleRooms.reduce((sum, c) => sum + waiting[c].count, 0);
  const now = new Date();

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else officeRef.current?.requestFullscreen();
  };

  return (
    <div className={`view is-wide office ${fullscreen ? 'is-fullscreen' : ''}`} ref={officeRef}>
      <header className="view-header">
        <div>
          <h1>
            {space.emoji} {space.name} 사무실
          </h1>
          <p>
            {AGENT_NAME}와 부서 에이전트 {officeAgents.filter((a) => canAccess(a.category)).length}명이 일하고 있어요. 에이전트를
            누르면 하는 일을 볼 수 있어요.
          </p>
        </div>
        <div className="office-actions">
          <span className="office-clock">
            {now.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}
          </span>
          <button className="btn" onClick={toggleFullscreen}>
            {fullscreen ? '전체 화면 닫기' : '⛶ 전체 화면'}
          </button>
          {!fullscreen && (
            <Link className="btn is-primary" to="/app/office/dashboard">
              📊 대시보드
            </Link>
          )}
        </div>
      </header>

      <section className="master-desk">
        <WorkerAvatar color="var(--accent)" status="working" size={72} master />
        <div className="master-body">
          <strong>
            {AGENT_NAME} <span className="master-role">마스터 에이전트 · 팀장석</span>
          </strong>
          <span className="master-bubble">
            {running > 0
              ? `작업 ${running}개를 부서 에이전트에게 나눠 맡기고 지켜보는 중이에요.`
              : '새 요청을 기다리는 중이에요.'}
          </span>
        </div>
        <div className="master-stats">
          <span>
            <b>{running}</b> 진행 중
          </span>
          <span className={waitingTotal > 0 ? 'is-warn' : ''}>
            <b>{waitingTotal}</b> 확인 필요
          </span>
          <span>
            <b>{doneToday}</b> 오늘 완료
          </span>
        </div>
      </section>

      <div className="office-floor">
        {roomOrder.map((c) => {
          const category = categoryById[c];
          const roomDesks = desks.filter((d) => d.agent.category === c);
          const locked = !canAccess(c);
          return (
            <section
              key={c}
              className={`room ${locked ? 'is-locked' : ''}`}
              style={{ ['--room' as string]: roomColors[c].tint, gridColumn: `span ${roomDesks.length}` }}
              aria-label={`${category.label} 방`}
            >
              <header className="room-head">
                <span>
                  {category.icon} {category.label}
                </span>
                {!locked && waiting[c].count > 0 && (
                  <Link className="chip is-warn" to={waiting[c].to}>
                    확인 필요 {waiting[c].count}
                  </Link>
                )}
              </header>
              {locked ? (
                <p className="room-locked">🔒 권한이 없어 비워 뒀어요</p>
              ) : (
                <div className="desks">
                  {roomDesks.map((d) => (
                    <button
                      key={d.agent.id}
                      className={`desk is-${d.status}`}
                      onClick={() => setSelectedId(d.agent.id)}
                      aria-label={`${d.agent.name} — ${d.bubble}`}
                    >
                      <span className="desk-bubble">{d.bubble}</span>
                      <WorkerAvatar color={roomColors[c].body} status={d.status} />
                      <span className="desk-table">
                        <span className="desk-monitor">
                          {d.job && <span style={{ width: `${d.job.progress}%` }} />}
                        </span>
                      </span>
                      <span className="desk-name">{d.agent.name}</span>
                      <span className="desk-status">
                        {d.job
                          ? `${d.job.title} · ${Math.round(d.job.progress)}%`
                          : d.status === 'waiting'
                            ? waiting[c].text
                            : d.status === 'idle'
                              ? '쉬는 중'
                              : '틈틈이 일하는 중'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {selected && (
        <AgentSheet desk={selected} waiting={waiting[selected.agent.category]} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function AgentSheet({ desk, waiting, onClose }: { desk: DeskState; waiting: Waiting; onClose: () => void }) {
  const { agent, job, next, status } = desk;
  const category = categoryById[agent.category];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stepIndex = job ? job.steps.indexOf(currentStep(job)) : -1;

  return (
    <div className="command-overlay is-sheet" onMouseDown={onClose}>
      <aside className="agent-sheet" role="dialog" aria-label={agent.name} onMouseDown={(e) => e.stopPropagation()}>
        <header className="agent-sheet-head" style={{ ['--room' as string]: roomColors[agent.category].tint }}>
          <WorkerAvatar color={roomColors[agent.category].body} status={status} size={72} />
          <div>
            <h2>{agent.name}</h2>
            <p>
              {category.icon} {category.label} · {agent.role}
            </p>
          </div>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="agent-sheet-body">
          <p className="settings-group">지금</p>
          {job ? (
            <div className="panel dash-panel">
              <strong>
                {job.icon} {job.title}
              </strong>
              <div className="job-bar">
                <span style={{ width: `${job.progress}%` }} />
              </div>
              <ol className="steps">
                {job.steps.map((s, i) => (
                  <li key={s} className={`step is-${i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'pending'}`}>
                    {s}
                  </li>
                ))}
              </ol>
              <p className="dash-hint">
                {Math.round(job.progress)}% · 이 작업에 {tokens(job.tokens)} 토큰 사용
              </p>
            </div>
          ) : status === 'waiting' ? (
            <div className="approval-bar">
              <span>👤 {waiting.text}</span>
              <Link className="btn is-primary" to={waiting.to}>
                확인하러 가기
              </Link>
            </div>
          ) : (
            <p className="agent-now">{desk.bubble}</p>
          )}

          {next && (
            <>
              <p className="settings-group">다음 차례</p>
              <p className="agent-now">
                {next.icon} {next.title}
              </p>
            </>
          )}

          {job && waiting.count > 0 && (
            <div className="approval-bar">
              <span>👤 확인 필요 {waiting.count} · {waiting.text}</span>
              <Link className="btn" to={waiting.to}>
                확인하러 가기
              </Link>
            </div>
          )}

          <p className="settings-group">평소에 하는 일</p>
          <ul className="agent-ambient">
            {agent.ambient.map((a) => (
              <li key={a}>{a.replace(/ 중$/, '')}</li>
            ))}
          </ul>

          <div className="stat-row is-2">
            <div className="stat">
              <span className="stat-value">{agent.doneThisMonth.toLocaleString('ko-KR')}</span>
              <span className="stat-label">이번 달 완료</span>
            </div>
            <div className="stat">
              <span className="stat-value">{waiting.count}</span>
              <span className="stat-label">부서 확인 필요</span>
            </div>
          </div>

          <div className="agent-links">
            <Link className="btn" to="/app/tasks">
              Task 보기
            </Link>
            <Link className="btn" to="/app/live">
              실시간 작업
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
