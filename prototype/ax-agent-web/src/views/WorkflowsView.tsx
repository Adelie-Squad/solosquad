import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { NoAccess } from '../components/NoAccess';
import { AGENT_NAME, categoryById, workflowCadenceOptions, type Workflow, type WorkflowId } from '../data/dummy';
import { tokens } from '../lib/format';
import { relativeTime } from '../lib/time';
import { attentionFor } from '../lib/workflows';
import { useWorkspace } from '../workspace-context';
import { FinancePanel } from './workflows/FinancePanel';
import { SnsPanel } from './workflows/SnsPanel';
import { SourcingPanel } from './workflows/SourcingPanel';
import './views.css';

const STEP_MS = 800;

const panels: Record<WorkflowId, ComponentType> = {
  finance: FinancePanel,
  sourcing: SourcingPanel,
  sns: SnsPanel,
};

/** 워크플로우 — 재무 관리 · 상품 소싱 · SNS 자동화를 켜고 끄고, 실행하고, 결과를 바로 쓴다 */
export function WorkflowsView() {
  const { id } = useParams<{ id?: string }>();
  const { wf, finance, canAccess } = useWorkspace();
  const allowed = wf.workflows.filter((w) => canAccess(w.category));
  const current = wf.workflows.find((w) => w.id === id);

  if (allowed.length === 0) return <NoAccess category="finance" />;
  if (!current) return <Navigate to={`/app/workflows/${allowed[0].id}`} replace />;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>워크플로우</h1>
          <p>{AGENT_NAME}가 부서 에이전트와 함께 돌리는 업무 흐름이에요. 켜고 끄고, 직접 실행하고, 결과를 바로 쓰세요.</p>
        </div>
      </header>

      <nav className="wf-cards" aria-label="워크플로우">
        {allowed.map((w) => {
          const attention = attentionFor(w.id, wf, finance);
          return (
            <Link key={w.id} to={`/app/workflows/${w.id}`} className={`panel wf-card ${w.id === current.id ? 'is-selected' : ''}`}>
              <span className="wf-card-icon">{w.icon}</span>
              <span className="wf-card-body">
                <strong>{w.name}</strong>
                <span className="wf-card-meta">
                  {w.enabled ? `켜짐 · ${relativeTime(w.lastRun.at)} 실행` : '꺼짐'}
                </span>
              </span>
              {attention > 0 && <span className="pinned-badge">{attention}</span>}
            </Link>
          );
        })}
      </nav>

      {canAccess(current.category) ? (
        <WorkflowDetail key={current.id} workflow={current} />
      ) : (
        <NoAccess category={current.category} />
      )}
    </div>
  );
}

type RunState = { step: number; waiting: boolean } | null;

function WorkflowDetail({ workflow: w }: { workflow: Workflow }) {
  const { setWf } = useWorkspace();
  const [run, setRun] = useState<RunState>(null);
  const timer = useRef<number | null>(null);
  const Panel = panels[w.id];
  const category = categoryById[w.category];

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const update = (patch: Partial<Workflow>) =>
    setWf((s) => ({ ...s, workflows: s.workflows.map((x) => (x.id === w.id ? { ...x, ...patch } : x)) }));

  // 한 단계씩 진행하다 승인 단계에서 멈춘다. 마지막 단계를 지나면 실행 기록을 남긴다
  const advance = (from: number) => {
    if (from >= w.steps.length) {
      setRun(null);
      update({ lastRun: { ok: true, summary: '수동 실행 완료', at: new Date().toISOString() } });
      return;
    }
    if (w.steps[from].approval) {
      setRun({ step: from, waiting: true });
      return;
    }
    setRun({ step: from, waiting: false });
    timer.current = window.setTimeout(() => advance(from + 1), STEP_MS);
  };

  const toggleApproval = (index: number) =>
    update({ steps: w.steps.map((s, i) => (i === index ? { ...s, approval: !s.approval } : s)) });

  const stepState = (i: number) => {
    if (!run) return 'idle';
    if (i < run.step) return 'done';
    if (i === run.step) return run.waiting ? 'waiting' : 'current';
    return 'pending';
  };

  return (
    <>
      <section className="panel wf-detail">
        <header className="wf-detail-head">
          <span className="wf-detail-icon">{w.icon}</span>
          <div className="wf-detail-title">
            <h2>{w.name}</h2>
            <p>{w.summary}</p>
          </div>
          <button
            className="toggle"
            role="switch"
            aria-checked={w.enabled}
            aria-label={`${w.name} 켜기/끄기`}
            onClick={() => update({ enabled: !w.enabled })}
          />
          <button className="btn is-primary" onClick={() => advance(0)} disabled={!w.enabled || run !== null}>
            {run ? '실행 중…' : '지금 실행'}
          </button>
        </header>

        <div className="wf-meta">
          <span className="chip">
            {category.icon} {category.label} 에이전트
          </span>
          <span className="chip">🕒 {w.cadence}</span>
          {w.triggers.map((t) => (
            <span key={t} className="chip">
              ⚡ {t}
            </span>
          ))}
          <span className="chip">이번 달 {tokens(w.monthTokens)} 토큰</span>
          <span className={`chip ${w.lastRun.ok ? 'is-ok' : 'is-danger'}`}>
            마지막 실행 {relativeTime(w.lastRun.at)} · {w.lastRun.summary}
          </span>
        </div>

        <ol className="pipeline">
          {w.steps.map((s, i) => (
            <li key={s.name} className={`pipe-step is-${stepState(i)} ${s.approval ? 'has-approval' : ''}`}>
              <span className="pipe-name">{s.name}</span>
              {s.approval && <span className="pipe-approval">👤 승인</span>}
            </li>
          ))}
        </ol>

        {run?.waiting && (
          <div className="approval-bar">
            <span>
              👤 <strong>{w.steps[run.step].name}</strong> 단계에서 승인을 기다려요. 아래에서 내용을 확인하고 넘겨 주세요.
            </span>
            <button className="btn is-primary" onClick={() => advance(run.step + 1)}>
              승인하고 계속
            </button>
          </div>
        )}

        <details className="wf-manage">
          <summary>관리 — 실행 주기 · 승인받을 단계</summary>
          <div className="wf-manage-body">
            <label className="settings-row">
              <span>실행 주기</span>
              <select value={w.cadence} onChange={(e) => update({ cadence: e.target.value })}>
                {workflowCadenceOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="settings-row is-stacked">
              <span>승인받을 단계 — 켠 단계에서는 {AGENT_NAME}가 멈추고 확인을 받아요</span>
              <div className="category-filter">
                {w.steps.map((s, i) => (
                  <button
                    key={s.name}
                    className={`perm-chip ${s.approval ? 'is-on' : ''}`}
                    aria-pressed={s.approval}
                    onClick={() => toggleApproval(i)}
                  >
                    {s.approval ? '👤 ' : ''}
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>
      </section>

      <Panel />
    </>
  );
}
