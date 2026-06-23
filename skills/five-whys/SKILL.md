---
name: five-whys
description: 5-Whys 근본 원인 추적 프레임워크. 한 질문에 대해 5단계 "왜?" 체인으로 근본 원인 1문장에 수렴. 3단계 미만에서 막히면 데이터 부족(open_question). v1.3.5 에서 problem-definition P2 를 독립 skill 로 분리.
schema_version: 2
tier: leader
team: _skill
category: problem-definition
used_by: ["product-manager", "chief"]
dev_capability: false
triggers:
  keyword: ["5-whys", "five whys", "근본 원인", "root cause"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# 5-Whys — Root Cause Chain

> 한 질문(예: SCQA 의 Q)에 대해 5단계 "왜?" 체인. 근본 원인 1문장으로 수렴.
> **합성 위치(v1.3.5):** 가설 수립 서브워크플로의 원인 추적 렌즈.

## 형식

```markdown
**Why 1**: [질문] → 왜냐하면 [원인 1]
**Why 2**: [원인 1] → 왜냐하면 [원인 2]
**Why 3**: [원인 2] → 왜냐하면 [원인 3]
**Why 4**: [원인 3] → 왜냐하면 [원인 4]
**Why 5**: [원인 4] → 왜냐하면 [근본 원인]
→ **근본 원인 (1문장)**: ...
```

## 5단계 못 채우는 경우

- 3단계 미만에서 막힘 → **데이터 부족**. open_question.append (`{ "stage": "five-whys", "blocking": true }`).
- 5단계가 너무 다양한 분기 → **`mece` 로 분해 필요**. 가장 큰 분기 1개 선택 후 진행.

## Anti-Sycophancy

근본 원인 진술도 입장 + 반증: "근본 원인은 X 입니다. Y 가 사실로 확인되면 다른 원인(Z)으로 입장 바뀝니다."

## 출력 예시

```markdown
## 5-Whys
**Why 1**: 메신저 설정 오류 → wizard 가 config.yaml 을 자동 생성 안 함
**Why 2**: 자동 생성 안 됨 → mkdir 누락 시 throw
**Why 3**: mkdir 누락 → discord 진입 시 lazy create 패턴 부재
**Why 4**: lazy create 부재 → 초기 init 만이 책임이라 가정
**Why 5**: init 만이 책임 가정 → 멀티 org 사례 미고려
**근본 원인**: 멀티-org 추가 시나리오에서 config 생성 책임이 init 에만 묶여 있음.
```
