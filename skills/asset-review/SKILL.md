---
name: asset-review
description: Asset(agent·workflow·goal·cron) 정의를 정적 validate 이후 LLM 품질 관점으로 검토. 모호한 description·불명확한 위임 경로·측정 불가 exit_criteria·cadence-prompt 불일치를 지적. 사용자나 Chief 가 "리뷰해줘" 요청 시 호출.
schema_version: 2
tier: leader
team: _skill
category: reflection
used_by: ["chief"]
dev_capability: false
triggers:
  keyword: ["asset 리뷰", "리뷰해줘", "asset review", "에이전트 리뷰", "워크플로 리뷰", "cron 리뷰", "스케줄 리뷰"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Asset Review Skill

정적 `validate`(kebab id·순환·참조 무결성)가 잡지 못하는 **품질·판단** 문제를 LLM 관점으로 검토한다.
CLI `solosquad <manager> review` 를 대체하는 대화형 표면 — review 는 비결정적 출력이라 CLI/CI 게이트가
아니라 Chief 와의 대화에서 수행한다(v1.3.2 conversational-first 결정).

## 입력

- **kind**: skill | agent | workflow | goal | cron
- **id/경로**: 검토 대상 (예: `product/pmf-planner`, `flows/weekly-retro/workflow.yaml`)
- (선택) 정적 validate 결과 — 이미 알려진 finding 은 반복하지 않는다.

## 절차

1. 대상 정의를 읽는다(`solosquad agent show <id>` / `workflow show` / 파일 직접).
2. 먼저 `solosquad <manager> validate` 로 정적 검증을 돌려 그 결과를 컨텍스트로 둔다.
3. kind 별 렌즈로 **판단 문제**만 짚는다(정적 규칙이 잡는 건 제외):
   - **skill** — description 이 3인칭·구체적이라 라우팅 가능한가? process 가 실행 가능한가? 단일 목적인가?
   - **agent** — 팀 내 다른 actor 와 역할이 구별되나? 명확한 escalation/handoff 경로가 있나? collaborator 가 과배선 아닌가?
   - **workflow** — 각 stage 의 exit_criteria 가 실제로 측정 가능한가? handoff 순서가 합리적인가? fixed/agentic 선택이 맞나?
   - **goal** — success metric 이 객관적·판정 가능한가? 가드레일(budget/cycles)이 적정한가? modifiable_paths 가 좁게 잡혔나?
   - **cron** — cadence 가 prompt 의도와 맞나? channel 이 kind 에 맞나? prompt 가 무인 실행에 자족적인가?
4. 제안을 severity 로 분류해 제시: **blocker**(고쳐야 함) / **improvement**(권장) / **nit**(사소).

## 출력

- 한 줄 요약 + severity 태그된 actionable 제안 목록.
- anti-sycophancy: 문제가 없으면 "문제 없음"이라고 분명히 말한다 — 억지 제안 금지.

## 비범위

- 정적 규칙으로 잡히는 것(id 형식·순환·깨진 참조)은 `validate` 의 몫. 여기서 반복하지 않는다.
- 자동 수정은 하지 않는다 — 제안만. 적용은 사용자/author 루프가 결정.
