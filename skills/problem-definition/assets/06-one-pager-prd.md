# P6. 1-Pager PRD — Synthesis

> P1~P5 의 결과를 PRD 8-section 으로 종합. `prd-writer` skill 의 입력으로 전달.

## 8 Section (phuryn template 차용)

```markdown
# [Title]

## 1. Summary
P5 hypothesis 의 한 줄 요약 + recommended approach.

## 2. Background
- P1 SCQA 요약 (3-4줄)
- P2 root cause (1줄)

## 3. Objective
team OKR 의 어떤 KR 과 정합하는가. 명시.

## 4. Target Segments
P5 의 Y segment + 추가 정의.

## 5. Value Proposition
P4 customer_opportunity 발췌 + 1-line value statement.

## 6. Solution
P5 recommended approach 상세.
- ≥ 2 approaches 비교 (gstack rule)
- V/U/V/F assumption 분류
- Hard gate 조건

## 7. Release Plan
wbs-decomposition skill 의 출력 (마일스톤 + WBS) 참조.

## 8. Metrics & Verification
- success_threshold (P5)
- measurement_window
- leading + lagging indicators (P4 trailing_indicator 포함)
```

## HARD GATE: PRD ship 조건

- [ ] 8 section 모두 채움
- [ ] §6 에 ≥2 approaches 비교
- [ ] §6 에 V/U/V/F 분류
- [ ] §7 wbs-decomposition 결과 inject
- [ ] §8 success_threshold 측정 가능 (formula 명시)

## 미달성 시

해당 section 의 빈 곳을 open_question 으로 escalate. Chief 가 batch 로 사용자 질의.

```json
{
  "stage": "problem-definition.P6",
  "type": "preference | constraint",
  "question": "이 기능의 측정 metric 우선순위는 conversion vs activation 중 어느 쪽?",
  "blocking": true
}
```

## Output: prd-writer 입력 패키지

```json
{
  "title": "...",
  "sections": {
    "summary": "...",
    "background": "...",
    "objective": "...",
    "target_segments": "...",
    "value_proposition": "...",
    "solution": {
      "approaches": [...],
      "recommended": "...",
      "v_u_v_f": {...},
      "hard_gate": [...]
    },
    "release_plan": "{wbs-decomposition output}",
    "metrics": {...}
  },
  "open_questions": [...]
}
```

→ `prd-writer` skill 호출 → 최종 PRD.md 생성.
