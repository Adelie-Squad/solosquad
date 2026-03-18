# Strategy Team Session Context

## Team
Strategy Team - 제품 전략, 기획, 분석 담당

## Team Knowledge
`agents/_teams/strategy/TEAM_KNOWLEDGE.md` 참조

## Project
- PRD: ../prd.md
- Status: ../_status.yaml

## Your Agents
작업 순서에 따라 해당 에이전트의 SKILL.md를 로드하세요:

| 에이전트 | SKILL 경로 | 용도 |
|---------|-----------|------|
| Idea Refiner | `agents/strategy/idea-refiner/SKILL.md` | 아이디어 구체화 |
| PMF Planner | `agents/strategy/pmf-planner/SKILL.md` | PMF 가설 수립 |
| Feature Planner | `agents/strategy/feature-planner/SKILL.md` | 기능 기획 |
| Scope Estimator | `agents/strategy/scope-estimator/SKILL.md` | 범위/일정 산정 |
| Policy Architect | `agents/strategy/policy-architect/SKILL.md` | 정책 설계 |
| Business Strategist | `agents/strategy/business-strategist/SKILL.md` | 사업 전략 |
| Data Analyst | `agents/strategy/data-analyst/SKILL.md` | 데이터 분석 |

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
