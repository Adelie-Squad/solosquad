# Bundled Workflow Templates (v1.1)

본 디렉토리는 `workflow-manager` skill 이 사용자 의도를 해석할 때 참조하는
사전 정의 workflow 4종. 사용자가 `solosquad workflow new` 또는 chief 가
TRIAGE → DECOMPOSE 에서 호출 시 이 중 가장 적합한 template 을 base로 사용.

| Template | 목적 | hard_gate |
|---|---|---|
| `discovery-cycle/` | PM 자율 문제 정의 6-stage chain | true |
| `pmf-validation/` | Strict PMF gate (Demand Reality → behavior metric) | true |
| `autoplan-pm/` | gstack /autoplan — 4 PM specialist sequential chain | false |
| `weekly-retro/` | 주간 회고 + skill/workflow refinement 제안 | false |

## 사용 방법

1. `workflow-manager` 가 사용자 의도를 분석
2. 본 디렉토리에서 가장 정합 높은 template 선택 (또는 합성)
3. `<org>/workflows/wf-YYYY-MM-DD-<slug>/workflow.yaml` 로 instance 복사
4. `_status.yaml` 생성 + 첫 stage `pending → in_progress`
5. chief-runner 가 stage 진행 관리

## Agent 참조 형식

stages[].agent 는 다음 중 하나:

- `<team>/<specialist>` — e.g. `product/pmf-planner`, `engineering/backend-engineer`
- `_main/<main-bot>` — e.g. `_main/pm`, `_main/chief`, `_main/engineer`
- `_skill/<skill>` — e.g. `_skill/prd-writer` (skill 직접 호출, spawn 없이 leader tier)

## HARD GATE 동작

`hard_gate: true` 인 workflow 는 각 stage 의 `exit_criteria` 통과 시에만
다음 stage 진입. 미달성 시 stage 가 `blocked` 상태로 유지되고 chief 에게
open_questions 가 escalate.

## 참조

- v1.1 PRD §13 (Workflow Templates)
- agentskills.io workflow standard
