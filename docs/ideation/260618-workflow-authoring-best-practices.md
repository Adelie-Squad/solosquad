# workflow 정의의 모든 것 — 워크플로 엔진·멀티에이전트 오케스트레이션 전수 분석과 SoloSquad 전략

> **청자:** SoloSquad 개발자(본인). dev 워크플로·내부 구현 관점의 설계 메모이며,
> 확정 기획(PRD)이 아니라 방향 탐색이다. v1.3.2 `workflow-manager`(`docs/prd/v1.3.2-domain-lifecycle-managers.md` §5) 의 근거 문서.
>
> **문서 목적.** "좋은 workflow 란 무엇인가"의 단일 레퍼런스. 우리는 workflow 를 두 방향으로
> 다룬다 — ⑴ `skills/workflow-maker/assets/workflows/*/workflow.yaml`(번들 템플릿)처럼 직접 *쓰는*
> 쪽, ⑵ `workflow-maker`/`workflow-refinement` skill + `workflow-resolver.ts`·`workspace-meta.ts`
> 로 *생성/실행/추적하는* 쪽. 전통 워크플로 엔진 8종(Temporal·Step Functions·Airflow·GitHub
> Actions·n8n·Argo·Prefect/Dagster·BPMN) + AI 에이전트 오케스트레이션 5종(LangGraph·CrewAI·
> AutoGen/Magentic-One·OpenAI Agents SDK·Anthropic 패턴) 을 전수 조사해 **객관적 현황 →
> 인사이트 → SoloSquad 전략** 순으로 정리한다.
>
> **조사 방법 주의.** 병렬 리서치 에이전트의 웹 조사(2026-06-18) 결과. 정량 수치(이벤트 한도
> 등)는 1차 공식 문서에서 수집했으나 일부는 검색 스니펫 교차검증 — verbatim 인용 전 라이브
> 페이지 재확인 권장. 본문에 [미검증] 표기.

---

## 목차

- **Part A** — TL;DR (한 장 요약)
- **Part B** — 기준선: Anthropic "Building Effective Agents" 5 패턴
- **Part C** — 객관적 현황: 워크플로 엔진 8종 (정의 모델·프리미티브)
- **Part D** — 객관적 현황: AI 에이전트 오케스트레이션 5종
- **Part E** — 반복되는 설계 패턴 (saga·idempotency·retry·HITL·관측)
- **Part F** — 인사이트 (수렴점·차이점)
- **Part G** — SoloSquad 적용 전략 (`workflow.yaml` 매핑)
- **Part H** — 궁극의 체크리스트
- **출처**

---

# Part A — TL;DR

1. **모두가 동의하는 workflow 의 본질 = 작업 노드 + 방향성 의존 엣지.** 거기에 ⑵조건분기 ⑶재시도(지수백오프+지터) ⑷타임아웃 ⑸에러처리/보상 ⑹종료/게이트 가 거의 보편 프리미티브.
2. **가장 큰 분기축은 "사이클 허용 여부".** DAG 엔진(Airflow·Argo·Dagster·GitHub job 그래프)은 **순환 금지 + 제출 시 검증**, 상태머신/코드/노드그래프(Step Functions·Temporal·n8n·BPMN·LangGraph)는 루프 허용.
3. **SoloSquad 의 `workflow.yaml` 은 이미 업계 합의(노드+`depends_on` 엣지 + `hard_gate`/`exit_criteria` 게이트 + `_handoff.md` 컨텍스트 패싱 + `_events.jsonl` 이벤트소싱)에 정렬돼 있다.** 단 — **`validateWorkflow` 부재**가 최대 갭. `depends_on` 이 있으니 **순환 검증(Kahn O(V+E))** 은 거의 보편 검증 단계인데 우리는 안 한다.
4. **우리 스키마에 없으나 모든 엔진에 있는 것:** stage 별 **명시적 retry policy**·**timeout**, 실패 시 **보상/롤백**, **사이클 허용 여부의 명문화**(우리는 "ordered stages" → DAG 로 보이지만 강제 안 함).
5. **"단순하게 시작" 이 보편 충고**(Anthropic·OpenAI·AutoGen 모두). 정적 체인 < 정적 DAG < 동적 오케스트레이션 순으로 복잡도·토큰 증가 — 유연성이 진짜 필요할 때만 위로.

