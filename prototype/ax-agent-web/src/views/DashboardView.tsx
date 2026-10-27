import { Link } from 'react-router-dom';
import {
  AGENT_NAME,
  categories,
  categoryById,
  currentStatement,
  dailyTokens,
  importedStatements,
  tokenBudget,
  tokenTopJobs,
  tokenUsageByCategory,
  upcomingPayments,
  type CategoryId,
} from '../data/dummy';
import type { TokenTally } from '../hooks/useLiveActivity';
import { expenses, marginRate, netIncome } from '../lib/finance';
import { tokens, won, wonShort } from '../lib/format';
import { dday } from '../lib/time';
import { useWorkspace } from '../workspace-context';
import './views.css';

/** 대시보드 — 돈 흐름(재무 권한)과 하루의 토큰 사용량을 한 화면에 */
export function DashboardView() {
  const { canAccess, viewer, sessionTokens, finance } = useWorkspace();

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>대시보드</h1>
          <p>이번 달 돈 흐름과 {AGENT_NAME}가 일하며 쓴 토큰을 한눈에 봐요.</p>
        </div>
        <Link className="btn" to="/app/office">
          ← 사무실
        </Link>
      </header>

      {canAccess('finance') ? (
        <FinanceSummary imported={finance.importedFile !== null} />
      ) : (
        <p className="panel dash-locked">🔒 재무 권한이 없어 매출 · 지출 정보는 숨겼어요.</p>
      )}

      <TokenUsage
        sessionTokens={sessionTokens}
        allowed={categories.filter((c) => canAccess(c.id)).map((c) => c.id)}
        showBudget={viewer.master}
      />
    </div>
  );
}

