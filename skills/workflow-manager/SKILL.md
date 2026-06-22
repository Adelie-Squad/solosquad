---
name: workflow-manager
description: Chief 또는 사용자 의도에서 workflow YAML 합성·검토·개선. assets/workflows/ 의 template 을 기반으로 instance 생성. v1.0.x meta-skill 의 v1.1 평탄화 버전, v1.3.5 에서 maker→manager 개명.
schema_version: 2
tier: leader
team: _skill
category: orchestration
used_by: ["chief", "pm"]
dev_capability: false
triggers:
  keyword: ["workflow", "워크플로우", "make workflow", "new workflow"]
  slash: ["/workflow"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 2
---

# Workflow Manager Skill — v1.1 (v1.3.5 maker→manager)

> Chief 또는 사용자 의도에서 workflow YAML 합성. 신규 workflow 작성 시
> 4 bundled template (assets/workflows/) 중 정합 가장 높은 것을 base 로
> 활용하거나, 다른 template 합성. 구 v1.0.x meta-skill 의 평탄화 (skills/
> 평탄 카탈로그 + agentskills.io 표준).

## 입력

- 사용자 의도 (Chief TRIAGE → DECOMPOSE 의 분류 결과)
- 또는 explicit slash: `/workflow <intent>`

## Bundled Templates

**v1.3.5 기획 메인/서브 (planning):** `new-build`·`improvement`(메인) + `idea-refinement`·
`requirements-analysis`·`market-research`·`kpi-check`·`data-analysis`·`hypothesis`(서브) +
`problem-definition`(프레임워크 체인). 아래 "Planning 워크플로" 참조.

**기존 템플릿(레거시 — 신규 2-메인의 프리셋/서브셋으로 재정의, 즉시 삭제 아님):**

| Template | 트리거 패턴 | v1.3.5 관계 |
|---|---|---|
| `discovery-cycle` | PM 자율 문제 정의 ("X 를 어떻게 만들지 분석") | new-build 의 풀 프리셋(discovery→problem-def→…) |
| `pmf-validation` | PMF gate 시퀀스 ("이게 진짜 시장에 fit 되는지") | new-build + hypothesis 강조 프리셋 |
| `autoplan-pm` | 다중 PM specialist 빠른 chain ("일단 전체 plan 한번") | new-build 의 축약 서브셋 |
| `weekly-retro` | 주간 회고 (weekly cron 호출) | 독립(회고) |

## 합성 흐름

```
1. Read user intent (텍스트)
2. Score against 4 templates (정합도 0-100)
3. If max score >= 70 → 해당 template 의 stages 복사 후 customize
4. Else → ≥2 approaches:
     a) 가장 가까운 2 template 합성
     b) custom workflow from scratch (handoff_to chain 직접 작성)
   사용자에게 둘 중 선택 의뢰 (Chief 가 open_questions 로 escalate)
5. <org>/workflows/wf-YYYY-MM-DD-<slug>/workflow.yaml 에 저장
6. _status.yaml 생성 + 첫 stage pending → in_progress
```

## 출력

- `<org>/workflows/wf-YYYY-MM-DD-<slug>/workflow.yaml`
- `<org>/workflows/wf-YYYY-MM-DD-<slug>/_status.yaml`
- (선택) handoff template 파일들

## Agent 참조 형식 (v1.1, v1.3.5 §3.3 `_workflow/` 추가)

stages[].agent:
- `<team>/<specialist>` — e.g. `product/pmf-planner`
- `_main/<main-bot>` — e.g. `_main/pm`, `_main/engineer`
- `_skill/<skill>` — leader tier 직접 호출
- `_workflow/<id>` — **서브워크플로**(Workflow-of-Workflows). 깊이 ≤2 권장, 순환 금지
  (`workflow validate --all` 이 cycle/depth 검사). new-build·improvement 메인이 이걸로 sub 합성.

## Planning 워크플로 — 메인 선택 (v1.3.5 §3.1)

기획 의도면 **2개 메인 중 하나**를 고른다. 명사 3종(agent·workflow·skill) 모델에서 main/sub 는
타입이 아니라 **호출 위치**다.

| 메인 | 구성(서브워크플로) | 트리거 맥락 |
|---|---|---|
| **new-build** | (idea-refinement \| requirements-analysis) → market-research → hypothesis | "이 아이디어 기획해줘" — 신규 |
| **improvement** | kpi-check → data-analysis → hypothesis | "전환율 떨어졌어, 개선하자" — 기존 지표 |

- **선택 = Chief 가 입력 맥락으로 추론**, **애매하면 사용자에게 되묻는다**(TRIAGE 사후 라벨링 규약
  정합 — 선처방 금지). new-build 의 시작점(아이디어 vs 요구사항)은 입력의 구체성으로 판단.
- **맥락 적응**: 각 메인은 추가 정보를 요청하거나 불필요 단계를 건너뛴다. 고객 발견은 사용자 입력
  요구(§3.6) — 없으면 추측 대신 open_questions[].
- **산출 위치**: 기획 PRD = `<org>/docs/prd/<slug>.md`(prd-writer 2 양식), 시장 리포트 =
  `<org>/docs/reports/`. PM 이 `<org>/docs/INDEX.md` 로 목록 유지(§3.7).
- **자산 재사용 우선**: 새 skill/agent 가 필요하면 [[skill-manager]]·[[agent-manager]] 로 제안·검증 후 생성.

## Anti-Sycophancy

- ❌ "좋은 workflow 가 만들어졌습니다"
- ✅ "intent 매칭 점수: discovery-cycle 72, pmf-validation 58. discovery-cycle base 사용. wedge 정의 부족하면 pmf-validation 로 escalate 권고."

## Reference

- 이전: `assets/agents/_meta/workflow-maker/SKILL.md`
- v1.1 PRD §13 (Workflow Templates)
- agentskills.io workflow standard
