import { useState } from 'react';
import { AGENT_NAME, mailAccounts, mailMessages, space, type MailLabel, type MailMessage } from '../data/dummy';
import { relativeTime } from '../lib/time';
import './views.css';

type Filter = 'all' | 'review' | 'auto';

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'review', label: '검토 필요' },
  { id: 'auto', label: '자동 처리됨' },
];

const labelChip: Record<MailLabel, string> = {
  주문문의: 'is-accent',
  대량구매: 'is-accent',
  클레임: 'is-danger',
  공급사: '',
  세금계산서: '',
  광고: '',
};

const providerIcon = { Gmail: '📮', Naver: '🟩', Outlook: '📘' } as const;

function draftFor(m: MailMessage): string {
  return `안녕하세요 ${m.from}님, ${space.name}입니다.\n문의 주신 "${m.subject}" 건 확인했습니다. … (${AGENT_NAME}가 작성한 답장 초안 — 데모)`;
}

export function MailView() {
  const [accounts, setAccounts] = useState(mailAccounts);
  const [messages, setMessages] = useState(mailMessages);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = messages.filter((m) =>
    filter === 'all' ? true : filter === 'review' ? m.needsReview : !m.needsReview,
  );

  const connect = (id: string) =>
    setAccounts((list) =>
      list.map((a) =>
        a.id === id
          ? { ...a, connected: true, address: 'moa.living@outlook.com', syncedAt: new Date().toISOString() }
          : a,
      ),
    );

  const approve = (id: string) => {
    setMessages((list) =>
      list.map((m) => (m.id === id ? { ...m, needsReview: false, unread: false, aiAction: '승인 후 발송함' } : m)),
    );
    setOpenId(null);
  };

  const toggleOpen = (id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, unread: false } : m)));
  };

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>메일 연동</h1>
          <p>연결된 메일함의 새 메일을 {AGENT_NAME}가 분류하고, 답장 초안을 준비해요.</p>
        </div>
      </header>

      <div className="account-row">
        {accounts.map((a) => (
          <div key={a.id} className={`panel account ${a.connected ? '' : 'is-off'}`}>
            <span className="account-icon">{providerIcon[a.provider]}</span>
            <div className="account-body">
              <strong>{a.provider}</strong>
              <span>{a.address}</span>
            </div>
            {a.connected ? (
              <span className="chip is-ok">{a.syncedAt ? `${relativeTime(a.syncedAt)} 동기화` : '연결됨'}</span>
            ) : (
              <button className="btn" onClick={() => connect(a.id)}>
                연결하기
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="toolbar">
        <div className="segmented" role="tablist">
          {filters.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? 'is-active' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id === 'review' && ` ${messages.filter((m) => m.needsReview).length}`}
            </button>
          ))}
        </div>
      </div>

      <ul className="panel mail-list">
        {visible.length === 0 && <li className="empty">해당하는 메일이 없어요.</li>}
        {visible.map((m) => (
          <li key={m.id} className={`mail ${m.unread ? 'is-unread' : ''} ${openId === m.id ? 'is-open' : ''}`}>
            <button className="mail-row" onClick={() => toggleOpen(m.id)} aria-expanded={openId === m.id}>
              <span className="mail-dot" />
              <span className="mail-from">{m.from}</span>
              <span className="mail-main">
                <span className="mail-subject">{m.subject}</span>
                <span className="mail-preview">{m.preview}</span>
              </span>
              <span className={`chip ${labelChip[m.label]}`}>{m.label}</span>
              <span className="mail-time">{relativeTime(m.receivedAt)}</span>
            </button>
            <div className="mail-ai">
              <span className={`chip ${m.needsReview ? 'is-warn' : 'is-ok'}`}>
                {m.needsReview ? '검토 필요' : '처리됨'}
              </span>
              <span>🤖 {m.aiAction}</span>
            </div>
            {openId === m.id && (
              <div className="mail-draft">
                <p>{draftFor(m)}</p>
                {m.needsReview && (
                  <div className="mail-actions">
                    <button className="btn">수정</button>
                    <button className="btn is-primary" onClick={() => approve(m.id)}>
                      승인 후 발송
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
