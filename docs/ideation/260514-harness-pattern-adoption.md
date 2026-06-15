# Harness 청사진 패턴 채택 — 구현 ideation

- **출처 문서**: `docs/ideation/AI_Agent_Harness_Report.md` §6 (1인 기업용 이상적 아키텍처) + §7 (SoloSquad 비교 분석)
- **자매 문서**: `docs/ideation/2026-05-14-agent-view-teams-application.md`
- **작성일**: 2026-05-14
- **상태**: ideation (plan 승격 전 단계)
- **청자**: SoloSquad 개발자(본인)

## 배경

`AI_Agent_Harness_Report.md` §7.5에서 SoloSquad에 채택 가치 있는 4개 패턴을 식별했다. 본 문서는 그 4개를 **각각 코드 경로·프롬프트 패치·라이프사이클 수정 수준**으로 구체화한다.

| # | 패턴                       | 우선순위 |
| :- | :------------------------- | :------- |
| 1 | Educational Nudge          | 높음      |
| 2 | Dependency Injection (지표) | 높음     |
| 3 | Experiment Proposal 자율 노드 | 중       |
| 4 | Board of Agents 메타포     | 낮음      |

## 패턴 1 — Educational Nudge

### 관찰

1인 창업자는 도메인 지식이 없는 영역(가격 정책, GTM 채널, 법무 등)에서 **막연한 입력**을 자주 준다. 현재 `assets/orchestrator/SKILL.md`는 PM이 vague input을 받으면 *"≤2개 명확화 질문 → PRD 생성"* 절차만 정의하고, 도메인 framework을 먼저 surface하는 룰은 없다. 결과: PM이 잘못된 가정으로 PRD를 만들거나, specialist에게 위임 후 specialist가 다시 사용자에게 framework 질문을 던지는 왕복 발생.

### 제안

PM의 stage delegation **이전 단계**에 "Educational Nudge" 분기 추가.

**발동 조건** (셋 중 둘 이상 충족 시):
- 사용자 메시지에서 도메인 키워드(`pricing`, `gtm`, `legal`, `funding`, `growth`)가 감지됨
- 메시지에 구체적 수치·세그먼트·제약 조건이 없음 (정규식 + 휴리스틱)
- 직전 N(=3)턴 안에 같은 도메인 framework이 surface된 적 없음

**대응**:
1. PM이 해당 도메인 team의 `KNOWLEDGE.md`(v0.6 §2.1)에서 1~3문장 framework을 추출
2. 사용자에게 **(a) framework 한 줄 요약 + (b) 채워야 할 입력 3개 + (c) "모르면 desk research로 채워볼게" 옵션**을 한 응답으로 제시
3. 사용자가 입력 채우면 정식 PRD 사이클 진입, "unknown"이면 `desk-researcher` agent에게 우선 위임

### 예시 응답 템플릿

```
사용자: 우리 SaaS 가격 정책 어떻게 할까?

PM (Educational Nudge):
  가격 책정에 들어가기 전에 빠르게 정렬할 게 있어. SaaS 가격은 보통
  LTV/CAC 3:1 + segment-fit 두 축으로 결정해.

  지금 손에 있는 데이터:
    • 평균 retention(월): ?
    • 타깃 segment (스타트업 / SMB / 엔터프라이즈): ?
    • 경쟁 제품 평균 ARPU($): ?

  채워주면 BM 에이전트가 plan을 짤게.
  모르겠으면 `unknown`이라고 답하면 desk-researcher가 먼저 채울게.
```

### 코드 타겟

- `assets/orchestrator/SKILL.md` — `## Educational Nudge` 신규 절. 발동 조건 + 응답 템플릿 명시
- `assets/agents/strategy/KNOWLEDGE.md` (v0.6 §2.1) — `## Frameworks for Nudge` 절 추가, 도메인별 1~3문장 요약
- `assets/agents/growth/KNOWLEDGE.md` — GTM nudge framework
- `src/bot/pm-runner.ts` — vague-input 휴리스틱 helper (단, 분기 결정은 모델에 맡김, 코드는 키워드 감지 + 컨텍스트 슬라이스만)

