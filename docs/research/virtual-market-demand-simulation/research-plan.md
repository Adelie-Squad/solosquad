# 연구 계획 — 가상 시장 수요검증 시뮬레이션의 효과성

> **역할:** "합성 페르소나 시뮬레이션이 **실세계 전환(결제) 행동을 예측**할 수 있는가" 를 증거로 검증.
> 유효 판정 시 → v1.4.3 시뮬레이션 코어 PRD 로 그래듀에이션.
> **운영:** `skills/workflow-manager/assets/workflows/research/research-workflow.md` 의 자율 4h goal 루프로 실행(Ralphthon 3h 무인 구간 포함).
> **작성일:** 2026-07-12 · **상태:** 계획
> **근거:** v1.4.0 Research Workflow 우산(`docs/prd/v1.4.0_research-workflow.md`) — 본 주제는 그 첫 dogfood ·
> [[260712-long-horizon-codex-goals-vs-fable5]] · [[260712-ralphthon-icml-review-and-passing-paper]].

---

## 1. 배경 · 문제의식

AI 코딩으로 제품은 빠르게 나오지만 **비즈니스 가치를 지속 창출하는 제품은 드물다.** 수요 검증
(인터뷰·Fake door·A/B)은 권장되나 시간·인력·자본 제약이 크다. **AI 합성 페르소나**가 대안으로
떠오르지만 **실세계 유효성이 미검증**이다. 이 연구는 그 유효성을 *정면으로 측정* 한다 — 코드로
기능화(v1.4.x)하기 *전에*, 시뮬레이션이 예측력이 있는지부터 증거로 확인한다.

## 2. 핵심 질문 (반증 가능)

**Q:** *"pre-launch 정보만 주어졌을 때, 합성 페르소나 시뮬레이션이 실제 시장의 전환(결제) 방향과
크기를 — 시뮬레이션 없는 baseline 보다 유의미하게 잘 — 예측하는가?"*

> "baseline 보다 잘" 이 핵심. 단순히 "맞췄다" 가 아니라 **시뮬레이션 메커니즘이 예측력을 *추가***
> 하는지가 유효성의 관건(LLM 사전지식만으로 맞추는 것과 구별).

## 3. 가설 목록

| ID | 가설 | 검증 실험 |
|---|---|---|
| **H1 (핵심)** | 시뮬레이션의 go/no-go 방향 예측이 5사례 blind 백테스트에서 **baseline(무시뮬 LLM 추측·base-rate)보다 정확**하다. | `2607xx_5case-blind-backtest` |
| **H2 (캘리브레이션)** | 페르소나별 결제확률 `p_pay` 가 관측 빈도와 **캘리브레이션**된다(ECE 낮음). | `2607xx_calibration` |
| **H3 (메커니즘 귀속)** | 페르소나 조건화·행동 3분류가 예측력의 **실제 원천**이다(ablation 시 성능 하락). | `2607xx_ablation` |
| **H4 (누출 통제)** | 성능이 **사례 암기(memorization)가 아니다** — 익명화본과 원본의 예측 격차가 작다. | `2607xx_leakage-audit` |

## 4. Verification surface — 주제 eval (유효성의 핵심 설계)

> **완료·유효는 증거가 결정한다.** 이 주제의 특성상 "정답이 이미 존재하는 과거 사례" 가 있으므로,
> **blind 백테스트**가 자연스러운 verification surface 다. 아래 5개 장치로 *진짜* 예측인지 보증한다.

- **① Ground truth = 5 실제 사례**(익명화): Dropbox · Zappos · New Coke · IBM · Buffer. 각 사례의
  실제 결과(성공/실패·전환 방향)가 문헌으로 확정돼 있음 → 채점 기준.
- **② Blind + 사전등록(pre-registration):** 시뮬은 **실제 결과를 보지 못한 채** 예측을 먼저 *기록*
  한 뒤 채점. 사후 기준 이동 금지(hindsight 차단).
- **③ 누출 통제(anonymization-as-control):** 사례에서 브랜드·연도·식별정보를 제거해 LLM 이 암기한
  실제 결과를 *검색*하지 못하게 함. 예측 후 de-anonymize 하여 채점. **H4** 로 익명화본 vs 원본
  성능 격차를 측정 → 격차가 크면 "예측이 아니라 암기" 로 판정(유효성 부정).
- **④ Baseline/null model(필수):** (a) 무작위, (b) **무시뮬 LLM 직접 추측**, (c) base-rate.
  시뮬레이션이 이들을 **이겨야** 예측력 *추가* 를 입증(**H1**). ← 유효성의 결정타.
