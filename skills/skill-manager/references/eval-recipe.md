# Skill eval — 운영 상세 (core §8 골격의 skill 판)

> **eval 골격·적용 판단은 `skills/skill-core/core.md` §8**(① description 트리거 eval + ② output 품질 A/B,
> 그리고 "채점기 없이는 자가개선 없음"). 이 파일은 그 골격을 **skill 에서 어떻게 돌리는가**의 운영 상세다 —
> corpus 레이아웃·`evals.json` 구조·SkillOpt 자가개선 루프 기계. 근거: agentskills.io skill-creation
> 3-가이드(`260617` Part B.6①②), SkillOpt(`260617` Part F). 자동화: `validator-corpus`/`npm run test:corpus`.

## 1. description 트리거 eval — 운영 (골격 = core §8 ①)
- **쿼리 셋:** 20개 = should 8–10 + should-NOT 8–10. should-NOT 엔 **near-miss 네거** 필수(키워드 겹치되
  다른 skill 이 맞는 케이스 — 예: CSV-분석 skill 에 "엑셀 *수식* 수정").
- **실행:** 각 쿼리 ×3런 = 60 호출 → trigger-rate. 판정 should>0.5 / should-NOT<0.5.
- **overfit 방지:** train 60% / val 40% 고정 split, ~5 iteration, **val 최고본 선택**("best ≠ last").
  실패 쿼리 키워드 직박 금지 → 상위 개념을 잡는다. 매 라운드 1024자 재확인.
- **SoloSquad 적용:** `triggers.{slash,keyword,freq}` + description 을 함께 회귀.

## 2. output 품질 A/B — 운영 (골격 = core §8 ②)
- **레이아웃:** `evals/evals.json`(id·prompt·expected·files·assertions) + `iteration-N/{with,without}_skill/`
  (outputs·timing·grading).
- **A/B:** 각 케이스 with_skill / without_skill(또는 이전 버전) ×2. **clean-context**(매 런 새 세션/서브에이전트).
  버전 비교는 **blind**(출처 숨김).
- **작게 시작:** 2–3 케이스. **assertion 은 첫 런 *이후*** 작성(미리 X). programmatically-verifiable·specific·
  countable(良) / "output is good"·exact-phrase(不). "Require concrete evidence for a PASS."
- **비용 delta:** `total_tokens`+`duration_ms` → 품질만이 아니라 품질/비용으로 채택 판단.
- **패턴 분석:** both 항상 pass = 가치 은닉(제거) · both 실패 = 깨진 검증/과난도 · high stddev = 모호(예시 추가).

## 3. SkillOpt 자가개선 루프 (v1.3.6 §3.5① 행동층 — 채점기 갖춘 skill 부터)
위 두 eval 이 채점기가 되면 다음을 얹는다:
**Rollout(현 skill 실행, scored 궤적) → Reflect(성공/실패 *분리* 반영) → Edit(span 단위 patch, `Lt=4`/floor 2
예산) → Gate(held-out 점수가 best 를 *엄격* 초과할 때만 채택).**
- **rejected-edit buffer:** 거부된 편집+점수하락 기록 → 재제안 차단(네거티브 신호).
- **protected slow-update:** 본문 "내구 규율" 블록은 step-edit 가 못 덮게 보호, epoch 에 기계가 갱신.
- **1차 패턴 = CMA Outcomes**(격리 rubric 채점기, `max_iterations` 3/20, `satisfied`/`needs_revision` 결과) —
  held-out gate 자체 구현 전 rubric 3~6 binary·격리 컨텍스트 패턴 차용 가능(260618 §B.6).
- ⚠️ **전제:** 자동 채점기 필요. 없는(주관적) skill 은 정적 게이트(validate + primitive-review)로 폴백.
