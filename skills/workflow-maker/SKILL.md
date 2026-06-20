---
name: workflow-maker
description: Chief 또는 사용자 의도에서 workflow YAML 합성. assets/workflows/ 의 4 template 을 기반으로 instance 생성. v1.0.x meta-skill 의 v1.1 평탄화 버전.
schema_version: 2
tier: leader
team: _skill
category: orchestration
used_by: ["chief", "pm"]
dev_capability: false
triggers:
  keyword: ["workflow", "워크플로우", "make workflow", "new workflow"]
  slash: ["/workflow"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 2
---

# Workflow Maker Skill — v1.1

> Chief 또는 사용자 의도에서 workflow YAML 합성. 신규 workflow 작성 시
> 4 bundled template (assets/workflows/) 중 정합 가장 높은 것을 base 로
> 활용하거나, 다른 template 합성. 구 v1.0.x meta-skill 의 평탄화 (skills/
> 평탄 카탈로그 + agentskills.io 표준).

## 입력

- 사용자 의도 (Chief TRIAGE → DECOMPOSE 의 분류 결과)
- 또는 explicit slash: `/workflow <intent>`

## 4 Bundled Templates

| Template | 트리거 패턴 |
|---|---|
| `discovery-cycle` | PM 자율 문제 정의 ("X 를 어떻게 만들지 분석") |
| `pmf-validation` | PMF gate 시퀀스 ("이게 진짜 시장에 fit 되는지") |
| `autoplan-pm` | 다중 PM specialist 빠른 chain ("일단 전체 plan 한번 만들자") |
| `weekly-retro` | 주간 회고 (weekly cron 호출) |

## 합성 흐름

```
1. Read user intent (텍스트)
2. Score against 4 templates (정합도 0-100)
3. If max score >= 70 → 해당 template 의 stages 복사 후 customize
4. Else → ≥2 approaches:
     a) 가장 가까운 2 template 합성
     b) custom workflow from scratch (handoff_to chain 직접 작성)
   사용자에게 둘 중 선택 의뢰 (Chief 가 open_questions 로 escalate)
5. <org>/workflows/wf-YYYY-MM-DD-<slug>/workflow.yaml 에 저장
6. _status.yaml 생성 + 첫 stage pending → in_progress
```

## 출력

- `<org>/workflows/wf-YYYY-MM-DD-<slug>/workflow.yaml`
- `<org>/workflows/wf-YYYY-MM-DD-<slug>/_status.yaml`
- (선택) handoff template 파일들

## Agent 참조 형식 (v1.1)

stages[].agent:
- `<team>/<specialist>` — e.g. `product/pmf-planner`
- `_main/<main-bot>` — e.g. `_main/pm`, `_main/engineer`
- `_skill/<skill>` — leader tier 직접 호출

## Anti-Sycophancy

- ❌ "좋은 workflow 가 만들어졌습니다"
- ✅ "intent 매칭 점수: discovery-cycle 72, pmf-validation 58. discovery-cycle base 사용. wedge 정의 부족하면 pmf-validation 로 escalate 권고."

## Reference

- 이전: `assets/agents/_meta/workflow-maker/SKILL.md`
- v1.1 PRD §13 (Workflow Templates)
- agentskills.io workflow standard