---

# Part B — 기준선: Anthropic "Building Effective Agents" 5 패턴

Anthropic 공식 글이 우리 도메인(LLM 오케스트레이션)의 정본 기준선이다. 핵심 구분:
**Workflow** = "LLM·툴을 *사전 정의된 코드 경로*로 오케스트레이션", **Agent** = "LLM 이 *동적으로* 자기 프로세스·툴 사용을 지휘".

**5개 명명 패턴:**
1. **Prompt chaining** — 순차 단계, 각 단계가 직전 출력을 처리, 단계 사이 **프로그래밍적 게이트**.
2. **Routing** — 입력 분류 → 전문화된 후속으로 라우팅.
3. **Parallelization** — *sectioning*(독립 하위작업) + *voting*(같은 작업 반복 투표).
4. **Orchestrator-workers** — 중앙 LLM 이 *동적으로* 분해·위임 후 합성(하위작업 사전정의 안 됨).
5. **Evaluator-optimizer** — 생성기 + 평가기 피드백 루프.

**지침:** "Start simple"; "Workflow 는 잘 정의된 작업에 예측가능성·일관성, Agent 는 유연성·모델주도 판단이 규모에서 필요할 때". 패턴은 조합 가능(prescriptive 아님). [미검증: 인용은 WebFetch 요약 — 패턴명·정의는 복수 출처 교차확인].

**SoloSquad 매핑:** Chief 6+1 stage 머신은 **Orchestrator-workers**(Chief 가 분해·위임·합성). `workflow.yaml` 의 정적 stage 체인은 **Prompt chaining + Routing**. `hard_gate`/`exit_criteria` 는 chaining 의 "게이트". `workflow-refinement` 의 회고는 **Evaluator-optimizer** 의 평가기 역할.

---

# Part C — 객관적 현황: 워크플로 엔진 8종

## C.1 정의 모델 한눈에

| 엔진 | 코어 모델 | 노드 | 엣지 | 조건분기 | 재시도 기본 | 타임아웃 | 보상 | 사이클 | 대표 한도 |
|---|---|---|---|---|---|---|---|---|---|
| **Step Functions (ASL)** | 상태머신(JSON) | State | `Next`/`End` | `Choice` | MaxAttempts 3, ×2.0 | `TimeoutSeconds` | `Catch` fallback | 허용 | 25k events·256 KiB I/O·정의 1MB |
| **Temporal** | 코드(durable) | (코드) | 제어흐름 | if/else | 무제한, ×2.0 | activity 4종 타임아웃 | Saga(코드) | 루프 허용 | 51,200 events/50 MB |
| **Airflow** | DAG(Python) | Task | `>>`/`<<` | `@task.branch` + 12 trigger rule | 연산자별(≈0 [미검증]) | `execution_timeout` | trigger rule | **금지** | 비순환 |
| **GitHub Actions** | jobs-DAG + 순차 step | Job/Step | `needs:` | `if:` | 네이티브 없음 | `timeout-minutes`(360) | `continue-on-error` | **금지**(job) | run 35일·matrix 256 |
| **n8n** | 데이터플로 그래프 | Node | `connections`(소스명) | IF/Switch | maxTries ≤5 | host 설정 | error workflow/output | 허용 | tries≤5·wait≤5000ms |
| **Argo** | K8s DAG/steps | Task/Step | `depends`/리스트중첩 | `when:` | OnFailure·지수백오프 | `activeDeadlineSeconds` | `onExit` | **금지**(제출시 reject) | 비순환 |
| **Prefect/Dagster** | 명령형/동적 DAG·asset 그래프 | Task/Asset | future·`deps`/`ins` | Python if/else | 0·RetryPolicy max1 | `timeout_seconds` | 코드·run retry | Dagster 비순환 | — |
| **BPMN 2.0** | 프로세스 다이어그램 | Activity | Sequence Flow | gateway(XOR/AND/OR/event) | 엔진별 | timer boundary event | compensation event | 허용 | — |

