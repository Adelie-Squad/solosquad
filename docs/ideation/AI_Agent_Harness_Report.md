# AI 에이전트 및 하네스 엔지니어링 기술 분석 보고서

본 보고서는 현대 AI 아키텍처의 핵심 요소인 '스킬(Skill)'과 '에이전트(Agent)'의 정의 및 차이점을 분석하고, 에이전트의 안정성과 확장성을 보장하는 '하네스 엔지니어링(Harness Engineering)'의 최신 동향과 구축 사례를 정리합니다. 2026-05-14 개정에서 **1인 기업/소규모 팀을 위한 멀티 리포지토리 + Skill-Bus 아키텍처 제안**과 **SoloSquad 현재 아키텍처와의 비교 분석**을 추가했습니다.

---

## 1. Skill vs Agent: 개념 및 아키텍처 분석

### 1.1 정의 및 비교
현대 AI 시스템은 도구(Tool) → 스킬(Skill) → 에이전트(Agent)의 계층 구조로 발전하고 있습니다.

| 구분 | Skill (스킬) | Agent (에이전트) |
| :--- | :--- | :--- |
| **정의** | 패키징된 전문 지식 및 절차적 로직 | 자율적 목표 달성 주체 (Orchestrator) |
| **역할** | "어떻게(How)"에 대한 가이드라인 | "무엇(What)"을 할지 결정하고 실행 루프 관리 |
| **상태 관리** | 무상태(Stateless) 성격이 강함 | 상태(Stateful)를 유지하며 메모리 관리 |
| **비유** | 특정 업무의 '매뉴얼' 또는 '자격증' | 상황에 맞춰 판단하는 '현장 요원' |

### 1.2 최신 컨텍스트 관리 구조
* **계층적 메모리 (Layered Memory):** 영구(Persistent), 에피소드(Episodic), 일시적(Transient) 컨텍스트로 분리하여 효율성 극대화.
* **점진적 스킬 로딩 (Just-in-Time Injection):** 필요한 순간에만 상세 지침을 로드하여 컨텍스트 비대화 방지.
* **그래프 기반 상태 머신:** 선형적 체인이 아닌 노드(Node)와 엣지(Edge)를 통한 복잡한 분기 및 루프 제어.

---

## 2. AI 에이전트 하네스 엔지니어링 (Harness Engineering)

### 2.1 하네스의 역할
에이전트 하네스는 모델(두뇌)이 외부 환경과 안전하게 상호작용하도록 돕는 제어 인프라입니다.

### 2.2 핵심 기술 구조
1.  **MCP (Model Context Protocol):** 에이전트와 외부 도구/데이터 간의 표준화된 통신 규약.
2.  **계층적 가드레일 (Hierarchical Guardrails):** 입력 검증(Input), 실행 모니터링(Runtime), 출력 검증(Output)의 3단계 제어.
3.  **에이전틱 메모리 파이프라인:** 단순 로그 저장을 넘어선 인지적 회상 및 자기 성찰(Reflection) 로직 포함.

---

## 3. 멀티에이전트 협업 및 워크플로우 제어

복잡한 비즈니스 목표 달성을 위해 여러 에이전트가 협업하는 구조는 다음과 같이 분류됩니다.

* **계층적 오케스트레이션:** 관리자 에이전트가 작업을 분할하고 전문 에이전트에게 할당.
* **그래프 기반 협업:** 공유 상태 객체(Global State)를 바탕으로 조건부 루핑과 피드백 수행.
* **동적 라우팅:** 시맨틱 유사성에 따라 적합한 에이전트에게 메시지를 전달하는 버스(Bus) 구조.

---

## 4. 데이터 및 지표(Metric) 체계

에이전트가 실험(A/B Test 등)을 주도하기 위해서는 데이터에 대한 명확한 정의가 필요합니다.

* **파생 지표 (Derived Metric):** 서로 다른 도메인(이기종 데이터)의 필드를 조합하여 생성한 새로운 지표.
* **데이터 정합성 검증 (Data Reconciliation):** 지표 산출 로직과 데이터 마트 원천값의 일치 여부를 확인하는 필수 작업.
* **교차 도메인 데이터:** 마케팅, 재무 등 서로 다른 영역의 데이터를 결합한 상태.

---

## 5. 선두적인 구축 및 레퍼런스 사례

### 5.1 Salesforce 'Agentforce'
* **특징:** Atlas Reasoning Engine을 통한 데이터 권한 제어 및 신뢰 계층(Trust Layer) 구축.
* **강점:** 기업 데이터 참조 시 리니지(Lineage)를 시각화하여 AI의 투명성 확보.

### 5.2 Microsoft 'AutoGen'
* **특징:** 멀티에이전트 협업 프레임워크의 선두주자로, 에이전트 간 대화 그래프 관리.
* **강점:** 복잡한 워크플로우 디버깅 및 에이전트 간 합의 알고리즘 구현 용이.