### 임팩트

- 사용자가 모르는 영역에서도 첫 응답이 generic이 아닌 framework 기반이 됨 → **"비서가 아닌 이사회" 가치 직접 실현** (패턴 4와 결합 효과)
- specialist 위임 전 입력이 정제됨 → stage 재실행 비율 ↓

### 리스크

- Nudge가 과도하면 사용자가 "잔소리"로 느낌. → `<org>/memory/nudge-log.jsonl`에 최근 nudge 이력 기록, 같은 framework은 동일 워크플로우에서 1회만
- KNOWLEDGE.md framework 품질이 곧 nudge 품질 → 초기 5개 도메인(pricing, gtm, legal, funding, growth)에 큐레이션 집중 후 점진 확장

---

## 패턴 2 — Dependency Injection (지표 자동 첨부)

### 관찰

v0.6 §2.2의 8-layer JIT 주입은 Layer 7에 `<org>/memory/` 전체를 포함하지만, **stage가 어떤 metric에 의존하는지** 명시되지 않아 spawn 프롬프트에 무관한 메모리가 함께 들어가거나 정작 필요한 지표가 빠지는 일이 생긴다. 청사진 §6.2의 "BM 에이전트가 LTV/CAC를 자동 참조"가 실제로 일어나려면, agent가 자신의 지표 의존성을 *frontmatter로 선언*하고 PM이 그것만 추출해 주입해야 한다.

### 제안

**agent frontmatter에 `metric_dependencies` 필드 추가**, spawn 시 PM이 `<org>/memory/signals.jsonl`을 필터링해 metric pack을 handoff에 첨부.

#### Step 1 — frontmatter 스키마 확장

```yaml
# assets/agents/strategy/business-strategist/SKILL.md (frontmatter)
---
name: business-strategist
team: strategy
metric_dependencies:
  - ltv
  - cac
  - arpu
  - retention_m1
metric_lookback_days: 90
---
```

#### Step 2 — signals.jsonl 레코드 표준화

```jsonl
{"ts":"2026-05-14T09:00:00Z","metric":"ltv","value":1240,"unit":"USD","source":"stripe-export","cohort":"q2-2026"}
{"ts":"2026-05-14T09:00:00Z","metric":"cac","value":380,"unit":"USD","source":"meta-ads","cohort":"q2-2026"}
```

#### Step 3 — Layer 7 보강: "metric pack" 서브레이어

기존 8-layer 주입의 Layer 7(`memory/` + `_handoff.md`) 안에 *metric pack* 자동 생성:

```
Layer 7 (보강):
├─ <org>/workflows/<id>/_handoff.md (slice)
├─ <org>/memory/ (existing)
└─ <org>/memory/metric-pack.<stage-id>.md  ← spawn 시 자동 생성
```

`metric-pack.<stage-id>.md` 형식:

```markdown
# Metric Pack for stage:bm-pricing-2026-05-14

## ltv (last 90d, n=3)
- 2026-05-14: $1240 (q2-2026 cohort, stripe-export)
- 2026-04-15: $1180 (q2-2026 cohort, stripe-export)
- 2026-03-15: $1095 (q1-2026 cohort, stripe-export)
→ trend: +13% QoQ

## cac (last 90d, n=3)
...
```

PM은 spawn 프롬프트에 `Refer to ./<org>/memory/metric-pack.<stage-id>.md for current metrics.`만 한 줄 추가.

### 코드 타겟

- `src/bot/agents-builder.ts` — frontmatter 파싱 시 `metric_dependencies` 인식
- `src/bot/pm-runner.ts` — stage spawn 직전 `buildMetricPack(stageId, deps, lookback)` 호출
- `src/util/metric-pack.ts` (신규) — signals.jsonl 필터 + markdown 렌더
- `assets/agents/strategy/business-strategist/SKILL.md` — 첫 적용 케이스
- `assets/agents/strategy/scope-estimator/SKILL.md` — 두 번째
- `docs/plan/v0.6-default-workflow-tuning.md` §2.2 — Layer 7 보강 절 추가

### 임팩트

