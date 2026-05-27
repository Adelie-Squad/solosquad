---
name: lean-canvas
description: Lean Canvas (Maurya) + Value Proposition Canvas (Strategyzer) 작성. business-strategist 가 호출. ≥2 model 비교 강제.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["pm", "chief"]
dev_capability: false
triggers:
  keyword: ["lean canvas", "value proposition", "business model", "jtbd canvas"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 2
---

# Lean Canvas Skill

> Tier-2 (v1.1.x slot). business-strategist 가 호출. 솔로 founder 가 빠르게 비즈니스 모델을 1-page 로 압축.

## Lean Canvas — 9 Box

```
+-------------------+-------------------+-------------------+
| 1. Problem        | 4. Solution       | 3. Unique Value   |
|   (top 3)         |                   |   Proposition     |
|                   +-------------------+   (Single-line)   |
|                   | 8. Key Metrics    |                   |
+-------------------+-------------------+-------------------+
| 5. Unfair         | 9. Cost Structure | 2. Customer       |
|   Advantage       |                   |   Segments        |
|                   +-------------------+                   |
|                   | 6. Channels       |                   |
+-------------------+-------------------+-------------------+
                    | 7. Revenue Streams |
                    +-------------------+
```

## Value Proposition Canvas (Strategyzer)

```
Customer side:                      Product side:
- Jobs (functional/social/emotional) - Products & Services
- Pains (frustrations/risks)         - Pain Relievers
- Gains (benefits/aspirations)       - Gain Creators

Fit: Pains ↔ Pain Relievers   +   Gains ↔ Gain Creators
```

## ≥2 Model 비교

각 모델로 동일 사업 표현 후 비교:
- Lean Canvas: 어떤 box 가 가장 약한가?
- VPC: 어떤 fit 이 가장 강한가?
- 둘이 다른 결론 나오면 → conflict 영역 명시

## 출력

```markdown
## Lean Canvas (v1)

1. Problem: ...
2. Customer Segments: ...
3. UVP: "[Single-line value statement]"
4. Solution: ...
5. Unfair Advantage: ...
6. Channels: ...
7. Revenue Streams: ...
8. Key Metrics: ...
9. Cost Structure: ...

## Value Proposition Canvas (v1)
- Jobs / Pains / Gains
- Products & Services / Pain Relievers / Gain Creators
- Fit assessment

## Conflict / Open Questions
- "Lean Canvas Box 7 (revenue) 가 VPC Pains 와 mismatch — 사용자 의향 vs 지불 의향 분리 검증 필요"
```

## HARD GATE

```markdown
- [ ] 9 box 모두 채움 (각 ≤3 항목)
- [ ] UVP single-line + 측정 가능 (NSM 정합)
- [ ] VPC fit assessment 완료
- [ ] ≥2 model 결과 비교 + conflict 명시
```

## Reference

- "Running Lean" by Ash Maurya
- Strategyzer Value Proposition Design
- phuryn/pm-skills/pm-product-strategy/{lean-canvas, value-proposition}
