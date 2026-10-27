import { useState, type FormEvent } from 'react';
import { AGENT_NAME, CNY_TO_KRW, type FactoryQuote, type SourcingRequest } from '../../data/dummy';
import { won } from '../../lib/format';
import { relativeTime } from '../../lib/time';
import { landedCost, quoteMargin } from '../../lib/workflows';
import { useWorkspace } from '../../workspace-context';

const QUOTE_DELAY_MS = 2500;

const statusChip: Record<SourcingRequest['status'], { label: string; className: string }> = {
  searching: { label: '공장 찾는 중', className: 'is-accent' },
  quoted: { label: '견적 도착', className: 'is-warn' },
  ordered: { label: '발주 완료', className: 'is-ok' },
};

const contactChip: Record<FactoryQuote['contact'], { label: string; className: string }> = {
  replied: { label: '견적 받음', className: 'is-ok' },
  sent: { label: '문의 발송 · 답 대기', className: '' },
  call: { label: '☎ 전화 필요 · 긴급', className: 'is-danger' },
};

// 새 요청에 붙일 가상 공장 — 단가는 판매가에 비례한 더미 값
const mockFactories = [
  { factory: '이우 하오란 일용품 (义乌浩然日用品)', city: '이우', platform: '1688' as const, ratio: 0.21, moq: 500, leadDays: 12, rating: 4.6 },
  { factory: '선전 바이청 가정용품 (深圳百诚家居)', city: '선전', platform: '1688' as const, ratio: 0.18, moq: 2_000, leadDays: 20, rating: 4.4 },
  { factory: '광저우 신메이 무역 (广州新美贸易)', city: '광저우', platform: '알리바바' as const, ratio: 0.24, moq: 300, leadDays: 9, rating: 4.8 },
];