- 8-layer JIT 주입이 *"전부 다 주입"*에서 *"필요한 것만 주입"*으로 정밀화 → spawn token 비용 ↓
- BM/Pricing/Growth stage가 첫 시점부터 데이터 기반 → 청사진 §6.2 "의존성 주입" 직접 구현

### 리스크

- `signals.jsonl`에 metric record가 없으면 metric pack이 비어 specialist가 estimation 가설로 작업. → metric pack 헤더에 `[NO DATA — using assumptions]` 명시 강제
- metric naming 불일치 위험. → `assets/knowledge/metrics-glossary.md` 신규로 정식 metric 이름 nail down (v0.6에서)

---

## 패턴 3 — Experiment Proposal 자율 노드

### 관찰

v0.4 autonomous engine sketch는 *parse → run → evaluate → keep/discard*까지만 정의되어 있다. discard 시 다음 가설을 누가 만드는지가 미정. 청사진 §6.2 "가설 기반 분기 (Pivot)"가 실현되려면 evaluator가 discard 직후 **다음 가설 후보를 자율 제안**하고, 사용자 승인 받아 새 사이클로 진입해야 한다.

### 제안

`src/engine/goal-runner.ts`(v0.4 미구현)에 사이클 종료 후 **`proposeNextHypothesis()`** 노드 추가.

#### 노드 입출력

**입력**: 종료된 사이클의 evaluation 결과
- `discarded_hypothesis`
- `discard_reason` (metric delta 등 정량)
- `cycle_logs` (시도된 실험·관찰)

**출력**: `proposed-N.yaml` 파일 (`<org>/goals/<goal-id>/cycle-N+1/proposed.yaml`)

```yaml
# <org>/goals/g-2026-05-14-cvr/cycle-3/proposed.yaml
parent_cycle: 2
discarded_hypothesis: "30% discount banner increases signup CVR"
discard_reason:
  metric: signup_cvr
  expected_delta: ">= +5%"
  observed_delta: "-2.1%"
  significance: p=0.04

proposed:
  - id: h-3-a
    summary: "Reduce signup form fields from 5 to 2"
    rationale: |
      Funnel analytics show 64% drop-off at field 3 (phone number).
      Removing non-essential fields is a higher-leverage change than incentive tweaks.
    expected_delta: "+8 to +12% signup_cvr"
    experiment_design:
      type: A/B
      variants: [5-field (control), 2-field (treatment)]
      sample_target: 2000 visitors
      duration_days: 7
    metric_dependencies: [signup_cvr, time_to_signup]

  - id: h-3-b
    summary: "Add social proof above signup CTA"
    ...
```

#### 사용자 흐름

1. 사이클 N 종료 → evaluator가 `proposed.yaml` 생성
2. messenger `#workflow` 채널에 카드 푸시:
   - "Cycle 2 결과: 가설 기각. 다음 후보 3개:"
   - Discord embed / Slack block로 a/b/c 버튼 + "모두 보기" / "전부 거부"
3. 사용자 선택 → 선택된 가설 ID로 cycle N+1 진입
4. 30분 응답 없으면 PM이 `proposed.yaml`의 첫 후보를 자동 채택(자율 모드) — 단, `workspace.yaml`의 `autonomy.auto_pick_next: true`일 때만

### 코드 타겟

- `src/engine/goal-runner.ts` (신규) — 사이클 라이프사이클 + `proposeNextHypothesis()` 노드
- `src/engine/evaluator.ts` (신규) — discard 결과 + cycle logs 입력 → 후보 N개 생성 (실제 추론은 Claude Code subagent에 위임)
- `src/bot/events.ts` — `#workflow` 카드 푸시 핸들러
- `assets/templates/proposed.yaml` (신규) — 후보 yaml 템플릿
- `assets/orchestrator/SKILL.md` — "가설 제안" 절 추가, evaluator subagent에게 줄 system 프롬프트 명시

### 임팩트

- v0.4 autonomous goal 사이클이 실제로 **자율**이 됨 (사용자가 매 사이클 가설을 손으로 정의할 필요 없음)
- 청사진 §6.2 "가설 기반 순환 그래프" 직접 구현
- 패턴 2(metric injection)와 결합 시 후보 가설이 데이터 기반으로 생성됨

