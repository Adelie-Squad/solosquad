---
name: scqa
description: SCQA(Situation/Complication/Question/Answer) 구조 분해 프레임워크. archive·customers·memory 에서 문제 진술 4요소를 추출한다(사용자와 Q&A 안 함). v1.3.5 에서 problem-definition 6-Phase skill 의 P1 을 독립 skill 로 분리.
schema_version: 2
tier: leader
team: _skill
category: problem-definition
used_by: ["product-manager", "chief"]
dev_capability: false
triggers:
  keyword: ["scqa", "상황 분석", "situation complication"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# SCQA — Context Mining

> **목적**: archive / customers / memory 에서 문제 진술의 4 요소를 추출. 사용자와 직접 Q&A 하지
> 않는다(자율 사고). 데이터가 부족한 필드는 `open_questions[]` 로 escalate.
> **합성 위치(v1.3.5):** 요구사항 분석 서브워크플로의 구조 분해 렌즈 + problem-definition 워크플로의 1단계.

## 4 필드

```yaml
situation: |
  현재 상태. 가장 최근 N개월 archive 의 컨텍스트.
  Source: archive.sqlite WHERE created_at > now() - N months
complication: |
  변화 / 위협 / 기회. 무엇이 달라졌나.
  Source: memory ledger, workflow 실패 기록, customers.md 갱신 이력
question: |
  PM 자체 구문화. "그래서 무엇을 해야 하나?" 의 더 구체적인 형태.
answer: |
  가설 후보 N개 (각 한 줄).
```

## 데이터 부족 시 → open_questions[]

각 필드를 채울 evidence 가 부족하면 append:

```json
{ "id": "q-scqa-situation", "stage": "scqa", "type": "data_request",
  "question": "최근 [도메인]에서 사용자 행동에 어떤 변화가 있었나요?",
  "context": "archive 에 관련 신호 2건 미만", "blocking": false }
```

## 출력 예시

```markdown
## SCQA
**S**: solo founder 가 최근 3개월 내 v1.0.x 4회 release. 평균 release 간격 14일.
**C**: v1.0.4 출시 후 메신저 설정 오류 issue 3건 보고. 이전 release 0건.
**Q**: config auto-create 로직이 부족한가, onboarding wizard 가 불완전한가?
**A**: 가설 후보 — (a) wizard step 누락 (b) config schema validation 부재 (c) 메신저 권한 변경
```
