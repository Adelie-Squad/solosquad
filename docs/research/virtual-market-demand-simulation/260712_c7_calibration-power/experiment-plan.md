# 실험 계획 — C7: 캘리브레이션 검정력 강화 (사례 5→14)

> **사이클 7** · 검증 가설 **H10** · 상태: 실행(2026-07-12)

## 사전 가설
- **H10**: C6 캘리브레이션(LOO 5/5)이 **더 큰 N(14)에서도 유지**된다(chance·raw 상회) → 유효성이 운/과적합이 아니라 일반화.
- 방법: 익명 사례 9개 추가(F~N, 4 성공·5 실패) → stated framing(C6 최강 특징) general 실행 → **14 사례 combined LOO 캘리브레이션**.

## Goal 6필드
| 필드 | 내용 |
|---|---|
| Outcome | 14-사례 LOO 정확도가 chance(≈0.5)·raw(≈0.4) 상회 → 캘리브레이션 일반화 |
| Verification surface | 신규 `results_cases2_stated_general.json` + 기존 `results_general.json` → 14 사례 combined LOO |
| Constraints | 동일 모델·seed·framing(stated) · 익명화 · gt 예측 후 채점 |
| Boundaries | Qwen2.5-7B, 신규 9 사례 |
| Iteration policy | stated general 실행 → combined LOO(단일특징 stump) |
| Blocked condition | LOO ≤ chance면 H10 기각(N=5의 5/5는 소표본 운) → 정직 보고 |

## 판정 규칙 (사전 고정)
14-사례 LOO ≥ 0.75 이면 H10 지지(캘리브레이션 일반화). 0.5~0.75면 부분. ≤0.5면 기각. 결과 무관 보고. **누출(유명 사례 인식) 한계 명시.**
