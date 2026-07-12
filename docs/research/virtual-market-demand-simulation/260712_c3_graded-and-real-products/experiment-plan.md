# 실험 계획 — C3: 연속확률(graded) + 실제 제품 적용

> **사이클 3** · 검증 가설 **H6** + 실제 제품 forward 예측 · 상태: 완료(2026-07-12)

## 사전 가설
- **H6**: 이진 붕괴(C2)를 넘어, **연속 확률(0~1 "유료 지속고객이 될 확률")** + 타겟조건화가 판별력(Δ>0)을 회복한다.
- **실제 제품 적용**: 회복 시 **토론철·SoloSquad**(실제 제품, ground truth 없음)에 forward 수요 예측.

## Goal 6필드
| 필드 | 내용 |
|---|---|
| Outcome | graded framing에서 Δ가 양수로 회복(판별) → 실제 제품에 신뢰 적용 |
| Verification surface | `results_graded_{general,target}.json`(백테스트 Δ) + `results_products_graded_*`(제품 p_pay) |
| Constraints | 동일 모델·seed·페르소나풀; 제품은 gt 없음 → 지표 생략, p_pay만 |
| Boundaries | Qwen2.5-7B; 제품 시나리오는 Notion 원문 기반(토론철) + 프로젝트 맥락(SoloSquad) |
| Iteration policy | graded × {general,target} 백테스트 → 판별 확인 → 제품 예측 |
| Blocked condition | 판별 실패 시 제품 예측은 "신뢰불가" 명시(과장 금지) |

## 판정 규칙 (사전 고정)
Δ_graded > 0 이면 유효성 회복 → 제품 예측 신뢰. Δ_graded ≤ 0 이면 H6 기각 → 제품 예측은 illustration only + 무효 caveat.