## C.2 핵심 관찰

- **Step Functions** — 명시적 상태머신. 8 state type(Task·Choice·Parallel·Map·Pass·Wait·Succeed·Fail). Retry/Catch 가 state 1급 필드. 나열 순서 ≠ 실행 순서(`Next` 가 결정).
- **Temporal** — "workflow-as-code, durable execution". 선언적 DAG 아님. **결정성 제약**(wall-clock·RNG·UUID·외부호출 금지 → Activity 로). Saga 는 코드로(보상 역순 실행). Continue-As-New 로 이벤트 한도 회피.
- **Airflow/Argo/Dagster** — DAG, **비순환 강제**. Argo 는 제출 시 `verifyNoCycles` → "dependency cycle detected" reject. Airflow 는 토폴로지 정렬식 탐지.
- **GitHub Actions** — 하이브리드: job 은 `needs:` DAG, step 은 순차. 네이티브 step 재시도 없음.
- **n8n** — 데이터플로. `connections` 가 **소스 노드 이름** 키. 노드별 `onError`(Stop/Continue/error-output) + `retryOnFail`.
- **BPMN** — 4 범주(Flow Object·Connecting·Swimlane·Artifact), gateway 4종(XOR 1경로/AND 전체포크조인/OR 참인경로/event 첫이벤트). **compensation event 가 핸들러 역순 실행** [미검증: OMG PDF 손상, Camunda 2차 출처 교차].

**반복 프리미티브(거의 전 엔진):** ①작업 노드 ②방향 의존 엣지 ③조건분기 ④지수백오프 재시도 ⑤타임아웃 ⑥에러처리/보상 ⑦종료/exit 개념. idempotency·관측성은 보편 *요구사항*이나 스키마 1급 필드인 경우는 드묾.

---

# Part D — 객관적 현황: AI 에이전트 오케스트레이션 5종

- **LangGraph** — 공유 `State` 위의 방향 상태그래프, **사이클 1급**. reducer 로 state 병합 제어. **체크포인팅/HITL 이 이 군에서 최강**(`interrupt()` 무기한 일시정지 + `Command(resume=)`). 주의: resume 시 노드가 **처음부터 재실행** → interrupt 전 부작용은 idempotent 해야.
- **CrewAI** — 역할 에이전트 + 태스크 + Process(`sequential` vs `hierarchical`). hierarchical 은 **manager 에이전트**가 동적 위임·검증. `Task.context` 로 비인접 출력 체이닝. [미검증: durable checkpoint/HITL 문서 부재].
- **AutoGen + Magentic-One** — Team 내 그룹챗(RoundRobin·Selector·MagenticOne·Swarm). 조합형 종료조건(`MaxMessage`·`TextMention`·`External` 을 `|` 결합). **Magentic-One 의 ledger 패턴**: Task Ledger(사실·추측·계획, 외부루프) + Progress Ledger(스텝별 5질문, 내부루프) + **stall counter**(임계 ≤2) → 재계획.
- **OpenAI Agents SDK** — Agents + **Handoffs**(위임, "새 에이전트가 대화 소유") + **Guardrails**(input/output, **tripwire** 가 raise 후 중단) + Sessions(메모리) + **Tracing 기본 on**. 에이전트 루프 `max_turns`. (전신 Swarm 은 stateless·실험용.)
- **Anthropic** — Part B 참조.

