# agent 정의의 모든 것 — 멀티에이전트 오케스트레이션·actor 정의 전수 분석과 SoloSquad 전략

> **청자:** SoloSquad 개발자(본인). dev 워크플로·내부 구현 관점의 설계 메모이며,
> 확정 기획(PRD)이 아니라 방향 탐색이다. v1.3.2 `agent-manager`(`docs/prd/v1.3.2-asset-managers-validate.md` §5) 의 근거 문서.
>
> **문서 목적.** "좋은 agent(actor) 정의란 무엇인가"의 단일 레퍼런스. SoloSquad 에서 agent =
> `agents/{main,specialists}/<name>/SKILL.md`(frontmatter: name/description/tier/team/category/
> collaborators/skills_used/used_by/dev_capability + 본문 역할 프롬프트) + `agent-profile.yaml`
> (org 단위 tone/priorities/budget 수정자, 3-tier 상속, budget narrower-only invariant). main =
> 오케스트레이션 actor(Chief 가 DECOMPOSE→DISPATCH 로 동적 위임), specialist = bounded worker.
> agent 정의 포맷 6종(Claude Code subagent·OpenAI Agents SDK·CrewAI·AutoGen·A2A AgentCard·Copilot)
> + 오케스트레이션 토폴로지(supervisor·swarm·hierarchical·orchestrator-workers) + 역할 설계 원칙
> (SRP·right-altitude·least-privilege) + 실패 모드(MAST 14종·cascading error·무한 위임) 를 전수
> 조사해 **객관적 현황 → 인사이트 → SoloSquad 전략** 순으로 정리한다.
>
> **호출 층 정정(중요).** agent 는 ⓪ 직접 대화 디스패치(사용자→Chief→spawn, 휘발·동적·기본),
> ① workflow ② goal ③ schedule 네 가지로 호출된다. ①②③ 은 ⓪ 을 *박제·자동화*한 형태일 뿐
> — agent 가 호출보다 근본적이며, 어떤 호출이든 결국 actor 를 깨운다.
>
> **조사 방법 주의.** 병렬 리서치 에이전트의 웹 조사(2026-06-18). 1차 출처 다수 직접 fetch
> (Anthropic·OpenAI·CrewAI·A2A·MCP·MAST arXiv). 일부(LangGraph concepts JS-redirect, OWASP
> genai 원문, Cursor modes 스키마)는 2차 교차. 본문 [미검증]/[2차] 표기.
>
> **2026-06-22 갱신(v1.3.6 착수).** 추가 조사로 ⑴ **Vercel Eve**(filesystem-first agent 프레임워크 —
> agent=디렉터리, subagent=재귀 동형 디렉터리 → 新 **B.5**), ⑵ **personal-agent-template 의 메모리 패턴**
> (고정 5-카테고리·full-block replace·**human-approved** write·session-start 주입 → 新 **Part E.5 자가개선/
> 메모리**), ⑶ **agency-agents 실측 정정**(REQUIRED=name/description/color, 232 agent/16 division,
> orchestrator 의 "max 3 attempts/escalation", **check-agent-originality.sh** anti-reskin 게이트 → **B/D/G**)
> 를 통합했다. 이 갱신은 **v1.3.6 = "작성법 내재화 + 자가개선 asset 구조"** 의 agent 측 근거다 — E.5 가
> 메모리/학습 청사진, G 가 적용 경로. (skill 측 짝: `260617-skill-md-authoring-best-practices.md` Part F/B.6.)

---

## 목차

- **Part A** — TL;DR
- **Part B** — 객관적 현황: agent 정의 포맷 6종 + 오케스트레이션 토폴로지
- **Part C** — 역할/페르소나 설계 원칙 (SRP·right-altitude·least-privilege·tier)
- **Part D** — 오케스트레이션 패턴 (supervisor vs swarm·handoff vs agents-as-tools·멀티에이전트 득실)
- **Part E** — 실패 모드 & 가드레일 (MAST 14종·cascading·무한위임·HITL·budget)
- **Part F** — 인사이트 (수렴점·차이점)
- **Part G** — SoloSquad 적용 전략 (`agent-manager` 매핑)
- **Part H** — 궁극의 체크리스트
- **출처**

---

# Part A — TL;DR

