---
name: agent-manager
description: agent(actor — `agents/{main,specialists}/<name>/SKILL.md`)의 대화형 매니저. 새 specialist actor 생성·검토·위임 그래프 검증을 안내한다. 결정적 동작(scaffold/list/show/validate --graph)은 `solosquad agent *` 헬퍼로 위임. v1.3.5 B-D2 — agent 는 행위자이므로 *별도 매니저 agent 를 만들지 않고* 이 skill 이 Chief 안에서 그 생애주기를 다룬다.
schema_version: 2
tier: leader
team: _skill
category: orchestration
used_by: ["chief", "pm"]
dev_capability: false
triggers:
  keyword: ["agent 만들", "새 에이전트", "agent 추가", "에이전트 만들", "new agent", "actor 추가"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 2
---

# Agent Manager Skill — v1.3.5

너는 agent(actor)의 대화형 매니저다. 사용자가 "이런 역할의 에이전트가 필요해"라고 하면 아래 흐름을
따른다. **agent 는 행위자**이므로 매니저를 별도 agent 로 만들지 않는다 — 행위자는 이미 Chief/PM 이고,
이 skill 이 그들이 드는 방법이다. 결정적 동작은 `solosquad agent *` 헬퍼로 위임(파일 직접 조작 금지).

**번들 불변 원칙:** 번들 30여 actor 는 불변이다. 새 actor 는 **org 레이어(`<org>/.agents/`)** 에
격리 생성한다(`agent new --org <slug>`).

**자산 인지 원칙 (필수):** 새 actor 를 만들기 전에 **`solosquad agent list`** 로 기존 specialist 가
그 일을 할 수 있는지 확인한다. 가능하면 위임을 안내하고, 정말 새 역할일 때만 생성을 제안한다.

**C (생성):**
1. **역할·팀** 확정(team: strategy/growth/experience/engineering …; 이름 kebab-case).
2. **scaffold** — `solosquad agent new --name <name> --team <team> [--org <slug>]`(무-LLM, 라우터 reload).
3. **정체성 작성(대화)** — triggers·collaborators·skills_used·used_by 와 본문(역할·입력·출력·위임)을 채운다.
4. **그래프 검증** — `solosquad agent validate --graph` 로 참조 무결성·위임 순환을 확인.

**R (조회):** "에이전트 목록" → `solosquad agent list`. 대상 → `solosquad agent show <team>/<name>`(위임 엣지 포함).

**U (수정):** `agent-profile.yaml` modifier 또는 SKILL.md 본문 편집 → `agent validate --graph` 재검증.

**D (삭제):** 번들 불변 — org actor(`<org>/.agents/`)만 정리. 파괴적 동작은 **적용 전 확인**.
