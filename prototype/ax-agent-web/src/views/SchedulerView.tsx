import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AGENT_NAME,
  cadenceOptions,
  categories,
  categoryById,
  schedules as initialSchedules,
  type CategoryId,
} from '../data/dummy';
import { relativeTime } from '../lib/time';
import { useWorkspace } from '../workspace-context';
import './views.css';

export function SchedulerView() {
  const { canAccess } = useWorkspace();
  const allowedCategories = categories.filter((c) => canAccess(c.id));
  const [allSchedules, setSchedules] = useState(initialSchedules);
  const schedules = allSchedules.filter((s) => canAccess(s.category));
  const [newCategory, setNewCategory] = useState<CategoryId>(allowedCategories[0]?.id ?? 'store');
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCadence, setNewCadence] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const toggle = (id: string) =>
    setSchedules((list) => list.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));

  // "지금 실행" — 잠깐 실행 중 상태를 보여준 뒤 성공 결과로 갱신 (더미)
  const runNow = (id: string) => {
    setRunningIds((ids) => [...ids, id]);
    const t = window.setTimeout(() => {
      setRunningIds((ids) => ids.filter((x) => x !== id));
      setSchedules((list) =>
        list.map((s) =>
          s.id === id
            ? { ...s, lastResult: { ok: true, summary: '수동 실행 완료', at: new Date().toISOString() } }
            : s,
        ),
      );
    }, 1800);
    timers.current.push(t);
  };

  // "+ 새 자동화" — 목록 맨 위에 추가하고 잠깐 강조 (저장하지 않음)
  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const cadence = cadenceOptions[newCadence];
    const id = `new-${Date.now()}`;
    setSchedules((list) => [
      {
        id,
        name,
        description: newDesc.trim() || `${AGENT_NAME}가 정해진 시간에 처리해요`,
        category: canAccess(newCategory) ? newCategory : allowedCategories[0].id,
        cadence: cadence.label,
        nextRun: new Date(Date.now() + cadence.nextRunInMs).toISOString(),
        enabled: true,
        lastResult: null,
      },
      ...list,
    ]);
    setCreating(false);
    setNewName('');
    setNewDesc('');
    setNewCadence(0);
    setHighlightId(id);
    timers.current.push(window.setTimeout(() => setHighlightId(null), 2000));
  };

  const activeCount = schedules.filter((s) => s.enabled).length;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>자동화 스케줄러</h1>
          <p>
            {AGENT_NAME}가 정해진 시간에 알아서 하는 일이에요. 지금 {activeCount}개가 켜져 있어요.
          </p>
        </div>
        <button className="btn is-primary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          {creating ? '닫기' : '+ 새 자동화'}
        </button>
      </header>

      {creating && (
        <form className="panel schedule-form" onSubmit={create}>
          <label>
            <span>이름</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="예: 마감 정산 정리"
            />
          </label>
          <label>
            <span>하는 일</span>
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="예: 오늘 매출과 남은 재고를 정리해 보고"
            />
          </label>
          <label>
            <span>맡길 부서</span>
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as CategoryId)}>
              {allowedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.label} 에이전트
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>주기</span>
            <select value={newCadence} onChange={(e) => setNewCadence(Number(e.target.value))}>
              {cadenceOptions.map((c, i) => (
                <option key={c.label} value={i}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="schedule-form-actions">
            <button type="button" className="btn" onClick={() => setCreating(false)}>
              취소
            </button>
            <button type="submit" className="btn is-primary" disabled={!newName.trim()}>
              만들기
            </button>
          </div>
        </form>
      )}

      <ul className="schedule-list">
        {schedules.map((s) => {
          const running = runningIds.includes(s.id);
          return (
            <li
              key={s.id}
              className={`panel schedule ${s.enabled ? '' : 'is-paused'} ${s.id === highlightId ? 'is-new' : ''}`}
            >
              <button
                className="toggle"
                role="switch"
                aria-checked={s.enabled}
                aria-label={`${s.name} 켜기/끄기`}
                onClick={() => toggle(s.id)}
              />
              <div className="schedule-body">
                <div className="schedule-title">
                  <strong>{s.name}</strong>
                  <span className="chip">
                    {categoryById[s.category].icon} {categoryById[s.category].label}
                  </span>
                  <span className="chip">🕒 {s.cadence}</span>
                </div>
                <p className="schedule-desc">{s.description}</p>
                <div className="schedule-meta">
                  <span>{s.enabled ? `다음 실행 ${relativeTime(s.nextRun)}` : '일시정지됨'}</span>
                  <span className="dot-sep">·</span>
                  {running ? (
                    <span className="chip is-accent">실행 중…</span>
                  ) : s.lastResult ? (
                    <>
                      <span className={`chip ${s.lastResult.ok ? 'is-ok' : 'is-danger'}`}>
                        {s.lastResult.ok ? '성공' : '실패'} · {s.lastResult.summary}
                      </span>
                      <span className="schedule-last">{relativeTime(s.lastResult.at)}</span>
                    </>
                  ) : (
                    <span className="chip">아직 실행 기록 없음</span>
                  )}
                </div>
              </div>
              <button className="btn" onClick={() => runNow(s.id)} disabled={running}>
                지금 실행
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
