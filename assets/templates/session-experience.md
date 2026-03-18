# Experience Team Session Context

## Team
Experience Team - 사용자 리서치, UX/UI 디자인 담당

## Team Knowledge
`agents/_teams/experience/TEAM_KNOWLEDGE.md` 참조

## Project
- PRD: ../prd.md
- Status: ../_status.yaml

## Your Agents
작업 순서에 따라 해당 에이전트의 SKILL.md를 로드하세요:

| 에이전트 | SKILL 경로 | 용도 |
|---------|-----------|------|
| User Researcher | `agents/experience/user-researcher/SKILL.md` | 유저 리서치, 페르소나 |
| Desk Researcher | `agents/experience/desk-researcher/SKILL.md` | 시장/경쟁사 리서치 |
| UX Designer | `agents/experience/ux-designer/SKILL.md` | 플로우, IA, 와이어프레임 |
| UI Designer | `agents/experience/ui-designer/SKILL.md` | 비주얼, 디자인 시스템 |

## Current Task
1. `../_status.yaml`에서 이 팀이 담당하는 stage 확인
2. `status: pending`이고 `depends_on`이 모두 `completed`인 stage 찾기
3. 해당 stage에 이전 핸드오프가 있으면 `_handoff.md` 읽기
4. 에이전트 SKILL.md 로드 후 작업 수행

## Output Rules
1. 산출물은 `../stage-N-{{stage_name}}/`에 저장
2. 작업 완료 시 `../stage-N-{{stage_name}}/_handoff.md` 작성 (템플릿: `templates/handoff.md`)
3. `../_status.yaml`에서 해당 stage를 `completed`로 업데이트
4. artifacts 목록 업데이트
