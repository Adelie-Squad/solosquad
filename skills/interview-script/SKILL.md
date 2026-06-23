---
name: interview-script
description: Chief 가 사용자에게 보낼 user-interview script 생성. Mom Test 기반 — leading 질문 금지. 사용자가 실제 고객과 인터뷰 진행 후 transcript 업로드.
schema_version: 2
tier: leader
team: _skill
category: discovery
used_by: ["product-manager", "chief"]
dev_capability: false
triggers:
  keyword: ["interview", "인터뷰 스크립트", "interview script", "user interview"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 1
---

# Interview Script Author Skill

> PM 또는 chief 가 호출. 사용자(founder)가 직접 실제 고객과 인터뷰 진행할 때 사용할 script 생성. PM 이 직접 인터뷰하지 않는다.

## 입력

- target segment 정의
- 검증하려는 hypothesis (XYZ format)
- 기존 customer 가설 (`<org>/domain/customers.md`)

## Mom Test 원칙 (Rob Fitzpatrick)

1. **사람들의 의견 묻지 마라.** 그들의 삶을 물어라.
2. **미래 가설 묻지 마라.** 과거 행동을 물어라.
3. **칭찬 받지 마라.** 사실을 받아라.

→ "X 기능 좋아하실까요?" ❌
→ "마지막으로 [pain] 을 겪었을 때 어떻게 해결하셨나요?" ✅

## 산출

```markdown
# Interview Script — {{topic}}

## 목적
{{검증할 hypothesis 1줄}}

## 인터뷰 대상
- Segment: ...
- Recruit criteria: ...
- 최소 N=5

## 진행 (25-30분)

### Warm-up (3분)
- 자기소개
- 최근 어떻게 지내셨는지 (light)

### 과거 행동 탐색 (15분)
1. 가장 최근 [domain] 관련 작업이 언제였나요? 어떤 상황이었나요?
2. 그 작업에서 가장 답답했던 순간은?
3. 그 순간을 어떻게 처리하셨나요? 어떤 도구/방법을 썼나요?
4. (위 도구/방법에 만족 못 한 경우) 다른 시도 해보셨나요?
5. 이 작업에 보통 시간/돈을 얼마 쓰시나요?

### Constraint 탐색 (7분)
- 만약 [hypothetical solution] 이 있다면, 지금 쓰시는 [current solution] 을 *대체* 하시겠어요? 무엇이 *전환* 결정 요인일까요?
- (전환 안 한다면) 어떤 조건이면 전환하시겠어요?

### Wrap-up (3분)
- 우리가 안 물어본 질문 중 이 주제에 중요한 게 있나요?
- 비슷한 고민하시는 분 소개 가능하실까요?

## Scoring Rubric

각 응답을 다음 기준으로 채점:
- Demand evidence: 0-3 (0=interest, 3=actual demand with payment/workaround)
- Specificity: 0-3 (0=vague, 3=specific instance with date+context)
- Switching cost signal: 0-3
```

## HARD GATE

```markdown
- [ ] 모든 질문이 Mom Test 통과 (no leading, no hypothetical)
- [ ] 과거 행동 질문 ≥ 5
- [ ] scoring rubric 첨부
- [ ] minimum sample N=5 명시
```

## Reference

- Mom Test by Rob Fitzpatrick
- phuryn/pm-skills/pm-product-discovery/interview-script
- v1.1 PRD §9.1 (discovery)
