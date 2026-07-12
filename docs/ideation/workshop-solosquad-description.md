# SoloSquad 로 나만의 기획 에이전트 만들기 — 워크샵 가이드

> **청자:** 워크샵 참가자 — 1인 창업자·빌더. Claude Code 나 Codex 를 써봤지만,
> "한 번 묻고 닫는 대화"를 넘어 **메신저에 상주하며 내 사업을 같이 기획하는 파트너**를
> 만들고 싶은 사람.
>
> **문서 목적.** SoloSquad 를 살아있는 케이스 스터디로 삼아, 참가자가 자기만의 기획
> 에이전트를 설계할 수 있도록 ⑴ **기본 구조/기능**(워크스페이스 3계층·멀티 리포지토리·
> 문제정의 워크플로우·primitive 5종), ⑵ **차별성**(단독 Claude/Codex 대비, OpenClaw·Hermes
> Agent 대비 가치), ⑶ **실제 트러블슈팅·피봇 과정**, ⑷ **프롬프트 습관**을 전수한다.
> 추상론이 아니라 *우리가 실제로 겪은 결정*을 file:line·버전 단위로 보여준다.
>
> **주의.** 본 문서는 워크샵 교보재(ideation)이며 확정 기획(PRD)이 아니다. 구조·기능
> 서술은 **2026-06-26 코드/문서 직독 근거(v1.3.11 기준)**, 외부 레퍼런스는 `README.md`
> References 표 + `docs/trend-record/` 베이스라인 근거. 차용/거절 결정은 CHANGELOG 출처를
> 병기한다.
>
> **용어 갱신(v1.3.6+).** 초판이 쓰던 통칭 **"자산(asset)"** 은 v1.3.6~v1.3.7 에서
> **"primitive"** 로 통일됐다(skill·agent·workflow·goal·cron 5종). CLI 입구 `solosquad
> asset …` 도 retire 되고 명사 없는 `solosquad validate [kind]` 로 승격됐다. 본 최신화판은
> primitive 로 표기한다.

---

## 목차

1. 왜 "기획 에이전트"인가 — 워크샵의 전제
2. 기본 구조 ① — 워크스페이스 3계층
3. 기본 구조 ② — 멀티 리포지토리 작업
4. 기본 기능 ③ — 문제정의 워크플로우 (RO-PNA 6-Phase)
5. 기본 기능 ④ — primitive 5종 + 오케스트레이션
6. 차별성 ① — 단독 Claude / Codex 대비
7. 차별성 ② — OpenClaw · Hermes Agent 대비
8. 트러블슈팅 · 피봇 과정 (실제 사례)
9. 프롬프트 습관 (실습용 7계명)
10. 워크샵 핸즈온 시나리오
11. 현재 버전 토폴로지 — 에이전트·팀·스킬 인벤토리
12. 작동원리 — 기본 workflow·goal·cron + 시나리오 플로우
13. 사용법 — primitive 5종 CRUD + 상호관계
14. Sources

---

## 1. 왜 "기획 에이전트"인가 — 워크샵의 전제

대부분의 사람은 LLM 을 **출력 기계**로 쓴다. "PRD 써줘", "경쟁사 조사해줘" 한 번 묻고
결과를 받는다. SoloSquad 의 코어 철학은 정반대다:

```
Output ≠ Goal. Output = Means to achieve the goal.
```
(`AGENTS.md` §Core Philosophy)

기획 에이전트는 **한 장의 산출물**이 아니라 **목표를 향해 계속 도는 루프**다. 이 워크샵에서
만드는 것은 PRD 생성기가 아니라:

- **상주한다** — 메신저(Discord/Slack)에 살면서 24/7 자율 cron 으로 신호를 본다.
- **기억한다** — org 단위 공유 브레인(hot JSONL + cold FTS5)에 결정·시그널·가설이 쌓인다.
- **체계적으로 사고한다** — "감"이 아니라 RO-PNA 6-Phase 같은 검증된 프레임워크로 기획한다.
- **팀을 이룬다** — Chief 가 PM·specialist 에게 위임하는 멀티 에이전트 분업.

> **워크샵 핵심 메시지:** "기획 에이전트 = 프롬프트 한 줄"이 아니다. **구조(워크스페이스) +
> 기억(메모리) + 절차(워크플로우) + 분업(오케스트레이션)** 네 가지가 모여야 *파트너*가 된다.
> 아래 §2~5 가 그 네 기둥이다.

---

## 2. 기본 구조 ① — 워크스페이스 3계층

기획 에이전트의 첫 번째 기둥은 **컨텍스트를 어디에 둘지의 토폴로지**다. SoloSquad 는
3계층으로 나눈다 (`AGENTS.md` §3-Layer Context):

```
Layer 0: Workspace / Universal   ← 나라는 사람·보편 자산 (도구 무관)
├── AGENTS.md                    크로스-툴 영속 가이드 (사람만 편집)
├── user/                        owner profile · voice · preferences
├── knowledge/                   누적된 craft · 의사결정 프레임워크
├── agents/{main,specialists}/   에이전트 정의 (5 main + 14 specialist, v1.3.6 squad 개편)
└── teams/{team}/                팀 멤버십(=데이터) · KNOWLEDGE · OKR (5팀)

Layer 1: Organization (<org>/)   ← 사업/프로젝트 1개 단위
├── core/                        org 철학·톤 (Layer 0 override)
├── domain/                      시장·고객 등 도메인 지식
├── memory/                      cron-logs(hot) + archive.sqlite(cold FTS5) + decisions
├── workflows/<id>/ · goals/<id>/  진행 중 작업
└── repositories/<repo>.yaml     Layer 2 로의 경로 참조

Layer 2: Repository              ← 실제 제품 코드 (org 디렉토리 밖!)
```

**왜 3계층인가 — 워크샵 교훈 3개:**

1. **"나"는 한 번만 적는다 (Layer 0).** 톤·선호·의사결정 원칙은 프로젝트마다 반복하지
   않는다. `user/voice.md` 한 곳. 새 사업을 시작해도 그대로 상속된다.
2. **사업은 격리된다 (Layer 1).** org 마다 `core/`·`domain/`·`memory/` 가 분리돼,
   "본업"과 "사이드 프로젝트"의 결정·시그널이 섞이지 않는다 (n잡 시나리오, roadmap §2.1).
3. **코드는 복사하지 않는다 (Layer 2).** 이것이 §3 의 멀티 repo 핵심 — 워크스페이스는
   ~50MB config 폴더로 남고, 실제 코드는 사용자의 원래 dev 트리에 그대로 산다.

