import { useState, type FormEvent } from 'react';
import { AGENT_NAME, CNY_TO_KRW, space, type FactoryQuote, type SourcingRequest } from '../../data/dummy';
import { won } from '../../lib/format';
import { BUSINESS_CONTEXT, llmChat, parseJsonObject, useLlm } from '../../lib/llm';
import { relativeTime } from '../../lib/time';
import { landedCost, quoteMargin } from '../../lib/workflows';
import { useWorkspace } from '../../workspace-context';

const QUOTE_DELAY_MS = 2500;

/** 공장에 보낼 중국어 견적 문의 초안 + 한국어 번역 */
interface Inquiry {
  factory: string;
  zh: string;
  ko: string;
  /** 실제 AI 가 썼으면 그 모델, 더미 문안이면 없음 */
  model?: string;
}

function templateInquiry(r: SourcingRequest, factory: string): Inquiry {
  return {
    factory,
    zh: `您好！我们是韩国电商公司 ${space.name}（Moa Living），主要在 Coupang、Naver 等平台销售家居用品。\n我们对贵司的产品「${r.product}」很感兴趣，首批计划采购 ${r.qty.toLocaleString('ko-KR')} 件。\n麻烦提供：1）含包装的单价 2）最小起订量 3）交货期 4）样品费用及寄送时间。\n期待您的回复，谢谢！`,
    ko: `안녕하세요! 저희는 쿠팡 · 네이버 등에서 생활용품을 파는 한국 커머스 회사 ${space.name}입니다.\n귀사의 「${r.product}」에 관심이 있어 첫 발주로 ${r.qty.toLocaleString('ko-KR')}개를 생각하고 있습니다.\n1) 포장 포함 단가 2) MOQ 3) 납기 4) 샘플 비용과 발송 일정을 알려 주세요.\n답변 기다리겠습니다. 감사합니다!`,
  };
}

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
  const llm = useLlm();
  const [selectedId, setSelectedId] = useState(wf.sourcingRequests[0]?.id ?? '');
  const [inquiries, setInquiries] = useState<Record<string, Inquiry>>({});
  const [drafting, setDrafting] = useState<string | null>(null);
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

  // 고른 공장(없으면 추천 · 첫 공장)에 보낼 중국어 문의 — 키가 있으면 실제 AI, 없거나 실패하면 정해진 문안
  const draftInquiry = () => {
    if (!request) return;
    const target = quotes.find((q) => q.id === chosen) ?? recommended ?? quotes[0];
    const factory = target?.factory ?? '공장';
    const rid = request.id;
    const done = (inq: Inquiry) => {
      setInquiries((cur) => ({ ...cur, [rid]: inq }));
      setDrafting((cur) => (cur === rid ? null : cur));
    };
    setDrafting(rid);
    if (!llm?.configured) {
      window.setTimeout(() => done(templateInquiry(request, factory)), 900);
      return;
    }
    llmChat(
      [
        { role: 'system', content: BUSINESS_CONTEXT },
        {
          role: 'user',
          content: `중국 공장 '${factory}'(1688/알리바바)에 보낼 견적 문의 메시지를 써줘.
상품: ${request.product}, 첫 발주 수량: ${request.qty}개, 우리 판매가: ${request.sellPrice}원.
단가(포장 포함) · MOQ · 납기 · 샘플 비용을 묻고, 정중하지만 짧게(4~5문장).
JSON 하나로만 답해: {"zh": "간체 중국어 메시지", "ko": "같은 내용의 한국어 번역"}`,
        },
      ],
      { maxTokens: 700, temperature: 0.4 },
    )
      .then((text) => {
        const parsed = parseJsonObject<{ zh?: string; ko?: string }>(text);
        if (!parsed?.zh) throw new Error('형식이 맞지 않는 응답');
        done({ factory, zh: parsed.zh, ko: parsed.ko ?? '', model: llm.model });
      })
      .catch(() => done(templateInquiry(request, factory)));
  };

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
            <button className="btn market-action" onClick={draftInquiry} disabled={drafting === request.id || quotes.length === 0}>
              {drafting === request.id ? '쓰는 중…' : '📨 중국어 문의 초안'}
            </button>
          </div>

          {inquiries[request.id] && (
            <div className="inquiry">
              <div className="inquiry-head">
                <strong>{inquiries[request.id].factory} 에 보낼 문의</strong>
                <span className={`chip ${inquiries[request.id].model ? 'is-accent' : ''}`}>
                  {inquiries[request.id].model ? `🤖 AI 작성 · ${inquiries[request.id].model}` : '정해진 문안 (데모)'}
                </span>
                <button className="btn" onClick={() => navigator.clipboard?.writeText(inquiries[request.id].zh)}>
                  중국어 복사
                </button>
              </div>
              <div className="inquiry-body">
                <p lang="zh-Hans">{inquiries[request.id].zh}</p>
                <p className="inquiry-ko">{inquiries[request.id].ko}</p>
              </div>
            </div>
          )}

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
