---
name: tdcc
description: TDCC 5필드 매핑 프레임워크 — Trailing indicator·Downstream problems·Customer opportunity·Causal link·Unknown. 측정 가능한 후행지표 + 선행문제 + 인과사슬을 잇고 미지 항목은 open_question 으로 escalate. v1.3.5 에서 problem-definition P4 를 독립 skill 로 분리.
schema_version: 2
tier: leader
team: _skill
category: problem-definition
used_by: ["pm", "chief"]
dev_capability: false
triggers:
  keyword: ["tdcc", "trailing indicator", "후행지표"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# TDCC — 5필드 매핑

> **T**railing indicator(후행지표) · **D**ownstream problems(선행문제 3개) · **C**ustomer opportunity(기회)
> · **C**ausal link(인과) · **Unknown**(미지). 원본: 토스 TDCC(RO-PNA 변형).
> **합성 위치(v1.3.5):** 가설 수립 서브워크플로 — 원인을 측정 가능한 지표·기회로 변환.

## 5 필드

```yaml
trailing_indicator:
  metric: "예: 신규 org config 오류율"
  baseline: "현재 값"
  target: "목표 값"
downstream_problems:   # mece 의 선행 문제 3개
  - "(2.1) …" 
  - "(2.2) …"
  - "(2.3) …"
customer_opportunity:
  description: "사용자 측에서 얻는 가치"
  size: "small | medium | large"
causal_link:
  chain: "선행 → 후행 인과 사슬"
unknown:               # 답할 수 없는 항목 — open_question 으로 escalate
  - "…"
```

## 미지 필드 처리

각 unknown → `open_questions[]` append (`{ "stage": "tdcc", "type": "data_request", "blocking": false }`).

## HARD GATE

- [ ] 5 필드 모두 채움 (또는 unknown 으로 escalate)
- [ ] causal_link 가 선행 문제와 1:1 정합
- [ ] trailing_indicator 가 측정 가능 (baseline + target 명시)

미달성 시 → 다음 단계(`xyz-hypothesis`) 진입 차단.