### 5.3 Venture Architect (가칭) 아키텍처
* **목표:** PMF 검증 및 GTM 전략 수립을 위한 애자일 실험 중심 워크플로우.
* **구조:** BM 전문가, 성장 해커, 브랜드 에이전트가 마스터 에이전트의 지휘 하에 가설 수립부터 실행까지 담당.

---

## 6. 1인 기업/소규모 팀을 위한 이상적 아키텍처 — "중앙 오케스트레이터 + 분산 스킬 레지스트리"

> 2026-05-14 통합. 1인 기업/소규모 팀이 멀티 리포지토리 환경에서 전문적인 비즈니스 가설 검증(PMF, GTM)을 수행하기 위한 청사진. §1~§5의 개념을 구체적 아키텍처와 기술 스택으로 환원한 것.

### 6.1 멀티 리포지토리 구성 전략 (Separation of Concerns)

복잡한 비즈니스 로직과 기술적 구현을 분리하기 위해 **최소 3개의 핵심 저장소**로 나누어 관리하는 것이 확장성과 유지보수 면에서 가장 우수합니다.

#### ① `repo-core-orchestrator` (The Harness)
에이전트의 '뇌'와 '중추신경계'가 위치하는 곳.
- **역할:** 전체 워크플로우 그래프 정의, 권한 제어, 하네스 가드레일 설정.
- **핵심 기능:** 어떤 상황에서 어떤 에이전트를 호출할지 결정하는 라우팅 로직과 상태 관리(State Management).

#### ② `repo-specialized-skills` (The Expertise)
사용자가 부족한 도메인 지식(BM, 마케팅, 가격 정책)이 집약된 저장소.
- **역할:** 각 분야 전문가의 '페르소나'와 '프롬프트 지침', '도구(Tools)'의 집합.
- **구조:** `/marketing`, `/business-model`, `/legal-compliance` 등 디렉토리별로 독립적인 스킬셋 관리.
- **특징:** 새로운 비즈니스 전략이 나올 때마다 이 리포지토리만 업데이트하면 모든 에이전트의 지능이 동시에 업그레이드됨.

#### ③ `repo-data-context` (The Memory)
실험 데이터(A/B 테스트 결과, 사용자 피드백)와 지표 정합성을 관리.
- **역할:** 데이터 마트 스키마 정의, 파생 지표 산출 로직(SQL/Python), 시맨틱 레이어 관리.
- **특징:** 에이전트가 "데이터에 기반해 제안"할 수 있도록 신뢰할 수 있는 소스(Single Source of Truth) 역할.

### 6.2 "Skill-Bus" 아키텍처 — MCP 기반 시맨틱 버스

멀티 리포지토리의 파편화된 정보를 하나로 묶기 위해 MCP(Model Context Protocol)를 활용한 시맨틱 버스(Semantic Bus) 구조를 사용합니다.

- **동적 스킬 로딩:** 사용자가 "GTM 전략을 짜줘"라고 요청하면, 코어 오케스트레이터가 `repo-specialized-skills`에서 마케팅 관련 MCP 서버를 활성화. (§1.2 JIT Injection의 구체 구현)
- **의존성 주입 (Dependency Injection):** BM 에이전트가 가격 정책을 세울 때, `repo-data-context`에 정의된 '유사 업종 평균 결제액' 지표를 자동으로 참조하도록 하네스가 데이터를 주입.
- **가설 기반 분기:** 워크플로우는 단순 선형 구조가 아닌, "실험 데이터가 가설을 충족했는가?"라는 조건에 따라 다음 노드로 이동(Next Step)하거나 가설을 수정(Pivot)하는 **순환 그래프** 형태로 관리. (§3 그래프 기반 협업의 PMF 특화 변형)

### 6.3 사용자 경험 — 에이전트의 전문성 발휘 방식

사용자가 도메인 지식이 없는 분야(예: 가격 정책)에 대해 에이전트는 두 가지 패턴으로 개입합니다.

- **교육적 개입 (Educational Nudge):** 사용자가 막연한 가격을 제시하면, 에이전트는 `repo-specialized-skills`의 "SaaS 가격 전략 스킬"을 꺼내 *"현재 시장의 LTV/CAC 비율은 3:1이 적합합니다. 이에 따른 가격 구간은…"* 가이드를 제공.
- **실험적 제안 (Experiment Proposal):** *"단순히 예쁘게 만드는 것보다, PMF 검증을 위해 A/B 테스트가 필요합니다. A안은 편의성 강조, B안은 가격 경쟁력 강조로 설계하겠습니다."*처럼 워크플로우의 다음 단계를 자율 제안.

### 6.4 권장 기술 스택 (2026 기준)

