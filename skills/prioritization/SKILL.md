---
name: prioritization
description: 9 framework (RICE/ICE/Kano/Opportunity Score/MoSCoW/Weighted/Eisenhower/Value-vs-Effort/Cost-of-Delay) 비교 후 컨텍스트 맞춤 selection + 계산.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["pm", "chief"]
dev_capability: false
triggers:
  keyword:
    - "우선순위"
    - "prioritization"
    - "rice"
    - "ice"
    - "kano"
    - "moscow"
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Prioritization Skill

## 9 Framework 매트릭스

| Framework | 형식 | 적용 컨텍스트 |
|---|---|---|
| **RICE** | (Reach × Impact × Confidence) / Effort | 분기 로드맵, 기능 우선순위 |
| **ICE** | (Impact + Confidence + Ease) / 3 | 빠른 직관 비교, ≤10 후보 |
| **Kano** | Must-have / Performance / Excitement / Indifferent / Reverse | 신규 기능 분류 |
| **Opportunity Score** | Importance × (1 - Satisfaction) | Discovery 단계, unmet need |
| **MoSCoW** | Must / Should / Could / Won't | Release 단위 분류 |
| **Weighted** | Σ (weight × score) | 다기준 의사결정 (technical + business) |
| **Eisenhower** | Urgent × Important 2×2 | Solo founder 일정 |
| **Value vs Effort** | 2×2 matrix | quick wins 식별 |
| **Cost of Delay** | $$ / week | 의존성 / 시간민감 작업 |

## Framework 선택 가이드 (post-labeling)

PM 이 후보 framework 를 직접 처방하지 않고, 컨텍스트에서 *어떤 분류가 자연스러운지* 식별:

- 후보가 N≥20 → **RICE**
- 후보가 N≤10 + 빠른 비교 → **ICE**
- discovery 단계, unmet need 발굴 → **Opportunity Score**
- release scope 결정 → **MoSCoW**
- 신규 vs 기존 mix → **Kano**
- 시간 민감 / 의존성 → **Cost of Delay**

## 계산 예시 (RICE)

```yaml
candidates:
  - title: "feature A"
    reach: 1000        # 분기 영향 사용자 수
    impact: 2          # 0.25 / 0.5 / 1 / 2 / 3 scale
    confidence: 0.7    # 0-1
    effort: 2          # person-month
    rice_score: 700    # (1000 * 2 * 0.7) / 2

  - title: "feature B"
    reach: 500
    impact: 3
    confidence: 0.5
    effort: 1
    rice_score: 750
```

## 출력

```json
{
  "framework_used": "RICE",
  "framework_rationale": "후보 23개 → RICE 적합",
  "ranked": [
    { "id": "feature-B", "score": 750, "rank": 1 },
    { "id": "feature-A", "score": 700, "rank": 2 }
  ],
  "recommended": ["feature-B"],
  "deferred": ["feature-X"]
}
```

## Anti-Sycophancy

- ❌ "feature B 가 더 좋아 보입니다"
- ✅ "feature B 가 RICE 750 으로 1위. effort < 2 인 조건에서. effort 가 1.5 이상으로 재추정되면 feature A 가 1위로 역전."

## Reference

- phuryn/pm-skills/pm-execution/prioritization-frameworks (9 framework)
- Intercom RICE framework
- Kano model