**스폰 시점 컨텍스트 조립 (8-layer JIT).** 에이전트가 깨어날 때 8개 레이어를 우선순위
순으로 주입하고, `max_context_tokens`(기본 80000) 도달 시 **낮은 우선순위부터 drop** 하며
그 결정을 `memory/spawn-decisions.jsonl` 에 기록한다 (`AGENTS.md` §Spawn-time). agent
identity·org core·agent-profile 는 절대 drop 하지 않는다.

> **참가자 적용:** 자기 에이전트를 만들 때 "모든 걸 한 프롬프트에"가 아니라 **무엇을
> 영속(Layer 0)·무엇을 사업별(Layer 1)·무엇을 JIT 주입**할지부터 나눠라. 이게 컨텍스트
> 폭증을 막는 유일한 구조적 답이다.

---

## 3. 기본 구조 ② — 멀티 리포지토리 작업

"1인 창업자가 메신저로 AI 팀을 부려 **여러 repo 를 넘나드는 통합 작업**을 시킨다" — 이게
SoloSquad 가 지향하는 그림이다. 핵심 설계 결정 5개:

### 3.1 repo 는 "복사"가 아니라 "경로 참조" (Model B)

repo 는 워크스페이스에 복사·심볼릭되지 않는다. `<org>/repositories/<slug>.yaml` 에
`path: /abs/경로` 만 적히고 **실제 코드는 외부 절대경로에 그대로** 산다 (v0.9.1+,
`src/cli/add-repo.ts`, `src/util/config.ts`). `resolveRepoCwd` 가 slug→절대경로를 푼다.

> **왜 이렇게?** §8 의 피봇 스토리 참조 — 초기엔 repo 를 워크스페이스 *안에* 강제했다가
> 솔로 사용자 4 시나리오가 전부 깨져서 갈아엎은 결과다. IDE 옆에서 에이전트 커밋을 실시간
> 보는 *direct working-tree* 가 솔로에게 자연스럽다는 결론(Codex 패턴 차용).

### 3.2 디렉토리 노출 = `--add-dir` (SDK 가 아니라 child process)

SoloSquad 는 Agent SDK 가 아니라 **Claude Code 를 child process 로 띄운다**(`claude
--print`). 따라서 repo 접근은 `--add-dir` 노선이 정답이다. Chief 대화는 이미 org 의
전 repo 를 `--add-dir` 로 노출한다(`collectRegisteredRepoPaths`).

### 3.3 매니페스트 주입 — "디렉토리만 추가한다고 멀티 repo 가 아니다"

`--add-dir` 는 *파일 접근*만 준다. 에이전트는 **무슨 repo 가 있고 무슨 역할인지도** 알아야
통합 작업을 한다. `repositories/*.yaml`(slug·role·path) 를 "repo 매니페스트"로 프롬프트에
주입한다. (VS Code multi-root 가 디렉토리만 추가하고 매니페스트·쓰기권한을 안 줘서 멀티
repo 추론에 실패한 것이 반면교사 — `260621-multi-repo-execution.md` §2.3.)

### 3.4 지정 문법 — "비우면 전체, 적으면 그것들"

`@slug` 멘션이 `[target_repo:<s>]` / `[target_repos:<a>,<b>]` 마커로 변환된다(`src/bot/
mention-parser.ts`, LLM 호출 0회). 지정 없으면 전 repo, 지정하면 그 repo 로 좁힌다.

### 3.5 메모리는 org 공유 (이건 오히려 맞다)

`<org>/memory/*.jsonl` 은 **org 단위 공유 브레인**이다. 통합 작업에서 결정·시그널이 repo
경계를 넘으므로 공유가 올바르다. repo-로컬 지식은 각 repo 의 AGENTS.md/CLAUDE.md 가 담당
→ **공유 메모리 = org, 코드 컨벤션 = repo 파일**.

> **업계 정합성:** GitHub Squad 의 "드롭박스" 패턴(라이브 동기화 대신 버전관리되는
> `decisions.md` 에 append)과 SoloSquad 의 `memory/decisions.jsonl` + `_handoff.md` 가
> 정확히 같은 결론이다(`260621-multi-repo-execution.md` §2.6c). **기획 에이전트의 상태
> 공유는 실시간 채팅/벡터DB 가 아니라 버전관리되는 마크다운/JSONL 이 정답.**

---

## 4. 기본 기능 ③ — 문제정의 워크플로우 (RO-PNA 6-Phase)

기획 에이전트가 단독 LLM 과 갈리는 결정적 지점: **"감"이 아니라 검증된 프레임워크로
사고**한다는 것. SoloSquad 의 문제정의 코어는 RO-PNA PMF 게임의 6-Phase 다. **단,
v1.3.5~v1.3.7 에서 구조가 바뀌었다** — 초판의 단일 `problem-definition` 스킬(모놀리식
6-Phase 체인)은 **해체**됐고, 각 Phase 는 그 결(結) 성격에 따라 **workflow 또는 skill 로
재배치**됐다(v1.3.7 §C, "workflow essence" 원칙: 목표+근거+방법→결론→handoff 면 workflow,
"그냥 행위"면 skill):

```
P1. SCQA    Situation·Complication·Question·Answer 추출  → workflow (scqa)
P2. 5-Whys  근본 원인 1문장                              → workflow (five-whys)
P3. MECE    후행/선행 문제 분해                          → skill   (mece)
P4. TDCC    후행지표·선행문제·기회·인과·미지            → workflow (tdcc)
P5. XYZ     검증 가능한 가설 (X%의 Y가 T안에 Z, 왜냐 R)  → skill   (xyz-hypothesis)
P6. 1-pager → prd 스킬 synthesis (요구사항 taxonomy + review gate, v1.3.5) (PRD)
```

> **왜 해체했나(워크샵 교훈):** "한 스킬이 6단계를 다 쥐는" 모놀리식은 부분 재사용이
> 안 되고, 다른 기획 맥락(개선/데이터 분석)에서 일부만 꺼내 쓸 수 없었다. v1.3.7 은 "결론과
> handoff 가 있는 다단계 = workflow / 단일 사고도구 = skill"로 쪼개, scqa·five-whys·tdcc 는
> **독립 호출·합성 가능한 workflow** 가 됐다(§12). 6-Phase 는 "강제된 순서"가 아니라 Chief 가
> 맥락에 맞춰 **조립하는 레고 블록**이 됐다.

**진입 게이트 — Six Forcing Questions** (gstack 차용): PMF 진입 전 6항목 자가검증 —
Demand Reality(관심 ≠ 수요) · Status Quo(진짜 경쟁자) · Desperate Specificity ·
Narrowest Wedge · Observation & Surprise · Future-Fit. 컨텍스트로 답할 수 있어야 통과,
아니면 회귀.

