---
name: workflow-refinement
description: Workflow 종료 시 개선 제안. stage 의존성 / handoff 효율 / 평균 cycle time 분석. Chief 가 RETROSPECT 에서 호출.
schema_version: 2
tier: leader
team: _skill
category: reflection
used_by: ["chief"]
dev_capability: false
triggers:
  keyword: ["workflow 개선", "workflow refinement"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Workflow Refinement Skill

> Workflow 종료 시 어떤 stage 가 bottleneck 인지, 어떤 handoff 가 정보 손실 큰지 식별.

## 입력

- 종료된 workflow id
- `<org>/workflows/<id>/_status.yaml`
- `<org>/workflows/<id>/stage-*/handoff_*.md`
- `<org>/memory/ledger/<task-id>.jsonl`

## 분석 차원

```yaml
per_stage:
  - stage_id: "..."
    duration_min: <N>
    spawns: <N>
    open_questions: <N>
    handoff_artifact_size_lines: <N>
    next_stage_blocked_min: <N>   # 다음 stage 시작까지 대기 시간

bottlenecks:
  - "stage-3-design (75% of total cycle time)"

handoff_quality:
  - from_stage: "stage-2-plan"
    to_stage: "stage-3-design"
    fidelity: high | medium | low   # 다음 stage 가 추가 질문 없이 시작했는지
    issues: ["..."]
```

## 출력

```yaml
workflow_id: "..."
cycle_time_total: <min>
bottleneck_stages: [...]
handoff_issues: [...]
refinement_proposals:
  - target: stage-3-design
    proposal: "researcher → ux-designer 사이에 explicit handoff template 도입"
    expected_impact: "다음 stage 평균 대기 -40%"
    effort: small
```

## ≥ 2 approaches (gstack)

각 proposal 에 대안 1개 이상.

## Anti-Sycophancy

- ❌ "workflow 가 매끄럽게 진행되었습니다"
- ✅ "stage-3 평균 4시간 대기. 원인 = handoff 누락. fix A vs B 비교."

## Reference

- v1.1 PRD §5.2 RETROSPECT
