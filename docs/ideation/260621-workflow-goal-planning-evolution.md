# Workflow·Goal 기획 진화 — 문제정의 프레임워크 + 오케스트레이션 레퍼런스 조사

> **청자:** SoloSquad 개발자(본인). v1.3.5(workflow·goal 개선) PRD 의 **선행 ideation**이다.
> 확정 기획이 아니라 방향 탐색 — 레퍼런스 조사·분석 + 현재 자산 진단 + 오케스트레이션 동작 분석.
>
> **문서 목적.** SoloSquad 의 workflow·goal 을 **기획(planning) 전용**으로 단단하게 만든다.
> 디자인·개발은 기본 skill/agent 로 해결하고, workflow·goal 은 **체계적 기획 파이프라인**에
> 집중한다 — cron 처럼 **org 종속 · repo 를 넘나들며 · `works-<handle>` 에 보고**하고, CRUD 에서
> 워크스페이스 skill·agent 를 활용/갱신한다. 기획은 **RO-PNA PMF 게임의 문제정의 프레임워크**에
> 근거해 진행한다. 본 문서는 ⑴ 그 프레임워크와 선도 레퍼런스를 조사하고, ⑵ SoloSquad 현재
> 기획 자산을 진단하며, ⑶ **오케스트레이션 구조에서 기획이 어떻게 작동하는지** 분석하고, ⑷ 6대
> 기획 단계 ↔ 프레임워크 ↔ 자산 매핑 + 격차를 도출한다.
>
> **조사 방법.** RO-PNA `pna-builders` 워크샵 문서 직독(gh api, 2026-06-21) + WebSearch 4건 +
> 코드 직독(병렬 Explore). 1차 출처는 §8.

---

## 목차

1. v1.3.5 의도 (사용자 요구 정리)
2. SoloSquad 현재 기획 자산 진단 (AS-IS)
3. 레퍼런스 조사
   - 3.1 RO-PNA PMF 게임 — 문제정의 프레임워크 (핵심 레퍼런스)
   - 3.2 Teresa Torres — Opportunity Solution Tree / Continuous Discovery
   - 3.3 Spec-Driven Development (GitHub spec-kit) — 개발 요구사항·엣지·사이드이펙트
   - 3.4 멀티 에이전트 오케스트레이션 (기획·리서치)
4. 오케스트레이션 구조에서 기획이 어떻게 작동하는가
5. 6대 기획 단계 ↔ 프레임워크 ↔ 자산 매핑 + 격차
6. v1.3.5 개선 방향 (PRD 로 넘길 골격)
7. 오픈 이슈
8. Sources

---

## 1. v1.3.5 의도 (사용자 요구 정리)

1. **workflow·goal 도 cron 처럼** org 종속 · **repo 를 넘나들며 작업** · **`works-<handle>` 보고**.
   (멀티 repo 실행은 v1.4.0 §10 공통 리졸버의 소비자가 됨 — `260621-multi-repo-execution.md`.)
2. **CRUD 에서 워크스페이스의 skill·agent 활용**, 필요 시 **워크스페이스 위계의 skill·agent 를
   갱신**(자산 재사용 우선·없으면 생성/개선 — cron-manager 와 동형, v1.3.4 §G).
3. **기획 전용 초점.** 디자인·개발은 기본 skill/agent 로 일단 해결. workflow·goal 은 기획 단계에
   집중.
4. **중요 기획 단계 6종:** ① 아이디어 구체화 ② 요구사항 분석 ③ 리서치(시장 조사) ④ 데이터 분석
   ⑤ 가설 수립 ⑥ 개발 요구사항(예외/분기 처리, 사이드 이펙트 고려).
5. **산출물:** 시장 조사는 **별도 리포트**, 시장 조사 포함 나머지는 **하나의 PRD** 로 관리.
6. **체계성:** RO-PNA PMF 게임의 문제정의 프레임워크 순서·고려사항에 근거.

---

## 2. SoloSquad 현재 기획 자산 진단 (AS-IS)

SoloSquad 는 이미 **깊은 기획 인프라**를 갖고 있다 — v1.3.5 는 *새로 만드는 게 아니라 재정렬·보강*이다.

**문제정의 workflow (6-Phase):** `skills/workflow-maker/assets/workflows/problem-definition/workflow.yaml`
— **SCQA → 5-Whys → MECE → TDCC → XYZ 가설 → 1-pager PRD** (각 phase 가 evidence-refs +
open_questions[] 산출). `discovery-cycle` 은 이를 확장(discovery-synthesis → problem-definition →
opportunity-tree → hypothesis-design → prd-writer → wbs-decomposition).

