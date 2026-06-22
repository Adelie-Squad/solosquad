---
name: mece
description: MECE 분해 프레임워크. 근본 원인을 후행/선행 문제로 분해하고 누락(Exhaustive)+중복(Mutually Exclusive)을 검증. 행동 가능한 선행 문제만 다음 단계 입력. v1.3.5 에서 problem-definition P3 를 독립 skill 로 분리.
schema_version: 2
tier: leader
team: _skill
category: problem-definition
used_by: ["pm", "chief"]
dev_capability: false
triggers:
  keyword: ["mece", "분해", "decomposition"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# MECE — Decomposition

> 근본 원인을 **후행 문제** + **선행 문제** 로 분해. 누락(Exhaustive) + 중복(Mutually Exclusive) 검증.
> **합성 위치(v1.3.5):** 요구사항 분석 서브워크플로의 구조 분해 렌즈.

## 형식

```markdown
## 근본 원인: [원인]
### 후행 문제 (Lagging)
- (1.1) … / - (1.2) …
### 선행 문제 (Leading) — 행동 가능한 영역
- (2.1) … / - (2.2) … / - (2.3) …
### 분류 기준
"[기준 X] 가 있는지 없는지" 로 갈랐다.
### 경계 사례 점검
- (1.x) 와 (2.y) 가 겹치는가? → 겹치면 정의 재조정.
- 빠진 case 있는가? → 외부 케이스 1~2개 mental sim.
```

## MECE 위반 시

- 중복(overlap): 정의/기준 재조정 · 누락(gap): 카테고리 신설 · 둘 다 안 되면 → **다른 분류 기준** 재실행.

## 행동 가능성 우선

후행(lagging)은 결과. **선행(leading) 문제만 다음 단계(`tdcc`) 입력 후보.**

## 출력 예시

```markdown
## MECE
### 근본 원인: 멀티-org 추가 시 config 생성 책임 부재
### 후행 문제
- (1.1) 사용자 보고: config 없음 에러  - (1.2) Discord 진입 시 silent fail
### 선행 문제
- (2.1) lazy-create 패턴이 discord-adapter 에 없음
- (2.2) org 추가 CLI 가 config seed 안 함  - (2.3) migration 이 새 org 에 config 자동 생성 안 함
분류 기준: "config 가 *언제* 누락되었나" (lifecycle 단계).
```