| 구분           | 추천 기술                            | 이유                                                  |
| :------------- | :----------------------------------- | :---------------------------------------------------- |
| Orchestration  | LangGraph v3                         | 상태 유지 및 복잡한 조건부 루프 제어의 표준           |
| Communication  | MCP (Model Context Protocol)         | 멀티 리포지토리 간 도구 및 컨텍스트 공유 용이         |
| Validation     | PydanticAI                           | 데이터 정합성 및 타입 체크를 통한 실행 안정성 확보    |
| Memory         | Vector DB + Graph DB (Hybrid)        | 정적 지식(Skill)과 동적 관계(Workflow) 동시 관리      |

### 6.5 메타포 — "Board of Agents"

가장 이상적인 구조는 **"내가 명령을 내리는 비서"가 아니라 "나와 함께 스타트업을 운영하는 전문 이사회(Board of Agents)"** 형태입니다.

각 리포지토리는 이사회 멤버들의 전문 지식 창고이며, 하네스는 이들이 서로 싸우지 않고 데이터에 기반해 결론을 도출하도록 만드는 운영 체계입니다.

---

## 7. SoloSquad 현재 아키텍처와의 비교 분석

> 본 보고서의 §6 청사진을 SoloSquad 현재 구현(v0.5 진행 / v0.6 plan)에 매핑하고, 정합/차이/채택 가치를 평가합니다.

### 7.1 매핑 — 청사진 vs SoloSquad 현실

| 청사진 (§6)                  | SoloSquad 현재                                                                     | 분리 수준               |
| :--------------------------- | :--------------------------------------------------------------------------------- | :---------------------- |
| `repo-core-orchestrator`     | `src/bot/` (PM runner, reconciler) + `src/cli/` + `src/scheduler/` + `src/engine/`(v0.4) | 디렉토리 (단일 npm 패키지) |
| `repo-specialized-skills`    | `assets/agents/{team}/{agent}/SKILL.md` (25명) + v0.6 `agents/{team}/KNOWLEDGE.md` + `assets/knowledge/` | 디렉토리                |
| `repo-data-context`          | `<org>/memory/*.jsonl` + `<org>/domain/` + v0.6 FTS5 archive                       | 워크스페이스 디렉토리   |
| MCP Skill-Bus                | Claude Code 네이티브 MCP 호환 + `Task` 도구 위임                                    | 부분 적용               |
| LangGraph v3 (Python)        | TypeScript + Claude Code `Task` + `WorkflowReconciler` + `_status.yaml` 상태머신    | 패러다임 차이           |
| PydanticAI                   | TypeScript strict mode (no `any`) + 자체 타입                                       | 다른 도구로 동등        |
| Vector + Graph DB Hybrid     | JSONL append-only + (v0.6) FTS5 fallback                                            | 경량 대체               |
| 순환 그래프 (가설 기반 분기) | v0.4 `goal-runner` keep/discard 사이클 (planned)                                    | 부분 정합               |
| Educational Nudge            | 없음 — `orchestrator/SKILL.md`에 명시적 패턴 부재                                   | **갭**                  |
| Experiment Proposal          | v0.4 goal-runner가 부분 수행 가능 (자율 제안 노드 미정의)                            | **부분 갭**             |
| Dependency Injection (지표)  | v0.6 §2.2 8-layer JIT 컨텍스트 주입 (`<org>/memory/`, `<org>/domain/` 자동 포함)    | 정합                    |
| Board of Agents 메타포       | PM(orchestrator) + 4 teams × 25 agents — 구조는 일치, 톤은 "비서" 쪽에 가까움        | 부분 정합               |

### 7.2 정합 영역 (이미 청사진 방향과 일치)

- **SoC**: 청사진은 *리포지토리 분리*, SoloSquad는 *디렉토리 분리*. **본질적 분리 자체는 달성**되어 있음. core(`src/`) / skills(`assets/agents/`) / memory(`<org>/memory/`)의 3분할이 명확.
- **JIT 컨텍스트 로딩**: v0.6 §2.2의 8-layer 주입은 청사진의 "동적 스킬 로딩"과 메커니즘 동일. assets/`<org>` 분리도 이미 적용.
- **가설 기반 사이클**: v0.4 autonomous engine의 keep/discard는 청사진의 "Next Step / Pivot" 그래프와 메커니즘 일치.
- **MCP 호환**: Claude Code 네이티브 MCP 위에 올라가 있어 추가 도입 비용 없음.

### 7.3 갭 영역 (청사진이 더 앞서있는 부분)