function FinanceSummary({ imported }: { imported: boolean }) {
  const s = currentStatement;
  const months = imported ? [...importedStatements, s] : [s];
  const maxNet = Math.max(...months.map(netIncome));

  return (
    <section className="dash-section">
      <h2 className="panel-title">
        이번 달 돈 흐름 <span className="dash-sub">10월 1일 ~ 오늘 · 자동 기록 기준</span>
      </h2>
      <div className="stat-row is-4">
        <Stat label="매출" value={wonShort(s.revenue)} />
        <Stat label="지출" value={wonShort(expenses(s))} />
        <Stat label="순이익" value={wonShort(netIncome(s))} />
        <Stat label="마진율" value={`${marginRate(s).toFixed(1)}%`} />
      </div>

      <div className="dash-grid">
        <div className="panel dash-panel">
          <h3 className="dash-panel-title">결제 예정</h3>
          <ul className="pay-list">
            {upcomingPayments.map((p) => {
              const d = dday(p.due);
              const soon = d === '오늘' || Number(d.slice(2)) <= 5;
              return (
                <li key={p.id}>
                  <span className={`chip ${soon ? 'is-warn' : ''}`}>{d}</span>
                  <span className="pay-title">{p.title}</span>
                  <span className="pay-amount">{won(p.amount)}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="panel dash-panel">
          <h3 className="dash-panel-title">월별 순이익</h3>
          <div className="vbars" role="img" aria-label="월별 순이익 막대 그래프">
            {months.map((m) => {
              const net = netIncome(m);
              return (
                <div key={m.month} className={`vbar ${m.partial ? 'is-partial' : ''}`} title={`${m.month} 순이익 ${won(net)}`}>
                  <span className="vbar-value">{wonShort(net)}</span>
                  <span className="vbar-fill" style={{ height: `${(net / maxNet) * 100}%` }} />
                  <span className="vbar-label">{m.partial ? `${m.month} (진행 중)` : m.month}</span>
                </div>
              );
            })}
          </div>
          {!imported && (
            <p className="dash-hint">
              지난 결산 엑셀을 올리면 이전 달 추이도 보여요. <Link to="/app/workflows/finance">워크플로우 › 재무 관리에서 올리기 →</Link>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

interface TokenUsageProps {
  sessionTokens: TokenTally;
  allowed: CategoryId[];
  showBudget: boolean;
}

function TokenUsage({ sessionTokens, allowed, showBudget }: TokenUsageProps) {
  const rows = allowed
    .map((id) => ({ ...categoryById[id], used: tokenUsageByCategory[id] + (sessionTokens[id] ?? 0) }))
    .sort((a, b) => b.used - a.used);
  const used = rows.reduce((sum, r) => sum + r.used, 0);
  const maxRow = Math.max(...rows.map((r) => r.used), 1);
  const sessionTotal = allowed.reduce((sum, id) => sum + (sessionTokens[id] ?? 0), 0);

  // 오늘 막대는 실시간 작업 토큰만큼 자란다
  const days = dailyTokens.map((d, i) =>
    i === dailyTokens.length - 1 ? { ...d, tokens: d.tokens + sessionTotal } : d,
  );
  const maxDay = Math.max(...days.map((d) => d.tokens));
  const budgetPct = Math.min(100, (used / tokenBudget.monthlyTokens) * 100);

  return (
    <section className="dash-section">
      <h2 className="panel-title">
        {AGENT_NAME}의 토큰 사용량{' '}
        <span className="dash-sub">{showBudget ? '이번 달 · 전체 부서' : '이번 달 · 내 담당 부서'}</span>
      </h2>

      <div className="stat-row">
        <Stat label="이번 달 사용" value={`${tokens(used)} 토큰`} />
        <Stat label="예상 비용" value={won(Math.round((used / 1_000_000) * tokenBudget.krwPerMillion))} />
        <Stat label="이번 접속 이후" value={`${tokens(sessionTotal)} 토큰`} live />
      </div>

      {showBudget && (
        <div className="panel dash-panel budget">
          <div className="budget-head">
            <span>월 예산 {tokens(tokenBudget.monthlyTokens)} 토큰 중</span>
            <strong>{budgetPct.toFixed(0)}% 사용</strong>
          </div>
          <div className="budget-bar">
            <span style={{ width: `${budgetPct}%` }} />
          </div>
        </div>
      )}

      <div className="dash-grid">
        <div className="panel dash-panel">
          <h3 className="dash-panel-title">부서별</h3>
          <ul className="hbars">
            {rows.map((r) => (
              <li key={r.id} title={`${r.label} ${r.used.toLocaleString('ko-KR')} 토큰`}>
                <span className="hbar-label">
                  {r.icon} {r.label}
                </span>
                <span className="hbar-track">
                  <span style={{ width: `${(r.used / maxRow) * 100}%` }} />
                </span>
                <span className="hbar-value">
                  {tokens(r.used)} · {((r.used / used) * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel dash-panel">
          <h3 className="dash-panel-title">많이 쓴 작업</h3>
          <ul className="top-jobs">
            {tokenTopJobs
              .filter((j) => allowed.includes(j.category))
              .map((j) => (
                <li key={j.title}>
                  <span className="top-job-title">
                    {categoryById[j.category].icon} {j.title}
                    <small>{j.note}</small>
                  </span>
                  <span className="top-job-value">{tokens(j.tokens)}</span>
                </li>
              ))}
          </ul>
          <p className="dash-hint">이미지를 만드는 SNS 작업, 여러 번 시도하는 최저가 탐색이 토큰을 많이 써요.</p>
        </div>
      </div>

      {showBudget && (
        <div className="panel dash-panel">
          <h3 className="dash-panel-title">최근 14일</h3>
          <div className="vbars is-dense" role="img" aria-label="최근 14일 일별 토큰 사용량">
            {days.map((d, i) => {
              const date = new Date(d.date);
              const today = i === days.length - 1;
              return (
                <div
                  key={d.date}
                  className={`vbar ${today ? 'is-today' : ''}`}
                  title={`${date.getMonth() + 1}/${date.getDate()} · ${d.tokens.toLocaleString('ko-KR')} 토큰`}
                >
                  {today && <span className="vbar-value">{tokens(d.tokens)}</span>}
                  <span className="vbar-fill" style={{ height: `${(d.tokens / maxDay) * 100}%` }} />
                  <span className="vbar-label">{today ? '오늘' : `${date.getDate()}`}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">
        {live && <span className="live-dot" />} {label}
      </span>
    </div>
  );
}
