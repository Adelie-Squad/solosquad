---
name: skill-refinement
description: Skill 사용 후 개선 제안. ledger 분석으로 어느 skill 이 자주 실패 / open_question 다발 / 비효율인지 식별. Chief 가 retrospective 후 호출.
schema_version: 2
tier: leader
team: _skill
category: agile
used_by: ["chief"]
dev_capability: false
triggers:
  keyword: ["skill 개선", "skill refinement", "skill 평가"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Skill Refinement Skill

> Chief 자가학습 루프의 일부. 어떤 skill 이 잘 작동하고, 어떤 skill 이 개선 필요한지 평가.

## 입력

- 평가 대상 period
- `<org>/memory/ledger/<task-id>.jsonl` — skill 호출 trace
- `<org>/memory/open-questions/<id>.json` — 미해결/blocking 비율
- `<org>/memory/agent-costs.jsonl` — skill 별 cost

## 평가 차원

```yaml
per_skill_metrics:
  skill_name: <name>
  invocation_count: <N>
  avg_duration_ms: <N>
  avg_cost_usd: <N>
  hard_gate_failure_rate: <%>      # gate 통과 못 한 비율
  open_question_rate: <%>           # 호출당 발생한 open_question 수
  rework_rate: <%>                  # 같은 task 에서 재호출된 비율
  confidence_delta_avg: <+/->       # 호출 전후 confidence 변화
```

## Failure Patterns

```yaml
patterns:
  - skill: problem-definition
    issue: "TDCC P4 단계 unknown 필드 too frequent (62%)"
    root_cause_hypothesis: "archive context 너무 짧음 (avg N=4 entries)"
    fix_candidates:
      - "기본 archive window 확대 (4→8 entries)"
      - "TDCC P4 reasoning step skip threshold 도입"
```

## 출력

```yaml
period: "..."
top_3_high_friction_skills: [...]
top_3_efficient_skills: [...]
refinement_proposals:
  - skill: "..."
    proposal: "..."
    expected_impact: "..."
    effort: small | medium | large
    approval_required: founder | chief_auto
```

## Anti-Sycophancy

- ❌ "skill 들이 잘 작동합니다"
- ✅ "problem-definition 의 P4 단계가 62% 빈도로 unknown 필드 발생. archive context 확대로 개선 가능 (예상 -30%)."

## Reference

- v1.1 PRD §5.2 RETROSPECT + §1.1 #7 (자가학습 메커니즘)
