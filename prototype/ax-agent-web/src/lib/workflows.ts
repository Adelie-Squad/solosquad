import {
  CHANNEL_FEE_RATE,
  CNY_TO_KRW,
  type FactoryQuote,
  type SourcingRequest,
  type WorkflowId,
} from '../data/dummy';
import type { FinanceState, WorkflowState } from '../workspace-context';

/** 워크플로우별 '확인 필요' 건수 — 카드 배지와 사이드바 배지가 같은 숫자를 쓴다 */
export function attentionFor(id: WorkflowId, wf: WorkflowState, finance: FinanceState): number {
  if (id === 'finance') return finance.ledger.filter((l) => l.needsReview).length;
  if (id === 'sns') return wf.snsPosts.filter((p) => p.status === 'review').length;
  // 상품 소싱 — 견적이 왔는데 아직 공장을 안 고른 요청 + 전화가 필요한 공장
  const undecided = wf.sourcingRequests.filter((r) => r.status === 'quoted' && !wf.chosenQuote[r.id]).length;
  const calls = wf.quotes.filter((q) => q.contact === 'call').length;
  return undecided + calls;
}

/** 개당 들어오는 원가 = 공장 단가(원 환산) + 해외 운송 · 관세 · 입고 */
export function landedCost(q: FactoryQuote, r: SourcingRequest): number {
  return Math.round(q.unitCny * CNY_TO_KRW + r.landingPerUnit);
}

/** 판매가에서 채널 수수료와 원가를 뺀 마진율, 0–100 */
export function quoteMargin(q: FactoryQuote, r: SourcingRequest, sellPrice = r.sellPrice): number {
  const net = sellPrice * (1 - CHANNEL_FEE_RATE) - landedCost(q, r);
  return (net / sellPrice) * 100;
}