**PM 에이전트** (`agents/main/pm/SKILL.md`): Chief dispatch 를 받아 deep product thinking. product
team 6 스페셜리스트(pmf-planner · feature-planner · idea-scoper · business-strategist ·
policy-architect · data-analyst) 오케스트레이션. 책임 4: 문제 발견/정의 · 가설/실험 설계 · 데이터
기반 판단 · 마일스톤/WBS.

**기획 스페셜리스트:** pmf-planner(PMF 가설·RO-PNA 6-Phase 오케스트레이션) · feature-planner
(8-section PRD + 9-framework 우선순위) · idea-scoper(발산↔수렴) · business-strategist(Lean
Canvas·수익화) · data-analyst(Confidence Score·KPI) · policy-architect(정책·Hard Gate) ·
researcher(user+desk research, 시장 신호·경쟁 스캔).

**기획 스킬:** problem-definition · discovery-synthesis · hypothesis-design · experiment-design ·
prd-writer(8-section) · prioritization(9 framework) · opportunity-tree(OST + Six Forcing Questions)
· wbs-decomposition · okr-writer.

**goal 엔진** (`src/engine/goal-runner.ts`, `goal-parser.ts`): goal = {metrics · pipeline(agent+task
per step) · time/cost budget · termination}. cycle = pipeline_pass, state machine RUNNING →
CONFIRMING1 → CONFIRMING2 → CONVERGED → STOPPED(2연속 keep → 수렴). `target_repo` 단수·nullable.

**workflow 스키마** (`workflow-resolver.ts`): stage = {id · team · agents[] · target_repo · status ·
depends_on[] · upstream_handoff}. hard_gate + exit_criteria. `_status.yaml` 로 진행 추적.

> **진단 요약:** B(구조분해: SCQA·MECE)·C(원인추적: 5-Whys·TDCC)·D(가설실험: XYZ) 프레임워크는
> 이미 강하다. 그러나 **A(고객발견: JTBD·디자인씽킹)가 명시 단계로 약하고**, 사용자가 요구한
> **②요구사항 분석 · ⑥개발 요구사항(엣지/사이드이펙트) · 시장조사 별도 리포트**가 1급 단계로
> 정립돼 있지 않다. 또 RO-PNA 의 *설계 원칙*(기대-현실 비교, 예상 밖 요소, 턴제 반복)이 부분만
> 반영됐다(사후 라벨링은 chief SKILL 에 존재). 그리고 workflow/goal 도 cron 과 같은 **org/repo/
> 채널/자산-CRUD 정합**이 필요하다.

---

## 3. 레퍼런스 조사

### 3.1 RO-PNA PMF 게임 — 문제정의 프레임워크 (핵심 레퍼런스)

`RO-PNA/pna-builders` 의 워크샵 문서(`docs/PNA_워크샵_1·2`)가 정의한 체계. **"프레임워크를 강의로
배우지 않고 게임처럼 체험한다"** — 팀이 PO 가 되어 6단계 미션을 턴제로 풀고, 챗봇 GM 이 **사후에**
프레임워크로 해석한다.

**4개 문제해결 유형 × 9개 프레임워크** (분류 기준 = "문제에 부딪혔을 때 가장 먼저 하는 행동"):

| 유형 | 별칭 | 프레임워크 | 핵심 질문 |
|---|---|---|---|
| **A. 고객 발견형** | 현장 탐정 | IDEO 디자인씽킹 · **JTBD** | "고객은 지금 무엇을 경험하고 있는가?" |
| **B. 구조 분해형** | 구조 설계자 | MECE+Logic Tree · 구글 CIRCLES · 맥킨지 **SCQA** | "빠짐없이 쪼개면 핵심은 어디인가?" |
| **C. 원인 추적형** | 인과 추적자 | 도요타 **5-Whys** · 토스 **TDCC** | "왜·왜·왜? 근본 원인은?" |
| **D. 가설 실험형** | 속도전 실험가 | If-Then-Because · **XYZ 가설** | "검증 가능한 가설로 전환하면?" |

**순서(가이드라인, 정답 아님):** A 고객발견 → B 구조분해 → C 원인추적 → D 가설실험. *핵심은 순서가
아니라 **4개 관점이 모두 나오는 것**.* (실무는 어디서든 시작·왕복.)