1. **모든 프레임워크에 반복되는 agent 정의 = 4요소: 정체성(name·description) + 역량(tools·skills·model) + 경계(scope·clear task boundaries) + 위임 관계(handoffs·collaborators).** Google **A2A AgentCard** 가 이를 가장 명시적 표준으로 박제(name·description·capabilities·skills·provider·securitySchemes). Claude Code subagent·OpenAI SDK·Copilot 은 모두 **Markdown+YAML frontmatter 의 `name`/`description`/`tools`/`model` 4필드를 공유**.
2. **SoloSquad 의 agent `SKILL.md` frontmatter(name·description·tier·team·collaborators·skills_used·used_by·dev_capability)는 이미 이 슈퍼셋에 정렬**돼 있고, `agent-profile.yaml`(budget narrower-only)이 자율 오케스트레이션의 1차 가드레일 층. **빠진 건 그래프 무결성·순환 검증 + 생성 경로.**
3. **최대 분기축 둘:** ⑴ control-locus(workflow=개발자 고정 vs agent=LLM 동적 — Anthropic), ⑵ topology(supervisor 중앙집중 vs swarm 탈중앙 vs hierarchical). **SoloSquad Chief = orchestrator-workers/supervisor**(중앙 lead 가 동적 분해·위임·합성). specialist 는 bounded worker.
4. **"specialist > generalist" 가 보편 합의.** CrewAI "specialized roles", Anthropic "clear task boundaries", Claude Code "each subagent should excel at one specific task". 역할 중첩(role overlap)은 1급 안티패턴 — Anthropic 사례: 모호한 지시 시 subagent 들이 "**performed the exact same searches**".
5. **최대 갭 / 신호:** ⑴ frontmatter 그래프(collaborators·skills_used·used_by)의 **참조 무결성·순환 검증 부재** — workflow `depends_on` 과 동일한 Kahn 으로 해결. ⑵ **위임 budget(turn/depth)이 자식에 상속 안 되는 함정**(LangGraph SubAgentMiddleware 버그가 대표 사례 — 자체 harness 도 동일 리스크). ⑶ **역할 중첩 탐지 부재**(두 specialist 가 같은 일). ⑷ 무한 위임 루프 가드(recursion/depth cap) 부재.

---

# Part B — 객관적 현황: agent 정의 포맷 6종 + 오케스트레이션 토폴로지

## B.1 정의 포맷 한눈에

| 시스템 | 정의 단위 | 정체성 필드 | 역량 필드 | 위임 필드 | 가드레일 필드 |
|---|---|---|---|---|---|
| **Claude Code subagent** | `.md`+YAML frontmatter | `name`(소문자-하이픈)·`description` | `tools`(생략 시 전부 상속)·`disallowedTools`·`model`(기본 `inherit`)·`skills`·`mcpServers` | (description 기반 자동 위임) | `maxTurns`·`permissionMode`·`background`·`isolation` |
| **OpenAI Agents SDK** | Python `Agent(...)` | `name`·`instructions`·`handoff_description` | `tools`·`mcp_servers`·`model`·`model_settings` | `handoffs`(→`transfer_to_<name>`) | `input/output_guardrails`(tripwire)·`max_turns`(기본 10) |
| **CrewAI** | `Agent(role,goal,backstory)` | `role`·`goal`·`backstory` | `tools`·`llm` | `allow_delegation`(기본 False) | `max_iter`(기본 20)·`max_rpm`·`max_execution_time` |
| **AutoGen** | `AssistantAgent` | `name`·`system_message` | `tools`·`model_client` | `HandoffMessage`(Swarm) | team `max_turns`·11종 termination |
| **A2A AgentCard** | discovery JSON | `name`·`description`·`provider`·`version` | `capabilities`·`skills[]`(id/name/desc/tags)·`defaultInput/OutputModes` | (peer 통신 via url) | `securitySchemes`·`security` |
| **GitHub Copilot** | `.agent.md` | `name`·`description` | `tools[]`·`model` | `handoffs`·`agents`(하위) | `argument-hint` |
| **Vercel Eve** (2026-06-22) | **디렉터리**(`agent/`) | `instructions.md`(프롬프트, **frontmatter 無**)·`shared/agent.ts`(name·slug·tagline) | `tools/*.ts`(파일명=툴명, Zod)·`agent.ts`(`model`) | `subagents/<name>/`(재귀 동형, `agent.ts` 가 **`description` 필수 export**) | per-tool `needsApproval`·Workflows durable session |

**핵심 관찰:** 6종이 **name/description/tools/model 4필드로 수렴**. A2A 만 "discovery 명함"(누가·무엇을·어디서·어떻게 인증)으로 한 단계 더 추상화. **description 은 단순 설명이 아니라 *위임 트리거*** — Claude Code 는 "include phrases like **'use proactively'**", OpenAI 는 `handoff_description`, 이 필드 품질이 자동 라우팅 정확도를 좌우.

## B.2 오케스트레이션 토폴로지

| 토폴로지 | 정의 | 누가 다음 actor 결정 | 대표 |
|---|---|---|---|
| **Orchestrator-Workers** | 중앙 LLM 이 동적 분해·위임·합성 | orchestrator(LLM) | Anthropic, Claude Code lead |
| **Supervisor** | 중앙 supervisor 가 모든 통신·위임 통제 | supervisor | LangGraph supervisor, CrewAI hierarchical |
| **Swarm (탈중앙)** | actor 들이 서로 직접 제어권 이양 | 현재 활성 actor | OpenAI handoffs, LangGraph swarm, AutoGen Swarm |
| **Hierarchical** | supervisor 의 supervisor (다층) | 각 층 supervisor | LangGraph hierarchical, MetaGPT |
| **Network** | many-to-many, 각자 다음 호출 결정 | 임의 actor | LangGraph network [미검증, 2차] |

