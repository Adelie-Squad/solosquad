# Growth Team Session Context

## Team
Growth Team - 사용자 획득, 마케팅, 브랜딩 담당

## Team Knowledge
`agents/_teams/growth/TEAM_KNOWLEDGE.md` 참조

## Project
- PRD: ../prd.md
- Status: ../_status.yaml

## Your Agents
작업 순서에 따라 해당 에이전트의 SKILL.md를 로드하세요:

| 에이전트 | SKILL 경로 | 용도 |
|---------|-----------|------|
| Brand Marketer | `agents/growth/brand-marketer/SKILL.md` | 브랜딩, 톤앤매너 |
| GTM Strategist | `agents/growth/gtm-strategist/SKILL.md` | Go-To-Market 전략 |
| Content Writer | `agents/growth/content-writer/SKILL.md` | 콘텐츠 카피라이팅 |
| Paid Marketer | `agents/growth/paid-marketer/SKILL.md` | 페이드 광고 최적화 |

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