**5대 설계 원칙 (v1.3.5 가 차용할 핵심):**
1. **사후 라벨링** — 프레임워크를 *선처방하지 않고*, 팀의 자연스러운 행동을 사후에 "방금 한 접근은
   ___와 유사" 로 연결. (SoloSquad chief SKILL 의 "사후 라벨링 원칙"과 정합.)
2. **턴제 시뮬레이션** — "행동 → 결과 → 후속 행동 → 결과" 루프(미션당 2-3턴).
3. **기대-현실 비교** — 행동 *전에* 기대 결과를 적고 결과와 비교 = **가설-검증 훈련** 그 자체.
4. **예상 밖 요소** — 매 턴 결과에 **≥1개 예상 못한 발견** 포함(터널비전 방지).
5. **개인 관점 → 팀 합의** — 서로 다른 프레임워크 렌즈로 각자 분석 후 팀 논의로 합치기.

> **SoloSquad 함의:** SoloSquad 의 6-Phase 는 B·C·D 를 잘 담았으나 **A(고객발견/JTBD)가 명시 1단계로
> 빠져** 있다(researcher 가 있으나 문제정의 *진입*이 SCQA = 구조분해부터다). v1.3.5 는 **A 를 명시
> 전단계로 추가**하고, 원칙 ③(기대-현실=가설검증)·④(예상 밖 요소)·⑤(다중 렌즈)를 워크플로 단계에
> 절차로 박는다. 멀티 에이전트 = "다중 렌즈"의 자연스러운 구현(스페셜리스트별 프레임워크 렌즈).

### 3.2 Teresa Torres — Opportunity Solution Tree / Continuous Discovery

- **OST**: 상단 **비즈니스 outcome** → 중간 **opportunity(미충족 니즈)** → 하단 **solution** → 그
  아래 **assumption test**. 발견을 "한 번"이 아니라 **주간 리듬**으로 지속(Continuous Discovery).
- **Dual-track**: discovery 와 delivery 를 병행. 작은 가정 테스트 후 commit.

> **SoloSquad 함의:** SoloSquad 에 이미 `opportunity-tree` 스킬이 있다(OST + Six Forcing
> Questions). v1.3.5 는 OST 를 **A 고객발견 → opportunity → 가설** 의 연결 골격으로 1급화하고,
> goal 의 cycle(반복 측정·keep/discard)을 OST 의 "주간 리듬·assumption test" 에 대응시킨다.

### 3.3 Spec-Driven Development (GitHub spec-kit) — 개발 요구사항·엣지·사이드이펙트

사용자 요구 ⑥(개발 요구사항: 예외/분기 처리, 사이드 이펙트)의 직접 레퍼런스. spec-kit 은 코드보다
**명세를 중심**에 두고 단계로 정제: `/specify`(무엇을) → **`/clarify`(에이전트가 불확실·엣지케이스를
능동 발굴해 명세에 기록)** → `/plan` → `/tasks`(테스트 가능한 acceptance criteria + owner·의존성·
spec 역참조). "AI 가 명확화 질문을 하고, 엣지케이스를 식별하고, 정밀한 수용 기준을 정의."

> **SoloSquad 함의:** ⑥ 개발 요구사항 단계를 **spec-driven 절차**로 설계 — 기획 PRD 가 개발로
> 넘어가기 전, 에이전트가 **예외·분기·사이드이펙트·수용 기준**을 능동 발굴해 PRD 의 "개발 요구사항"
> 섹션에 박제(개발은 기본 agent 가 그 PRD 를 입력으로 받음). spec-kit 의 clarify 패턴 = SoloSquad
> 의 open_questions[] 프로토콜과 동형 → 재사용.

### 3.4 멀티 에이전트 오케스트레이션 (기획·리서치)

- **에이전트 팩토리**: 2-5인 휴먼 팀이 **50-100 전문 에이전트**를 감독해 "제품 출시" 같은 end-to-end
  프로세스를 돌린다(McKinsey). 멀티에이전트 = 각 에이전트가 서브태스크 + 오케스트레이션으로 조율.
- **멀티 에이전트 시장조사**(CrewAI 등): 전문 에이전트 분업으로 리서치→리포트 생성. **병렬화로
  리포트 생성 30-50% 단축**. **groundedness 평가자**가 주장-인용 일치를 검증(환각 방지). 노이즈
  필터 → concise fact sheet.