- **Anthropic multi-agent research** — lead 가 complex query 에 보통 **3–5개** subagent 동시 spawn(독립 context, 병렬). 토큰 ≈ chat 의 **15×**, "**token usage alone explains ~80% of performance variance**". (1차)
- **Magentic-One Orchestrator** — Task Ledger(facts/guesses/plan, 외부루프) + Progress Ledger(매 step 5질문, 내부루프) + **stall counter(>2 면 break→re-plan)**. (1차 arXiv)
- **CrewAI Hierarchical** — `manager_llm`/`manager_agent` 가 역할·능력 기반 task 할당 + 결과 검증, manager 는 worker 풀(`agents`)과 분리.
- **MetaGPT** — SOP 를 프롬프트 시퀀스로("Code = SOP(Team)"), 5역할(PM/Architect/PM/Engineer/QA), **shared message pool + publish-subscribe**(역할 profile 로 관련 정보만 구독, overload 방지).

## B.3 위임 메커니즘 — 제어권 이양 vs 유지

두 갈래(OpenAI 가 가장 명확히 대비):
- **Handoff(제어권 *이양*, swarm)** — "new agent owns the conversation". `transfer_to_<name>` tool. 탈중앙.
- **Agents-as-tools(제어권 *유지*, 중앙)** — `agent.as_tool()`, "orchestrate a network **instead of handing off control**". orchestrator 가 계속 핸들 쥠.

→ SoloSquad Chief 는 **agents-as-tools 형(제어권 유지)** 에 가깝다 — spawn 후에도 Chief 가 합성(SYNTHESIZE)을 소유. 단 spawn 된 specialist 는 독립 context(Claude Code subagent 와 동일 격리).

## B.4 2층 패턴 종합

| 시스템 | 영속(누가·무엇을) | 휘발(현재 위임) |
|---|---|---|
| Claude Code | `.claude/agents/*.md`(name·tools·model) | 런타임 자동 위임(description 매칭) |
| OpenAI SDK | `Agent` 정의 | `handoffs` 그래프 순회 |
| A2A | AgentCard(영속 명함) | task 단위 peer 통신 |
| **SoloSquad** | **`agents/**/SKILL.md` frontmatter 그래프 + `agent-profile.yaml`** | **Chief DECOMPOSE→DISPATCH→spawn** |

## B.5 Vercel Eve — filesystem-first agent 프레임워크 (2026-06-22 신규)
"eve is doing for agents what Next.js did for the web." agent = **디렉터리**(자동 디스커버리, 등록 無).
`agent/{agent.ts, instructions.md, tools/, skills/, channels/, connections/, subagents/, schedules/, sandbox/}`.
production 런타임(durable/resumable Workflows·Sandbox·AI Gateway·OTel)을 프레임워크에 융합. ~100+ 에이전트
프로덕션 운영 주장.

- **정의 = 관심사별 파일 분리:** *정체성 산문*(`instructions.md`, **frontmatter 없음** — "always-on
  system prompt, the agent's **permanent identity**") vs *타입드 역량*(`tools/*.ts`, **파일명=툴명**, Zod
  inputSchema) vs *온디맨드 지식*(`skills/*.md`, **이쪽엔** frontmatter `description`). → Claude Code
  subagent 와 *역전*: 거긴 역할파일 자체가 YAML frontmatter, Eve 는 skill 에만.
- **subagent = 재귀 동형 디렉터리.** `subagents/<name>/` 가 자기 `agent.ts`·`tools/`·중첩 `subagents/`
  보유. **`agent.ts` 가 `description` export 필수(컴파일러 강제)** — "The parent reads it to decide
  whether to delegate." 모든 subagent 를 **`{message, outputSchema?}` 툴로 lower** → 부모가 호출.
  자식은 **clean context window + 준 도구만** = bounded context/책임. (= agents-as-tools, SoloSquad Chief 와 동형.)
- **프레임워크가 agent loop 소유** — "developers write **what** agents do, not **how** they execute."
- ⚠️ **위임 가드 부재 [미검증]:** subagents/instructions 문서에 **depth/budget/recursion 한도 명시 없음** —
  중첩 임의. per-tool `needsApproval` HITL 게이트만 존재. (= 우리 G4 가드의 반면교사: 프레임워크가 종료
  가드를 빼면 무한위임 리스크. Claude 5·OpenAI 10·LangGraph 25 선례와 대비.)

> **SoloSquad 함의:** Eve 의 **"subagent description = 위임 계약(컴파일러 강제)"** 은 우리 `validateAgent`
> 가 `collaborators`/`description` 을 *위임 트리거 충분성*으로 검사해야 할 근거를 1급으로 박제. **단,
> 종료 가드는 Eve 가 빠뜨린 곳 — 우리는 거기서 차별화**(G1 depth·G4 budget 상속).

---

# Part C — 역할/페르소나 설계 원칙