**합의(체인 vs DAG vs 동적):**
- **순차/prompt chaining** — 잘 정의된 분해 가능 작업. 지연↔정확도 트레이드.
- **DAG/정적 병렬** — 하위작업 사전 파악 + 독립(sectioning, fan-out).
- **동적 오케스트레이션** — 하위작업 예측 불가 → orchestrator-workers/hierarchical/Magentic ledger. 예측가능성·토큰 비용.
- **보편 충고** — 작동하는 가장 단순한 구조; 유연성이 진짜 요구될 때만 동적으로.

---

# Part E — 반복되는 설계 패턴

- **DAG vs 상태머신 vs 코드** — DAG 비순환은 토폴로지 순서 + 명확한 시작/끝 + 병렬화 보장. 상태머신은 명시 흐름 state(Choice/Parallel/Map) + 루프 관용. 코드(Temporal)는 가시성↔표현력 트레이드.
- **Saga / 보상** — 로컬 트랜잭션 시퀀스, 실패 시 **보상 트랜잭션**(idempotent, 꼭 역순 아님). 오케스트레이션(중앙·SPOF) vs 코레오그래피(이벤트·확장시 혼란). (microservices.io·Azure architecture)
- **Idempotency / 전달** — 정확히-한번 전달은 **불가능** → 적어도-한번 + idempotent 처리 = "사실상 한번". 클라이언트 idempotency key(Stripe `Idempotency-Key` ≤255자) + mutation 과 원자적 기록. (bravenewgeek·Stripe·AWS Builders' Library)
- **Retry** — capped 지수백오프 + **지터**(AWS: Full Jitter 최선). transient 만 재시도. budget 으로 bound(Google SRE: ~3회/요청, 재시도 ≤10%, 단일 레이어). DLQ + circuit breaker.
- **HITL / hard gate** — GitHub Environments required reviewers + wait timer; Step Functions `.waitForTaskToken`(`SendTaskSuccess/Failure` 로 resume); **SonarQube quality gate = measure+operator+threshold** ("출시 준비됐나?"). (GitHub·AWS·SonarSource)
- **관측 / 이벤트 로그** — Event Sourcing(append-only 이벤트가 진실원, replay 로 state 재구성, "100% 신뢰 감사로그"); 외부계는 Gateway 로 감싸 replay 시 부작용 재발 방지. OpenTelemetry trace(span + W3C `traceparent`). (Fowler·microservices.io·OTel)
- **사이클 검증** — 방향그래프 비순환 ⟺ 토폴로지 순서 존재. **Kahn**(in-degree-0 워크리스트, 잔여엣지 ⇒ 사이클) 또는 DFS back-edge, 둘 다 **O(V+E)**. 노드/그래프는 **JSON Schema** 로.
- **Fan-out/in** — Scatter-Gather + **Aggregator**(correlation + 완료조건: Wait-for-All/Timeout/First-Best/External). Step Functions `Parallel`(고정) vs `Map`(Inline ≤40 / Distributed ≤10,000).

---

# Part F — 인사이트

## F.1 강한 수렴 (거의 모두 동의)
1. workflow = **노드 + 방향 의존 엣지**. 보편.
2. **조건분기**는 1급 필요(Choice/`if`/gateway/conditional edge).
3. **capped 지수백오프 재시도** + 지터가 기본 실패전략.
4. **타임아웃**은 작업단위 필수(여럿이 명시 설정 강권).
5. **idempotency**가 안전한 재시도·보상·HITL-resume 의 전제.
6. **append-only 이벤트 로그/tracing 관측성**은 옵션 아닌 필수.
7. **명시적 종료 state + 단계 사이 게이트** 개념.
8. **"단순 시작, 필요 시만 동적으로"** — Anthropic·OpenAI·AutoGen 수렴.

## F.2 의미있는 분기 (명시적 선택 필요)
1. **사이클** — DAG 엔진 금지+검증 vs 상태머신/코드/노드그래프/agent 그래프 허용. **최대 분기축.**
2. **선언적 vs 명령형** — ASL/Argo/BPMN/n8n vs Temporal/Prefect/Dagster/LangGraph. 가시성↔표현력.
3. **정적 vs 동적 오케스트레이션** — 사전 전체 그래프 vs 런타임 결정.
4. **보상** — 선언적(Catch·compensation event·`onExit`) vs 수기 saga.
5. **HITL 성숙도** — LangGraph/Step Functions 1급·durable vs CrewAI/AutoGen 미문서.
6. **state/컨텍스트 패싱** — 공유 가변 state+reducer(LangGraph) vs 태스크별 context 리스트(CrewAI) vs 메시지 브로드캐스트(AutoGen) vs 엣지-페이로드(대부분).

---

# Part G — SoloSquad 적용 전략

현재 상태(`workflow-maker`/`workflow-refinement` skill + `workflow-resolver.ts`·`workspace-meta.ts`·`workflow-reconciler.ts`):
SoloSquad 의 workflow 는 이미 합의에 정렬. 매핑:

| 우리 것 | 업계 대응 |
|---|---|
| ordered stages + `depends_on` | 보편 노드+엣지 DAG(Airflow `>>`·Argo `depends`·GitHub `needs`) |
| `agent: <team>/<specialist>` | 노드 실행자 바인딩(Airflow operator·ASL `Resource`·CrewAI task agent) |
| `hard_gate` + `exit_criteria` | 수렴된 "게이트"(Anthropic gate·SonarQube quality gate·GitHub required reviewer) |
| `handoff_to` + `_handoff.md` | 명시 컨텍스트-패싱 엣지(Swarm handoff·CrewAI `Task.context`·AutoGen `HandoffMessage`) |
| `_status.yaml` + `_events.jsonl` | 런타임 state + append-only 이벤트 로그 = Event Sourcing 정합(state 를 `_events.jsonl` replay 로 도출 가능) |
| Chief 6+1 stage 머신 | Orchestrator-workers + Magentic-One ledger(Task/Progress Ledger + stall counter 와 유사) |

## G1. `validateWorkflow` 신설 (P0 — 최대 갭, v1.3.2 §5)
현재 템플릿은 사전검증되나 **사용자 커스텀/생성 인스턴스는 무검증**. 신설:
- **순환 의존 탐지** — `depends_on` 그래프에 Kahn O(V+E). Argo/Airflow 가 하는 거의 유일한 보편 검증.
- stage `id` 유일성, `agent` 형식(`<team>/<agent>`·`_main/`·`_skill/`) 실존성, `handoff_to`/`depends_on` 도달성(고아 stage).
- `exit_criteria`/`hard_gate` 문법, `target_repo` 존재성.
- JSON Schema 로 `workflow.yaml` 형식 검증.

## G2. 스키마 갭 보강 검토 (P1)
모든 엔진에 있으나 우리 스키마엔 없는 것 — 추가 검토:
- stage별 **명시적 retry policy**(max attempts + 백오프) — 현재 암묵.
- stage별 **timeout** — 현재 host 레벨.
- 실패 시 **보상/롤백** 또는 `needs_revision` 외 명시적 fallback.
- **사이클 허용 여부 명문화** — "ordered stages" 면 DAG → 비순환 강제. (Chief 동적 재계획은 별도 레이어로 두고 정적 `workflow.yaml` 은 DAG 유지 권장.)

## G3. `exit_criteria` 를 측정가능 조건으로 (P1)
SonarQube quality gate 처럼 **measure+operator+threshold** 구조 권장(자유서술 → 검증가능). `workflow-refinement`(Evaluator-optimizer) 가 이를 자동 판정·게이팅하는 refine 루프로 확장(v1.3.2 §5).

## G4. 비범위 (v1.4+)
병렬 stage(async merge·fan-out/in Aggregator), 워크플로 중첩/파라미터화, artifact manifest, durable HITL resume(LangGraph `interrupt()` 식).

---

# Part H — 궁극의 체크리스트

좋은 `workflow.yaml` 작성·검증 시:

- [ ] stage 는 **작업 노드 + `depends_on` 엣지**로 표현됐는가
- [ ] **순환 의존이 없는가**(Kahn 검증) — 정적 워크플로는 DAG
- [ ] 각 stage `id` 가 유일하고, `agent` 가 실존(`<team>/<agent>`·`_main/`·`_skill/`)하는가
- [ ] `handoff_to`/`depends_on` 가 모두 도달 가능(고아 stage 없음)한가
- [ ] `exit_criteria` 가 **측정가능**(measure+operator+threshold)한가, `hard_gate` 의미 명확한가
- [ ] stage 실패 시 거동(`needs_revision`/보상/재시도)이 정의됐는가
- [ ] 타임아웃·재시도 정책이 (적어도 host 레벨에서) 있는가
- [ ] 재실행/resume 이 안전(idempotent)한가 — `_handoff.md` 부작용 재발 방지
- [ ] `_events.jsonl` 로 state 를 replay·감사할 수 있는가
- [ ] 정적 체인으로 충분한데 동적 오케스트레이션을 과하게 쓰지 않았는가("start simple")

---

## 출처

### Anthropic / 에이전트 패턴
- Building Effective Agents — https://www.anthropic.com/engineering/building-effective-agents

### 워크플로 엔진
- AWS Step Functions / ASL — https://docs.aws.amazon.com/step-functions/latest/dg/statemachine-structure.html · error-handling · service-quotas
- Temporal — https://docs.temporal.io/workflow-definition · /encyclopedia/retry-policies · /workflow-execution/limits
- Apache Airflow — https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html
- GitHub Actions — https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions · reference/limits
- n8n — https://docs.n8n.io/workflows/ · /flow-logic/error-handling/
- Argo Workflows — https://argo-workflows.readthedocs.io/en/latest/workflow-concepts/ · /enhanced-depends-logic/ · /retries/
- Prefect — https://docs.prefect.io/v3/develop/write-tasks · Dagster — https://docs.dagster.io/api/dagster/ops
- BPMN 2.0 — https://www.omg.org/spec/BPMN/2.0/ · https://camunda.com/bpmn/reference/

### AI 에이전트 프레임워크
- LangGraph — https://docs.langchain.com/oss/python/langgraph/graph-api · /persistence · /interrupts
- CrewAI — https://docs.crewai.com/en/concepts/processes · /tasks
- AutoGen — https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/tutorial/teams.html · Magentic-One arXiv https://arxiv.org/html/2411.04468v1
- OpenAI Agents SDK — https://openai.github.io/openai-agents-python/ · /guardrails/ · /tracing/ · Swarm https://github.com/openai/swarm

### 설계 패턴
- Saga — https://microservices.io/patterns/data/saga.html · Azure https://learn.microsoft.com/en-us/azure/architecture/patterns/saga
- Idempotency — Stripe https://docs.stripe.com/api/idempotent_requests · AWS https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
- Retry/jitter — https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ · Google SRE https://sre.google/sre-book/handling-overload/
- Quality gate — https://docs.sonarsource.com/sonarqube-server/10.5/user-guide/quality-gates
- Event Sourcing — https://martinfowler.com/eaaDev/EventSourcing.html · OpenTelemetry https://opentelemetry.io/docs/concepts/signals/traces/
- 토폴로지 정렬 — https://en.wikipedia.org/wiki/Topological_sorting · JSON Schema https://json-schema.org/

## 레포 내 관련 코드
- `skills/workflow-maker/SKILL.md` · `skills/workflow-refinement/SKILL.md` · `skills/workflow-maker/assets/workflows/*/workflow.yaml`
- `src/bot/workflow-resolver.ts` · `src/bot/workspace-meta.ts` · `src/bot/workflow-reconciler.ts` · `src/bot/spawn-prompt-markers.ts`
- `src/analyze/workflow-matcher.ts` · `agents/main/chief/SKILL.md`(stage 머신)
