# 백테스트 설계 예시 (golden) — blind · 누출통제 · baseline · Δ/LOO

> 이 워크플로의 실험(stage-3)이 "예측이 유효한가"를 재현 가능하게 채점하는 표준 설계.
> `research/subject-template/` 로 새 주제를 만들 때 이 골격을 복제한다. dogfood 실증:
> `docs/research/virtual-market-demand-simulation/`(가상 시장 수요검증 시뮬, 8사이클).

## 언제 쓰나
"정답이 이미 존재하는 과거 사례"가 있는 예측 주제 (수요검증·전환예측·성패 분류 등).
과거 N개 사례를 대상으로 예측기가 **실제 결과를 재현**하는지 측정한다.

## 5개 유효성 장치 (없으면 결과 무효)
1. **Ground truth** — 결과가 문헌으로 확정된 실제 사례 N개.
2. **Blind + 사전등록** — 예측기는 실제 결과를 못 본 채 예측을 *먼저 기록*, 그 뒤 채점(hindsight 차단).
3. **누출 통제(anonymization)** — 사례에서 브랜드·연도·식별정보 제거 → 모델이 암기한 결과를 *검색* 못 하게.
   예측 후 de-anonymize 하여 채점. 익명화본 vs 원본 성능 격차 측정 → 크면 "예측 아니라 암기".
4. **Baseline/null model** — (a) 무작위 (b) 모델 직접 추측(예측기 메커니즘 없이) (c) base-rate.
   예측기가 이들을 **이겨야** 메커니즘의 예측력 *추가* 를 입증.
5. **검정력 보강** — N이 작으면 개체-레벨(사례당 수백 결정)로 캘리브레이션·leave-one-out(LOO) + confidence 정직 서술.

## 지표 (수치 eval, 사전 고정)
- **분리도 Δ = mean(성공) − mean(실패)** : Δ>0 예측적, Δ<0 反예측(정직히 보고).
- **directional accuracy** : 임계 예측 vs GT.
- **LOO 정확도** : 소량 실측으로 sim→real 매핑 학습 후 hold-out 예측(캘리브레이션 회복 측정).
- **ECE** : 확률 예측의 캘리브레이션.

## 정직성 규율 (필수)
- **날조 0** — 모든 수치는 실제 run/log 앵커. 튜닝으로 결과 맞추기(p-hacking) 금지.
- **자기교정** — 소표본 낙관을 큰 N으로 재검(예: N=5 완벽 → N=14 부분). 실패 축은 "실패"로 기록.
- **판정** — Δ·LOO를 사전등록 rubric 임계와 대조. 미달이면 다음 사이클 가설로(stage-2 확산).

## 최소 코드 골격 (언어무관 의사코드)
```
cases = load_anonymized(ground_truth)      # blind: 결과 격리
preds = predictor.predict(cases)           # 사전등록(기록 후 불변)
base  = baselines(cases)                    # 무작위·직접추측·base-rate
score = compare(preds, reveal(ground_truth))  # Δ, dir-acc, ECE
loo   = leave_one_out_calibrate(preds, labels) # 캘리브레이션 회복
report(score, loo, honest_limitations)     # reports/ 에 저장
```