- **Single Responsibility — "한 actor 한 역할".** CrewAI: "Agents perform significantly better when given **specialized roles rather than general ones**"; 작명도 "Writer" 금지 → "Technical Documentation Specialist". Claude Code: "each subagent should excel at **one specific task**". Anthropic subagent 필수 4요소: "an objective, an output format, guidance on tools/sources, and **clear task boundaries**".
- **Right altitude(Goldilocks).** 너무 낮으면 "hardcoding complex, brittle logic in prompts", 너무 높으면 "vague, high-level guidance" → subagent 중복 탐색. 최적 = "specific enough to guide, flexible enough". (Anthropic context engineering)
- **Generalist 함정 — tool overload.** 도메인 늘면 "generalist's prompt becomes overloaded with tool definitions → confusion"; 툴 8–12개 초과 시 저하, "structural limitation, not a prompt engineering issue". [2차]
- **Least-privilege tools.** "each tool needs a distinct purpose and a clear description"; "prefer specialized tools over generic ones"; tool 정의에 "프롬프트만큼의 엔지니어링 주의". Claude Code 베스트프랙티스: "**Limit tool access**". OWASP ASI02(Tool Misuse) 도 동일 — 도구별 strict least privilege.
- **Tier/hierarchy.** orchestrator-workers(중앙 동적 분해) / supervisor(통신 통제) / manager 분리(CrewAI manager 는 worker 풀 밖). **SoloSquad `tier: leader`(main) vs `tier: member`(specialist)** 가 정확히 이 모델.
- **역할 중첩 = 안티패턴.** Anthropic 사례(모호한 지시→동일 검색 중복), "Anti-Patterns" 글: role collision = "vague, redundant, or **overlapping responsibilities**" → "No clear ownership of outputs". 해법 = Agent Role Design Template(scope/IO/access/escalation 명시).

---

# Part D — 오케스트레이션 패턴

- **Supervisor vs Swarm.** supervisor = 중앙 통제·예측가능·디버그 쉬움(SoloSquad Chief). swarm = 탈중앙·유연하나 추적 어려움. LangGraph 팀조차 "use the supervisor pattern directly **via tools** rather than [the] library"(context engineering 통제력) 권장.
- **Magentic ledger(진행 추적의 정본).** 외부 Task Ledger(계획) + 내부 Progress Ledger(매 step "task complete? / looping? / progress? / who next? / what instruction?") + **stall counter > 2 → re-plan**. SoloSquad Chief 6+1 stage 머신의 직접 대응물.
- **멀티에이전트가 *해로울* 때(Cognition "Don't Build Multi-Agents").** 2원칙: ①"**Share context, and share full agent traces, not just individual messages**" ②"**Actions carry implicit decisions, and conflicting decisions carry bad results**". 병렬 subagent 가 context 공유 못 해 불일치(Flappy Bird 가 Mario 배경). 권장 = single-threaded linear agent + context compression.
- **멀티에이전트가 *도움될* 때(Anthropic, 반대편).** 적합 = "breadth-first queries pursuing multiple independent directions" / "info exceeds single context". 부적합 = "domains that require all agents to **share the same context** or involve **many dependencies**" — 즉 대부분 coding.
- **종합(분기 기준):** 두 입장은 모순이 아니라 **task coupling 차이**. 강결합·write-heavy·공유컨텍스트(coding)=단일 스레드; 약결합·read-heavy·독립방향(research)=멀티에이전트. **SoloSquad 함의:** Chief 가 spawn 하는 specialist 들이 *독립* 작업이면 병렬 OK, *상호의존*이면 단일 스레드/순차(=workflow `depends_on`)로.

