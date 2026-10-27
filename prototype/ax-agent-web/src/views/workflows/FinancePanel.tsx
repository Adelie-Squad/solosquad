import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  AGENT_NAME,
  currentStatement,
  excelImportSheets,
  excelImportSteps,
  financeRules,
  importedStatements,
  space,
} from '../../data/dummy';
import { downloadStatementCsv, marginRate, statementRows } from '../../lib/finance';
import { won } from '../../lib/format';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../workspace-context';

const STEP_MS = 700;

/** 재무 관리 워크플로우 — 엑셀 결산 가져오기(더미 분석) · 손익표 · 자동 기록 장부 · 엑셀 내보내기 */
export function FinancePanel() {
  const { finance, setFinance } = useWorkspace();
  const [phase, setPhase] = useState<'idle' | 'processing' | 'done'>(finance.importedFile ? 'done' : 'idle');
  const [step, setStep] = useState(0);
  const [pendingName, setPendingName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [rules, setRules] = useState(financeRules);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const statements = finance.importedFile ? [...importedStatements, currentStatement] : [currentStatement];

  // 실제 파싱 없이 단계 진행만 보여준 뒤 지난달 결산을 채운다 (더미)
  const importFile = (file: File) => {
    setPendingName(file.name);
    setPhase('processing');
    setStep(0);
    excelImportSteps.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setStep(i + 1), STEP_MS * (i + 1)));
    });
    timers.current.push(
      window.setTimeout(() => {
        setPhase('done');
        setFinance((f) => ({ ...f, importedFile: file.name }));
      }, STEP_MS * (excelImportSteps.length + 1)),
    );
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) importFile(file);
  };

  const resolve = (id: string, as: string) =>
    setFinance((f) => ({
      ...f,
      ledger: f.ledger.map((l) =>
        l.id === id ? { ...l, memo: `${l.memo.split(' — ')[0]} — ${as}`, needsReview: false } : l,
      ),
    }));

  return (
    <div className="wf-panel">

      <section className="panel import">
        {phase === 'idle' && (
          <label
            className={`dropzone ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
            <span className="dropzone-icon">📎</span>
            <strong>지난 결산 엑셀을 올려 주세요</strong>
            <span>월별 결산 · 채널별 매출 · 입출금 · 상품별 마진 시트를 {AGENT_NAME}가 알아서 찾아 장부에 넣어요.</span>
            <span className="btn">파일 고르기</span>
          </label>
        )}

        {phase === 'processing' && (
          <div className="import-progress">
            <p className="import-file">📄 {pendingName}</p>
            <ol className="steps">
              {excelImportSteps.map((s, i) => (
                <li key={s} className={`step is-${i < step ? 'done' : i === step ? 'current' : 'pending'}`}>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        )}

        {phase === 'done' && (
          <div className="import-result">
            <div className="import-result-head">
              <p>
                <span className="chip is-ok">✓ 반영 완료</span> <strong>{finance.importedFile}</strong>
              </p>
              <button className="btn" onClick={() => setPhase('idle')}>
                다시 올리기
              </button>
            </div>
            <table className="sheet-map">
              <thead>
                <tr>
                  <th>찾은 시트</th>
                  <th>행</th>
                  <th>반영한 곳</th>
                </tr>
              </thead>
              <tbody>
                {excelImportSheets.map((s) => (
                  <tr key={s.sheet}>
                    <td>{s.sheet}</td>
                    <td>{s.rows}</td>
                    <td>→ {s.mapsTo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dash-section">
        <div className="wf-section-head">
          <h2 className="panel-title">월별 손익표</h2>
          <button
            className="btn"
            onClick={() => downloadStatementCsv(statements, `${space.name.replace(/\s/g, '')}_손익표.csv`)}
          >
            ⬇ 엑셀로 내보내기
          </button>
        </div>
        <div className="panel statement-wrap">
          <table className="statement">
            <thead>
              <tr>
                <th />
                {statements.map((s) => (
                  <th key={s.month}>
                    {s.month}
                    {s.partial && <small> 진행 중</small>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statementRows.map((r) => (
                <tr key={r.label} className={r.total ? 'is-total' : ''}>
                  <th>{r.label}</th>
                  {statements.map((s) => (
                    <td key={s.month}>{won(r.value(s))}</td>
                  ))}
                </tr>
              ))}
              <tr className="is-total">
                <th>마진율</th>
                {statements.map((s) => (
                  <td key={s.month}>{marginRate(s).toFixed(1)}%</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {!finance.importedFile && (
          <p className="dash-hint">지금은 이번 달 자동 기록만 있어요. 위에서 지난 결산 엑셀을 올리면 7–9월이 채워져요.</p>
        )}
      </section>

      <div className="dash-grid">
        <section className="panel dash-panel">
          <h3 className="dash-panel-title">자동 기록 규칙</h3>
          {rules.map((r) => (
            <div key={r.id} className="settings-row">
              <span>{r.label}</span>
              <button
                className="toggle"
                role="switch"
                aria-checked={r.enabled}
                aria-label={r.label}
                onClick={() => setRules((list) => list.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))}
              />
            </div>
          ))}
        </section>

        <section className="panel dash-panel">
          <h3 className="dash-panel-title">최근 자동 기록</h3>
          <ul className="ledger">
            {finance.ledger.map((l) => (
              <li key={l.id} className={l.needsReview ? 'is-review' : ''}>
                <div className="ledger-main">
                  <span className="ledger-memo">{l.memo}</span>
                  <span className="ledger-meta">
                    <span className="chip">{l.source}</span> {relativeTime(l.at)}
                  </span>
                </div>
                <span className="ledger-amount">
                  {l.direction === 'in' ? '+' : '−'}
                  {won(l.amount)}
                </span>
                {l.needsReview && (
                  <div className="ledger-actions">
                    <span className="chip is-warn">확인 필요</span>
                    <button className="btn" onClick={() => resolve(l.id, '매출')}>
                      매출로 기록
                    </button>
                    <button className="btn" onClick={() => resolve(l.id, '기타 수입')}>
                      기타 수입
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
