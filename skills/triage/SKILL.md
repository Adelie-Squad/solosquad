---
name: triage
description: Chief 의 과제 분류 도구. 사용자 입력을 4-way 분류 (discussion / workflow / cron / goal) + Educational Nudge (불명확 시 KNOWLEDGE 가이드 선제시).
schema_version: 2
tier: leader
team: _skill
category: core
used_by: ["chief"]
dev_capability: false
triggers:
  keyword: ["triage", "분류", "classify"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Triage Skill

> Chief 가 매 turn TRIAGE stage 에서 호출. Chief 의 의사결정 권한 (Task 분류) 의 reasoning 도구.

## 4-Way 분류

| 분류 | 정의 | 예시 |
|---|---|---|
| **discussion** | 대화 자체로 종결. clarification / status check / light reply | "어떻게 지내?", "지금 진행 중인 게 뭐야?" |
| **workflow** | 일회성 chain (PRD → 분해 → 실행 → 보고) | "X 기능 만들자", "캠페인 준비해줘" |
| **cron** | 반복 (cron 등록) | "매일 아침 brief 보여줘", "주간 회고 자동화" |
| **goal** | 자율 실행 (metric 기반 keep/discard) | "Y 지표를 Z 까지 올리는 방법 찾아줘" |

## Triage Stage 0 — Educational Nudge

사용자 입력이 막연하면 PM/specialist spawn **전에** KNOWLEDGE 가이드 선제시:

```
조건: 4-way 신뢰도 < 60%
→ team KNOWLEDGE.md 의 가장 정합 높은 playbook 1~2개 표시
→ "어느 단계에서 시작할까요?" 또는 "처음부터 가설 정의가 필요하신가요?"
→ 사용자 응답 기다림
```

**원칙: 사후 라벨링** — 프레임워크 선처방 X. 사용자 의도가 모이면 사후 label.

## 출력

```yaml
classification: discussion | workflow | cron | goal
confidence: 0-100
educational_nudge:
  needed: true | false
  candidate_playbooks: ["..."]
reasoning: "string"
next_stage: DECOMPOSE | reply_directly | await_user
```

## Confidence 임계값

- ≥80: 즉시 다음 stage (DECOMPOSE)
- 60~79: Educational Nudge 권고
- <60: 명시적 clarification 1회 (사용자에게 1-2 짧은 질문)

## ≥ 2 approaches (Educational Nudge 시)

KNOWLEDGE 가이드 제시는 ≥ 2 playbook 후보. 단일 강요 X.

## Anti-Sycophancy

- ❌ "흥미로운 요청이네요. 어떻게 시작할까요?"
- ✅ "이 요청은 workflow(60%) 와 goal(40%) 사이입니다. KNOWLEDGE 에 두 playbook 있어요: X / Y. 어느 쪽?"

## Reference

- v1.1 PRD §5.2 (TRIAGE stage), §5.4 (Educational Nudge)
- Harness Report §7.5 권고 (Educational Nudge)