**워크플로우가 강제하는 4가지 규약**(`pm_conventions`) — 이게 워크샵의 진짜 알맹이다.
**v1.3.6 (§A, P1)에서 이 규약은 "장식"에서 "하중 부담(load-bearing)"으로 승격**됐다 —
이제 `pm_conventions` + `category` 는 validator 가 파싱·강제하는 정식 필드다(decorative→
load-bearing):

| 규약 | 의미 | 왜 중요한가 |
|---|---|---|
| **anti_sycophancy** | 가설은 *"입장 + 반증 조건"* 형식 강제: "X 라고 판단. Y 가 사실이면 입장 바뀜." | 아첨하는 LLM 의 기본값을 깨고 반증 가능하게 |
| **hard_gate** | P1 4필드·P2 ≥3단계·P4 5필드·confidence ≥60 미달 시 다음 단계 진입 차단 | 어설픈 기획이 통과하지 못함 |
| **post_labeling** | 프레임워크를 *선처방* 안 함 — 자연스러운 사고를 사후에 "방금 한 건 SCQA 와 유사" 로 명명 | 도구가 사고를 가두지 않음 (RO-PNA 원칙①) |
| **minimum_approaches: 2** | 최소 2개 접근을 비교 | 단일안 확증편향 방지 |

**못 푼 건 숨기지 않는다 — `open_questions[]`.** 컨텍스트로 풀 수 없는 항목은 추측으로
메우지 않고 `open_questions[]` 에 `{question, blocking}` 으로 적어 비동기 배치로 사용자에게
묻는다. (spec-kit 의 `/clarify` 패턴과 동형 — `260621-workflow-goal-planning-evolution.md` §3.3.)

**진입점 워크플로우 — v1.3.7 재편(구 4종 폐기).** 초판의 `problem-definition`·
`discovery-cycle`·`pmf-validation`·`autoplan-pm`·`weekly-retro` 5종 모놀리식은 **전부
retire**됐다. 대신 **2개 main 기획 워크플로우 + 9개 sub-workflow 합성(Workflow-of-Workflows)**
모델로 바뀌었다(`skills/workflow-manager/assets/workflows/`):

- `new-build` (main) — **신규 구축 기획**: `idea-refinement`(또는 입력이 구체적이면 Chief 가
  `requirements-analysis` 로 교체) → `market-research` → `hypothesis`. "이 아이디어 기획해줘"
  → Chief 가 맥락 추론으로 진입.
- `improvement` (main) — **개선 기획**: `kpi-check` → `data-analysis` → `hypothesis`.
  "전환율 떨어졌어, 개선하자" → Chief 진입.
- 호출되는 sub-workflow(9): `scqa` · `five-whys` · `tdcc` · `idea-refinement` ·
  `requirements-analysis` · `market-research` · `data-analysis` · `kpi-check` · `hypothesis`.
  Chief 가 `_workflow/<id>` 참조로 합성하고 cycle/depth guard 가 무한재귀를 막는다(v1.3.5).

> **참가자 적용:** 자기 도메인의 "좋은 기획 절차"를 위 4규약(반증조건·하드게이트·사후라벨링·
> 복수접근)으로 SKILL.md 에 박제하라. 그리고 **모놀리식 한 덩이로 만들지 말고**, 재사용·합성
> 가능한 작은 workflow/skill 로 쪼개라(v1.3.7 essence 원칙). 프레임워크는 RO-PNA 가 아니어도
> 된다 — *절차를 강제하는 구조*가 핵심이다.

---

## 5. 기본 기능 ④ — primitive 5종 + 오케스트레이션

SoloSquad 에는 재사용 가능한 **primitive 가 5종**(skill·agent·workflow·goal·cron) 있고,
각각 멀티 repo·기획에 다른 역할을 한다. **분류(v1.3.7 §A)** — skill·agent 는 *workspace
base*(행위 단위), workflow·goal·cron 은 그 base 들을 참조해 조립하는 *org composite*:

| primitive | 정체 | repo scope 결정 | 강점 | 한계 |
|---|---|---|---|---|
| **skill** | 재사용 절차 지식 (SKILL.md) | 호출 컨텍스트 상속 | 절차의 N-repo 일괄 적용 | 스택 이질성·부분 적용 |
| **agent** | 전문 페르소나 + 위임 그래프 | Chief 가 스폰 시 지정 | 진짜 cross-repo 통합 변경 | 컨텍스트 폭증·쓰기 충돌 |
| **workflow** | 결정적 다단계 체인 (stage DAG) | stage 별 `target_repos` | 순서·의존 명시·재현 | 원자성 부재·작성 부담 |
| **goal** | 자율-반복 cycle (metric 수렴) | pipeline agent 의 scope | 무인 반복 수렴 | Goodhart·종료조건 설계 부담 |
| **cron** | 정기 자동 실행 | `repos:`(기본 전체) | org 횡단 관측(읽기) | 무인 쓰기 위험·timeout |

(출처: `260621-multi-repo-execution.md` §4.5 + v1.3.7 primitive-core §0 분류)

**오케스트레이션 위계 — Chief → 4 팀 supervisor → specialist (v1.3.6 squad 개편).**

```
사용자 ↔ 메신저 (#command-<handle>)
        ▼
   Chief (core 팀 · org 대면 오케스트레이터, 사용자가 시스템을 통제하는 핵심 통로)
        │  Claude Code 네이티브 Task 툴로 위임
        ▼
   4 팀 supervisor (main): product-manager · engineer · marketer · business-strategy
        ▼
   specialist × 14 (product 3 · engineering 7 · business 2 · brand 2)
```

- Chief 는 아이디어 → 명확화 질문(≤2) → PRD → `workflows/<id>/_status.yaml` 생성 →
  stage 위임 → tool_result 합성 → 보고 (`AGENTS.md` §Multi-Session Execution).
- 각 에이전트는 완료 시 `_handoff.md`(Summary·Artifacts·Key Decisions·Context·Open
  Questions)를 써서 다음 에이전트에 컨텍스트를 넘긴다 (Handoff Protocol).

**24/7 자동 cron** (빌트인 4종 유지, v1.3.11 기준 `src/cron/crons.ts:44`): 아침 브리프 ·
저녁 브리프 · Chief compaction(23:00) · system-housekeeping(00:00). cron 결과의 JSON 블록은
자동 추출되어 JSONL 메모리에 append 되고, 출력은 `#works-<handle>` 로 배달된다(§12). (구 신호
스캔·실험 체크·주간 리뷰는 v0.8.5 에서 제거 — 도메인 분석은 user-authored workflow/goal 로.
번들에는 `bot-health-check`·`leading-indicator`·`trace-rotate` 프롬프트 파일도 있으나
default-on 레지스트리는 여전히 위 4종.)

> **참가자 적용:** 5종을 다 만들 필요는 없다. 워크샵 MVP 는 **skill 1개(절차) + cron 1개
> (매일 신호 요약)** 면 충분히 "상주 파트너"가 된다. agent/workflow/goal 은 작업이 복잡해지면
> 추가.

