---
name: discovery-synthesis
description: archive.sqlite / customers.md / memory ledger 에서 JTBD / 문제 신호 / 사용자 패턴 추출. 사용자와 Q&A 안 함 (데이터 분석기). interview transcript 가 업로드되면 분석 포함.
schema_version: 2
tier: leader
team: _skill
category: discovery
used_by: ["product-manager"]
dev_capability: false
triggers:
  keyword:
    - "discovery"
    - "jtbd"
    - "사용자 패턴"
    - "고객 신호"
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 1
---

# Discovery Synthesis Skill

> **데이터 분석기, 챗봇 아님.** 사용자 메시지 archive / customers.md / memory ledger / interview transcript 에서 JTBD 신호 추출. 사용자에게 직접 인터뷰하지 않는다.

## 입력 소스

1. `<org>/memory/archive.sqlite` — 사용자 대화 FTS5 아카이브
2. `<org>/domain/customers.md` — 누적된 customer 가설
3. `<org>/memory/ledger/<task-id>.jsonl` — 과거 task 결과
4. `<org>/memory/interview-transcripts/` — (선택) Chief 가 인터뷰 스크립트 받아 사용자가 실제 고객과 진행한 transcript 업로드
5. team KNOWLEDGE.md — 팀 도메인 지식

## 산출물

```json
{
  "jtbd_signals": [
    {
      "when": "...",
      "i_want": "...",
      "so_i_can": "...",
      "evidence_refs": ["archive#123", "customers.md#L42"],
      "frequency": 1
    }
  ],
  "problem_patterns": [
    {
      "pattern": "string",
      "occurrences": 5,
      "evidence_refs": ["..."]
    }
  ],
  "gaps": [
    "string"   // 데이터로 풀 수 없는 영역 → open_question 으로 escalate
  ]
}
```

## JTBD 형식

Mom Test + Ulwick 표준:
- "사용자는 [상황] 일 때, [고용하는 job] 을 통해, [기대 결과] 를 얻고 싶다"
- "When [situation], I want to [job], so I can [outcome]"

## Anti-Sycophancy

JTBD 신호 진술은 evidence 명시:
- ❌ "사용자는 X 를 원할 것입니다"
- ✅ "archive 5건, customers.md 2건이 X 패턴을 시사합니다. Y 신호가 추가로 발견되면 이 가설 강화/약화 됩니다."

## Gaps → open_questions

데이터 부족 영역은 problem-definition.P1 의 open_question 으로 escalate:

```json
{
  "stage": "discovery-synthesis",
  "type": "data_request",
  "question": "[segment X] 의 frustration 데이터가 부족합니다. 사용자가 최근 X 와 관련해 어떤 경험을 했는지 알 수 있을까요?",
  "blocking": false
}
```

## Reference

- Mom Test (Rob Fitzpatrick)
- JTBD theory (Clayton Christensen, Tony Ulwick)
- phuryn/pm-skills/pm-product-discovery/summarize-interview
- v1.1 PRD §6.2 (PM 자율 작동 흐름)