### 리스크

- evaluator subagent가 생성한 후보 품질 편차 클 수 있음. → 후보 yaml에 `expected_delta` 외 `confidence: low|med|high` 강제
- auto_pick_next는 위험 — 디폴트는 `false`, 사용자가 explicit으로 켜야 함
- 사이클 무한 루프 가능성. → `goal.max_cycles` (default 5) 강제, 도달 시 사용자에게 종료 확인

---

## 패턴 4 — Board of Agents 메타포

### 관찰

현재 `assets/orchestrator/SKILL.md`의 PM 정의는 *"사용자 요청 → 명확화 질문 → 적절한 specialist 위임"* 흐름의 **비서·관리자** 톤. 청사진 §6.5 "Board of Agents" 메타포는 PM을 **이사회 의장(Chair)**, specialist를 **이사회 멤버**, 사용자를 **CEO**로 재정의한다. 톤 조정 자체는 비용이 거의 없으나, **의견 충돌의 처리 방식**에서 차이가 크다: 비서 모델은 합의된 한 답을 만들어 전달하지만, 이사회 모델은 *대립 의견을 분리해 노출*한다.

### 제안

#### Step 1 — orchestrator/SKILL.md 톤 조정

기존 §0 (역할 정의) 일부 발췌:
> *"PM은 사용자 요청을 받아 적절한 specialist에게 위임하고 결과를 종합해 사용자에게 보고한다."*

→ 신규 톤:
> *"PM은 4팀 25명의 specialist로 구성된 운영 이사회를 의장(Chair)으로서 조율한다. 사용자는 회사의 CEO이며, PM의 역할은 (1) 의제 결정, (2) 적절한 멤버 호출, (3) 멤버 권고를 CEO 의사결정에 도움이 되도록 정리하는 것이다."*

#### Step 2 — 충돌 표면화 룰 (신규 절)

**현재 PM**은 BM agent와 Brand agent가 다른 권고를 하면 *내부적으로 한 답으로 합쳐* 사용자에게 전달. 신규 룰:

> 두 명 이상의 specialist가 *명백히 대립*하는 권고를 했을 때, PM은 합쳐서 한 답을 만들지 말고, 대립 자체를 사용자에게 명시적으로 노출한다.
>
> 응답 형식:
> ```
> 이사회 의견이 갈렸어.
>
> [BM 에이전트 — "Pricing 우선"]
>   요지: ...
>   근거: ... (metric 인용)
>
> [Brand 에이전트 — "Positioning 우선"]
>   요지: ...
>   근거: ...
>
> CEO 판단이 필요한 지점: 둘 다 ROI는 있지만 자원이 동시 투입 불가.
> 어느 쪽 먼저 갈까?
> ```

#### Step 3 — 핸드오프에 "권고자" 명시

`_handoff.md` 템플릿에 `## Recommended By` 필드 추가 — 어느 agent가 어떤 권고를 했는지 트레이서빌리티 확보 (Agentforce 리니지에 대응).

### 코드 타겟

- `assets/orchestrator/SKILL.md` — §0 역할 재작성 + 신규 §X "충돌 표면화" 절
- `assets/templates/handoff.md` — `## Recommended By` 필드 추가
- `assets/core/principles.md` (있다면) — "CEO/이사회/의장" 어휘 통일

### 임팩트

- 사용자가 단일 답이 아닌 *대립 의견*을 볼 수 있어 의사결정 품질 ↑
- 청사진 §6.5 메타포 직접 구현, 다른 3개 패턴(특히 1, 3)과 톤 정합
- 코드 변경 거의 없음 (프롬프트 변경 위주) → ROI 높음

### 리스크

- 대립 노출이 사용자에게 *의사결정 피로*를 줄 수 있음. → 충돌 표면화는 *high-stakes* stage(전략·예산·법무)에만 적용, 일상 작업엔 단일 답 유지
- "이사회" 어휘가 messenger 톤과 안 맞을 수 있음. → `<org>/agent-profile.yaml`에서 톤 override 가능하게 (v0.6 §2.2)