> **SoloSquad 함의:** SoloSquad 의 chief→PM→specialist 가 곧 "에이전트 팩토리"다. v1.3.5 의 시장조사
> 단계는 **별도 리포트 산출물**을 내야 하므로(사용자 요구 ⑤), 멀티 에이전트 시장조사 패턴(병렬
> 리서치 + groundedness/citation 검증)을 researcher/business-strategist 분업으로 구현하고, 리포트는
> `works-<handle>` 에 보고 + PRD 와 별도 파일로 관리.

---

## 4. 오케스트레이션 구조에서 기획이 어떻게 작동하는가

SoloSquad 의 실행 위계: **Chief(org 대면 오케스트레이터) → PM(자율 product thinking) → product
스페셜리스트(프레임워크 렌즈별 실행)**. 기획 workflow/goal 은 이 위에서 이렇게 돈다:

1. **트리거/CRUD.** 사용자가 "이 아이디어 기획해줘"(대화) 또는 `[kind:workflow|goal]`. cron-manager
   와 동형으로 **planning-manager(=PM/Chief)**가 CRUD 를 가이드: 워크스페이스 skill·agent 를 먼저
   훑어 **재사용**하고, 단계에 맞는 자산이 없으면 **새 skill/agent 를 생성/개선**(워크스페이스 위계
   override; 번들 불변) 후 `asset validate` 게이트.
2. **단계 = stage(workflow) 또는 pipeline step(goal).** 각 단계가 하나의 프레임워크 렌즈를 든
   스페셜리스트를 호출(예: A=researcher/JTBD, B=PM/SCQA·MECE, C=PM/5-Whys·TDCC, D=hypothesis-design
   /XYZ, 시장조사=researcher+business-strategist 병렬). RO-PNA 원칙 ⑤(다중 렌즈)의 직접 구현.
3. **org 종속 · 멀티 repo.** 기획은 org 의 여러 repo 를 横断해 컨텍스트를 읽는다(repo 매니페스트
   주입 — v1.4.0 §10). 특정 repo 대상이면 지정, 아니면 전 repo.
4. **상태/보고.** 단계 결과·open_questions·"예상 밖 발견"을 `works-<handle>` 에 보고(cron §F2 와
   동일 채널 모델). 긴 산출물은 `<org>/artifacts/` 파일화(v1.3.0 Part C).
5. **산출물 2종.** 시장조사 → **별도 리포트**(`market-research-*.md`), 나머지 단계 → **하나의 PRD**
   (problem-definition 의 1-pager → prd-writer 8-section 으로 누적). 드롭박스 패턴(decisions.jsonl /
   _handoff.md)으로 단계 간 상태 공유(라이브 동기화 아님 — `260621-multi-repo-execution.md` §2.6).
6. **goal 의 반복.** goal 은 workflow 한 패스를 cycle 로 돌려 metric keep/discard(OST 의 주간
   리듬·assumption test 에 대응) — 기획 가설을 자율 반복 검증.

---

## 5. 6대 기획 단계 ↔ 프레임워크 ↔ 자산 매핑 + 격차

| # | 기획 단계 | RO-PNA/레퍼런스 프레임워크 | 현재 SoloSquad 자산 | 격차 / v1.3.5 |
|---|---|---|---|---|
| ① | **아이디어 구체화** | 디자인씽킹·JTBD(A) + 발산↔수렴 | `idea-scoper`, `discovery-synthesis` | A(고객발견)를 **명시 전단계**로; 발산-수렴에 "예상 밖 요소"(원칙④) |
| ② | **요구사항 분석** | CIRCLES · SCQA · MECE(B) | `problem-definition`(SCQA·MECE), feature-planner | **요구사항 분석을 1급 단계로** 정립(현재 문제정의에 흡수돼 모호) |
| ③ | **리서치(시장 조사)** | 멀티 에이전트 리서치 + groundedness | `researcher`, `business-strategist` | **별도 리포트 산출물** + 병렬 리서치 + 인용 검증 |
| ④ | **데이터 분석** | Confidence Score · KPI | `data-analyst` | org 멀티 repo 데이터 횡단(매니페스트) 연결 |
| ⑤ | **가설 수립** | XYZ · If-Then-Because(D) + OST | `hypothesis-design`, `opportunity-tree` | 원칙③(기대-현실=가설검증)을 절차로; goal cycle 연동 |
| ⑥ | **개발 요구사항** | spec-driven(specify→clarify→acceptance) | (약함 — prd-writer 일부) | **신규: 예외/분기/사이드이펙트/수용기준** 능동 발굴(spec-kit clarify ≈ open_questions) |

