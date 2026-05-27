---
name: opportunity-tree
description: Teresa Torres OST (Opportunity Solution Tree) + gstack Six Forcing Questions 자가검증. outcome → opportunity → solution → experiment 매핑. PM 자체 reasoning, 사용자 Q&A 안 함.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["pm"]
dev_capability: false
triggers:
  keyword:
    - "ost"
    - "opportunity solution tree"
    - "기회 트리"
    - "outcome"
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 2
---

# Opportunity Tree Skill

> Teresa Torres CDH (Continuous Discovery Habits) 의 OST 자체 실행. Outcome 에서 시작해 opportunity, solution, experiment 까지 트리 형태로 분해.

## 구조

```
Outcome (team OKR 의 KR)
  └─ Opportunity 1 (사용자 unmet need)
      ├─ Solution 1.1
      │   └─ Experiment 1.1.a
      └─ Solution 1.2
          └─ Experiment 1.2.a
  └─ Opportunity 2
      ├─ Solution 2.1
      └─ Solution 2.2
```

## 입력

- team OKR (Layer 4a)
- `discovery-synthesis` 출력 (JTBD signals)

## Six Forcing Questions (gstack 차용) — 자가검증 체크리스트

각 opportunity / solution 에 대해 PM 이 스스로 답해본다. 답할 수 없으면 → `open_questions[]`:

1. **Demand Reality**: "사용자가 진짜 원하는가, 흥미만 표현하나?"
   - Interest is not demand.
2. **Status Quo**: "현재 사용자가 이미 어떻게 해결하나?"
   - Status quo is your real competitor.
3. **Desperate Specificity**: "Y segment 가 X 를 *지금* 절박하게 원하나?"
4. **Narrowest Wedge**: "가장 좁고 깊은 진입점은?"
5. **Observation & Surprise**: "예상 못한 패턴 발견했나?"
6. **Future-Fit**: "이 솔루션이 6개월 뒤에도 유효한가?"

## 출력

```json
{
  "outcome": "OKR KR 인용",
  "tree": [
    {
      "opportunity": "...",
      "jtbd_ref": "...",
      "six_questions": {
        "demand_reality": "...",
        "status_quo": "...",
        "desperate_specificity": "...",
        "narrowest_wedge": "...",
        "observation": "...",
        "future_fit": "..."
      },
      "solutions": [
        {
          "title": "...",
          "approach": "...",
          "experiments": [
            { "spec": "...", "metric": "...", "expected": "..." }
          ]
        }
      ]
    }
  ],
  "open_questions": [...]
}
```

## HARD GATE

- [ ] Six Forcing Questions 6 항목 모두 자가응답 또는 open_question
- [ ] Opportunity 당 Solution ≥2 (gstack rule)
- [ ] Solution 당 Experiment ≥1

## Anti-Sycophancy

- ❌ "이 opportunity 가 흥미롭습니다"
- ✅ "이 opportunity 는 demand 신호 N건, status quo 분석 Y. Z 가 사실로 드러나면 우선순위 낮춤."

## Reference

- Teresa Torres "Continuous Discovery Habits"
- gstack `/office-hours` Six Forcing Questions
- phuryn/pm-skills/pm-product-discovery/opportunity-solution-tree
