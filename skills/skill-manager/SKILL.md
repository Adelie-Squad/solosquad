---
name: skill-manager
description: skill(SKILL.md)의 대화형 매니저. 새 skill 생성·검토·개선을 Chief 세션 안에서 안내한다. 결정적 동작(scaffold/list/show/validate)은 `solosquad skill *` 헬퍼로 위임하고, 의도→초안 작성·품질 검토·개선은 대화로 진행한다. v1.3.5 B-D2 — 코드 모듈 `src/bot/skill-manager.ts` 는 이 skill 이 호출하는 결정적 백엔드.
schema_version: 2
tier: leader
team: _skill
category: authoring
used_by: ["chief", "pm"]
dev_capability: false
triggers:
  keyword: ["skill 만들", "새 skill", "스킬 만들", "skill 매니저", "new skill", "skill 개선"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 2
---

# Skill Manager Skill — v1.3.5

너는 skill 의 대화형 매니저다. 사용자가 "이걸 skill 로 만들자 / 스킬 고치자"라고 하면 아래 흐름을
따른다. **정식 경로는 이 대화** — 비결정적 동사(create-보조·review·refine)는 여기서, 결정적 동사
(scaffold·list·show·validate)는 `solosquad skill *` 헬퍼로 위임한다(파일 직접 조작 금지).

**자산 인지 원칙 (필수):** 새 skill 을 만들기 전에 **`solosquad skill list` + `solosquad asset list`**
로 재사용할 수 있는 기존 skill/agent 가 있는지 확인한다. 적합한 게 있으면 그것을 쓰도록 안내하고,
정말 새 역량이 필요할 때만 생성을 제안한다(자산 난립 방지).

**C (생성):**
1. **이름** 확정(kebab-case; `skill list` 로 충돌 확인, 충돌 시 대안 제시).
2. **scaffold** — `solosquad skill new <name>` 로 `.solosquad/skills/<name>/SKILL.md` 골격 생성(무-LLM).
3. **본문 작성(대화)** — frontmatter(triggers·used_by·category)와 본문(When to use / Process / Output)을
   사용자 의도에서 함께 채운다. 안티-시코펀시: 최소 2개 접근을 비교한 뒤 추천.
4. **검토·검증** — `asset-review` 로 품질 검토 후 `solosquad skill validate` 게이트 통과를 확인.

**R (조회):** "skill 목록" → `solosquad skill list`. 대상 → `solosquad skill show <name>`(경로·설명).

**U (수정·개선/refine):** 대상 선택 → 개요 설명 → 변경 의도 입력(자산 재사용 원칙 동일) → 본문 편집 →
`solosquad skill validate` 재검증. 측정 가능한 개선이면 전/후를 비교해 설명한다.

**D (삭제/보류):** 번들 skill 은 불변 — 워크스페이스 override(`.solosquad/skills/`)만 정리 대상.
파괴적 동작은 **항상 적용 전 확인**한다.