**관통 격차 3종:** (a) A 고객발견형의 명시 전단계 부재, (b) ⑥ 개발 요구사항(spec-driven)의 1급화
부재, (c) workflow/goal 의 org/repo/채널/자산-CRUD 정합(cron 과 동형) 부재.

---

## 6. v1.3.5 개선 방향 (PRD 로 넘길 골격)

> 상세 설계·스키마·마이그레이션은 PRD 에서. 여기서는 ideation 결론만.

1. **기획 단계 표준화** — 6대 단계를 workflow stage / goal pipeline 의 표준 라인업으로. RO-PNA 4유형을
   단계별 프레임워크 렌즈로 매핑(A 전단계 추가, ⑥ spec-driven 추가). 5대 원칙(특히 ③④⑤)을 stage
   프롬프트에 박제.
2. **산출물 2종 분리** — 시장조사 = 별도 리포트 자산(`market-research`), 나머지 = 단일 PRD 누적
   (problem-definition 1-pager → prd-writer 8-section, "개발 요구사항" 섹션 신설).
3. **cron 동형 정합** — workflow·goal 을 org 종속 + repo 横断(v1.4.0 §10 리졸버 소비) + `works-
   <handle>` 보고 + 대화형 CRUD(planning-manager). 자산 재사용-우선·없으면 생성/개선(v1.3.4 §G 동형).
4. **워크스페이스 skill·agent 활용/갱신** — CRUD 중 기존 자산 재사용, 단계에 필요한 자산이 없거나
   부족하면 **워크스페이스 위계에서 생성/개선** + `asset validate`(번들 불변, override 레이어).
5. **사후 라벨링 유지** — 프레임워크 선처방 금지(원칙①). 사용자 의도가 모이면 사후 명명.

---

## 7. 오픈 이슈

- **단계 강제 vs 유연** — RO-PNA 는 "순서는 가이드, 4관점이 다 나오는 게 핵심". workflow hard_gate 를
  6단계에 강제할지 vs opportunity 기반 선택적 진입(OST)으로 둘지.
- **goal vs workflow 경계** — 기획에서 둘의 역할 분담(workflow=1패스 결정적 / goal=반복 수렴). 시장
  조사·데이터 분석은 goal cycle 로 반복? PRD 누적은 workflow 로 1회?
- **시장조사 리포트 ↔ PRD 링크** — 별도 리포트를 PRD 가 evidence_ref 로 참조하는 규약.
- **A 고객발견 데이터 출처** — 1인 창업 초기엔 인터뷰 데이터가 없을 수 있음(researcher 의 desk
  research·시장 신호로 보완하는 fallback).
- **멀티 repo 기획 컨텍스트 비용** — 전 repo 매니페스트+코드 주입의 토큰 폭증(v1.4.0 §6 가드 공유).

---

## 8. Sources

**RO-PNA PMF 게임 (1차 출처 — 직독)**
- [RO-PNA/pna-builders (repo)](https://github.com/RO-PNA/pna-builders) — `docs/PNA_워크샵_1_구성_진행.md`(흐름·5대 원칙), `docs/PNA_워크샵_2_프레임워크_매칭.md`(4유형×9프레임워크)

**기획·디스커버리 방법론**
- [Opportunity Solution Trees (Teresa Torres / Product Talk)](https://www.producttalk.org/opportunity-solution-trees/)
- [Continuous Discovery (IxDF)](https://ixdf.org/literature/topics/continuous-discovery)
- [The Arc PMF framework (Sequoia)](https://sequoiacap.com/article/pmf-framework/)
- [The PMF Framework canvas (Christian Strunk)](https://www.christianstrunk.com/blog/pmf-framework)

**Spec-Driven Development (개발 요구사항·엣지·수용기준)**
- [github/spec-kit (repo)](https://github.com/github/spec-kit)
- [Spec-driven development with AI (GitHub Blog)](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- [Diving into Spec-Driven Development (Microsoft for Developers)](https://developer.microsoft.com/blog/spec-driven-development-spec-kit)

**멀티 에이전트 오케스트레이션·리서치**
- [Seizing the agentic AI advantage (McKinsey)](https://www.mckinsey.com/capabilities/quantumblack/our-insights/seizing-the-agentic-ai-advantage)
- [Multi-Agent Market Research & Use-Case Generation (GitHub, CrewAI)](https://github.com/ramamoorthy07/Multi-Agent-Market-Research-and-Use-Case-Generation-System)
- [Building a Market Research AI Agent (appliedAI)](https://www.appliedai.de/en/ai-resources/blog/building-research-ai-agent/)