/** 상품 소싱 워크플로우 — 소싱 요청 · 공장 견적 비교 · 공장 선택과 발주 승인 */
export function SourcingPanel() {
  const { wf, setWf } = useWorkspace();
  const [selectedId, setSelectedId] = useState(wf.sourcingRequests[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const [product, setProduct] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [qty, setQty] = useState('');
  const request = wf.sourcingRequests.find((r) => r.id === selectedId);
  const quotes = wf.quotes.filter((q) => q.requestId === selectedId);
  const chosen = request ? wf.chosenQuote[request.id] : undefined;

  // 견적 받은 공장 중 MOQ 를 맞추면서 마진이 가장 큰 곳을 추천
  const recommended = request
    ? quotes
        .filter((q) => q.contact === 'replied' && q.moq <= request.qty)
        .sort((a, b) => quoteMargin(b, request) - quoteMargin(a, request))[0]
    : undefined;

  const choose = (quoteId: string) =>
    setWf((s) => ({ ...s, chosenQuote: { ...s.chosenQuote, [selectedId]: quoteId } }));

  const markCalled = (quoteId: string) =>
    setWf((s) => ({ ...s, quotes: s.quotes.map((q) => (q.id === quoteId ? { ...q, contact: 'replied' } : q)) }));

  const approveOrder = () =>
    setWf((s) => ({
      ...s,
      sourcingRequests: s.sourcingRequests.map((r) => (r.id === selectedId ? { ...r, status: 'ordered' } : r)),
    }));

  // 새 요청 — 공장 3곳에 문의를 보낸 상태로 만들고, 잠시 뒤 견적이 도착한다 (더미)
  const create = (e: FormEvent) => {
    e.preventDefault();
    const price = Number(sellPrice.replace(/,/g, ''));
    const amount = Number(qty.replace(/,/g, ''));
    if (!product.trim() || !price || !amount) return;
    const id = `sr-${Date.now()}`;
    const newQuotes: FactoryQuote[] = mockFactories.map((f, i) => ({
      id: `${id}-q${i}`,
      requestId: id,
      factory: f.factory,
      city: f.city,
      platform: f.platform,
      unitCny: Math.round(((price * f.ratio) / CNY_TO_KRW) * 10) / 10,
      moq: f.moq,
      leadDays: f.leadDays,
      rating: f.rating,
      contact: 'sent',
    }));
    setWf((s) => ({
      ...s,
      sourcingRequests: [
        {
          id,
          product: product.trim(),
          sellPrice: price,
          qty: amount,
          landingPerUnit: Math.round(price * 0.25),
          marketLowest: [
            { channel: '쿠팡', price: Math.round((price * 0.9) / 100) * 100 },
            { channel: '스마트스토어', price: Math.round((price * 0.94) / 100) * 100 },
          ],
          status: 'searching',
          createdAt: new Date().toISOString(),
        },
        ...s.sourcingRequests,
      ],
      quotes: [...s.quotes, ...newQuotes],
    }));
    setSelectedId(id);
    setCreating(false);
    setProduct('');
    setSellPrice('');
    setQty('');
    // 셸 상태를 바꾸므로 패널이 닫혀도 견적은 도착해야 한다 — 언마운트 시 타이머를 지우지 않는다
    window.setTimeout(
      () =>
        setWf((s) => ({
          ...s,
          sourcingRequests: s.sourcingRequests.map((r) => (r.id === id ? { ...r, status: 'quoted' } : r)),
          quotes: s.quotes.map((q) => (q.requestId === id ? { ...q, contact: 'replied' } : q)),
        })),
      QUOTE_DELAY_MS,
    );
  };

  return (
    <div className="wf-panel">
      <div className="wf-section-head">
        <h2 className="panel-title">소싱 요청</h2>
        <button className="btn is-primary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          {creating ? '닫기' : '+ 새 소싱 요청'}
        </button>
      </div>

      {creating && (
        <form className="panel schedule-form" onSubmit={create}>
          <label>
            <span>상품</span>
            <input autoFocus value={product} onChange={(e) => setProduct(e.target.value)} placeholder="예: 스테인리스 양념통 6종" />
          </label>
          <label>
            <span>우리 판매가 (원)</span>
            <input inputMode="numeric" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="12900" />
          </label>
          <label>
            <span>수량</span>
            <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1000" />
          </label>
          <label>
            <span>찾을 곳</span>
            <select defaultValue="both">
              <option value="both">1688 + 알리바바</option>
              <option value="1688">1688 만</option>
            </select>
          </label>
          <div className="schedule-form-actions">
            <span className="form-note">{AGENT_NAME}가 공장 3곳에 중국어로 견적 문의를 보내요.</span>
            <button type="button" className="btn" onClick={() => setCreating(false)}>
              취소
            </button>
            <button type="submit" className="btn is-primary" disabled={!product.trim() || !sellPrice || !qty}>
              요청하기
            </button>
          </div>
        </form>
      )}

      <div className="request-row">
        {wf.sourcingRequests.map((r) => (
          <button
            key={r.id}
            className={`panel request-card ${r.id === selectedId ? 'is-selected' : ''}`}
            onClick={() => setSelectedId(r.id)}
          >
            <span className="request-title">{r.product}</span>
            <span className="request-meta">
              {r.qty.toLocaleString('ko-KR')}개 · 판매가 {won(r.sellPrice)} · {relativeTime(r.createdAt)}
            </span>
            <span className={`chip ${statusChip[r.status].className}`}>{statusChip[r.status].label}</span>
          </button>
        ))}
      </div>

      {request && (
        <section className="panel dash-panel">
          <div className="market-row">
            <span className="market-label">국내 최저가</span>
            {request.marketLowest.map((m) => (
              <span key={m.channel} className="chip">
                {m.channel} {won(m.price)}
              </span>
            ))}
            <span className="chip is-accent">우리 판매가 {won(request.sellPrice)}</span>
          </div>

          {request.status === 'searching' ? (
            <p className="empty">
              {AGENT_NAME}가 공장 {quotes.length}곳에 중국어로 견적 문의를 보냈어요. 답이 오면 여기 정리돼요…
            </p>
          ) : (
            <div className="statement-wrap">
              <table className="quote-table">
                <thead>
                  <tr>
                    <th>공장</th>
                    <th>단가</th>
                    <th>MOQ · 납기</th>
                    <th>개당 원가</th>
                    <th>예상 마진</th>
                    <th>최저가 기준</th>
                    <th>상태</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => {
                    const lowest = Math.min(...request.marketLowest.map((m) => m.price));
                    const margin = quoteMargin(q, request);
                    const moqOk = q.moq <= request.qty;
                    return (
                      <tr key={q.id} className={q.id === chosen ? 'is-chosen' : ''}>
                        <td>
                          <strong>{q.factory}</strong>
                          <small>
                            {q.platform} · {q.city} · ★ {q.rating}
                            {q.id === recommended?.id && <span className="chip is-accent">추천</span>}
                          </small>
                        </td>
                        <td>
                          ¥{q.unitCny}
                          <small>≈ {won(Math.round(q.unitCny * CNY_TO_KRW))}</small>
                        </td>
                        <td className={moqOk ? '' : 'is-warn-text'}>
                          {q.moq.toLocaleString('ko-KR')}개 · {q.leadDays}일
                          {!moqOk && <small>MOQ 가 요청 수량보다 많아요</small>}
                        </td>
                        <td>{won(landedCost(q, request))}</td>
                        <td>
                          <strong>{margin.toFixed(0)}%</strong>
                        </td>
                        <td>{quoteMargin(q, request, lowest).toFixed(0)}%</td>
                        <td>
                          <span className={`chip ${contactChip[q.contact].className}`}>{contactChip[q.contact].label}</span>
                        </td>
                        <td>
                          {q.contact === 'call' ? (
                            <button className="btn" onClick={() => markCalled(q.id)}>
                              통화 완료
                            </button>
                          ) : q.contact === 'replied' && request.status !== 'ordered' ? (
                            <button
                              className={`btn ${q.id === chosen ? 'is-primary' : ''}`}
                              onClick={() => choose(q.id)}
                              aria-pressed={q.id === chosen}
                            >
                              {q.id === chosen ? '선택됨' : '선택'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="dash-hint">
            예상 마진 = 판매가 − 채널 수수료 11% − 개당 원가(공장 단가 + 해외 운송 · 관세 · 국내 택배). 광고비는 빼기 전이에요.
          </p>

          {request.status === 'quoted' && (
            <div className="approval-bar">
              {chosen ? (
                <>
                  <span>
                    👤 <strong>{quotes.find((q) => q.id === chosen)?.factory}</strong> 에{' '}
                    {request.qty.toLocaleString('ko-KR')}개 발주할까요? 승인하면 중국어 발주서를 보내고 선금 일정을 재무
                    관리에 넣어요.
                  </span>
                  <button className="btn is-primary" onClick={approveOrder}>
                    발주 승인
                  </button>
                </>
              ) : (
                <span>👤 공장을 하나 고르면 발주 승인으로 넘어가요.</span>
              )}
            </div>
          )}
          {request.status === 'ordered' && (
            <div className="approval-bar is-done">
              ✓ 발주서(중국어)를 보냈어요 · 선금 30% 송금 일정을 재무 관리에 추가했어요.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
