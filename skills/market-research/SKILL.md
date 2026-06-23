---
name: market-research
description: 멀티에이전트 병렬 시장 조사 프레임워크. 타깃 시장·경쟁사를 desk research 로 조사하고 인용/groundedness 를 검증해 리포트(<org>/docs/reports/)를 산출. v1.3.5 신규 — 현재 리포트 산출 skill 0 갭을 메움.
schema_version: 2
tier: leader
team: _skill
category: discovery
used_by: ["product-manager", "chief"]
dev_capability: false
triggers:
  keyword: ["시장 조사", "market research", "경쟁사 분석", "competitor"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 2
---

# Market Research — Multi-agent Desk Research + Report

> **목적**: 타깃 시장·경쟁사를 병렬 desk research 로 조사하고, **모든 주장에 인용(evidence_ref)**
> 을 달아 groundedness 를 검증한 뒤 리포트를 산출. 1인 초기엔 인터뷰 대신 desk research·시장 신호로
> 보완하고 "추후 인터뷰 계획"을 명시(§3.6).
> **합성 위치(v1.3.5):** market-research 서브워크플로(design/researcher + product/business-strategy).

## 절차

1. **질문 분해** — 타깃 시장(TAM/SAM 신호)·경쟁사·대체재·가격·진입장벽으로 조사 질문을 나눈다.
2. **병렬 조사** — 각 질문을 독립적으로 조사(멀티에이전트 가능). 출처 URL/문서를 기록.
3. **인용 검증(groundedness)** — 각 주장에 `evidence_ref`(출처) 부착. 출처 없는 주장은 **추측으로
   표시**하거나 제거. 상충 출처는 병기.
4. **리포트 산출** — `<org>/docs/reports/market-research-<slug>-<date>.md` 작성(아래 구조).
5. **요약 반환** — PRD §시장 에 들어갈 요약 + 리포트 경로(evidence_ref) 반환.

## 리포트 구조

```markdown
# Market Research — <topic> (<date>)
## 요약 (3–5줄)
## 시장 규모 / 신호        — 각 항목 [evidence_ref]
## 경쟁사 / 대체재         — 표: 이름·포지셔닝·강점·약점 [evidence_ref]
## 기회 / 차별화 가설
## 미해결 질문 (open_questions[]) — 추후 인터뷰/검증 계획
## 출처
```

## Anti-Sycophancy

낙관 편향 금지 — 시장 규모·수요는 출처로만 진술하고, 출처가 약하면 신뢰도를 낮춰 표기한다.
최소 2개 시나리오(낙관/보수)를 비교한다.
