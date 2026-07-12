# 실험 계획 — C5: 종단(temporal) retention 시뮬 (패러다임 전환)

> **사이클 5** · 검증 가설 **H8** · 상태: 실행(2026-07-12) · **패러다임: 1회성 → 시간축**

## 사전 가설
- **H8**: 1회성 *수준*(level)은 appeal 편향이라 판별 실패하지만, **시간에 따른 retention 궤적**은 성공/실패를 판별한다. 실제 성공(반복수요 충족)은 2달 후에도 잔존, 실제 실패(appeal만)는 신선함 소진·이탈로 급감.
- **1차 지표(pre-registered)**: retention level = p_2month의 Δ(성공−실패). **2차**: 감쇠 기울기 slope = p_2month − p_trial의 Δ.
- 근거: C1~C4에서 level은 appeal을 추종해 실패 → *변화율/잔존*이 남은 신호 후보.

## Goal 6필드
| 필드 | 내용 |
|---|---|
| Outcome | p_2month(잔존) 또는 slope의 Δ > 0 (level이 못 한 판별 회복) |
| Verification surface | `results_traj_{general,target}.json` — per-persona [p_trial, p_2week, p_2month] |
| Constraints | 동일 모델·seed·페르소나풀·사례; framing만 종단으로 |
| Boundaries | Qwen2.5-7B, 5 사례, 3 시점(trial/2주/2달) |
| Iteration policy | trajectory × {general,target} → retention·slope Δ 판정 |
| Blocked condition | 파싱 실패 시 해당 persona 제외 + 플래그 |

## 판정 규칙 (사전 고정)
p_2month의 Δ_success−fail > 0 이면 H8 지지(retention이 판별) → 실제 제품에 적용. slope Δ>0도 부분 지지. 둘 다 ≤0이면 H8 기각 → C6(진짜 멀티턴 상호작용/사회 시뮬 or 캘리브레이션). **결과 무관 보고.**
