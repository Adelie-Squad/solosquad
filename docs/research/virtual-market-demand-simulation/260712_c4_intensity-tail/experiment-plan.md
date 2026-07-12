# 실험 계획 — C4: 강도/꼬리 통계 (평균이 아니라 분포)

> **사이클 4** · 검증 가설 **H7** · 상태: 실행(2026-07-12) · **GPU 불요**(기존 graded 로그 재분석)

## 사전 가설 (C3 진단에서 도출)
- **H7**: 판별 신호는 페르소나 전환의 *평균*이 아니라 **분포의 강도/꼬리**에 있다. 니치 성공 제품(A·E)은 대중 평균은 낮아도 **소수의 강한 수요층(high-intensity minority)**을 가지며, 광범위-매력 실패(C·D)는 강한 층 없이 미지근한 다수를 가진다.
- **1차(pre-registered) 통계**: high-intensity 비율 = P(pay_prob > 0.7). (니치 = 소수 강한 수요라는 이론적 근거)
- **탐색적(2차, 다중비교 caveat)**: P(>0.5), top-10% 평균, std, max.

## Goal 6필드
| 필드 | 내용 |
|---|---|
| Outcome | 어떤 분포 통계가 Δ(성공−실패) > 0 (평균이 실패한 판별을 회복) |
| Verification surface | `reports/logs/results_graded_{general,target}.json` per-persona pay_prob 재집계 |
| Constraints | 데이터 재사용(재실행 없음), 동일 seed 로그 · 1차 통계 사전지정(p-hacking 방지) |
| Boundaries | 로컬 분석, 기존 로그만 |
| Iteration policy | 1차 통계 판정 → 탐색적 통계는 caveat와 함께 보고 |
| Blocked condition | 어떤 통계도 Δ>0 아니면 H7 기각 → 1회성 시뮬 최종 무효 결론 |

## 판정 규칙 (사전 고정)
1차 통계 P(>0.7)의 Δ_success−fail > 0 이면 H7 지지(판별 회복). 성공 시 실제 제품(토론철·SoloSquad)에도 같은 강도 통계 적용. 결과 무관 보고.
