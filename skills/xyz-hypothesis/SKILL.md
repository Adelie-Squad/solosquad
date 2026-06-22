---
name: xyz-hypothesis
description: 검증 가능한 가설 프레임워크 — "[X%] of [Y segment] will [Z behavior] within [T period], because [R]". 입장+반증 조건 강제, 최소 2개 접근, V/U/V/F 가정 분류. v1.3.5 에서 problem-definition P5 를 독립 skill 로 분리.
schema_version: 2
tier: leader
team: _skill
category: problem-definition
used_by: ["pm", "chief"]
dev_capability: false
triggers:
  keyword: ["xyz hypothesis", "가설 수립", "검증 가능한 가설", "hypothesis"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 2
---

# XYZ Hypothesis

> 검증 가능한 가설 형식: **`[X%] of [Y segment] will [Z behavior] within [T period], because [R rationale]`**.
> **합성 위치(v1.3.5):** 가설 수립 서브워크플로의 종착 렌즈(신규 구축·개선 두 메인이 공유).

## 형식

```yaml
hypothesis:
  x_percent: "예: 80%"
  y_segment: "예: 신규 org 를 추가하는 founder"
  z_behavior: "예: 첫 messenger send 를 1회 시도 내 성공"
  t_period: "예: org 추가 후 5분 이내"
  r_rationale: "lazy-create 패턴 + post-add seed 가 wizard 와 동등한 보장 제공"
verification:
  method: "instrumentation 으로 retry 횟수 카운트"
  success_threshold: "first-try 성공률 ≥ 80%"
  measurement_window: "구현 후 30일"
confidence: 75   # 0-100, RO-PNA Confidence Score
```

## Anti-Sycophancy 강제 (입장 + 반증)

```yaml
position: "lazy-create 도입 시 80% 첫시도 성공"
falsification:
  - "first-try < 50% → 다른 root cause (예: discord API 권한)"
  - "100% 인데 사용자 보고 지속 → metric 정의가 wrong proxy"
```

## ≥ 2 approaches 룰 (단일 가설 금지)

항상 최소 2개 가설(approach·pros·cons) 제시 후 `recommended` 명시(근거 포함).

## V/U/V/F Assumption 분류

각 가설 핵심 가정을 **V**alue / **U**sability / **V**iability / **F**easibility 4영역으로 분류,
가장 위험한 가정을 표시.
