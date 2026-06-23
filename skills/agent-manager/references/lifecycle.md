# actor 생애주기 — launch-your-agent 4페이즈 + 수용 게이트

> Anthropic 1차 빌드 스킬 `launch-your-agent` 의 **interview→stage→grade/iterate→schedule** 4페이즈를
> SoloSquad C/R/U/D 에 사상한다. 핵심 신규축 = **v0 scoping(reason class)** + **수용 게이트 rubric**(CMA
> Outcomes 패턴). 근거: 260618 Part G(G5)·B.6(CMA Outcomes·Scheduled deployment).

## 목차
- 1. Phase 1 — interview (C 의 ①)
- 2. Phase 2 — stage / v0 scoping (C 의 ③, reason class)
- 3. Phase 3 — grade/iterate = 수용 게이트 rubric (C 의 ⑥)
- 4. Phase 4 — schedule (호출 ③층)
- 5. 골든 케이스 regression

---

## 1. Phase 1 — interview (C 의 ①)
**폼이 아니라 클러스터형 enumerable 선택지(AskUserQuestion).** 8클러스터 — job / done(완료 정의) /
inputs / outputs / cadence(빈도) / boundaries(경계) / learning(개선) / shape(단일 vs 멀티).
- 경계는 *맥락에서만* 짧게 묻는다(매 항목 심문 X).
- 사용자 서술이 2~4클러스터를 동시에 답하면 **남은 것만** 묻는다(중복 질문 금지).

## 2. Phase 2 — stage / v0 scoping (C 의 ③ — reason class)
- **v0 = 핵심 일만 하는 최소 actor.** 나머지는 *자르는("cut") 게 아니라* per-agent **NEXT-DIRECTIONS** 에
  즉시 적재 — 각 항목에 **reason class** 부착: `not possible`(현 도구로 불가) / `needs credential`(자격증명
  대기) / `scope`(v1 예정). "v1 예정"으로 명시(폐기 아님).
- 자격증명 없으면 **mock connector**(schema-true outbox) 로 v0 — 실제 연동은 v1.

## 3. Phase 3 — grade/iterate = 수용 게이트 rubric (C 의 ⑥)
**rubric = per-run eval.** CMA Outcomes 의 1차 패턴을 차용:
- **3~6개 binary criterion** — job-specific · agent-checkable · bounded.
- 합격선 질문: **"이 actor 를 *리뷰 없이* spawn 할 자신이 드는가?"** — 미달이면 description/본문 sharpen 후 재검.
- 채점은 가능하면 **격리 컨텍스트**(생성과 분리)에서 pass/fail+사유 → 다음 iteration 피드백
  (`max_iterations` 3~20, CMA 기본 3). 결과 = `satisfied`/`needs_revision`/`max_iterations_reached`.
- 이것이 행동층 refine(SKILL.md §U 3)의 **채점기** — 채점기 없으면 정적 게이트(`validate --graph` + primitive-review)로 폴백.

## 4. Phase 4 — schedule (호출 ③층)
반복 실행 actor 는 `cron-manager` 로 연결:
- **상대 날짜 필수**("today"/"last 14 days" — 리터럴 날짜 금지).
- **manual run 으로 검증한 뒤 cron 커밋**(테스트 없이 스케줄 등록 금지).
- sub-agent archived 시 다음 run 실패 — 그래프 무결성(delegation-graph.md) 사전 확인.

## 5. 골든 케이스 regression
- **골든 케이스 1개로 v0** 합격을 고정, 이후 변경은 그 케이스를 **regression hold**(SkillOpt held-out 의 운영판).
- refine·재작성 후에도 골든 케이스가 깨지지 않아야 채택.
