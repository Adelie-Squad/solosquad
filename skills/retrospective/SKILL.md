---
name: retrospective
description: Cycle 종료 시 회고 진행. gstack /retro per-contributor breakdown + RO-PNA Confidence Score 갱신. Chief 가 RETROSPECT stage 에서 호출. weekly cron 에서도 호출.
schema_version: 2
tier: leader
team: _skill
category: reflection
used_by: ["chief"]
dev_capability: false
triggers:
  keyword: ["retro", "회고", "retrospective", "주간 회고"]
  slash: ["/retro"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Retrospective Skill

> Chief 가 cycle (workflow / goal / weekly) 종료 시 호출. 객관적 metric + 패턴 식별 + 액션 항목 도출.

## 입력

- 종료된 workflow id / goal id / period (e.g. last 7d)
- `<org>/memory/chief-stage-events.jsonl` — stage 전환 trace
- `<org>/memory/ledger/<task-id>.jsonl` — task event ledger
- `<org>/memory/agent-costs.jsonl` — agent 별 USD 소비
- `<org>/memory/leading-indicators.jsonl` — 누적 지표

## Per-Contributor Breakdown (gstack 차용)

```yaml
per_contributor:
  founder:
    inputs: <N>           # 사용자 메시지 수
    decisions: <N>        # batch 답변 / explicit approval 수
  chief:
    stages_executed: <N>
    open_questions_batched: <N>
  pm:
    spawns: <N>
    design_docs_produced: <N>
    open_questions_resolved: <N>
    avg_confidence: 0-100
  engineer:
    prs_shipped: <N>
    test_coverage_delta: <%>
  designer:
    specs_produced: <N>
    prototypes: <N>
  marketer:
    campaigns: <N>
    content_assets: <N>
```

## Shipping Streak

```yaml
shipping_streak:
  current_days: <N>    # 연속 release / merge 일수
  best: <N>
  threshold: ">=7 stable, <7 yellow"
```

## Confidence Score 갱신

period 내 PM 가설 confidence 평균:
```yaml
avg_confidence:
  start_of_period: 0-100
  end_of_period: 0-100
  delta: <+/->
  reasoning: "string"
```

## 출력

```yaml
period: "..."           # workflow id 또는 ISO 날짜 범위
metrics: { per_contributor, shipping_streak, avg_confidence }
what_worked: ["..."]
what_didn_work: ["..."]
patterns_observed: ["..."]
action_items:
  - { owner: chief|pm|engineer|..., action: "...", target_date: "YYYY-MM-DD" }
followup_skills:
  - skill-refinement     # 호출 권고 시
  - workflow-refinement  # 호출 권고 시
```

## Anti-Sycophancy

- ❌ "잘 한 점이 많네요"
- ✅ "5/7 일 ship 성공. miss 2건 모두 weekend 의존 task. Y 면 weekend 의존 task 분리 권고."

## Reference

- gstack `/retro` per-contributor breakdown
- RO-PNA Confidence Score
- v1.1 PRD §5.2 (Chief RETROSPECT stage)