---

## 6. 차별성 ① — 단독 Claude / Codex 대비

"Claude Code 만 쓰면 되지 않나?"가 워크샵에서 가장 자주 나오는 질문이다. 차이는 **세션의
경계**에 있다.

| 축 | 단독 Claude / Codex | SoloSquad 기획 에이전트 |
|---|---|---|
| **수명** | 세션 단위 — 닫으면 휘발 | org 단위 영속 — hot JSONL + cold FTS5 archive(365일) |
| **기억** | 컨텍스트 윈도우 + 수동 CLAUDE.md | 8-layer JIT 자동 주입 + spawn-decision 로그 + `decisions.jsonl` 드롭박스 |
| **접근** | 터미널/IDE 앞에 사람이 있어야 함 | 메신저 대화만으로 운영(conversation-only), 코드 안 봐도 됨 |
| **시간** | 사람이 칠 때만 동작 | cron 으로 밤새 자율(아침/저녁 brief · compaction · housekeeping) |
| **분업** | 단일 에이전트(+ ad-hoc subagent) | Chief→4 팀 supervisor→14 specialist(5팀) + 핸드오프 프로토콜 |
| **사고 절차** | 프롬프트 그때그때 | hard_gate·anti-sycophancy·post-labeling·복수접근 *박제* (v1.3.6 validator 강제) |
| **작성 표준** | 프롬프트마다 즉흥 | primitive-core 공유 표준 + manager-as-authority + originality gate(anti-reskin) |
| **멀티 repo** | `--add-dir` 수동 | 매니페스트 자동 주입 + `@slug` 라우팅 + org 공유 메모리 |
| **안전** | 사용자가 매번 판단 | dev-confirm 게이트 + modifiable_paths 화이트리스트 + author-guard |

**한 줄 요약:** SoloSquad 는 Claude Code 를 *대체*하지 않는다 — Claude Code 를 **child
process 로 띄워**, 그 위에 *영속성·메신저 상주·멀티 에이전트·프레임워크 절차·24/7 cron* 을
입힌 **하네스**다. "강력한 LLM 한 번 쓰기" → "내 사업에 상주하는 팀"으로 격상시키는 레이어.

> **반대로, 안 하는 것도 명확하다.** 3-repo 물리 분할, LangGraph v3 그래프 오케스트레이션,
> MCP 내부 스킬 레지스트리, Vector+Graph DB 하이브리드는 *1인 창업자에겐 오버엔지니어링*으로
> 명시적 거절 (`README.md` References, roadmap §4). 워크샵 교훈: **차별성 = 더 많은 기능이
> 아니라, 솔로 규모에 맞는 절제**.

---

## 7. 차별성 ② — OpenClaw · Hermes Agent 대비

SoloSquad 는 이 두 프로젝트에서 **패턴을 차용하되, 솔로 맥락에 안 맞는 부분은 거절**했다.
이 "차용/거절 결정"이 워크샵에서 가장 값진 부분이다 — 좋은 에이전트는 베끼는 게 아니라
*취사선택*한다.

### 7.1 OpenClaw — 하네스 (자가 업데이트·자연어 cron·메신저 상주)

