import { useState, type FormEvent } from 'react';
import { AGENT_NAME, snsChannels, snsProducts, type SnsChannel, type SnsPost, type SnsStatus } from '../../data/dummy';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../workspace-context';

const GENERATE_MS = 1500;
const HOUR = 3_600_000;

type Filter = SnsStatus | 'all';

const statusMeta: Record<SnsStatus, { label: string; className: string }> = {
  review: { label: '승인 대기', className: 'is-warn' },
  scheduled: { label: '예약됨', className: 'is-accent' },
  draft: { label: '초안', className: '' },
  published: { label: '게시됨', className: 'is-ok' },
};

const channelIcon: Record<SnsChannel, string> = { 인스타그램: '📸', '네이버 블로그': '🟩', 스레드: '🧵' };

const formatFor: Record<SnsChannel, string> = { 인스타그램: '릴스', '네이버 블로그': '블로그 글', 스레드: '텍스트 + 이미지' };

/** SNS 자동화 워크플로우 — 게시물 승인 · 예약 · 성과, 새 게시물 생성 */
export function SnsPanel() {
  const { wf, setWf } = useWorkspace();
  const [filter, setFilter] = useState<Filter>('review');
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [product, setProduct] = useState(snsProducts[0]);
  const [channel, setChannel] = useState<SnsChannel>('인스타그램');

  const posts = wf.snsPosts;
  const visible = filter === 'all' ? posts : posts.filter((p) => p.status === filter);
  const published = posts.filter((p) => p.status === 'published' && p.metrics);
  const reach = published.reduce((sum, p) => sum + (p.metrics?.reach ?? 0), 0);
  const clicks = published.reduce((sum, p) => sum + (p.metrics?.clicks ?? 0), 0);
  const best = [...published].sort((a, b) => (b.metrics?.reach ?? 0) - (a.metrics?.reach ?? 0))[0];

  const setStatus = (id: string, status: SnsStatus, at?: string | null) =>
    setWf((s) => ({
      ...s,
      snsPosts: s.snsPosts.map((p) => (p.id === id ? { ...p, status, at: at === undefined ? p.at : at } : p)),
    }));

  // 상품 · 채널을 고르면 잠시 뒤 승인 대기 게시물이 생긴다 (더미 문구)
  const create = (e: FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    window.setTimeout(() => {
      const post: SnsPost = {
        id: `sp-${Date.now()}`,
        channel,
        format: formatFor[channel],
        title: `${product} — 새 소개`,
        caption: `요즘 제일 많이 찾는 ${product} ✨ 오늘 주문하면 내일 도착해요. 지금 스토어에서 만나보세요!`,
        product,
        status: 'review',
        at: new Date(Date.now() + 20 * HOUR).toISOString(),
      };
      setWf((s) => ({ ...s, snsPosts: [post, ...s.snsPosts] }));
      setGenerating(false);
      setCreating(false);
      setFilter('review');
    }, GENERATE_MS);
  };

  const filters: { id: Filter; label: string }[] = [
    { id: 'review', label: '승인 대기' },
    { id: 'scheduled', label: '예약됨' },
    { id: 'draft', label: '초안' },
    { id: 'published', label: '게시됨' },
    { id: 'all', label: '전체' },
  ];

  return (
    <div className="wf-panel">
      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{reach.toLocaleString('ko-KR')}</span>
          <span className="stat-label">최근 게시물 도달</span>
        </div>
        <div className="stat">
          <span className="stat-value">{clicks.toLocaleString('ko-KR')}</span>
          <span className="stat-label">스토어 클릭</span>
        </div>
        <div className="stat">
          <span className="stat-value stat-value-sm">{best ? best.title : '—'}</span>
          <span className="stat-label">반응이 가장 좋은 게시물</span>
        </div>
      </div>

      <div className="wf-section-head">
        <div className="channel-row">
          {snsChannels.map((c) => (
            <span key={c.channel} className="chip is-ok" title={c.handle}>
              {channelIcon[c.channel]} {c.channel} 연결됨
            </span>
          ))}
        </div>
        <button className="btn is-primary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          {creating ? '닫기' : '+ 새 게시물 만들기'}
        </button>
      </div>

      {creating && (
        <form className="panel schedule-form" onSubmit={create}>
          <label>
            <span>상품</span>
            <select value={product} onChange={(e) => setProduct(e.target.value)}>
              {snsProducts.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            <span>채널</span>
            <select value={channel} onChange={(e) => setChannel(e.target.value as SnsChannel)}>
              {snsChannels.map((c) => (
                <option key={c.channel}>{c.channel}</option>
              ))}
            </select>
          </label>
          <div className="schedule-form-actions">
            <span className="form-note">{AGENT_NAME}가 문구 · 이미지 시안을 만들어 승인 대기로 올려요.</span>
            <button type="button" className="btn" onClick={() => setCreating(false)}>
              취소
            </button>
            <button type="submit" className="btn is-primary" disabled={generating}>
              {generating ? '만드는 중…' : '만들기'}
            </button>
          </div>
        </form>
      )}

      <div className="segmented" role="tablist">
        {filters.map((f) => {
          const count = f.id === 'all' ? posts.length : posts.filter((p) => p.status === f.id).length;
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? 'is-active' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label} {count}
            </button>
          );
        })}
      </div>

      <ul className="post-list">
        {visible.length === 0 && <li className="panel empty">비어 있어요.</li>}
        {visible.map((p) => (
          <li key={p.id} className={`panel post is-${p.status}`}>
            <span className="post-channel" title={p.channel}>
              {channelIcon[p.channel]}
            </span>
            <div className="post-body">
              <div className="post-head">
                <strong>{p.title}</strong>
                <span className={`chip ${statusMeta[p.status].className}`}>{statusMeta[p.status].label}</span>
              </div>
              <p className="post-caption">{p.caption}</p>
              <span className="post-meta">
                {p.channel} · {p.format} · {p.product}
                {p.at && (p.status === 'published' ? ` · ${relativeTime(p.at)} 게시` : ` · ${relativeTime(p.at)} 게시 예정`)}
                {p.metrics && ` · 도달 ${p.metrics.reach.toLocaleString('ko-KR')} · 클릭 ${p.metrics.clicks.toLocaleString('ko-KR')}`}
              </span>
            </div>
            <div className="post-actions">
              {p.status === 'review' && (
                <>
                  <button className="btn is-primary" onClick={() => setStatus(p.id, 'scheduled')}>
                    승인하고 예약
                  </button>
                  <button className="btn" onClick={() => setStatus(p.id, 'draft')}>
                    다시 써줘
                  </button>
                </>
              )}
              {p.status === 'draft' && (
                <button className="btn" onClick={() => setStatus(p.id, 'review', new Date(Date.now() + 26 * HOUR).toISOString())}>
                  승인 대기로 올리기
                </button>
              )}
              {p.status === 'scheduled' && (
                <button className="btn" onClick={() => setStatus(p.id, 'review')}>
                  예약 취소
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
