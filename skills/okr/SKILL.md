---
name: okr
description: 분기 OKR 작성·갱신. team/{team}/OKR.md 또는 <org>/teams/{team}/OKR.md 에 기록. Chief 의사결정 (PM 은 입력으로 받음).
schema_version: 2
tier: leader
team: _skill
category: agile
used_by: ["chief"]
dev_capability: false
triggers:
  keyword: ["okr", "분기 목표", "key result", "objective"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 2
---

# OKR Writer Skill

> Chief 의사결정 전용. PM 은 OKR 을 입력 layer (Layer 4a) 로 받지만 작성 권한 없음.

## 작성 원칙

1. **Objective 는 정성** — "우리는 X 를 달성한다"
2. **Key Result 는 정량** — outcome metric (행동/지표), output 아님 (산출물 갯수 아님)
3. **분기당 Objective ≤3, 각 Objective 당 KR ≤5**
4. **KR 은 measurable + time-bound**

## 8 단계 작성 흐름

```
1. 직전 분기 OKR 평가 (KR 달성률 + 미달성 원인)
2. team KNOWLEDGE.md + customer 신호 + PM 가설 묶음 검토
3. Objective 후보 ≥ 2 도출 (post-labeling: 카테고리 강제 안 함)
4. 각 Objective 의 KR 후보 ≥ 3
5. ≥ 2 approaches 비교: 보수 vs 야심 / 단일 vs 분산
6. 사용자 ack (Chief 가 사용자에게 batch 질의)
7. team/{team}/OKR.md 에 작성
8. carry-over / pivot / drop 결정 별도 섹션
```

## HARD GATE: OKR publish 조건

```markdown
- [ ] Objective ≤3, KR ≤5 per Objective
- [ ] 각 KR 에 baseline + target + 측정 방법
- [ ] ≥ 2 boldness levels 비교 (보수 vs 야심)
- [ ] PM 가설과의 정합 확인
- [ ] 사용자 명시적 ack
```

## 출력 형식 (예시)

```markdown
## 2026 Q3 — PMF expansion

### Objective 1
"우리는 솔로 founder 의 첫 30일 가치 경험을 보장한다."

#### Key Results
- KR1: D7 retention 18% → 35%  (측정: archive.sqlite cohort)
- KR2: activation rate 42% → 65% (측정: signup→첫 workflow 비율)
- KR3: 첫 workflow 완료 평균 시간 14d → 5d
```

## Anti-Sycophancy

- ❌ "야심찬 OKR 입니다"
- ✅ "KR1 35% 목표는 D7 retention 의 baseline 18% 대비 +94% 증가 — historical pace 가 +20%/Q. 야심 수준. fallback target 25% 권고."

## Reference

- John Doerr "Measure What Matters"
- phuryn/pm-skills/pm-execution/brainstorm-okrs
- v1.1 PRD §5.3 (Chief 의사결정 권한)
