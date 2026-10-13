import { useEffect, useRef, useState } from 'react';
import { AGENT_NAME, schedules as initialSchedules } from '../data/dummy';
import { relativeTime } from '../lib/time';
import './views.css';

export function SchedulerView() {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [runningIds, setRunningIds] = useState<string[]>([]);
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
        <button className="btn is-primary" disabled title="데모에서는 비활성">
          + 새 자동화
        </button>
      </header>

      <ul className="schedule-list">
        {schedules.map((s) => {
          const running = runningIds.includes(s.id);
          return (
            <li key={s.id} className={`panel schedule ${s.enabled ? '' : 'is-paused'}`}>
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
                  <span className="chip">🕒 {s.cadence}</span>
                </div>
                <p className="schedule-desc">{s.description}</p>
                <div className="schedule-meta">
                  <span>{s.enabled ? `다음 실행 ${relativeTime(s.nextRun)}` : '일시정지됨'}</span>
                  <span className="dot-sep">·</span>
                  {running ? (
                    <span className="chip is-accent">실행 중…</span>
                  ) : (
                    <span className={`chip ${s.lastResult.ok ? 'is-ok' : 'is-danger'}`}>
                      {s.lastResult.ok ? '성공' : '실패'} · {s.lastResult.summary}
                    </span>
                  )}
                  <span className="schedule-last">{relativeTime(s.lastResult.at)}</span>
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
