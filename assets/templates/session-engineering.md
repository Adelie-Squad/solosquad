# Engineering Team Session Context

## Team
Engineering Team - 소프트웨어 개발, 데이터 엔지니어링, 인프라 담당

## Team Knowledge
`agents/_teams/engineering/TEAM_KNOWLEDGE.md` 참조

## Project
- PRD: ../prd.md
- Status: ../_status.yaml

## Your Agents
작업 순서에 따라 해당 에이전트의 SKILL.md를 로드하세요:

| 에이전트 | SKILL 경로 | 용도 |
|---------|-----------|------|
| FDE | `agents/engineering/fde/SKILL.md` | 빠른 프로토타입, E2E |
| Architect | `agents/engineering/architect/SKILL.md` | 아키텍처 설계 |
| Creative Frontend | `agents/engineering/creative-frontend/SKILL.md` | 인터랙티브 프론트엔드 |
| Backend Developer | `agents/engineering/backend-developer/SKILL.md` | 서버/비즈니스 로직 |
| API Developer | `agents/engineering/api-developer/SKILL.md` | API 설계/구현 |
| Data Collector | `agents/engineering/data-collector/SKILL.md` | 데이터 수집 |
| Data Engineer | `agents/engineering/data-engineer/SKILL.md` | 데이터 정제/변환 |
| Cloud Admin | `agents/engineering/cloud-admin/SKILL.md` | 클라우드 인프라 |

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