---

## 통합 우선순위

| # | 패턴                       | 우선순위 | v0.6 plan 후보 | 의존성                          | 비용     |
| :- | :------------------------- | :------- | :------------- | :------------------------------- | :------- |
| 1 | Educational Nudge          | 높음      | ○              | KNOWLEDGE.md 큐레이션 필요       | 낮음     |
| 2 | Dependency Injection       | 높음      | ○              | signals.jsonl 표준화 + Layer 7 보강 | 중       |
| 4 | Board of Agents 메타포     | 높음(낮은비용) | ○         | 없음 (프롬프트만)                | 매우낮음 |
| 3 | Experiment Proposal 자율 노드 | 중       | △ (v0.4와 묶음) | v0.4 goal-runner 본체 구현       | 높음     |

> **패턴 4를 "낮음" → "높음(낮은 비용)"으로 재평가**: 비교 분석 §7.5에서 우선순위 낮음으로 적었으나, 구현 비용이 거의 0(프롬프트 변경)이고 다른 패턴들의 톤 정합을 만드는 *기반*이라 함께 도입하는 것이 합리적.

## 결합 시너지

- **1 + 4**: Educational Nudge의 응답 톤이 "이사회 의장이 CEO에게 정보를 정렬해주는" 형태가 되어 자연스러움
- **2 + 3**: metric pack(2)이 있으면 evaluator(3)의 다음 가설 후보가 데이터 기반으로 생성됨 — 두 패턴 묶어 v0.4/v0.6 경계에서 동시 도입 검토
- **1 + 3**: nudge로 사용자가 가설을 명확히 정의 → goal-runner가 정제된 입력으로 사이클 시작 → 자율 사이클 품질 ↑

## 미해결 질문

- **Q1**: Educational Nudge 발동을 코드(휴리스틱)로 판단할지, PM 모델 추론에 맡길지? → 코드는 *키워드 감지 + 컨텍스트 슬라이스*까지만, *발동 결정*은 PM 모델에 맡기는 게 정합 (over-engineering 회피).
- **Q2**: `signals.jsonl`의 metric record는 누가 채우는가? → 1차 사용자 수동 입력 / 2차 v0.6 routine(`Signal Scan`)이 자동 추출 / 3차 `data-collector` agent가 stripe/meta-ads MCP에서 자동 수집 (장기).
- **Q3**: Experiment Proposal에서 evaluator가 생성한 후보 가설의 책임 소재는? → 사용자가 *선택한* 가설은 사용자 책임, 자동 채택(`auto_pick_next: true`)은 *워크스페이스 설정 시점에 사용자 동의 명시 필요*.
- **Q4**: Board of Agents 메타포가 messenger 톤과 안 맞으면? → org-level override를 v0.6 `<org>/agent-profile.yaml`로 허용 (이미 v0.6 §2.2에 base 존재).

## 다음 액션

1. **즉시 적용 (v0.6 plan 검토 항목으로 추가)**: 패턴 1, 2, 4 — `docs/plan/v0.6-default-workflow-tuning.md`의 §16 작업 계획 절에 다음 3개 작업을 후보로 추가:
   - "orchestrator/SKILL.md Educational Nudge 절 신설"
   - "agent frontmatter `metric_dependencies` + Layer 7 metric-pack 서브레이어"
   - "orchestrator/SKILL.md Board of Agents 톤 재작성 + 충돌 표면화 절"
2. **v0.4와 함께 (또는 그 후)**: 패턴 3 — v0.4 autonomous engine 본체 구현 시 `proposeNextHypothesis()` 노드를 *초기 sketch에 포함* (지금부터 설계 검토 권장).
3. **cross-reference**:
   - `2026-05-14-agent-view-teams-application.md`의 제안 A(Plan Approval) ↔ 본 문서 패턴 1(Educational Nudge) — 둘 다 "stage 실행 전 정렬" 패턴이라 함께 검토.
   - 본 문서 패턴 2(metric injection) ↔ 위 문서 제안 G(토큰 예산 가드) — metric pack 도입으로 spawn token이 늘면 G의 예산 압박 ↑, 함께 튜닝.
