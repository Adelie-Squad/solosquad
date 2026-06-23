---
name: experiment-design
description: Test spec + metric + gate 조건 + 기간 + variant 정의. data-analyst 의 Confidence Score 모델 입력 가설을 받아 manifest.yaml 생성.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["product-manager"]
dev_capability: false
triggers:
  keyword: ["실험", "experiment", "a/b test", "ab test", "test design"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 2
---

# Experiment Design Skill

> Hypothesis-design 의 후속. recommended hypothesis 를 검증 가능한 실험으로 변환.

## 입력

- recommended hypothesis (XYZ format) from `skills/hypothesis-design`
- team OKR (어떤 KR 에 영향?)

## 산출 — `<org>/experiments/<id>/manifest.yaml`

```yaml
experiment_id: exp-YYYY-MM-DD-<slug>
hypothesis:
  xyz: "[X%] of [Y] will [Z] within [T], because [R]"
  source_pr: "..."

variants:
  - id: control
    description: "current behavior"
    traffic_pct: 50
  - id: treatment
    description: "..."
    traffic_pct: 50

metrics:
  primary:
    name: "..."
    formula: "..."
    direction: increase | decrease
    threshold: "..."
  secondary: [...]
  guardrail: [...]

design:
  type: ab_test | feature_flag | concierge | wizard_of_oz | fake_door
  duration_days: 14
  min_sample: 1000
  power: 0.8
  alpha: 0.05

gates:
  start:
    - "instrumentation verified"
    - "guardrail metrics baselines stable"
  stop_early:
    - "guardrail breach"
    - "primary metric Δ p<0.01 (positive)"
  end:
    - "min_sample reached"
    - "duration reached"

evidence_refs:
  - "<org>/workflows/.../PRD.md"
  - "<org>/memory/open-questions/<task>.json"
```

## ≥ 2 Designs Rule

experiment design 도 항상 ≥2 후보:
- AB test vs concierge MVP
- feature flag vs cohort
- 다른 traffic split

가장 cheap 한 valid design 우선 권고.

## HARD GATE

```markdown
- [ ] primary metric 1개 + threshold + window
- [ ] sample size 충분성 (power=0.8, α=0.05)
- [ ] guardrail metric ≥1 (regression 방지)
- [ ] start/stop/end gate 모두 정의
- [ ] product-designer 검토 (사용자 segment 차별 시)
```

## Reference

- phuryn/pm-skills/pm-execution/brainstorm-experiments
- v1.1 PRD §12.3 (Experiment 인프라)