- **Educational Nudge 패턴 부재**: 현재 `orchestrator/SKILL.md`는 "사용자가 막연한 입력을 줄 때 도메인 가이드를 먼저 제시한다"는 규칙이 명시되지 않음. 1인 창업자의 핵심 가치 제안(도메인 지식 보완)과 정확히 맞물리는 갭.
- **Experiment Proposal의 자율 노드 미정의**: v0.4 goal-runner가 metric-driven keep/discard는 하지만, "다음 실험 가설을 에이전트가 자율 제안" 노드는 v0.6에도 명시 없음.
- **의존성 주입의 지표 레이어**: 8-layer 주입에 `<org>/memory/`는 들어가지만, "BM stage에 LTV/CAC 추정치를 자동 첨부" 같은 *지표 특정 주입*은 룰화되지 않음.
- **데이터 정합성 검증(Reconciliation)**: §4의 핵심 항목이 SoloSquad 메모리(JSONL append-only)에 부재. 파생 지표를 산출하는 코드 경로가 없음.

### 7.4 청사진을 그대로 채택하기 어려운 영역

- **멀티 리포 물리 분리**: 1인 창업자가 3개 repo를 운영하는 비용 ↑. `solosquad init` 한 줄 셋업이 핵심 가치 — 디렉토리 분리로 충분히 SoC 달성 중.
- **LangGraph v3 / Python**: SoloSquad는 TypeScript + Claude Code Task 도구가 표준. 패러다임 전환 비용 ≫ 얻는 가치.
- **PydanticAI**: TypeScript strict mode + 자체 타입으로 동등 수준 달성. 신규 의존성 도입 불필요.
- **Vector + Graph DB Hybrid**: 1인 운영 인프라 부담. JSONL + (v0.6) FTS5로 같은 검색/회상 기능 경량 대체 가능.

### 7.5 채택 가치 — 패턴 4건만 추출

| # | 청사진 항목                | SoloSquad 적용 방안                                                              | 우선순위 |
| :- | :------------------------- | :-------------------------------------------------------------------------------- | :------- |
| 1 | Educational Nudge          | `assets/orchestrator/SKILL.md`에 "막연한 입력 감지 → 관련 도메인 KNOWLEDGE.md 가이드 우선 제시" 규칙 추가 | 높음      |
| 2 | Dependency Injection (지표) | v0.6 §2.2 8-layer 주입에 "stage 도메인 키워드별 지표 자동 첨부" 레이어 추가 (예: BM/Pricing stage → `signals.jsonl`의 LTV/CAC) | 높음     |
| 3 | Experiment Proposal 자율 노드 | v0.4 `goal-runner`에 "다음 가설 자율 제안 → 사용자 승인 → 사이클 진입" 단계 정의   | 중       |
| 4 | Board of Agents 메타포     | `orchestrator/SKILL.md` 톤 조정 — "PM이 비서가 아닌 이사회 의장" 프레이밍          | 낮음     |

### 7.6 채택 부적합 명시

- 멀티 리포 물리 분리 ✗
- LangGraph v3 마이그레이션 ✗
- PydanticAI 도입 ✗
- Vector + Graph DB 도입 ✗

### 7.7 cross-reference

- 채택 권고 1·2·3은 `docs/ideation/2026-05-14-agent-view-teams-application.md`의 제안 A(Plan Approval), C(File-disjoint Lock), G(토큰 가드)와 결합 가능. v0.6 plan(`docs/plan/v0.6-default-workflow-tuning.md`) 검토 항목으로 묶어서 평가 권장.

---

## 8. 결론 및 제언

성공적인 AI 에이전트 도입을 위해서는 **"Agent = Model + Skill + Harness"**의 공식이 성립되어야 합니다. 특히 사용자가 도메인 지식이 부족한 분야(BM, 마케팅 전략 등)에서는 전문성을 가진 스킬셋을 하네스 내에 사전에 정의하고, 실험 지표 기반의 그래프 워크플로우를 통해 PMF를 검증하는 구조가 가장 우수한 구조로 평가됩니다.

SoloSquad는 §6 청사진의 **구조적 분리(SoC) / JIT 컨텍스트 로딩 / 가설 기반 사이클 / MCP 호환**을 이미 디렉토리/모듈 레벨에서 달성하고 있습니다. 청사진을 *물리적 멀티 리포 + Python 스택*으로 그대로 채택하는 것은 1인 창업자 가치와 충돌하므로 부적합합니다.

대신, §7.5의 **패턴 4건(Educational Nudge / Dependency Injection / Experiment Proposal / Board of Agents 메타포)**을 v0.6 plan에 검토 항목으로 반영하는 것이 ROI 측면에서 가장 우수합니다.

---

**최초 작성일:** 2026년 5월 12일
**최근 개정:** 2026년 5월 14일 — §6 (1인 기업용 이상적 아키텍처) + §7 (SoloSquad 비교 분석) 추가
**주제:** AI 에이전트 스킬 및 하네스 엔지니어링 조사 + SoloSquad 적용 분석
