import { useEffect } from 'react';
import { AGENT_NAME, categories, type AgentSettings, type CategoryId, type Member } from '../data/dummy';

interface Props {
  value: AgentSettings;
  onChange: (next: AgentSettings) => void;
  members: Member[];
  onMembersChange: (next: Member[]) => void;
  viewer: Member;
  onViewAs: (memberId: string) => void;
  onClose: () => void;
}

type ToggleKey = 'autoSendShippingReplies' | 'holdLowRatingReviews' | 'alwaysApproveOrders';

const approvalRules: { key: ToggleKey; label: string }[] = [
  { key: 'autoSendShippingReplies', label: '배송 일정 문의는 바로 답장 보내기' },
  { key: 'holdLowRatingReviews', label: '별점 3점 이하 리뷰는 답글 전에 확인받기' },
  { key: 'alwaysApproveOrders', label: '공장 발주는 항상 승인받기' },
];

/** 설정 — 바꾼 값은 화면 안에서만 유지된다(저장·서버 반영 없음) */
export function SettingsDialog({ value, onChange, members, onMembersChange, viewer, onViewAs, onClose }: Props) {
  const set = <K extends keyof AgentSettings>(key: K, v: AgentSettings[K]) => onChange({ ...value, [key]: v });

  const toggleCategory = (memberId: string, category: CategoryId) =>
    onMembersChange(
      members.map((m) =>
        m.id !== memberId
          ? m
          : {
              ...m,
              categories: m.categories.includes(category)
                ? m.categories.filter((c) => c !== category)
                : [...m.categories, category],
            },
      ),
    );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="command-overlay" onMouseDown={onClose}>
      <div className="settings" role="dialog" aria-label="설정" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <h2>{AGENT_NAME} 설정</h2>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="settings-body">
          <p className="settings-group">말투</p>
          <label className="settings-row">
            <span>저를 부를 때</span>
            <input value={value.ownerTitle} onChange={(e) => set('ownerTitle', e.target.value)} />
          </label>
          <div className="settings-row">
            <span>{AGENT_NAME}의 말투</span>
            <div className="segmented" role="tablist">
              {(
                [
                  ['friendly', '친근하게'],
                  ['formal', '정중하게'],
                ] as const
              ).map(([tone, label]) => (
                <button
                  key={tone}
                  role="tab"
                  aria-selected={value.tone === tone}
                  className={value.tone === tone ? 'is-active' : ''}
                  onClick={() => set('tone', tone)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p className="settings-group">혼자 처리할 일 · 확인받을 일</p>
          {approvalRules.map((rule) => (
            <div key={rule.key} className="settings-row">
              <span>{rule.label}</span>
              <button
                className="toggle"
                role="switch"
                aria-checked={value[rule.key]}
                aria-label={rule.label}
                onClick={() => set(rule.key, !value[rule.key])}
              />
            </div>
          ))}

          <p className="settings-group">보고</p>
          <label className="settings-row">
            <span>아침 브리핑 시간</span>
            <select value={value.briefingTime} onChange={(e) => set('briefingTime', e.target.value)}>
              {['06:00', '07:00', '08:00', '09:00'].map((t) => (
                <option key={t} value={t}>
                  오전 {Number(t.slice(0, 2))}시
                </option>
              ))}
            </select>
          </label>

          <p className="settings-group">팀원 · 권한</p>
          <p className="settings-hint">
            {AGENT_NAME}(마스터 에이전트)는 부서별 에이전트에게 일을 나눠 맡겨요. 팀원에게는 담당 부서
            에이전트만 열어 줄 수 있고, 열어 준 부서의 일만 보이고 맡길 수 있어요.
          </p>
          {members.map((m) => (
            <div key={m.id} className="member">
              <div className="member-head">
                <span className="member-emoji">{m.emoji}</span>
                <div className="member-name">
                  <strong>{m.name}</strong>
                  <span>{m.role}</span>
                </div>
                {m.master ? (
                  <span className="chip is-accent">마스터 · 모든 부서</span>
                ) : (
                  <button className="btn" onClick={() => onViewAs(m.id)} disabled={!viewer.master || viewer.id === m.id}>
                    {viewer.id === m.id ? '보는 중' : '이 사람으로 보기'}
                  </button>
                )}
              </div>
              {!m.master && (
                <div className="member-perms" role="group" aria-label={`${m.name} 부서 권한`}>
                  {categories.map((c) => {
                    const on = m.categories.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        className={`perm-chip ${on ? 'is-on' : ''}`}
                        aria-pressed={on}
                        disabled={!viewer.master}
                        onClick={() => toggleCategory(m.id, c.id)}
                      >
                        {c.icon} {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {!viewer.master && <p className="settings-hint">권한은 사장님(마스터)만 바꿀 수 있어요.</p>}

          <p className="settings-note">바꾼 내용은 바로 적용돼요.</p>
        </div>
      </div>
    </div>
  );
}
