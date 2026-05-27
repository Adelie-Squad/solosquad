---
name: hypothesis-design
description: XYZ hypothesis + If-Then-Because + V/U/V/F assumption 분류. PM 자체 reasoning. ≥2 approaches 비교 강제.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["pm"]
dev_capability: false
triggers:
  keyword:
    - "가설"
    - "hypothesis"
    - "실험 가설"
    - "if then because"
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 2
---

# Hypothesis Design Skill

## XYZ Hypothesis

```
[X%] of [Y segment] will [Z behavior] within [T period], because [R rationale]
```

상세 schema 는 `skills/problem-definition/assets/05-xyz-hypothesis.md` 참조 (cross-reference).

## If-Then-Because

```
If [intervention] is delivered to [segment]
Then [measurable result] within [period]
Because [causal mechanism]
```

XYZ 보다 가벼운 형식. early-stage exploration 시 사용.

## V/U/V/F Assumption Classifier

각 가설의 핵심 가정을 4 카테고리로 분류 후 위험도 평가:

| 카테고리 | 질문 | 위험 시 검증 방법 |
|---|---|---|
| **V**alue | 사용자가 이 변화로 가치를 얻는가? | concierge MVP, fake door |
| **U**sability | 사용자가 발견/사용 가능한가? | usability test, prototype |
| **V**iability | 비즈니스 / 운영 가능한가? | financial model, capacity check |
| **F**easibility | 기술적으로 가능한가? | technical spike, prototype |

가장 risky assumption 부터 experiment 우선순위 결정.

## ≥ 2 approaches 룰

```yaml
hypotheses:
  - id: h1
    xyz: "..."
    pros: [...]
    cons: [...]
    v_u_v_f_risk: { v: high, u: low, v2: low, f: low }
  - id: h2
    xyz: "..."
    pros: [...]
    cons: [...]
    v_u_v_f_risk: { v: low, u: high, v2: low, f: medium }
recommended: h1
recommendation_rationale: "h1 의 V 위험이 더 testable. h1 fail 시 h2 로 pivot."
```

## HARD GATE: hypothesis → experiment-design 진입 조건

- [ ] ≥2 hypotheses 비교
- [ ] 각 hypothesis 의 V/U/V/F risk 평가
- [ ] recommended + falsification 명시
- [ ] confidence ≥ 60

## Reference

- RO-PNA XYZ format
- David Bland "Testing Business Ideas" — V/U/V/F (V=Value, U=Usability, V=Viability, F=Feasibility)
- gstack approaches ≥2 rule
