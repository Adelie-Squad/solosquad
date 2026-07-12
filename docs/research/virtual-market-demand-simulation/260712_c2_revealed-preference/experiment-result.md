# 실험 결과 — C2: revealed-preference 재정식화

> **판정: H5 부분 지지 후 붕괴** (2026-07-12) · 증거: `reports/logs/results_revealed_{general,target}.json`

## 1. 실행 요약
stated "살래요?" → revealed "2주~2달 뒤에도 기존 대안 대비 돈 내고 지속 사용?"(이진)로 재정식화. **反예측성은 사라졌으나(Δ −0.462→0.000), 모든 사례가 0.000으로 바닥붕괴**(floor). 판별 불가.

## 2. claim inventory
| 주장 | 증거 | 라벨 |
|---|---|---|
| revealed general/target 전 사례 conversion=0.000 | results_revealed_*.json | 확정 |
| 파싱 실패 아님(31/1000, 3.1%) | records 검사 | 확정 |
| retained_pay=0 이유가 진짜("기존 습관·필요성 부족·차별성 낮음") | records reason | 확정 |
| Δ=0.000, dir_acc=0.60은 all-zero+median 임계의 허수 | metrics | 확정 |

## 3. 판정 · 진단
- **H5(revealed가 유효성 회복) 기각 방식이 특이**: 反예측(과대)에서 **바닥붕괴(과소)로 실패 모드가 뒤집힘**.
- **핵심 발견**: 1회성 *이진* 페르소나 willingness는 **양극단(stated=과대·反상관, strict-revealed=과소·바닥)** 사이에서 판별력을 못 가진다. 문제는 framing 방향이 아니라 **이진 판단의 해상도 부재 + 임계 보정 불가**.

## 4. 다음 사이클 (C3)
이진→**연속 확률(0~1)** + 타겟조건화로 해상도를 주면 판별력이 복원되는가(**H6**). 성공 시 실제 제품(토론철·SoloSquad)에 적용.
