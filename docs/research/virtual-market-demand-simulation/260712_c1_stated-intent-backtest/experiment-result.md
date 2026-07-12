# 실험 결과 — C1: stated-intent blind 백테스트

> **판정: H1 기각 · H3 기각** (2026-07-12) · 증거: `reports/logs/results_{general,target}.json`

## 1. 실행 요약
5 익명 사례 × 200 페르소나, stated "살래요?". sim이 baseline을 못 이길 뿐 아니라 **反예측적** — 실제 성공이 실제 실패보다 낮은 전환을 받음.

## 2. claim inventory (주장 → 증거)
| 주장 | 증거 | 라벨 |
|---|---|---|
| general Δ = −0.462 | results_general.json metrics | 확정 |
| target Δ = −0.494 (악화) | results_target.json metrics | 확정 |
| dir_acc general 0.40, target 0.20, baseline 0.40 | 두 파일 metrics | 확정 |

## 3. 사례별 전환 (gt: 1=성공)
| | GT | general | target |
|---|---|---|---|
| A 파일동기화 | 1 | 0.185 | 0.295 |
| B 온라인신발 | 1 | 0.185 | 0.305 |
| C 콜라재배합 | 0 | 0.625 | 0.670 |
| D 음성받아쓰기 | 0 | 0.545 | 0.735 |
| E 소셜예약 | 1 | 0.000 | 0.025 |

## 4. 판정 · 진단
- **H1 기각**: 反예측(Δ<0). **H3 기각**: target이 오히려 Δ 악화.
- 진단 3종: ⑴막연한-매력 편향 ⑵시간·관계 동학 부재(브랜드 애착 C·사용피로 D) ⑶반직관적 실수요(A·E 타겟 제품).

## 5. 한계
N=5 저검정력 · 단일 7B · 1회성 · 키워드 타겟.

## 6. 다음 사이클 (C2)
진단이 "측정 정식화(stated intent)가 틀렸다"를 가리킴 → **C2 가설**: revealed-preference + 종단 retention + 기존제품 애착을 반영한 재정식화가 유효성을 회복하는가.
