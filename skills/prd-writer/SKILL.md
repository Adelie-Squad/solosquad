---
name: prd-writer
description: 8-section PRD 작성 (phuryn template + gstack design doc 컨벤션). problem-definition 의 P6 1-pager 출력을 입력으로 받아 최종 PRD.md 생성.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["pm", "chief"]
dev_capability: false
triggers:
  keyword:
    - "prd"
    - "요구사항 문서"
    - "design doc"
    - "기획서"
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: false
  minimum_approaches: 2
---

# PRD Writer Skill

## 8 Section (phuryn `create-prd` template 차용)

```markdown
# [Title]

## 1. Summary
1-2 문단. 무엇을 만들고 왜.

## 2. Background
- 사용자 needs (JTBD 인용)
- 시장 상황
- 기존 시도와 한계

## 3. Objective
team OKR 의 어떤 KR 과 정합하는가. 명시.

## 4. Target Segments
- 주 segment + 정의
- non-target (명시적으로 제외)

## 5. Value Proposition
1-line value statement + 사용자 가치 구조.

## 6. Solution
- ≥ 2 approaches 비교 (gstack rule)
- Recommended + rationale + falsification
- V/U/V/F assumption 분류
- Hard gate 조건

## 7. Release Plan
wbs-decomposition 출력 inject:
- Milestone 1: ...
- Milestone 2: ...
- 의존성 graph

## 8. Metrics & Verification
- Success threshold (formula + window)
- Leading indicator (실험 진행 중 관찰)
- Lagging indicator (사후 평가)
```

## 저장 위치 (gstack design doc 컨벤션 차용)

```
<org>/workflows/wf-YYYY-MM-DD-<slug>/PRD.md
<org>/decisions/{user-handle}-{branch}-design-{datetime}.md  ← 결정 누적
```

## HARD GATE: PRD ship 조건

- [ ] 8 section 모두 채움
- [ ] §6 에 ≥2 approaches 비교
- [ ] §6 에 V/U/V/F 분류
- [ ] §7 wbs-decomposition 결과 inject
- [ ] §8 success_threshold 측정 가능
- [ ] open_questions[] 빈 상태 또는 blocking 모두 resolved

## Anti-Sycophancy

PRD 본문에 다음 표현 금지:
- "검토 부탁드립니다 :)"
- "흥미로운 기능"
- "한번 생각해보시면 좋을"

대신:
- "권고: X. 반증 조건: Y."
- "결정 필요 항목: Z 의 trade-off (A vs B)"

## Reference

- phuryn/pm-skills/pm-execution/create-prd
- gstack `/office-hours` design doc naming convention
- v1.1 PRD §9.1 (skill category=planning)
