# 실험 계획 — C2: revealed-preference 재정식화

> **사이클 2** · 검증 가설 **H5** · 상태: 실행 중(2026-07-12)
> **한 줄:** C1 진단(측정 정식화가 틀림)을 정면 검정 — stated intent → *revealed-preference + 종단 retention + 기존제품 애착* 로 바꾸면 유효성(Δ)이 회복되는가.

## 사전 가설 (C1 진단에서 도출)
- **H5**: revealed 재정식화가 stated 대비 Δ를 유의하게 높인다(음→양이면 유효성 회복).
- 진단 3종을 한 프롬프트에 대응: (R1) 행동 퍼널(관심→시도→지속) = 막연한-매력 편향, (R2) 2주~2달 뒤 지속 유료(신선함 감쇠) = 시간 동학, (R3) 기존 애착 대체재 반영 = 브랜드/관계 동학.

## Goal 6필드
| 필드 | 내용 |
|---|---|
| Outcome | revealed framing에서 Δ(성공−실패)가 stated 대비 상승(가능하면 양수) |
| Verification surface | `results_revealed_{general,target}.json` vs C1 `results_{general,target}.json` |
| Constraints | **동일 사례·페르소나 선택·seed·모델** — framing만 변수(공정 비교) |
| Boundaries | 동일 하네스(`--framing revealed`), Qwen2.5-7B |
| Iteration policy | revealed × {general, target} 실행 → Δ 비교 |
| Blocked condition | 파싱 실패 시 pay=0 처리 + 플래그 |

## 방법
`retained_pay`(지속 유료) = 사례 전환. 프롬프트: (1)클릭/관심 (2)비용 치르고 시도 (3)2주~2달 뒤에도 기존 대안 대비 돈 내고 지속? 애착 대체재 있으면 이탈 반영. 최종 `retained_pay`만 집계.

## 예상 판정 규칙 (사전 고정 — p-hacking 방지)
- Δ_revealed > Δ_stated 이면 H5 부분 지지. Δ_revealed > 0 이면 유효성 회복(강). Δ 변화 없거나 하락이면 H5 기각(측정 정식화가 원인 아님 → C3에서 다른 축).
- **결과와 무관하게 보고.**
