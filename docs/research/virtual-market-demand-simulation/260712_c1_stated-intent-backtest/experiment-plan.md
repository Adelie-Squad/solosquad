# 실험 계획 — C1: stated-intent blind 백테스트

> **사이클 1** · 검증 가설 **H1**(+H3) · 상태: 완료(2026-07-12)
> **한 줄:** 순진한 1회성 "살래요?" 합성-페르소나 시뮬이 실제 전환을 baseline보다 잘 예측하는가.

## Goal 6필드
| 필드 | 내용 |
|---|---|
| Outcome | 5 익명 사례 blind 백테스트에서 sim 전환이 실제 성공/실패를 방향 예측 |
| Verification surface | `results_{general,target}.json` (200 personas/case, seed 42) — success−fail 분리도 Δ, 방향정확도 |
| Constraints | seed 고정 결정성 · 사례 결과 미변조 · 예측 후 채점(hindsight 금지) |
| Boundaries | Nemotron-Personas-Korea · Qwen2.5-7B-Instruct · 5 사례 |
| Iteration policy | general(무작위) → target(사전 키워드 세그먼트) 2 arm |
| Blocked condition | 매칭 페르소나 부족 시 전체 사용 + 플래그(대기 없음) |

## 방법
페르소나가 각 사례 시나리오에 대해 `would_pay` 확률적 결정 → 사례별 전환율 = mean(would_pay). Baseline = 무-페르소나 LLM 직접 추정. 지표 = 방향정확도 + Δ(성공평균−실패평균).

## 사전 가설
- **H1**: sim 방향정확도 > baseline.
- **H3**: target 조건화가 general보다 예측력 높음.