- **실측 — agency-agents(msitarzewski) 오케스트레이션(2026-06-22).** **232 agent / 16 division**(tool-
  agnostic markdown, 17+ 하네스 설치). 단일 lead = `specialized/agents-orchestrator.md`("**You are the
  leader of this process.**"), 파이프라인 **PM → ArchitectUX → [Dev ↔ QA 루프] → Integration**. 위임 =
  **프롬프트로 역할명 spawn**("Please spawn a project-manager-senior agent…"), 에이전트 상호참조는 **산문의
  역할명**(ID·formal handoff 스키마 없음). 품질 게이트 = **"Maximum 3 attempts per task before escalation"**
  + "each task must pass QA before proceeding"(실패 시 피드백과 함께 dev 로 루프백). = **Magentic stall
  counter(>2)·circuit breaker 의 산문판**(E.3). frontmatter REQUIRED = `name·description·color`(나머지
  emoji·vibe 는 WARN), `model`/`tools` 필드 **부재**(하네스 무관).
- **실측 — agency-agents 의 정적 eval 게이트(2026-06-22, G2 직접 근거).** ⑴ `lint-agents.sh`(CI):
  frontmatter 존재 + 본문 헤더를 **"soul"(정체성/메모리/규칙) vs "agents"(역량)** 버킷으로 분류. ⑵
  **`check-agent-originality.sh`: 엔티티 중립화 8-word shingle 중복도로 *re-skin*(find-replace 복제) 탐지 —
  FAIL ≥40% / WARN ≥20%**(median 0%, 최악쌍 ~1.5% 로 캘리브). ⑶ `divisions.json` = single-source-of-truth,
  on-disk 와 불일치 시 CI fail. → **역할 중첩 탐지(G2)의 값싼 정적 구현**: SkillOpt 식 행동 eval 없이도
  "두 specialist 가 같은 일" 을 shingle 중복으로 잡는다.

---

# Part E — 실패 모드 & 가드레일

## E.1 MAST 14종 (UC Berkeley, arXiv 2503.13657 — 7 프레임워크·kappa 0.88·1600+ traces)

| 카테고리 | failure modes |
|---|---|
| **① Specification & System Design** | FM-1.1 task spec 위반 · FM-1.2 **role spec 위반** · FM-1.3 **step repetition** · FM-1.4 대화이력 손실 · FM-1.5 종료조건 인지실패 |
| **② Inter-Agent Misalignment** | FM-2.1 대화 reset · FM-2.2 clarification 미요청 · FM-2.3 task derailment · FM-2.4 정보 은닉 · FM-2.5 타 agent 입력 무시 · FM-2.6 reasoning-action 불일치 |
| **③ Task Verification & Termination** | FM-3.1 조기 종료 · FM-3.2 검증 부재/불완전 · FM-3.3 잘못된 검증 |

카테고리별 % 는 [미검증](primary abstract 미기재, 2차 충돌 — ~42/37/21 수준으로만). "no single category dominates".

## E.2 무한 위임 / handoff 루프 — 프레임워크 기본 가드(EXACT)

- **LangGraph `recursion_limit` 기본 = 25.** 초과 시 `GraphRecursionError`. 병렬 노드는 1 super-step. **함정:** `SubAgentMiddleware` 가 한도를 자식에 전파 안 함 → 하위가 조용히 기본 25 사용.
- **OpenAI `max_turns` 기본 = 10.** 초과 시 `MaxTurnsExceeded`(None=무제한). handoff/tool call 마다 turn 1 소모 = circular handoff safety net.
- **Claude Code subagent depth limit = 5** (depth 5 의 background subagent 는 Agent tool 미수령 → 더 못 spawn, "fixed and not configurable").

## E.3 Cascading error (arXiv 2603.04474 "From Spark to Fire")

- 단일 atomic error seed → ① **Cascade Amplification**: reviewer 역할 있어도 6개 중 **5개가 100% infection** · ② **Topological Fragility**: LangGraph hub vs leaf **10.31× Impact Factor** · ③ Consensus Inertia. governance 방어로 Benign Infection Control 0.32→0.89.
- 완화: **circuit breaker**(N연속 실패 trip) + downstream 전달 전 **LLM 출력 schema 검증**.

## E.4 가드레일 종합 (OWASP Agentic + 프레임워크)

- **Least privilege** — ASI02/ASI03. 도구·자격증명 스코핑, "bounded identity + short-lived task-scoped credentials".
- **HITL / 비가역 액션** — "pause for human feedback at checkpoints"; "require explicit confirmation for destructive actions". **주의(LangGraph `interrupt()`):** side-effect 를 승인 *앞*에 두면 재개 시 중복 — 승인 *이후* 단계로 분리(idempotency).
- **Budget cap** — "stopping conditions (max iterations)"; "autonomous nature means higher costs, compounding errors". OpenAI blocking guardrail 은 시작 *전* 완료 → tripwire 시 "preventing token consumption and tool execution".
- **Delegation depth cap** — ASI08 Cascading Failures → blast-radius caps·circuit breaker.

## E.5 자가개선 / 메모리 — 실측 패턴과 안전 규율 (2026-06-22 신규, v1.3.6 핵심)
"asset 이 스스로 학습·개선" 의 구체 메커니즘은 둘로 갈린다 — **⑴ 행동 자가개선(skill 텍스트 학습)** 과
**⑵ 경험 메모리(세션 간 컨텍스트 누적)**. ①은 skill-doc Part F(SkillOpt)가 정본, 여기선 ②를 박제한다.

**Vercel personal-agent-template — 메모리 패턴(verbatim 실측).** 프레임워크(Eve)는 메모리 프리미티브가
**없다**("Instructions are stable, always-on prompts — **not self-modifying**"). 메모리는 *앱 코드의
컨벤션*으로 구현 — 우리가 베낄 골격:
- **고정 5-카테고리 taxonomy**(자유 스키마 아님): `work_context · personal_context · active_focus ·
  instructions_preferences · project_history`. 카테고리당 **prose 블록 1개**.
- **읽기(주입):** `session.started` 이벤트에 `defineDynamic` 로 유저 메모리를 fetch 해 base 프롬프트에 append.
  = **세션 시작 시 메모리 재주입**(우리 `<system-reminder>` 메모리 리콜과 동형).
- **쓰기(자가개선, 게이트):** `save_memory` 툴이 **`needsApproval: always()`** — 매 메모리 쓰기가 **유저
  명시 승인** 필요. 비가역 학습에 HITL.
- **메모리 위생 규칙(프롬프트에 박제 — 재사용 1급):**
  - **full-block replace(델타 아님):** "send the **full updated text** for that category, not a partial delta."
  - **턴당 1회 write**("never call save_memory twice in parallel").
  - **휘발성 금지:** "Do not save ephemeral task details, one-off requests, or info they didn't imply should be remembered."
  - **환각 방지:** "Do **not claim to remember** something not in injected memory unless saving it this turn."

**대비 — agency-agents 의 "Learning Memory" 는 마케팅.** README 가 "Pattern recognition & continuous
improvement" 를 표방하고 본문에 "Memory: You remember pipeline patterns…" 줄이 있으나 **persisted store·
피드백 루프·재학습 전무** = 프롬프트 롤플레이일 뿐. **반면교사: "메모리" 라 적는 것 ≠ 메모리 메커니즘.**

**3대 설계 교훈(SoloSquad 적용):**
1. **고정 스키마 > 자유서술.** 메모리 카테고리를 enum 으로 고정(우리 MEMORY.md `type: user|feedback|
   project|reference` 와 정확히 동형) — drift 방지 + 리콜 정확도.
2. **full-block replace + 턴당 1회 + 비가역 승인.** 자가개선이 *조용히 누적*되면 protected-section 오염
   (SkillOpt −22pt 교훈) → 쓰기를 게이트하고 휘발성을 거부.
3. **읽기는 세션 시작 주입, 쓰기는 명시 행위.** SkillOpt 의 fast/slow 2-timescale 과 같은 결 — 휘발 노트
   (세션)와 내구 지침(승인된 메모리)을 물리 분리.

> **v1.3.6 직격:** asset 자가개선 = **①행동층(SkillOpt 식 텍스트 학습, 자동 검증기 필요) + ②경험층
> (위 메모리 패턴, human-approved)** 의 2층 구조. ②는 검증기 없이도 *지금* 도입 가능 — `agent-profile.yaml`
> /org 메모리에 고정 taxonomy + 승인 게이트 + full-block replace 를 얹는 것이 최소 착수점(G5 와 연동).

---

# Part F — 인사이트

## F.1 강한 수렴 (1차 출처)
1. **agent 정의 = name/description/tools/model 4필드 + 경계**; Markdown+frontmatter 가 사실상 표준(Claude Code·Copilot·AGENTS.md).
2. **specialist > generalist**; 역할 중첩은 보편 안티패턴.
3. **orchestrator/supervisor 가 중앙 통제 토폴로지의 정본**; 동적 분해·위임·합성.
4. **위임에는 반드시 종료 가드**(max_turns/recursion_limit/depth/stall counter) — 모든 프레임워크가 기본값 보유.
5. **least-privilege tool + 비가역 액션 HITL + budget cap** = 자율 actor 3대 가드레일.
6. **멀티에이전트 득실은 task coupling 으로 갈린다**(약결합=병렬, 강결합=단일).

## F.2 의미있는 분기 (명시적 선택 필요)
1. **제어권 — handoff(이양) vs agents-as-tools(유지).** SoloSquad = 유지(Chief 가 합성 소유).
2. **토폴로지 — supervisor vs swarm vs hierarchical.** SoloSquad = supervisor/orchestrator-workers.
3. **정의 위치 — 코드(OpenAI/CrewAI) vs 선언 파일(Claude Code/Copilot/A2A).** SoloSquad = 선언(`SKILL.md`).
4. **위임 그래프 — 단방향(트리) vs 상호(네트워크).** SoloSquad `collaborators` 는 현재 상호 — 순환 위험.

**SoloSquad 포지셔닝:** 합의 측에 정확히 위치 — 선언적 actor 정의(`SKILL.md` frontmatter ≈ AgentCard 계보), supervisor 토폴로지(Chief), specialist 분리, tier 모델. 분기축 선택: **제어권 유지(agents-as-tools)** + **supervisor**. 대부분 시스템보다 *약한* 지점: **위임 그래프 가드(순환·depth) 부재** + **위임 budget 자식 상속 미보장** — 정확히 v1.3.2 `agent-manager` 가 메울 곳.

**(2026-06-22) v1.3.6 자가개선 포지셔닝.** "asset 이 스스로 학습·개선" 은 **2층**으로 분해된다 — **①행동층**
(역할 프롬프트 텍스트를 eval-게이트로 학습 = SkillOpt, *자동 검증기 필수*) + **②경험층**(세션 간 메모리
누적 = personal-agent-template 패턴, *human-approved*). 시장은 둘을 *분리*해 풀고 있다(Eve = 메모리를
프레임워크 밖 앱 컨벤션으로, agency-agents = "learning memory" 는 마케팅뿐, SkillOpt = 행동층만). **SoloSquad
기회:** 두 층을 **하나의 asset-manager 생애주기로 통합**(refine=①, agent-profile/org 메모리=②) — 단 ①은
검증기 있는 actor 부터, ②는 고정 taxonomy+승인 게이트로 *지금* 착수. 이게 loop engineering 도입 *전*
"스스로 개선하는 squad" 의 최소 골격.

---

# Part G — SoloSquad 적용 전략

현재 코드(`src/bot/agents-builder.ts`·`src/engine/agents-md-loader.ts`·`src/util/agent-profile.ts`
+ `agents/{main,specialists}/<name>/SKILL.md` 30여 개 번들):
actor 정의·customize·spawn 은 동작하나 **생성 경로·그래프 검증·refine 부재**. v1.3.2 §5 매핑:

## G1. validate — frontmatter 그래프 무결성 (P0 — 최대 갭)
frontmatter 는 그래프다. `validateAgent`:
- `collaborators`·`used_by` 가 **실존 actor 참조**(`<team>/<agent>` 해소) — 참조 무결성.
- `skills_used` 가 **실존 skill 참조**(skill-manager 레지스트리 교차).
- **collaborator/delegation 순환·도달성 — workflow `depends_on` 과 동일 Kahn O(V+E)**(§9.2 공유 코어). 무한 위임 루프 차단. 최소 **depth 제한** 강제(LangGraph 25·Claude 5·OpenAI 10 선례).
- `tier`↔`team` 정합, `name` kebab-case·dir-match·예약어(skill validate 동형).
- `agent-profile.yaml` budget narrower-only invariant **사전 표면화**(현재 로드 시 warning 만).

## G2. review — 역할 중첩 탐지 (P1)
MAST FM-1.2(role spec 위반)·역할 중첩 안티패턴 대응: **두 specialist 가 같은 일을 하나**
(skill domain-overlap 과 동형 메커니즘), 역할 명확성, `dev_capability` 적정성(design-only actor 가
write 권한 요구 X), description 이 *위임 트리거*로 충분히 구체적인가("use proactively" 류).
- **(2026-06-22) 값싼 정적 구현 = agency-agents `check-agent-originality.sh` 이식**(Part D): 엔티티
  중립화 **8-word shingle 중복도, FAIL ≥40%/WARN ≥20%** 로 *re-skin*·역할중첩을 **행동 eval 없이** 탐지.
  → `validateAgent` 에 description/본문 shingle 검사를 얹어 신규 actor 가 기존 30여 번들과 겹치는지 게이트.
- Vercel Eve 의 "**subagent description = 컴파일러 강제 위임계약**"(B.5)을 차용 — description 이 위임
  트리거로 불충분하면 review FAIL(현재 warning 만).

## G3. create — actor scaffold (P1)
새 specialist/main 생성(frontmatter+body+CUSTOMIZATION_GUIDE). description 공식·3인칭은
skill-manager 와 공유. **번들 30여 개 불변, 사용자 actor 는 org 레이어(`<org>/agents/`)** — v1.5.0
upstream 재조정 충돌 회피. AgentCard 의 명시적 scope/boundary/skills 모델을 frontmatter 가이드로.

## G4. 위임 가드레일 — budget 자식 상속 (P1 — 대표 함정)
LangGraph SubAgentMiddleware 버그(한도 자식 미전파)가 자체 harness 의 직접 리스크. Chief→specialist
spawn 시 **turn/depth budget 을 자식에 명시적 상속** + circuit breaker(연속 실패 trip) + downstream
전달 전 출력 schema 검증(cascading error 방어). §9.4 가드레일 코어 공유.

## G5. refine + 메모리/자가개선 + lifecycle (P2 / P1)
- refine(행동층) — §9.3 bounded-edit 루프를 SKILL.md body(역할 프롬프트)/agent-profile tone 에.
  **patch-mode add/delete/replace + held-out gate + rejected-edit buffer**(SkillOpt, skill-doc F). frontmatter
  그래프는 protected(refine 은 산문만). **자동 검증기 있는 actor 부터**(전제조건).
- **(2026-06-22) 메모리/경험층(E.5) — 검증기 없이 *지금* 도입 가능:** `agent-profile.yaml`/org 메모리에
  **고정 taxonomy(우리 MEMORY.md `type` enum 재사용) + session-start 주입 + human-approved write +
  full-block replace + 턴당 1회 + 휘발성 거부**. = personal-agent-template 패턴의 SoloSquad 이식. ①행동층
  (refine)과 ②경험층(메모리)의 **2-timescale 분리**(SkillOpt fast/slow 와 동형).
- lifecycle — `solosquad agent list/show/validate/enable/disable` + **org 위임 그래프 시각화**
  (mermaid/DOT). workflow `<team>/<agent>` 노드 실존성의 **단일 진실원**(agency-agents `divisions.json`
  single-source + drift CI 와 동형).

## G6. 비범위 (v1.4+)
런타임 동적 actor 생성(spawn-time), actor 버전 히스토리, per-agent 메모리 스코프, agent 단위
termination policy, swarm 식 탈중앙 handoff(현재 supervisor 유지).

---

# Part H — 궁극의 체크리스트

좋은 agent(`SKILL.md`) 정의·검증 시:

- [ ] **정체성** — `name`(kebab-case·dir-match·예약어 회피) + `description`(3인칭, *위임 트리거*로 구체적)
- [ ] **역량** — `skills_used` 가 실존 skill 참조, `dev_capability` 가 역할에 맞는 최소 권한
- [ ] **경계** — 역할이 **하나로 명확**(SRP), 기존 actor 와 책임 중첩 없음(generalist 함정 회피)
- [ ] **right altitude** — 너무 brittle(하드코딩)도 너무 vague(모호 지시)도 아닌가
- [ ] **위임 그래프** — `collaborators`·`used_by` 가 실존 actor 참조(참조 무결성)
- [ ] **순환 없음** — 위임 그래프에 무한 루프 없음(Kahn), depth 제한 있는가
- [ ] **tier 정합** — `tier`(leader/member) ↔ `team` 일치, supervisor/worker 역할 분명
- [ ] **budget 가드** — `agent-profile.yaml` cap 이 narrower-only, spawn 시 자식에 turn/depth 상속
- [ ] **비가역 액션** — push 등에 HITL 게이트, side-effect 가 승인 *이후*(idempotent)
- [ ] **cascading 방어** — downstream 전달 전 출력 검증, circuit breaker
- [ ] **역할 중첩 게이트** — 8-word shingle 중복도 FAIL ≥40%/WARN ≥20%(agency-agents 식 anti-reskin)
- [ ] **(자가개선) 행동층** — patch-mode refine + held-out gate, **자동 검증기 있을 때만**(SkillOpt 전제)
- [ ] **(자가개선) 경험층/메모리** — 고정 taxonomy · session-start 주입 · **human-approved write** ·
      full-block replace(델타 X) · 턴당 1회 · 휘발성 거부 · 환각 방지(미저장 기억 주장 금지)

---

## 출처

### agent 정의 / 오케스트레이션 프레임워크
- Anthropic Building Effective Agents — https://www.anthropic.com/engineering/building-effective-agents · Multi-Agent Research System https://www.anthropic.com/engineering/multi-agent-research-system · context engineering https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Claude Code Subagents — https://code.claude.com/docs/en/sub-agents
- OpenAI Agents SDK — https://openai.github.io/openai-agents-python/ · agents · handoffs · guardrails · running_agents (max_turns 기본 10: https://github.com/openai/openai-agents-python)
- CrewAI — https://docs.crewai.com/concepts/agents · /concepts/processes · /en/learn/hierarchical-process · /en/guides/agents/crafting-effective-agents
- AutoGen — https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html · termination · Magentic-One arXiv https://arxiv.org/html/2411.04468v1
- MetaGPT — https://arxiv.org/abs/2308.00352 · https://github.com/geekan/MetaGPT
- Microsoft Agent Framework / Semantic Kernel — https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/ · https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-orchestration/

### 정의 포맷 / 상호운용
- A2A AgentCard — https://a2a-protocol.org/latest/specification/ · skills https://a2a-protocol.org/latest/tutorials/python/3-agent-skills-and-card/ · discovery https://agent2agent.info/docs/concepts/agentcard/
- MCP — https://modelcontextprotocol.io/docs/learn/architecture
- GitHub Copilot custom agents — https://code.visualstudio.com/docs/copilot/customization/custom-chat-modes
- AGENTS.md — https://agents.md
- **(2026-06-22) Vercel Eve** — https://vercel.com/eve · https://vercel.com/blog/introducing-eve · https://vercel.com/docs/eve · https://github.com/vercel/eve
- **(2026-06-22) personal-agent-template(메모리 패턴)** — https://github.com/vercel-labs/personal-agent-template
- **(2026-06-22) agency-agents(실측 schema·orchestration·originality 게이트)** — https://github.com/msitarzewski/agency-agents · https://agencyagents.dev/
- **(2026-06-22) SkillOpt(행동 자가개선)** — https://microsoft.github.io/SkillOpt/ · https://arxiv.org/abs/2605.23904 (skill-doc Part F 참조)

### 역할 설계 / 실패 모드 / 가드레일
- MAST taxonomy — https://arxiv.org/abs/2503.13657 · https://arxiv.org/html/2503.13657v1
- Cognition "Don't Build Multi-Agents" — https://cognition.ai/blog/dont-build-multi-agents
- Cascading failure "From Spark to Fire" — https://arxiv.org/html/2603.04474v1
- LangGraph recursion_limit — https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT · supervisor https://github.com/langchain-ai/langgraph-supervisor-py · swarm https://github.com/langchain-ai/langgraph-swarm-py
- OWASP Agentic Top 10 — https://goteleport.com/blog/owasp-top-10-agentic-applications/ [2차]
- specialist vs generalist — https://www.kubiya.ai/blog/why-should-ai-agents-be-specialists-not-generalists-moe-in-practice [2차]

## 레포 내 관련 코드
- `agents/main/<name>/SKILL.md`(chief·pm·engineer·designer·marketer, `tier: leader`) · `agents/specialists/<name>/SKILL.md`(20여 개, `tier: member`)
- `src/util/agent-profile.ts`(3-tier 상속·budget narrower-only invariant) · `src/bot/agents-builder.ts` · `src/engine/agents-md-loader.ts`
- `src/bot/chief-runner.ts`(`handleUserMessage`→DECOMPOSE→DISPATCH→spawn, orchestrator-workers) · `src/bot/spawn-assembler.ts` · `src/bot/spawn-prompt-markers.ts`
- `src/analyze/workflow-matcher.ts`(`<team>/<agent>` ref) · `agents/main/chief/SKILL.md`(stage 머신)
