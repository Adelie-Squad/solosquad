import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IsoAgentIcon, IsoOffice, type StationState, type StationView } from '../components/IsoOffice';
import {
  AGENT_NAME,
  categoryById,
  mailMessages,
  officeAgents,
  space,
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

/** 부서별 '확인 필요' — 무엇을 기다리는지 한 줄과 처리하러 갈 곳 */
interface Waiting {
  count: number;
  text: string;
  to: string;
}

interface AgentState {
  agent: OfficeAgent;
  state: StationState;
  line: string;
  job: Job | null;
  next: Job | null;
}

/** 사무실 — 하루(마스터) 허브와 부서 에이전트 3명. 대시보드는 버튼으로 연다 */
export function OfficeView() {
  const { jobs, canAccess, wf, finance, viewer } = useWorkspace();
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
    finance: { count: attentionFor('finance', wf, finance), text: '용도 확인이 필요한 입금이 있어요', to: '/app/workflows/finance' },
    sourcing: { count: attentionFor('sourcing', wf, finance), text: '공장 선택 · 통화 확인을 기다려요', to: '/app/workflows/sourcing' },
    marketing: { count: attentionFor('sns', wf, finance), text: '게시물 승인을 기다려요', to: '/app/workflows/sns' },
  };

  const agents: AgentState[] = officeAgents.map((agent, i) => {
    const job = jobs.find((j) => j.category === agent.category && j.status === 'running') ?? null;
    const next = jobs.find((j) => j.category === agent.category && j.status === 'queued') ?? null;
    const w = waiting[agent.category];
    if (!canAccess(agent.category)) return { agent, state: 'locked', line: '권한이 없어 비워 뒀어요', job: null, next: null };
    if (job) return { agent, state: 'working', line: `${job.title} · ${currentStep(job)}`, job, next };
    if (w.count > 0) return { agent, state: 'waiting', line: w.text, job, next };
    return { agent, state: 'idle', line: agent.ambient[(tick + i) % agent.ambient.length], job, next };
  });
  const selected = agents.find((a) => a.agent.id === selectedId) ?? null;

  // 부서에 넘기지 않는 공용 일(메일 분류 · 브리핑)은 하루가 허브에서 직접 한다
  const haruJob = jobs.find((j) => j.category === 'haru' && j.status === 'running') ?? null;
  const running = jobs.filter((j) => j.status === 'running').length;
  const doneToday = COMPLETED_TODAY_BASE + jobs.filter((j) => j.status === 'done').length;
  const mailReview = viewer.master ? mailMessages.filter((m) => m.needsReview).length : 0;
  const waitingTotal = agents.filter((a) => a.state !== 'locked').reduce((sum, a) => sum + waiting[a.agent.category].count, 0) + mailReview;

  const stations: StationView[] = agents.map((a) => {
    const category = categoryById[a.agent.category];
    const w = waiting[a.agent.category];
    return {
      category: a.agent.category,
      state: a.state,
      onSelect: () => setSelectedId(a.agent.id),
      label:
        a.state === 'locked' ? (
          <div className="iso-label is-locked">
            <strong>🔒 {a.agent.name}</strong>
            <span className="iso-label-line">{a.line}</span>
          </div>
        ) : (
          <button className={`iso-label is-${a.state}`} onClick={() => setSelectedId(a.agent.id)}>
            <strong>
              {category.icon} {a.agent.name}
            </strong>
            <span className="iso-label-line">
              <span className="iso-state-dot" />
              {a.line}
            </span>
            <span className="iso-label-meta">
              {a.job && <span className="chip">{Math.round(a.job.progress)}%</span>}
              {w.count > 0 && <span className="chip is-warn">확인 필요 {w.count}</span>}
            </span>
          </button>
        ),
    };
  });

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
            {AGENT_NAME}가 부서 에이전트 3명에게 일을 나눠 맡기는 모습이에요. 에이전트를 누르면 하는 일을 볼 수 있어요.
          </p>
        </div>
        <div className="office-actions">
          <span className="office-clock">{new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</span>
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

      <div className="office-stats">
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

      <IsoOffice
        stations={stations}
        hubWorking={running > 0}
        hubLabel={
          <div className={`iso-label ${haruJob ? 'is-working' : ''}`}>
            <strong>🤖 {AGENT_NAME} · 마스터 에이전트</strong>
            <span className="iso-label-line">
              <span className="iso-state-dot" />
              {haruJob ? `직접 하는 중 — ${haruJob.title} · ${currentStep(haruJob)}` : `작업 ${running}개를 부서에 나눠 맡기고 지켜보는 중`}
            </span>
            {mailReview > 0 && (
              <span className="iso-label-meta">
                <Link className="chip is-warn" to="/app/mail">
                  메일 답장 검토 {mailReview}
                </Link>
              </span>
            )}
          </div>
        }
      />

      {selected && selected.state !== 'locked' && (
        <AgentSheet agent={selected} waiting={waiting[selected.agent.category]} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function AgentSheet({ agent: a, waiting, onClose }: { agent: AgentState; waiting: Waiting; onClose: () => void }) {
  const { wf } = useWorkspace();
  const { agent, job, next, state } = a;
  const category = categoryById[agent.category];
  const workflow = wf.workflows.find((w) => w.id === agent.workflow);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stepIndex = job ? job.steps.indexOf(currentStep(job)) : -1;

  return (
    <div className="command-overlay is-sheet" onMouseDown={onClose}>
      <aside className="agent-sheet" role="dialog" aria-label={agent.name} onMouseDown={(e) => e.stopPropagation()}>
        <header className="agent-sheet-head">
          <IsoAgentIcon working={state === 'working'} />
          <div>
            <h2>{agent.name}</h2>
            <p>
              {category.icon} {category.label} 부서
            </p>
            <div className="agent-roles">
              {agent.roles.map((r) => (
                <span key={r} className="chip">
                  {r}
                </span>
              ))}
            </div>
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
          ) : (
            <p className="agent-now">{a.line}</p>
          )}

          {waiting.count > 0 && (
            <div className="approval-bar">
              <span>
                👤 확인 필요 {waiting.count} · {waiting.text}
              </span>
              <Link className="btn is-primary" to={waiting.to}>
                확인하러 가기
              </Link>
            </div>
          )}

          {next && (
            <>
              <p className="settings-group">다음 차례</p>
              <p className="agent-now">
                {next.icon} {next.title}
              </p>
            </>
          )}

          {workflow && (
            <>
              <p className="settings-group">
                맡은 워크플로우 — {workflow.icon} {workflow.name} {workflow.enabled ? '' : '(꺼짐)'}
              </p>
              <ol className="pipeline">
                {workflow.steps.map((s) => (
                  <li key={s.name} className={`pipe-step is-idle ${s.approval ? 'has-approval' : ''}`}>
                    <span className="pipe-name">{s.name}</span>
                    {s.approval && <span className="pipe-approval">👤 승인</span>}
                  </li>
                ))}
              </ol>
            </>
          )}

          <p className="settings-group">평소에 하는 일</p>
          <ul className="agent-ambient">
            {agent.ambient.map((x) => (
              <li key={x}>{x.replace(/ 중$/, '')}</li>
            ))}
          </ul>

          <div className="stat-row is-2">
            <div className="stat">
              <span className="stat-value">{agent.doneThisMonth.toLocaleString('ko-KR')}</span>
              <span className="stat-label">이번 달 완료</span>
            </div>
            <div className="stat">
              <span className="stat-value">{workflow ? tokens(workflow.monthTokens) : '—'}</span>
              <span className="stat-label">이번 달 토큰</span>
            </div>
          </div>

          <div className="agent-links">
            <Link className="btn is-primary" to={`/app/workflows/${agent.workflow}`}>
              워크플로우 열기
            </Link>
            <Link className="btn" to="/app/tasks">
              Task 보기
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