| | 차용 (adopt) | 거절 (reject) |
|---|---|---|
| **무엇** | `solosquad update`/`doctor` CLI + npm 배포 패턴, cron lifecycle UX(create/edit/start-stop/delete) | "전체 삭제 디폴트" 안티패턴 (Issue #6289) |
| **출처** | `README.md` References, CHANGELOG v1.3.3 | CHANGELOG: uninstall 시 전체 삭제 디폴트 → 비복구 데이터. v0.7 에서 **명시적 거부** + opt-in |

> SoloSquad 의 cron 은 OpenClaw + Hermes 의 cron UX 를 참조해 `cron new/edit/enable/
> disable/delete/run/runs` 전 라이프사이클 + dead-man's-switch + one-shot 까지 갖췄다
> (CHANGELOG v1.3.3). 하지만 uninstall 은 **삭제가 아니라 farewell archive(WAL-safe
> SQLite backup) 가 디폴트** — OpenClaw 의 데이터 파괴 디폴트를 반면교사로 삼았다.

### 7.2 Hermes Agent (Nous Research) — 멀티에이전트 메모리

| | 차용 (adopt) | 거절 (reject) |
|---|---|---|
| **무엇** | hot+cold FTS5 메모리 archive, trajectory → skill 자동 요약(v0.6), WAL-safe SQLite `backup()`(v0.7) | **모델 C (Hermes sandbox)** — 격리 샌드박스 teammate 모델 |
| **출처** | `README.md` References, CHANGELOG v0.6/v0.7 | CHANGELOG v0.9 plan §Skipped(영구 박제) |

> Hermes 의 메모리 아키텍처(hot JSONL + cold FTS5, trajectory 요약)는 SoloSquad 메모리의
> 직접 모델이다. 그러나 Hermes 식 **샌드박스 격리 teammate** 는 *솔로 founder 에겐
> 오버스펙*으로 거절하고, 대신 **IDE 옆 direct working-tree + dev-confirm 게이트**(Codex
> 패턴)를 택했다 — 솔로는 에이전트 커밋을 실시간으로 보는 게 자연스럽기 때문(§8.1).
> (multi-user/cloud 진화 시 v2.x 슬롯으로 재검토 박제.)

> **워크샵 교훈:** 레퍼런스를 볼 때 "이걸 통째로 쓸까"가 아니라 **"내 사용자(=솔로) 맥락에
> 이 결정의 트레이드오프가 맞나"** 를 물어라. OpenClaw 의 cron UX 는 차용하되 삭제 디폴트는
> 거절, Hermes 의 메모리는 차용하되 샌드박스는 거절 — 이 분별이 차별성을 만든다.

---

## 8. 트러블슈팅 · 피봇 과정 (실제 사례)

기획 에이전트는 한 번에 안 나온다. SoloSquad 가 실제로 갈아엎은 피봇들 — 참가자가 같은
실수를 피하도록.

### 8.1 가장 큰 피봇: repo "안에 복사" → "경로 참조" (v0.9)

- **증상:** v0.8.5~v0.8.6 사용자 테스트에서 *repos-inside-workspace-tree* 강제가 **솔로
  사용자 4 시나리오를 모두** 깨뜨림 (CHANGELOG v0.9 plan).
- **진단:** repo 를 워크스페이스 안으로 복사/이동하면, 사용자의 원래 dev 트리·IDE·git
  워크플로우와 단절된다.
- **피봇:** peer agent 모델(Hermes / Codex / Copilot Workspace) 비교 후 **Model B
  (path-reference) 채택** — repo 는 외부 절대경로에 그대로, `<slug>.yaml` 에 path 만 기록.
  워크스페이스는 ~50MB config 폴더로 축소.
- **거절:** Model C(Hermes sandbox)는 솔로엔 오버스펙으로 영구 박제.

> **교훈:** "내 시스템이 사용자 자산을 *소유*하려" 들면 깨진다. 기획 에이전트는 사용자의
> 기존 워크플로우에 **얹혀야지 흡수하면 안 된다.**

### 8.2 npm 0.9.0 burn — 되돌릴 수 없는 실수

- **사고:** v0.9.0 을 publish 직후 unpublish. 하지만 npm time 객체에 **영구 기록**됨 —
  사용 가능한 첫 버전은 v0.9.1 부터 (roadmap §1, CHANGELOG).
- **교훈:** `npm publish` 는 비가역이다. 그래서 SoloSquad 는 **`--dry-run` 강제 + pre-publish
  docs 게이트**를 도입했다 (`.claude/rules/git-workflow.md`, `npm run docs-check` 가
  `prepublishOnly` 에서 강제). **이 게이트는 v1.3.8 에서 4→6 으로 확장**됐다 —
  roadmap·architecture·CHANGELOG·README 필수 + manual 조건부(없으면 skip) + **PRD 존재 +
  `docs/`-leak invariant**(`scripts/check-docs-freshness.ts`). **비가역 작업 앞엔 자동
  게이트를 세운다.**

### 8.3 v1.2.6 dogfood — trust 가 working-dir 까지 안 갔다

- **증상:** publish 몇 시간 내 dogfood 에서, Claude trust 자동 부여가 *trust 다이얼로그*만
  덮고 *additional working directories* 권한은 안 덮음. `cwd=<org>/repo` 로 스폰된 Claude 가
  외부 경로(`C:\Dev\...`)의 진짜 repo 에 **못 닿음** (CHANGELOG v1.2.6).
- **교훈:** Model B(경로 참조)의 부작용 — "디렉토리 노출"과 "권한 부여"는 별개다(§3.3 의
  VS Code 교훈과 같은 뿌리). 차용 결정엔 *2차 효과*가 따라온다.

### 8.4 Windows precheck 가 자기 자신을 매칭 (v0.9.2)

- **증상:** 봇이 안 도는데도 uninstall 이 "bot appears to be running" 으로 차단.
- **진단:** WMI 쿼리의 정규식 리터럴이 powershell.exe 자신의 CommandLine 에 포함돼
  **자기 자신을 매칭**. `$_.Name -eq 'node.exe'` 가드로 해결, 회귀 catcher 추가.
- **교훈:** 크로스플랫폼 자동화는 *관찰자가 관찰 대상에 섞이는* 함정이 있다. 버그 잡으면
  **회귀 테스트로 박제**(SoloSquad 패턴 — 모든 hotfix 에 catcher).

### 8.5 용어 통일 — routine + schedule → cron (v1.3.3), asset → primitive (v1.3.6~7)

- **증상:** 같은 "예약 작업"을 built-in 은 *routine*, 사용자 작성은 *schedule* 로 불러
  혼란. 그리고 5종 통칭을 *asset* 으로 부르던 것도 모호(외부 "에셋"과 충돌).
- **피봇:** 하나의 명사 **cron** 으로 통일(v1.3.3) → 이어서 5종 통칭을 **primitive** 로 통일
  (v1.3.6~v1.3.7). `workflow-maker → workflow-manager`(v1.3.5), `asset-review →
  primitive-review`, `skill-core/core.md → primitive-core.md`. CLI 입구 `solosquad asset …`
  은 deprecate(v2.0 제거 예정)되고 명사 없는 `solosquad validate [kind]` 로 승격(§8.6).
- **교훈:** 어휘 부채는 기능 부채만큼 비싸다. 같은 개념엔 같은 이름.

### 8.6 squad 재편 — 4팀/25 에이전트 → 5팀/19 에이전트 (v1.3.6)

- **증상:** 초기 4팀(product/design/engineering/marketing)에서 design 팀이 얕고
  (researcher·ux·ui 만), 전략/사업 사고가 product 팀에 뭉쳐 있었다. 에이전트 25개에
  중복(`fde` 등)·경계 모호가 있었다.
- **피봇:** **5팀(core·product·engineering·business·brand)** 으로 재편. design 을 별도 팀에서
  해체해 product(`product-designer`)·brand(`creative-designer`)로 흡수, **business 팀 신설**
  (전략을 product 에서 분리). 에이전트 **25→19**(5 merge + `fde` 제거 + product-designer/
  sales/creative-designer 신설). 번들 actor 이름은 사용자 org-layer actor 와 격리돼 있어
  **마이그레이션 없이 minor 로 ship**(`260623-squad-org-restructure.md`).
- **교훈:** 팀 토폴로지는 "기능 나열"이 아니라 *사고의 결*(전략 vs 제품 vs 실행)로 나눈다.
  번들 자산을 사용자 자산과 격리해두면 대형 리네임도 무중단으로 옮길 수 있다(§3.5 격리 원칙).

### 8.7 `--add-dir` 가 안 먹는 두 갈래 — claude-code 호환 + Windows 개행 (v1.3.10~11)

- **증상:** dogfood 에서 Chief 가 **등록된 외부 repo 를 못 읽음**. 두 개의 독립 버그가 같은
  증상으로 수렴.
- **진단①(v1.3.10):** Claude Code 2.1.x 가 `--input-format stream-json`(stdin) 일 때
  `--add-dir` 를 **조용히 무시**. → 사용자 메시지를 **plain text stdin** 으로 먹이도록 전환
  (출력은 `--output-format stream-json` 유지).
- **진단②(v1.3.11):** Windows 는 `shell:true` 로 spawn → args 가 command **문자열**로 합쳐지는데,
  `--append-system-prompt` 값의 **개행이 cmd.exe 명령줄을 잘라** 뒤따르는 `--add-dir` 를 통째로
  날림. → system prompt 를 **temp 파일 + `--append-system-prompt-file`** 로 전달해 개행이
  명령줄에 닿지 않게.
- **교훈:** "디렉토리 노출"의 실패는 §3.3(매니페스트)·§8.3(trust working-dir)에 이어 **세 번째
  변종**이다. 외부 도구(child process)의 인자 전달은 플랫폼·버전마다 깨질 수 있으니 **불변식을
  회귀 테스트로 핀**(두 hotfix 모두 catcher 추가).

> **관통 패턴:** SoloSquad 의 모든 피봇은 ⑴ **dogfood 로 발견** → ⑵ **레퍼런스 비교로 방향
> 결정** → ⑶ **마이그레이션 + 회귀 테스트로 안전 이행** → ⑷ **CHANGELOG/ideation 에 결정
> 박제**(거절 사유까지) 의 사이클을 돈다. 기획 에이전트 개발도 이 루프로 굴려라.

---

## 9. 프롬프트 습관 (실습용 7계명)

이 문서가 속한 `docs/ideation/` 자체가 좋은 프롬프트 습관의 산물이다. 워크샵에서 바로 쓸
7가지:

1. **병렬 탐색 먼저, 결론만 회수.** 코드/현황 파악은 Explore 에이전트 3종을 *동시* 파견하고
   파일 덤프가 아니라 결론만 받는다 (`260621-multi-repo-execution.md` 조사 방법 주). 메인
   컨텍스트를 아낀다.
2. **file:line 으로 못 박기.** "어딘가에 있다"가 아니라 `src/bot/mention-parser.ts:23-81`
   처럼 인용한다. 검증 가능하고, 다음 세션이 바로 찾는다.
3. **1차 출처 + 캡처 일시.** 레퍼런스는 트위터 인용이 아니라 공식 GitHub/블로그/논문.
   못 찾으면 "확인 안 됨"으로 적는다 (trend-tracker Quality Checklist). **추측을 사실로
   표기하지 않는다.**
4. **입장 + 반증 조건 (anti-sycophancy).** "X 라고 판단합니다. Y 가 사실로 드러나면 입장
   바뀝니다." 아첨하는 기본값을 깨는 한 문장 (`pm_conventions`, `skills/skill-core/primitive-core.md`).
5. **사후 라벨링.** 프레임워크를 *선처방*하지 말고, 자연스러운 사고를 사후에 "방금 한 건
   ___와 유사"로 명명 (RO-PNA 원칙①). 도구가 사고를 가두지 않게.
6. **모르는 건 open_questions[] 로.** 컨텍스트로 못 푸는 항목을 추측으로 메우지 말고
   `{question, blocking}` 으로 모아 사용자에게 비동기 배치 질문.
7. **기대-현실 비교 + 예상 밖 요소.** 행동 *전에* 기대 결과를 적고 결과와 비교(=가설검증),
   매 결과에 *예상 못한 발견 ≥1개* 포함(터널비전 방지) — RO-PNA 원칙③④
   (`260621-workflow-goal-planning-evolution.md` §3.1).

> **메타 습관:** 결정은 *거절 사유까지* 문서에 박제한다. "왜 안 했는가"가 "왜 했는가"만큼
> 중요하다 (§7 의 차용/거절 표, §8 의 Skipped 박제). 6개월 뒤의 나(또는 다음 에이전트)가
> 같은 길을 다시 파지 않게.

---

## 10. 워크샵 핸즈온 시나리오

참가자가 90분 안에 "최소 기획 에이전트"를 세우는 경로:

1. **설치 & 진단** (`solosquad init` → `solosquad doctor`). Layer 0 = 나(user/voice.md),
   Layer 1 = 첫 org 생성.
2. **repo 경로 참조 등록** — 기존 프로젝트 폴더에서 `solosquad add repo`(cwd 자동 인식).
   복사 안 됨을 확인(§3.1).
3. **문제정의 1패스** — 메신저에서 "이 아이디어 기획해줘". Chief 가 명확화 질문(≤2) →
   6-Phase → 1-pager PRD. `open_questions[]` 가 어떻게 돌아오는지 관찰(§4).
4. **나만의 skill 박제** — 자기 도메인의 절차 1개를 SKILL.md 로. `pm_conventions`
   4규약(반증조건·하드게이트·사후라벨링·복수접근)을 frontmatter 에 넣기.
5. **cron 1개** — "매일 아침 내 사업 관련 신호 요약"을 `cron new --at "08:00"`. 다음날
   `#works-<handle>` 에 브리프가 뜨는지 확인.
6. **회고** — 무엇을 *거절*할지 정하기. 내 솔로 맥락에 오버스펙인 기능을 §7 방식으로
   명시 박제.

> **성공 기준:** 데모가 아니라 *내일 아침 메신저에 브리프가 떠 있는 것*. 상주하는 파트너의
> 최소 증거.

---

## 11. 현재 버전 토폴로지 — 에이전트·팀·스킬 인벤토리 (v1.3.11)

§2 가 *컨텍스트* 토폴로지였다면, 여기는 *행위자* 토폴로지다 — **v1.3.6 squad 재편 이후
5 main + 14 specialist, 5 team** (`teams/{team}/composition.yaml` = 데이터; §8.6).

```
                       사용자 ↔ #command-<handle>
                                  │
                        ┌─────────▼──────────┐
                        │  Chief (core 팀)    │  유일한 user-facing · 오케스트레이터
                        └─────────┬──────────┘
   ┌──────────────┬──────────────┴───────┬──────────────────┐
[product]     [engineering]          [business]           [brand]
product-mgr    engineer            business-strategy       marketer    ← 4 팀 supervisor (main)
   │              │                      │                    │
product-designer system-architect    go-to-market        creative-designer
researcher       backend             sales               communication
data-analyst     frontend
                 data-engineer
                 infra
                 qa
                 security
```

**Main 에이전트 (5)** — Chief(core, org 대면) + 4 팀 supervisor:

| agent | team | 역할 |
|---|---|---|
| chief | core | org 대면 오케스트레이터. TRIAGE→DECOMPOSE→DISPATCH→SYNTHESIZE (members 없음) |
| product-manager | product | 자율 product thinking. product specialist 오케스트레이션 |
| engineer | engineering | 엔지니어링 팀 supervisor (design doc → 코드/인프라) |
| business-strategy | business | 사업 전략 supervisor (전략·GTM·세일즈) — v1.3.6 신설 |
| marketer | brand | 브랜드/실행 supervisor (콘텐츠·디자인·커뮤니케이션) |

**Specialist 에이전트 (14) — 팀별:**

| team | specialists |
|---|---|
| **product (3)** | product-designer · researcher · data-analyst |
| **engineering (7)** | system-architect · backend · frontend · data-engineer · infra · qa · security |
| **business (2)** | go-to-market · sales |
| **brand (2)** | creative-designer · communication |
| **core (0)** | (Chief 단독, members 없음) |

**Skill (29) — category별** (`skills/`):

| category | skills |
|---|---|
| manager(작성권한) | skill-manager · agent-manager · workflow-manager · goal-manager · cron-manager |
| authoring core | skill-core(=primitive-core.md) · primitive-review |
| governance/docs | docs · design-system · policy |
| discovery/research | discovery-synthesis · interview-script · market-research |
| framework | mece · xyz-hypothesis |
| planning | hypothesis-design · experiment-design · opportunity-tree · prd · prioritization · jobs-stories · lean-canvas · premortem · wbs |
| orchestration | okr · triage |
| reflection | retrospective · skill-refinement · workflow-refinement |

> **이름 변경(v1.3.5~6):** `okr-writer→okr` · `prd-writer→prd` · `wbs-decomposition→wbs` ·
> `interview-script-author→interview-script` · `asset-review→primitive-review` ·
> `workflow-maker→workflow-manager`. scqa·five-whys·tdcc 는 skill 에서 **workflow 로 승격**
> 돼(§4) 여기 목록에서 빠졌다.

> **워크샵 포인트:** product 팀이 여전히 가장 깊고(+ business 팀 분리로 전략 사고 전담),
> planning 계열 skill 이 가장 두껍다 — SoloSquad 가 "기획 에이전트"인 이유. 엔지니어링·브랜드는
> *기본 제공*으로 받쳐줄 뿐, 무게중심은 기획·전략이다. **manager 5종이 신설 카테고리** —
> 이들이 "무엇이 좋은 primitive 인가"의 작성 표준을 쥔다(v1.3.6~7 authoring 내재화).

---

## 12. 작동원리 — 기본 workflow·goal·cron + 시나리오 플로우

**기본 workflow (11, `skills/workflow-manager/assets/workflows/`)** — v1.3.7 재편:
구 5종(problem-definition·discovery-cycle·pmf-validation·autoplan-pm·weekly-retro) 전부 폐기,
**2 main(Workflow-of-Workflows) + 9 sub** 합성 모델로 전환(§4):

| workflow | 종류 | 순서 / 역할 |
|---|---|---|
| `new-build` | main | idea-refinement(또는 requirements-analysis) → market-research → hypothesis |
| `improvement` | main | kpi-check → data-analysis → hypothesis |
| `idea-refinement` | sub | 아이디어 구체화 |
| `requirements-analysis` | sub | 요구사항 구체적일 때 stage-1 교체 |
| `market-research` | sub | 시장 조사 |
| `data-analysis` | sub | 기존 제품 지표 분석 |
| `kpi-check` | sub | KPI baseline·방향·threshold (goal-alignment gate) |
| `scqa` | sub | P1 구조분해 (구 skill 승격) |
| `five-whys` | sub | P2 원인추적 (구 skill 승격) |
| `tdcc` | sub | P4 원인추적 (구 skill 승격) |
| `hypothesis` | sub | XYZ 가설 수립(공유 종착 stage) |

**기본 goal:** 번들 정의 **0개**. goal 엔진(`src/engine/goal-runner.ts`) + `goal new` 스캐폴드만
제공 — 사용자가 `<org>/goals/<id>/goal.md`(metrics·pipeline·budget·termination)를 작성한다.

**기본 cron (4 built-in, v1.3.4~11 유지, `src/cron/crons.ts:44`):**

| cron | 시각 | kind | 배달 |
|---|---|---|---|
| `morning-brief` | workspace 설정(기본 08:00) | user-brief | #works-\<handle\> |
| `evening-brief` | workspace 설정(기본 18:00) | user-brief | #works-\<handle\> |
| `chief-compaction` | 23:00 | background | #works-\<handle\> thread |
| `system-housekeeping` | 00:00 | background | (silent — 게시 안 함) |

> v1.3.4 에서 배달 채널이 (존재하지 않던) `#workflow` → **`works-<handle>`** 로 정정됐고,
> 빌트인 cron id `pm-compaction → chief-compaction` 으로 개명됐다. v1.3.5(B-D3)에서 사용자
> cron 은 워크스페이스 전역 → **org-scoped(`<org>/crons/`)** 로 이동했다. 번들에는
> `bot-health-check`·`leading-indicator`·`trace-rotate` 프롬프트도 들어 있으나 default-on
> 레지스트리는 위 4종 그대로.

**시나리오 플로우 — 메신저 1메시지가 primitive 로 흐르는 경로:**

```
사용자 메시지 (#command-<handle>)
   │
   ▼
mention-parser ── @slug → [target_repo(s)] 마커 주입 (LLM 0회, 멀티 repo 라우팅)
   │
   ▼
Chief · TRIAGE ── kind 분류 (triage skill): chat / workflow / cron / goal
   │
   ├─ chat ─────────► 즉답 (#command-<handle>)
   │
   ├─ workflow ─────► <org>/workflows/<id>/ 생성 (workflow-manager)
   │                    │ stage.agent = <team>/specialist · _skill/<x> · _workflow/<x>
   │                    │ 각 stage 완료 → _handoff.md → 다음 stage (hard_gate 통과 시)
   │                    └─► PRD/산출물 → #works-<handle> 보고
   │
   ├─ cron ─────────► crons/<id>.yaml 등록 → 데몬이 정시 발화
   │                    └─► 결과 → #works-<handle> (실패 시 사유 + 누락 시 경보)
   │
   └─ goal ─────────► <org>/goals/<id>/ → 백그라운드 cycle loop
                        └─► metric keep/discard → 2연속 keep → 수렴 → #works-<handle>
```

**상태 공유 = 드롭박스(라이브 아님):** 단계 간 컨텍스트는 실시간 채팅이 아니라 버전관리되는
`memory/decisions.jsonl` + `_handoff.md` 로 넘긴다(§3.5 / GitHub Squad 패턴).

---

## 13. 사용법 — primitive 5종 CRUD + 상호관계

**CRUD 표** (대화형 = Chief 에게 말하기 / CLI = `solosquad ...`):

| primitive | Create | Read | Update | Delete |
|---|---|---|---|---|
| **skill** | 대화(Chief→skill-manager) · `SKILL.md` 작성 | `solosquad validate skill` | `SKILL.md` 편집 | 파일 삭제 |
| **agent** | `agents/specialists/<id>/SKILL.md` 작성 | `solosquad validate agent` · `agent validate --graph` | `SKILL.md` 편집 | 파일 삭제 |
| **workflow** | 대화(Chief→workflow-manager) → `<org>/workflows/<id>/` | `workflow list/show` | `workflow.yaml` 편집 · `workflow set`(active) | snapshot revert |
| **goal** | `goal new <id>`(scaffold) | `goal list/show/status` · `goal validate` | `goal.md` 편집 | 파일 · `goal stop`(실행 중단) |
| **cron** | `cron new`(대화 cron-manager) | `cron list/show/runs` | `cron edit/enable/disable` | `cron delete`(archive 기본, `--hard`) |

- **공통 검증 게이트(v1.3.6~7):** `solosquad validate [kind]` — 5종 전부(skill·agent·
  workflow·goal·cron) 통합. 구 `solosquad asset list/show/validate` 입구는 **deprecate
  (v2.0 제거 예정)**, 명사 없는 top-level `validate` 로 승격됐고 CI `validate-bundled` 가
  이를 dogfood 한다. goal validator 는 v1.3.7(`src/bot/goal-validate.ts`)에서 합류 —
  metric provenance·pipeline agent 존재·termination·Goodhart guardrail 검사.
- **작성 표준(v1.3.6~7 authoring 내재화):** "무엇이 좋은 primitive 인가"의 ~70% 공통 표준은
  `skills/skill-core/primitive-core.md` 에 있고, 5개 manager(skill/agent/workflow/goal/cron)
  가 이를 참조하는 **작성 권한(authoring authority)** 이다. validator 가 reserved-word·vague-
  phrasing·500-line lint + **anti-reskin originality gate**(8-word shingle, FAIL≥40%)까지 강제.
- **공통 원칙:** 번들 불변 → **워크스페이스 override 레이어**에 생성, **재사용 우선·없으면 생성**,
  파괴적 CRUD 는 **적용 전 확인**(cron-manager 패턴, v1.3.4 §G).

**상호관계 — 누가 누구를 조립하나:**

```
   ┌──── workflow ────┐   ┌──── goal ────┐   ┌──── cron ────┐
   │ stage DAG(결정적) │   │ cycle(반복)   │   │ 정시(자율)    │     ← "오케스트레이터" 3종
   └────────┬─────────┘   └──────┬───────┘   └──────┬───────┘        (전부 org 종속 · works-<handle> 보고)
            └──────────── 모두 호출 ───────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                        ▼
       ┌────────────┐          ┌────────────┐
       │   agent    │ ───사용──►│   skill    │
       │ (행위자 WHO)│          │ (방법 HOW)  │
       └────────────┘          └────────────┘
```

- **workflow · goal · cron** = 같은 추상("오케스트레이터")의 세 변종 — 결정적 / 반복 / 정시.
  셋 다 **agent 와 skill 을 조립**해 일한다. (goal = 자율-반복 workflow.)
- **agent**(행위자)는 **skill**(방법)을 쓰고, 다른 agent·workflow 도 호출한다 → 호출은 **양방향**.
- **main/sub 는 타입이 아니라 호출 위치**: workflow 안에서 불리면 sub-workflow, agent 가 스폰하면
  sub-agent. 단독 실행하면 같은 게 main 이 된다.
- **repo scope:** workflow=stage별 `target_repos` · cron=`repos:`(기본 전체) · 모두 비우면 전 repo,
  적으면 그 repo(§3.4).

> **워크샵 한 줄:** 5종을 다 만들 필요 없다. **skill 1개 + cron 1개**로 시작하고, 작업이
> 복잡해지면 workflow(결정적 다단계)·goal(반복 수렴)·agent(전문 분업)를 더한다. 전부 같은
> skill·agent 라이브러리 위에서 조립된다.

---

## 14. Sources

**SoloSquad 내부 (1차 — 직독, v1.3.11 기준)**
- `AGENTS.md` — Core Philosophy, 3-Layer Context, 8-layer JIT spawn, Multi-Session
  Execution, Handoff Protocol (※ Team Composition 표는 v1.3.6 squad 재편 이전 상태로
  일부 stale — 현재 팀/에이전트 정합은 `teams/{team}/composition.yaml` 직독이 기준)
- `teams/{team}/composition.yaml` — 5팀(core·product·engineering·business·brand) 멤버십 데이터
- `skills/skill-core/primitive-core.md` — primitive 작성 표준(§0 분류·philosophy·SKILL.md/
  composition format·workflow essence·3-bias guards·acceptance rubric) + pm_conventions
- `skills/workflow-manager/assets/workflows/` — 2 main(new-build·improvement) + 9 sub 번들 워크플로우
- `skills/{scqa,five-whys,tdcc}` (workflow) + `skills/{mece,xyz-hypothesis}` (skill) — RO-PNA
  6-Phase 의 재배치된 조각들
- `src/cron/crons.ts` — 빌트인 cron 4종 레지스트리; `src/bot/goal-validate.ts` — goal validator
- `docs/prd/product-roadmap.md` §2 — 제품 목표 3축(멀티 프로덕트·24/7 자율팀·실험 기획)
- `docs/ideation/260621-multi-repo-execution.md` — Model B 경로참조·`--add-dir`·매니페스트·
  드롭박스 패턴·primitive 비교표
- `docs/ideation/260621-workflow-goal-planning-evolution.md` — RO-PNA 5대 원칙·spec-kit
  clarify·멀티에이전트 리서치
- `docs/ideation/260623-squad-org-restructure.md` — 4팀/25 에이전트 → 5팀/19 에이전트 재편(§8.6)
- `docs/ideation/260625-ai-planning-insights.md` — prd 8 작성규칙(R1–R8)의 21-source 근거(v1.3.8)
- `CHANGELOG.md` — v0.6/v0.7(Hermes 차용), v0.9 plan(Model B 피봇·Model C Skip·npm burn),
  v1.2.6(trust working-dir), v0.9.2(precheck self-match), v1.3.3(cron 용어 통일),
  v1.3.5(planning workflows·org-scope cron·workflow-manager rename), v1.3.6(authoring 권한·
  squad 재편·asset→validate), v1.3.7(primitive 작성 내재화·workflow essence), v1.3.8(docs
  skill·6-doc gate), v1.3.9(3-segment version), v1.3.10~11(--add-dir 호환·Windows hotfix)
- `skills/docs/SKILL.md` — 문서 분류·네이밍·PRD↔version 1:1·publish gate 단일 큐레이션 권한(v1.3.8)
- `.claude/rules/git-workflow.md` — pre-publish docs 게이트(v1.3.8 에서 4→6 확장)
- `.claude/skills/trend-tracker/SKILL.md` — Tier-1 레퍼런스 표·품질 체크리스트

**외부 레퍼런스 (peer-project inspirations — `README.md` References 표)**
- [OpenClaw](https://github.com/openclaw/openclaw) — npm publish + `update`/`doctor` +
  cron lifecycle UX (차용); 전체 삭제 디폴트 Issue #6289 (거절)
- [Hermes Agent (Nous Research)](https://github.com/nousresearch/hermes-agent) — hot+cold
  FTS5 메모리 archive, trajectory→skill 요약, WAL-safe SQLite backup (차용); sandbox 모델 (거절)
- [gstack (Garry Tan)](https://github.com/garrytan/gstack) — Six Forcing Questions + 슬래시 체인
- [RO-PNA/pna-builders](https://github.com/RO-PNA/pna-builders) — PMF 게임 6-Phase·5대 원칙
- [phuryn/pm-skills](https://github.com/phuryn/pm-skills) — auto-load + slash 듀얼 트리거
- [Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — initializer/coding 분리·compaction·subagent
- [github/spec-kit](https://github.com/github/spec-kit) — specify→clarify→tasks (open_questions 정합)
