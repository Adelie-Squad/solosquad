# Orchestrator Session Context

## Role
이 세션은 **조율 전용**입니다. 에이전트 작업을 직접 수행하지 않고, 워크플로우를 관리합니다.

## Project
- PRD: ../prd.md
- Status: ../_status.yaml
- Changelog: ../_changelog.md

## Your Responsibilities
1. `_status.yaml`를 확인하여 현재 Phase와 각 stage 상태 파악
2. 다음에 실행할 팀 세션을 사용자에게 안내
3. 병렬 실행 가능한 세션은 동시 실행 안내
4. 세션 완료 후 `_handoff.md`를 읽고 핵심 내용 요약
5. 수정 요청 시 영향 받는 stage 식별 및 `_status.yaml` 업데이트
6. `_changelog.md`에 변경 이력 기록

## Current Phase
`_status.yaml` 확인 후 현재 Phase를 파악하세요.

## How to Proceed
```
1. _status.yaml에서 status: pending이고 depends_on이 모두 completed인 stage 찾기
2. 해당 stage의 team 확인
3. 같은 phase의 stage는 병렬 실행 가능
4. 사용자에게 세션 실행 안내
5. 완료 보고 받으면 _handoff.md 확인 후 다음 Phase 안내
```

## Session Commands for User
```bash
# 팀 세션 시작 (사용자에게 안내할 명령어)
cd {{project_root}}
claude "projects/{{project_id}}/sessions/{{team}}/CLAUDE.md 읽고 작업 시작"
```
