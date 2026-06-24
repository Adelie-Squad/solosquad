# Bundled Workflow Templates (v1.3.7)

`workflow-manager` skill 이 사용자 의도를 해석할 때 참조하는 번들 워크플로. 사용자가
`solosquad workflow new` 또는 Chief 가 TRIAGE → DECOMPOSE 에서 호출 시 가장 정합 높은
것을 base 로 사용하거나 합성한다. add-org 시 전 세트가 org 로 시드된다(`SCAFFOLD_WORKFLOWS`).

## 워크플로 본질 원칙 (v1.3.7 §3.6)

워크플로는 *행위*가 아니라 **목표 + 근거 + 방법 → 결론 → 다음 단계로의 핸드오프**를 담은
판단 단위다. 단순 행위라면 워크플로가 아니라 **skill** 이어야 한다. 각 stage 는 "무엇을 *왜*
어떤 근거·방법으로 하고 어떤 *결론*을 넘기는가"를 명시한다.

## 메인 (Workflow-of-Workflows — `_workflow/` 합성)

| Template | 구성(서브) | 트리거 맥락 |
|---|---|---|
| `new-build/` | (idea-refinement \| requirements-analysis) → market-research → hypothesis | "이 아이디어 기획해줘" — 신규 |
| `improvement/` | kpi-check → data-analysis → hypothesis | "전환율 떨어졌어, 개선하자" — 기존 지표 |

> **메인/서브 = 타입 아니라 호출 위치.** `_workflow/<id>` 로 다른 워크플로를 합성하면 메인,
> 합성되면 서브. 메인 선택은 Chief 가 입력 맥락으로 추론하고 애매하면 되묻는다(선처방 금지).

## 서브

| Template | 목적(목표·결론) |
|---|---|
| `idea-refinement/` | 아이디어 고도화 — 입력 성격에 맞는 프레임(고객발견·JTBD·기회트리·lean-canvas)으로 riskiest assumption 까지 |
| `requirements-analysis/` | 요구사항 구조분해·User Story·우선순위 + 리뷰 게이트 → PRD §요구사항 |
| `market-research/` | 목표·근거·방법 정의 후 병렬 리서치 + 인용검증 → TAM/SAM·차별화 결론 |
| `hypothesis/` | 원인 추적 → 검증 가능 가설(xyz-hypothesis·opportunity-tree·hypothesis-design skill). new-build·improvement 공유 |
| `kpi-check/` | **정렬 게이트** — 과제 진행 전 방향성·북극성 지표·기대 성과 확인 → 팀 얼라인 → PM 업무분장 |
| `data-analysis/` | 지표 변화를 experiment-design + Confidence Score 로 분석 → PRD §데이터 |

## 문제 정의 (성격에 따라 선택 — 강제 체인 아님, v1.3.7 §3.6B)

구 monolithic `problem-definition` 체인을 폐기하고, 본질 원칙으로 재배치. Chief/PM 이 문제
성격에 맞는 것을 선택한다. (`mece`·`xyz-hypothesis` 는 *행위 단위* 라 skill 로 유지.)

| Template | 문제 성격 | 결론 |
|---|---|---|
| `scqa/` | "무엇이 달라졌는지부터 구조화 필요" | S·C·Q·A + 가설 후보 |
| `five-whys/` | "증상 말고 근원을 찾아야" | 근본 원인 1문장 |
| `tdcc/` | "원인을 측정 가능한 지표로" | 후행지표 + 기회 + 인과 (hard_gate) |

## Agent 참조 형식

stages[].agent:
- `<team>/<specialist>` — e.g. `product/product-manager`, `engineering/backend`
- `_main/<main-bot>` — e.g. `_main/chief`, `_main/engineer`
- `_skill/<skill>` — leader tier 직접 호출
- `_workflow/<id>` — 서브워크플로(깊이 ≤2, 순환 금지 — `workflow validate --all` 검사)

## HARD GATE

`hard_gate: true` 또는 stage `exit_criteria` 가 있으면 통과 시에만 다음 stage 진입. 미달 시
`blocked` 유지 + Chief 에게 open_questions escalate.

## 기획 워크플로 — 3대 편향 가드 (v1.3.7 §3.7)

기획 stage 프롬프트는 ① 자기부정(번복↔고집 → 원칙 있는 수정 + durable-md 고정) ② 학습편향
(천장 갇힘↔할루시네이션 → 표준 프레임 근거 제시) ③ 확증편향(주객전도 → 가상 용어 금지·업계
표준 용어·자기 한계 명시)을 경계한다. 상세 = `skills/skill-core/primitive-core.md` §4.4.

## 참조
- `docs/prd/v1.3.7-*.md` §3.6·§3.7 · `skills/skill-core/primitive-core.md` §4 · agentskills.io
