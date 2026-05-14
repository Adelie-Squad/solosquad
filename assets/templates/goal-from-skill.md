---
schema_version: 1
goal_id: "{goal_id}"
org: "{org_slug}"
target_repo: null
cycle_unit: pipeline_pass
---

# Goal: {title}

Auto-generated from a spec-gate SKILL. Stop rule: {stop_when}.

## Metrics
metrics:
  - name: "spec_gate_pass"
    formula: "1.0 if spec_gate_satisfied else 0.0"
    source: "{spec_path}"
    threshold: 1.0
    direction: maximize

## Pipeline
1. {pipeline}

## Budget
time:
  hours: 8
cost:
  per_cycle_usd: 0.50
  total_usd: 5.00

## Termination
- {stop_when}
- spec_gate_pass reaches 1.0 for 3 consecutive cycles
- Time / cost budget exhausted
- 5 consecutive discards (deadlock break)

## Signal Trigger
auto: false
match_keywords: []
