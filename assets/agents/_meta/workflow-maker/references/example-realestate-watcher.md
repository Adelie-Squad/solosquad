# Example — Real Estate Watcher author conversation

Canonical worked example for the §5.2-5.3 author loop. Read this when a user asks for a similar recurring monitoring task.

---

## Turn 1 — user intent

> 사용자: "이런 작업 자주 하니까 자동화하고 싶다 — 매주 등기부 알림 보고서 만들어줘"

PM classifies this as "create a new SKILL". Routes into `workflow-maker`.

## Turn 2 — PM asks the §5.2 trio in one message

> PM: 이 작업을 자동화하려고 합니다. 몇 가지만 확인할게요.
>
> 1. 입력은 무엇인가요? (예: 등기부 API 응답 / 수동 입력 데이터 / 다른 에이전트 출력)
> 2. 출력 형태는? (예: 메신저 알림 / Markdown 리포트 / JSONL)
> 3. 매주 자동 실행되어야 하나요, 아니면 사용자가 트리거해야 하나요?

## Turn 3 — user answers

> 사용자: 1) 등기부 OpenAPI 응답, 2) 메신저 알림 + Markdown, 3) 매주 월요일 자동

## Turn 4 — PM presents the draft

> PM: 아래로 생성하려고 합니다. 확정할까요?
>
> ```yaml
> ---
> name: "realestate-watcher"
> description: "등기부 OpenAPI 응답에서 신호를 추출해 주간 Markdown 리포트 + 메신저 알림 생성"
> team: strategy
> stateful: false
> triggers:
>   explicit: true
>   keyword: ["등기부 알림", "real estate watcher"]
> inputs:
>   required: [data_source]
>   optional: [time_range]
> outputs:
>   - realestate-weekly.md
>   - messenger_alert.txt
> scope: agent
> confidence: 1.0
> source: messenger-author-2026-05-14
> ---
>
> # Real Estate Watcher
>
> > 매주 등기부 OpenAPI 응답을 받아 신호를 분류하고 Markdown 리포트 + 메신저 알림을 생성합니다.
>
> ## Process
>
> 1. 등기부 응답을 정규화 (지번 / 등기 종류 / 일자).
> 2. 변경 신호 추출 — 매매 / 압류 / 가등기 등.
> 3. Markdown 리포트 작성 + 메신저용 1줄 요약 생성.
>
> ## Inputs
>
> - data_source: 등기부 OpenAPI endpoint URL or cached JSON path.
> - time_range: 분석 윈도우 (default: 최근 7일).
>
> ## Outputs
>
> - realestate-weekly.md
> - messenger_alert.txt
> ```
>
> 저장 위치: `<org>/.agents/strategy/realestate-watcher/SKILL.md`
>
> 매주 월요일 09:00 cron으로 자동 등록하시려면 `routines/realestate-weekly.md`도 함께 생성합니다.
>
> 승인 (y/N):

## Turn 5 — user `y`

Applier writes SKILL.md atomically, rebuildRoutes() reloads. PM reports paths back.

> PM: 저장 완료. 라우터를 reload 했습니다.
>
> - SKILL.md: `<org>/.agents/strategy/realestate-watcher/SKILL.md`
>
> 다음에 "등기부 알림" 키워드를 메시지에 포함하면 자동 라우팅됩니다.

---

## Notes

- This run consumed 4 LLM calls (clarify-question, clarify-interpret, draft, sandbox-skipped). Total budget impact recorded to `<org>/memory/author-costs.jsonl`.
- No `loop_mode.spec-gate` was set because the task has no "definitive completion" — it's a recurring monitor, not a goal-runner target.
- If the user had asked for sandbox preview, the dry-run step would have appended an additional `sandbox-dryrun` cost row.
