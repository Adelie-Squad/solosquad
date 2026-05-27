---
name: problem-definition
description: PM 의 자체 reasoning chain. RO-PNA 6-Phase (SCQA→5-Whys→MECE→TDCC→XYZ→1-pager) 를 자율 실행 (사용자와 Q&A 안 함). 컨텍스트로 풀 수 없는 항목은 open_questions[] 에 append.
schema_version: 2
tier: leader
team: _skill
category: problem-definition
used_by: ["pm"]
dev_capability: false
triggers:
  keyword:
    - "문제 정의"
    - "problem definition"
    - "scqa"
    - "5-whys"
    - "mece"
    - "tdcc"
    - "xyz hypothesis"
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 2
---

# Problem Definition Skill

> **PM 자율 사고 chain.** 사용자에게 직접 Q&A 하지 않는다. archive / customers / OKR / memory 에서 데이터를 추출해 6-Phase 시퀀스를 자체 실행한다. 답할 수 없는 항목 = `open_questions[]`.

## 흐름

```
P1. SCQA       (Situation / Complication / Question / Answer 추출)
P2. 5-Whys     (근본 원인 1문장)
P3. MECE       (후행/선행 문제 분해)
P4. TDCC       (후행지표 / 선행문제 / 기회 / 인과 / 미지)
P5. XYZ        (검증 가능한 가설)
P6. 1-pager    (PRD 8-section synthesis)
```

각 phase 의 상세 reasoning template 은 `assets/` 참조.

## 입력

- Chief 의 brief
- 9-layer JIT context (특히 archive.sqlite, customers.md, team OKR)

## 출력 (JSON)

```json
{
  "problem_statement": "string (P5 결과 1문장)",
  "root_cause": "string (P2 결과)",
  "hypotheses": [
    {
      "xyz": "string (X% of Y will Z in T, because R)",
      "confidence": 0-100,
      "evidence_refs": ["..."]
    }
  ],
  "open_questions": [
    { "id": "q1", "stage": "...", "question": "...", "blocking": true | false }
  ]
}
```

## HARD GATE: 다음 skill 진입 조건

- [ ] P1 SCQA 4필드 모두 채움
- [ ] P2 5-Whys 단계 ≥3
- [ ] P4 TDCC 5필드 모두 채움 (또는 미지 = open_question)
- [ ] confidence_score ≥ 60

미달성 시 `opportunity-tree` 또는 `discovery-synthesis` 로 회귀.

## Anti-Sycophancy

가설 진술은 **입장 + 반증 조건** 형식 강제:
- "X 라고 판단합니다. Y 가 사실로 드러나면 입장 바뀝니다."

## Reference

- RO-PNA/pna-builders systemPrompt.ts — 6-Phase 시나리오 원본
- v1.1 PRD §6.6 RO-PNA 6-Phase 의 PM 내부화
