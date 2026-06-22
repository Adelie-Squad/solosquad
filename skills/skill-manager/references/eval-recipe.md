# Skill eval 검증 레시피 — description 트리거 + output 품질 A/B

> skill-manager 가 skill 을 만들거나 개선한 뒤 **"좋아졌다"를 감이 아니라 측정으로 확인**하는 절차.
> 근거: agentskills.io skill-creation 3-가이드(`260617` Part B.6①②). 자동화 골격: `validator-corpus`/
> `npm run test:corpus`. **자가개선 루프(SkillOpt)의 채점기는 이 eval 이다 — 채점기 없이는 자가개선 없음.**

## 목차
- 1. description 트리거 eval (디스커버리 검증)
- 2. output 품질 A/B (본문 검증)
- 3. 자가개선 루프와의 관계
- 4. eval 적용 판단

---

## 1. description 트리거 eval (디스커버리 검증)
description 이 "필요할 때 켜지고, 아닐 때 안 켜지나"를 정량 측정한다.

- **쿼리 셋:** **20개 = should-trigger 8–10 + should-NOT 8–10**. should-NOT 엔 **near-miss 네거**를
  반드시 포함(키워드는 겹치되 다른 skill 이 맞는 케이스 — 예: CSV-분석 skill 에 "엑셀 *수식* 수정").
- **실행:** 각 쿼리 **×3런 = 60 호출**. **trigger-rate** 계산.
- **판정:** should-trigger 는 rate **>0.5** 통과, should-NOT 은 **<0.5** 통과.
- **overfit 방지:** **train 60% / val 40% 고정 split.** 실패 쿼리의 키워드를 description 에 직박 금지 —
  그 쿼리의 *상위 개념*을 잡아라.
- **반복:** **~5 iteration**, **val 점수 최고본 선택**("the best description may not be the last one").
  매 라운드 1024자 재확인(개선 중 description 은 자라는 경향).
- **SoloSquad 적용:** 우리 `triggers.{slash,keyword,freq}` + description 을 함께 회귀시킨다.

## 2. output 품질 A/B (본문 검증)
본문(절차)이 실제로 결과를 좋게 만드나를 baseline 대비로 측정한다.

- **레이아웃:** `evals/evals.json`(id·prompt·expected·files·assertions) +
  `iteration-N/{with,without}_skill/`(각각 outputs·timing·grading).
- **A/B:** 각 케이스를 **with_skill / without_skill**(또는 이전 버전) 2회. **clean-context**(매 런 새 세션/
  서브에이전트). 버전 비교는 **blind**(출처 숨기고 judge).
- **작게 시작:** 2–3 케이스. **assertion 은 첫 런 *이후* 작성**(미리 X).
- **assertion 품질:** programmatically-verifiable·specific·countable("≥3 recommendations") = 良. "output
  is good"(모호)·exact-phrase(취약) = 不. **"Require concrete evidence for a PASS."** 기계검증은 코드,
  나머지는 LLM-judge.
- **비용도 측정:** `total_tokens`+`duration_ms` 의 **delta**. 휴리스틱 — "+13초인데 pass +50%p = 가치
  있음; 토큰 2배에 +2%p = 아닐 수도." → **품질만이 아니라 품질/비용으로 채택 판단.**
- **패턴 분석:** both 에서 항상 pass 하는 assertion = 가치 은닉 → 제거. both 실패 = 깨진 검증/과난도.
  런 간 high stddev = 모호 지침 → 예시 추가.

## 3. 자가개선 루프와의 관계 (SkillOpt — v1.3.6 P1)
위 두 eval 이 채점기가 되면, 다음 루프를 얹을 수 있다:
**Rollout(현 skill 실행, scored 궤적) → Reflect(성공/실패 *분리* 반영) → Edit(span 단위 patch,
`Lt=4`/floor 2 예산) → Gate(held-out 점수가 best 를 엄격 초과할 때만 채택).**
- **rejected-edit buffer:** 거부된 편집+점수하락을 기록해 재제안 차단(네거티브 신호).
- **protected slow-update:** 본문 내 "내구 규율" 블록은 step-edit 가 못 덮게 보호, epoch 에 기계가 갱신.
- ⚠️ **전제:** 자동 채점기 필요. 없는(주관적) skill 은 정적 게이트(validate + asset-review)로 폴백.

## 4. eval 적용 판단
- **모든 skill**: 최소한 description 트리거 eval §1 은 만들 가치(디스커버리는 보편).
- **검증 가능한 output(코드/포맷/카운트) skill**: §2 A/B + §3 자가개선 후보.
- **주관적 output skill**(문서·전략): §2 는 LLM-judge 로만, §3 자가개선은 보류 — 정적 게이트 의존.