- **⑤ 통계적 검정력 보강:** 사례 5개는 case-level 검정력이 낮음. → **페르소나-레벨**(사례당 수백
  결정)로 캘리브레이션(**H2**)을 측정해 표본 확대 + **leave-one-out** + confidence 정직 서술.

## 5. 통과 rubric — "유효" 판정 bar (실험 전 고정)

| 기준 | 통과선 | 측정 |
|---|---|---|
| **방향 정확도(H1)** | 시뮬 ≥ **4/5** 사례 방향 일치 **AND** baseline 대비 +마진 | blind 백테스트 |
| **baseline 우위(H1)** | ≥ 2개 지표에서 무시뮬 LLM·base-rate 초과 | 대조 실험 |
| **캘리브레이션(H2)** | **ECE ≤ 0.15**(reliability diagram) | 페르소나-레벨 |
| **메커니즘 귀속(H3)** | ablation 시 성능 유의 하락 | 대조 |
| **누출 통제(H4)** | 익명화 vs 원본 성능 격차 ≤ 임계(암기 아님) | leakage audit |
| **리뷰 통과(Track2)** | verifier subagent **overall ≥ 4**(Weak Accept), 4축 각 ≥ 3 | §research-workflow §3 |

- **종합 유효 판정:** H1(방향+baseline 우위) **필수** + H2 캘리브레이션 통과 + H4 누출 통제 통과.
  H3 는 significance/originality 강화(있으면 가점). 전부 충족 시 "유효 → 기능화 권고".

## 6. 실험 로드맵 (자율 사이클 순서)

각 실험 = goal 6필드. 디렉토리 `26xxxx_<name>/`. 시간 안전상 **General Track 1**(A100 미의존).

| 순 | 실험 | 검증 | 산출 |
|---|---|---|---|
| 1 | `2607xx_baseline-and-harness` | 인프라 | 시뮬 코어(행동 3분류·`p_pay`)·baseline 3종·익명화 파이프라인·1사례 sanity |
| 2 | `2607xx_5case-blind-backtest` | **H1** | 5사례 blind 예측 vs 실제 + baseline 대조(방향 정확도·마진) |
| 3 | `2607xx_calibration` | **H2** | 페르소나-레벨 reliability diagram·ECE |
| 4 | `2607xx_ablation` | **H3** | 페르소나 조건화 on/off·행동 3분류 vs binary |
| 5 | `2607xx_leakage-audit` | **H4** | 익명화 vs 원본 성능 격차(암기 편향) |

> 무인 루프는 1→2 를 우선(유효성 본체), 예산 남으면 3→4→5. 예산 소진 시 완료된 것까지로 종결.

## 7. 경계 · 제약 · 정지

- **Constraints(회귀 금지):** seed 고정 **결정성**(재현) · 실제 사례 결과 **미변조** · 예측
  **사전등록 후 불변**(hindsight 금지).
- **Boundaries:** 5 익명화 사례 코퍼스 · 페르소나 데이터셋(v0 시드 세그먼트, Nemotron 류 참고) ·
  LLM(Fable) 호출 · 예산 상한. **외부 데이터 임의 수집 금지**.
- **Blocked condition(무인=플래그):** 사례 실측 수치 부재 → 방향(ordinal)만으로 채점 + `blocked`
  라벨. 페르소나 데이터 부족 → 시드 세그먼트로 진행 + 한계 명시. **사람 대기 없음.**

## 8. epistemic 라벨 규약

모든 결과를 **확정 / 근사 재구성 / 블록 / 불확실** 로 분류(문서1 §1.2). 예: "5사례 방향 4/5 = 확정",
"IBM 사례 전환율 수치 부재 → 방향만 = 근사", "N=5 통계 검정력 = 불확실(한계 명시)".

## 9. 기능화 브리지 (그래듀에이션)

- **유효 시 → 대상 PRD:** `docs/prd/v1.8.0_virtual-market-demand-simulation.md`(기능화).
- **PRD 로 넘길 것:** 캘리브레이션된 `p_pay` 모델 · 통과 rubric(= 그 기능의 eval) · baseline 대비
  마진(효과 크기) · 익명화/누출 통제 규약.
- **사용자 판단 지점:** `final-result.md` 종합 판정 검토 → "유효" 승인 시 v1.4.3 착수.

## 10. 산출물 위치

- 과정: 본 디렉토리(`research-plan.md` · `26xxxx_*/{experiment-plan,experiment-result}.md` · `final-result.md`).
- 최종 paper: `reports/virtual-market-demand-simulation-<26xxxx>.{tex,pdf}` (ICML 4p, §research-workflow §5).
