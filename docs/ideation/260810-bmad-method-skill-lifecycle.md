# BMAD-METHOD 실측 조사 — 3단 오버라이드·폐기 shim·2패스 검증기

> **조사일** 2026-08-10 · **대상** [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
> (main, JavaScript · **51,711 stars** · 778 파일 · **2,025 커밋** · 2025-04-13 ~ 2026-08-09 · 현재 `v6.10.0`)
>
> **위치** — 이 4건 조사 중 **SoloSquad 와 문제 구조가 가장 가까운 프로젝트**다.
> Hermes/OpenClaw 는 런타임이고 gstack 은 개인 도구 모음이지만, BMAD 는
> **"에이전트 로스터 + 단계별 워크플로 + 산출물 + 설치기"** 를 파는 방법론 제품이다.
> 즉 SoloSquad 의 `agents/` 25종 · `skills/` 55종 · `workflows/` · `solosquad init` 과 **같은 층**에 있다.
>
> **1차 소스만 사용** — 전체 히스토리 2,025 커밋 + repo 파일 직접 판독.

---

## 0. 한 문장

**BMAD 는 16개월 동안 메이저 버전을 6번 갈아치웠고, 지금은 자기가 만든 스킬을 줄이는 중이다.**
그 과정에서 만들어진 세 가지 장치 — **3단 오버라이드 머지 규칙** · **폐기 shim 정책** ·
**2패스 스킬 검증기** — 가 SoloSquad 재작성에 바로 쓰인다.

---

## 1. 속도와 곡선

| 기간 | 커밋 | |
|---|---:|---|
| 2025-04 ~ 08 | ~100 | v1 → v2 → V3 (첫 5개월에 메이저 3개) |
| 2025-09 ~ 2026-02 | 809 | 월 130~196 안정 |
| 2026-03 | **342** | 스파이크 (v6 전환기) |
| 2026-04 ~ 08 | 271 | **감쇠** (108 → 44 → 50 → 45 → 24) |

**gstack 과 같은 감쇠 곡선**이되 기간이 훨씬 길다. 그리고 감쇠 구간의 커밋 내용이
**증축이 아니라 통합**이라는 점이 이 프로젝트의 성격을 말해준다(§5).

### 1.1 메이저 6번

```
2025-04-13  "Initial Commit of the BMAaDd Workflow"
2025-05-04  v2 "fully tested and production ready — beta tag removed"       (3주)
2025-05-17  V3 "Final Beta Testing Release" (#59)                            (2주)
   …        v4 · v5
2026-??     v6.0.0-alpha.9 ~ alpha.23 → v6.0.1 … → **v6.10.0**(2026-07-03)
```

초기 커밋 제목에서 이미 방향이 보인다 — 2025-05-04 *"drastically simplified workflow diagram"*,
2025-05-12 **`lean out all ide agent modes to below 6k character count`**.
**컨텍스트 예산 인식이 2025년 5월부터 있었다.**

---

# A. 현재 구조

## 2. 2모듈 · 30스킬

```
src/
├── core-skills/          116 파일 — 모듈 무관 공통
│   ├── bmad-advanced-elicitation   bmad-brainstorming   bmad-customize
│   ├── bmad-deep-recon             bmad-forge-idea      bmad-help
│   ├── bmad-party-mode             bmad-review
│   ├── v6-shims/                   module.yaml   module-help.csv
│
└── bmm-skills/           241 파일 — BMad Method(=제품 개발) 모듈
    ├── agents/           5종 — analyst · pm · ux-designer · architect · dev
    ├── plan/             기획 단계 스킬
    ├── ship/             구현·출하 단계 스킬
    ├── v6-shims/         12 폐기 shim
    └── module.yaml       설치 프롬프트 + 아티팩트 경로 + 에이전트 로스터
```

**plan/ship 17종**: `architecture · build · build-auto · checkpoint-preview · code-review ·
correct-course · create-epics-and-stories · generate-project-context · prd · prfaq ·
product-brief · project-context · qa-generate-e2e-tests · retrospective · spec ·
sprint-planning · ux`

**`agents / plan / ship` 3분류는 2026-08-01 에 생겼다** (#2658, §5).

## 3. 🔴 3단 오버라이드 — 이 조사의 핵심 발견

### 3.1 정체성은 고정, 페르소나는 설정

```toml
# {skill-root}/customize.toml
# DO NOT EDIT -- overwritten on every update.
[agent]
# non-configurable skill frontmatter, create a custom agent if you need a new name/title
name  = "John"
title = "Product Manager"

# --- Configurable below ---
icon = "📋"
activation_steps_prepend = []
activation_steps_append  = []
persistent_facts = ["file:{project-root}/**/project-context.md"]
role                = "Translate product vision into a validated PRD, epics, and stories …"
identity            = "Thinks like Marty Cagan and Teresa Torres. Writes with Bezos's six-pager discipline."
communication_style = "Detective's 'why?' relentless. Direct, data-sharp, cuts through fluff to what matters."
```

**`name`/`title` 은 변경 불가**이고, 바꾸고 싶으면 *"커스텀 에이전트를 새로 만들라"* 고 명시한다.
번들 자산의 **정체성 안정성**과 사용자 커스터마이즈를 분리한 것이다.

### 3.2 병합 규칙이 문서에 명시돼 있다

```
1. {skill-root}/customize.toml                        기본값 (번들)
2. {project-root}/_bmad/custom/{skill-name}.toml      팀 오버라이드
3. {project-root}/_bmad/custom/{skill-name}.user.toml 개인 오버라이드
                    ↓ base → team → user 순
스칼라              → override (뒤가 이김)
테이블              → deep-merge
`code`/`id` 키 배열 → 일치 항목 replace + 신규 append
그 외 배열          → append
없는 파일           → 건너뜀
```

> 🔴 **SoloSquad 3-tier 검색 경로와 정확히 같은 문제, 더 정밀한 답.**
> SoloSquad `util/paths.ts getAgentsDir` 는 `.solosquad/agents/` → top-level `agents/` → bundle
> 순으로 **파일 단위 우선순위**를 쓴다. 즉 org 에 파일이 있으면 **번들 정의가 통째로 대체**된다.
> BMAD 는 **필드 단위 구조적 병합**이라, `persistent_facts` 한 줄만 추가하고 나머지는
> 번들 업데이트를 계속 받는다.
>
> | | SoloSquad 현행 | BMAD |
> |---|---|---|
> | 단위 | 파일 전체 교체 | **필드 단위 구조 병합** |
> | 번들 업데이트 | 오버라이드한 파일은 **영영 못 받음** | 오버라이드하지 않은 필드는 계속 받음 |
> | 배열 처리 | — | append / code·id 키 기준 replace |
> | 규칙 소재 | 코드 | **문서 + 스크립트 + 프롬프트 3곳에 동일 서술** |

### 3.3 결정론적 스크립트 + **수동 폴백**

```
Step 1: Resolve the Agent Block
  uv run {project-root}/_bmad/scripts/resolve_customization.py --skill {skill-root} --key agent

  **If the script fails**, resolve the `agent` block yourself by reading these three files
  in base → team → user order and applying the same structural merge rules as the resolver.
```

**스크립트가 실패하면 에이전트가 직접 하라**고 같은 규칙을 산문으로 다시 적어둔다.
LLM 시스템의 우아한 성능 저하(graceful degradation) 설계이며,
**규칙이 코드에만 있으면 폴백이 불가능하다**는 인식이 깔려 있다.

### 3.4 8단계 활성화 프로토콜

```
1 에이전트 블록 해석 (3단 병합)
2 activation_steps_prepend 실행
3 페르소나 채택 — role/identity/communication_style/principles 를 겹쳐 씌움
    "사용자가 해제할 때까지 캐릭터를 깨지 마라. 스킬을 호출해도 페르소나는 이어진다"
4 persistent_facts 로드 — `file:` 접두는 경로/글롭(내용을 사실로 로드), 나머지는 문장 그대로
5 config 로드 — user_name · communication_language · document_output_language ·
                planning_artifacts · project_knowledge
6 인사 — 아이콘을 앞에 달고, 이후 모든 메시지에 아이콘 접두 유지
7 activation_steps_append 실행
    "prepend/append 가 비어있지 않았다면 전부 순서대로 실행됐음을 확인한 뒤 본 작업 시작"
8 디스패치 또는 메뉴
    사용자 첫 메시지가 이미 의도를 담고 있으면("John, PRD 쓰자") **메뉴를 건너뛰고 직행**
    아니면 번호 표로 렌더 → 입력 대기. 번호/코드/퍼지 매칭 수용
    "두 항목이 진짜로 비슷할 때만 한 번 짧게 묻는다 — 확인 의식(confirmation ritual)이 아니라"
```

**주목할 두 문장**:
- *"아이콘 접두를 유지해 활성 페르소나가 시각적으로 식별되게 하라"* — 멀티 에이전트에서
  **누가 말하는지**를 값싸게 표시
- *"메뉴에 맞는 게 없으면 그냥 대화를 이어가라. 잡담·명확화 질문·`bmad-help` 는 언제나 유효하다"* —
  **메뉴가 감옥이 되지 않게** 하는 탈출구

## 4. 아티팩트 3분할 + 지연 생성

`module.yaml` 이 설치 시 3개 경로를 묻는다.

| 키 | 기본값 | 담는 것 |
|---|---|---|
| `planning_artifacts` | `{output_folder}/planning-artifacts` | Phase 1-3 — 브레인스토밍·브리프·PRD·UX·아키텍처·에픽 |
| `implementation_artifacts` | `{output_folder}/implementation-artifacts` | Phase 4 — 스프린트 상태·스토리·리뷰·회고·빌드 출력 |
| `project_knowledge` | `docs` | 리서치·document-project 출력·**장수하는 정확한 지식** |

주석이 규범 하나를 못박는다 —
*"**사전 생성 디렉토리 없음**: 세 경로는 **처음 쓰는 스킬이 지연 생성**한다."*

> **SoloSquad 대비** — `<org>/` 하위에 `workflows/` · `goals/` · `memory/` · `domain/` · `reports/` 를
> **init 이 미리 만든다.** BMAD 의 지연 생성은 *"안 쓰는 기능의 빈 폴더가 사용자를 혼란시키지 않는다"*
> 는 이점이 있고, SoloSquad 의 사전 생성은 *"구조가 곧 문서"* 라는 이점이 있다.
> 재작성에서 **결정할 가치가 있는 갈림길**이며, 현재 어느 문서에도 근거가 기록돼 있지 않다.

또 하나 — `user_skill_level`(beginner/intermediate/expert)을 설치 시 묻고
*"이것이 에이전트가 채팅에서 개념을 얼마나 설명할지를 바꾼다"* 고 명시한다.
SoloSquad `user/profile.md` 에 대응물이 없다.

---

# B. 시간축 — 지금 벌어지는 일은 "통합"이다

## 5. 2026-07 ~ 08 대통합 캠페인

감쇠 구간(월 24~50커밋)의 실제 내용이다.

| 날짜 | 커밋 | 방향 |
|---|---|---|
| 07-18 | `streamline core to an **8-skill set** with merged review and editorial skills` (#2603) | 코어 축소 |
| 07-19 | `group v6 shims and **merge editorial review into bmad-review as lenses**` (#2608) | 스킬 → **렌즈** |
| 07-22 | `**consolidate research trio** into bmad-deep-recon` (#2611) | 3 → 1 |
| 07-27 | `refactor(quick-dev,dev-auto): **minimal handoff**, drop Code Map nudge` (#2635) | 핸드오프 축소 |
| 07-28 | `promote quick-dev to the **official Phase 4 loop**` (#2637) | 실험 → 정본 |
| 07-28 | `**deprecate** create-story and dev-story` (#2641) | 폐기 |
| 07-29 | `**Rename** Quick Dev to Build` (#2651) | 개명 |
| 07-31 | `rework bmad-retrospective as an **evidence-based** epic review` (#2612) | 근거 기반화 |
| 08-01 | `**reorganize skills into agents / plan / ship**; retire tech-writer agent` (#2658) | 재분류 |
| 08-01 | `unify build skills on **shared renderer**` (#2657) | 렌더러 단일화 |
| 08-01 | `**consolidate sprint skills — one owner for the sprint-status artifact**` (#2659) | 🔴 |
| 08-02 | `refactor(review): **slim** adversarial hunter prompt` (#2675) | 프롬프트 축소 |
| 08-08 | `refactor(project-context): **conversational skill, no script**, AGENTS.md block` (#2698) | 스크립트 제거 |
| 08-09 | `restrict bmad-project-context routing to **invocation by name**` (#2702) | 라우팅 축소 |

### 5.1 세 가지 통합 축

**① 스킬 → 렌즈.** 별도 스킬이던 editorial review 를 `bmad-review` 의 **lens** 로 병합했다.
*"리뷰 스킬 3개"* 가 아니라 *"리뷰 스킬 1개 + 관점 3개"* 가 된다.
→ [[260810-hermes-agent-orchestration-topology]] §15.3 의 *"라우터/인덱스 스킬 금지"* 와 같은 계열.

**② 한 아티팩트 = 한 오너**(#2659). 스프린트 스킬들이 같은 `sprint-status` 산출물을 건드리던 것을
**단일 오너로 통합**했다.
→ SoloSquad `workflows/<id>/_status.yaml` 을 여러 스테이지가 갱신하는 현 구조에 직접 걸린다.

**③ 스크립트 → 대화형**(#2698). `bmad-project-context` 를 *"스크립트 없는 대화형 스킬"* 로 바꾸고
**`AGENTS.md` 블록**을 쓰게 했다. 다음 날 라우팅을 **이름 호출로만** 제한했다(#2702).

## 6. 🔴 v6-shims — 폐기를 제품 기능으로 만들었다

12개 shim 이 **v6 스킬 ID 하위호환**을 담당한다.

```
bmad-quick-dev           → bmad-build
bmad-dev-auto            → bmad-build-auto
bmad-create-prd          → bmad-prd (create intent)
bmad-edit-prd            → bmad-prd (update intent)
bmad-validate-prd        → bmad-prd (validate intent)
bmad-create-architecture → bmad-architecture (create intent)
bmad-market-research     → bmad-deep-recon (market type)
bmad-domain-research     → bmad-deep-recon (domain type)
bmad-technical-research  → bmad-deep-recon (technical type)
bmad-sprint-status       → bmad-sprint-planning (status view)
bmad-create-story        → 전체 유지 (forward 아님)
bmad-dev-story           → 전체 유지
```

**설계 요점 3개.**

- **단순 별칭이 아니라 의도 전달**이다 — *"일부는 전체 워크플로를 유지하고, 나머지는 후속 스킬로
  **명시된 의도와 미리 해결된 커스터마이즈 필드를 넘겨** 전달한다. **대상 스킬은 자기 의도 추론을
  건너뛴다.**"* 즉 `bmad-create-prd` 는 `bmad-prd` 에 *"create"* 라는 답을 들고 간다
- **제거 시점이 정책으로 못박혀 있다** — *"엔터프라이즈 사용자가 여전히 이 ID 에 의존할 수 있으므로
  기본 배송된다. **제거는 v7 컷을 타며, 6.x 마이너에서는 절대 하지 않는다.**"*
- **폴더는 그룹핑일 뿐이다** — 설치기는 재귀적으로 발견해 각자의 `name` 으로 설치하므로
  **중첩이 설치 경로나 스킬 ID 를 바꾸지 않는다.** 향후 설치 옵션으로 포함/제외를 열 예정

> 🔴 **SoloSquad 결정 11(마이그레이션 체인 없음)과 대비된다.**
> SoloSquad 는 npm 계약 소멸을 근거로 **43 스크립트 체인을 전량 폐기**하기로 했다(§M1).
> 그러나 **자산 ID**(스킬·에이전트 이름)의 하위호환은 별개 문제이며 아직 다뤄지지 않았다.
> v1.3.6 이 이미 `paid → performance` 개명 · 5건 통합 · `fde` 제거를 했고, 재작성에서
> 25 에이전트 · 55 스킬이 다시 재편될 가능성이 높다.
> **BMAD 의 shim 정책은 "코드 마이그레이션 없이 자산 ID 만 이어주는" 값싼 형태**다.

## 7. 🔴 2패스 스킬 검증기

`tools/skill-validator.md`(378줄)가 **Agent Skills 오픈 표준**을 따르는 스킬을 검증한다.

```
1패스  결정론적   node tools/validate-skills.js --json <skill-dir>
                  13 규칙: SKILL-01~07 · PATH-02 · STEP-01/06/07 · SEQ-02 · TPL-01

2패스  추론 기반   LLM 이 스킬 디렉토리 전체를 재귀적으로 읽고 규칙 적용
                  13 규칙: PATH-01/03/04/05 · WF-03 · STEP-02~05 · SEQ-01 · REF-01~03

   ★ "1패스에서 **findings 0 인 규칙은 2패스에서 건너뛰라.** 이미 검증됐다.
      findings 가 있었던 규칙은 판단이 도움되는 하위 검사가 있으므로 2패스도 본다.
      추론 노력을 **판단이 필요한 나머지 규칙에 집중하라.**"
```

**규칙 분류**: `SKILL-*`(파일·프론트매터) · `PATH-*`(경로 해석) · `STEP-*`(단계 서술) ·
`SEQ-*`(순서) · `REF-*`(참조 무결성) · `WF-*`(워크플로) · `TPL-*`(템플릿).
각 규칙이 **Severity · Applies to · Rule · Detection · Fix** 5필드로 정의된다.

정의절에 안티패턴이 하나 박제돼 있다 —
**"intra-skill path variable"**: 프론트매터 변수의 값이 **같은 스킬 안의 다른 파일 경로**인 것.

> **SoloSquad 대비** — v1.3.2 `solosquad validate` 와 v1.3.6 검증기 정렬
> (예약어·vague·트리거절·본문 500줄·8-word shingle originality)은 **전부 결정론적**이다.
> BMAD 는 그 위에 **판단이 필요한 규칙을 LLM 패스로 분리**하고,
> **1패스 통과분을 2패스에서 빼는 비용 규칙**까지 넣었다.
> `originality.ts` 같은 것은 결정론적이 맞고, *"이 STEP 서술이 실행 가능한가"* 는 추론이 맞다.

---

# C. SoloSquad 로의 환류

## 8. 미결·설계에 주는 것

### 8.1 🔴 `[0] 골격` — 자산 오버라이드를 필드 단위로

§3.2 의 대비표가 결론이다. **파일 단위 교체는 번들 업데이트를 영구히 끊는다.**
SoloSquad 는 자산 98파일을 100% 승계하고(§0.0.3), org 별 특화를 `agent-profile.yaml` 로 받는
구조인데, **`agents/` 자체를 org 가 오버라이드하면 그 에이전트는 업데이트가 멈춘다.**

```
권고 — 재작성 시 자산 해석을 2층으로 나눈다
  ① 정체성 (name·title·team)        번들 고정. 바꾸려면 새 에이전트를 만든다
  ② 페르소나·행동 (role·voice·      3단 병합: bundle → org → user
     principles·facts·menu)          병합 규칙을 **문서·스크립트·프롬프트 3곳에 동일 서술**
```

**③ 규칙을 3곳에 적는 이유**(§3.3) — 스크립트가 실패해도 에이전트가 같은 결과를 낼 수 있어야 한다.
결정 8(새 구조 재작성)에서 Python 리졸버를 새로 쓰게 되므로 **지금이 이 형태를 넣을 시점**이다.

### 8.2 🔴 `_status.yaml` — 한 아티팩트 = 한 오너

BMAD #2659 (`consolidate sprint skills — one owner for the sprint-status artifact`)가
SoloSquad 의 현재 구조를 직격한다.

```
현행 — workflows/<id>/_status.yaml 을 갱신하는 주체
   · 각 스테이지 에이전트 (pending → in_progress → completed)
   · WorkflowReconciler (봇 크래시 복구 시 needs_revision)
   · Chief (스테이지 위임 시 stage_id 마킹)
   → 오너가 셋
```

[[260810-hermes-agent-orchestration-topology]] §16.3 은 `_status.yaml` 을 **오케스트레이션 1급 축으로
승격**할 것을 M9 의 선택지로 제안했다. 승격한다면 **오너 단일화가 선행 조건**이다 —
BMAD 는 스킬을 통합해서 풀었고, SoloSquad 는 **러너가 유일한 writer 가 되고 에이전트는 이벤트만
낸다**는 형태가 자연스럽다(러너가 spawn 을 직접 소유하므로 — §0.0.6).

### 8.3 🔴 자산 ID 하위호환 정책 — 지금 없는 것

§6 이 드러낸 공백이다. SoloSquad 는 **코드 마이그레이션은 폐기하기로 결정**(결정 11)했지만
**자산 ID 재편의 하위호환은 아무 정책이 없다.** 재작성에서 25 에이전트·55 스킬이 다시 정리될
가능성이 높고, 사용자 워크스페이스의 `<org>/` 문서·워크플로가 옛 이름을 참조하고 있다.

> **권고 — BMAD 형 shim 정책을 채택하되 SoloSquad 규모로 축소**
> ```
> ① shim 은 "의도 전달 forward" 로 만든다 (단순 별칭 아님)
>    구 이름 → 신 스킬 + 미리 해결된 인자 → 대상은 의도 추론을 건너뛴다
> ② 제거 시점을 **메이저 컷에 못박는다** — "v3 에서 제거, v2.x 마이너에서는 절대"
> ③ shim 폴더는 **그룹핑일 뿐** — 설치 경로나 ID 를 바꾸지 않는다
> ```
> 비용이 낮다(스킬 파일 몇 개)는 점이 핵심이다. 43 스크립트 체인과는 성질이 다르다.

### 8.4 🔴 검증기를 2패스로

§7 의 형태를 v1.3.2/v1.3.6 검증기 위에 얹는다.

```
1패스 결정론적 (현행 유지)   프론트매터 · 예약어 · vague · 트리거절 · 본문 길이 ·
                              originality shingle · 경로 존재 · 참조 무결성
2패스 추론 (신설)            "이 STEP 서술이 실행 가능한가" · "이 트리거가 실제 요청과 맞는가" ·
                              "순서가 논리적인가" · "이 참조가 의미상 옳은 대상인가"
   ★ 1패스 통과 규칙은 2패스에서 제외 — LLM 비용을 판단 필요분에만 쓴다
```

각 규칙을 **Severity · Applies to · Rule · Detection · Fix** 5필드로 정의하는 형식도 그대로 쓸 만하다.
`skills/skill-core/core.md`(v1.3.6 공유 코어)에 규칙 카탈로그를 두면 매니저 스킬과 검증기가
**같은 문서를 본다.**

### 8.5 🟡 활성화 프로토콜 — Chief/에이전트 SKILL.md 에 얹을 5개

§3.4 의 8단계 중 SoloSquad 에 없는 것들:

| 항목 | 값 |
|---|---|
| **아이콘 접두 유지** | 멀티 에이전트 대화에서 화자 식별이 값싸다. Discord 복귀(v2.1.0) 시 특히 |
| **`persistent_facts` 의 `file:` 접두** | 문장과 파일 참조를 **한 배열에서** 구분. SoloSquad 8-layer 는 층별로 나뉘어 있어 org 규칙 한 줄을 넣을 자리가 없다 |
| **의도가 명확하면 메뉴 건너뛰기** | *"확인 의식이 아니라"* — Chief 의 clarifying question ≤2 규칙과 같은 계열이나 **디스패치 직행** 조건이 없다 |
| **메뉴는 감옥이 아니다** | 맞는 항목이 없으면 그냥 대화를 이어가라 |
| **prepend/append 훅** | 활성화 전후 사용자 정의 단계. org 별 컴플라이언스 체크 등 |

### 8.6 🟡 설치 시 `user_skill_level`

BMAD 는 설치 때 beginner/intermediate/expert 를 묻고 *"에이전트가 개념을 얼마나 설명할지"* 를 바꾼다.
SoloSquad `solosquad init` 은 handle/name/role/provider 를 묻지만 **숙련도를 묻지 않는다**.
1인 창업자 대상 제품에서 *"코드를 안 보는 사용자"* 와 *"IDE 옆에서 보는 사용자"* 는 다른 설명량을 원한다.

### 8.7 🟡 아티팩트 지연 생성 vs 사전 생성

§4 의 갈림길. 재작성에서 `<org>/` 레이아웃을 새로 정하므로 **지금 결정할 것**이며,
현재 어느 문서에도 근거가 없다. 판단 기준 제안:

```
사전 생성  구조가 문서 역할을 함 · 사용자가 직접 파일을 넣을 곳 (domain/ · core/ · knowledge/)
지연 생성  기능을 쓸 때만 생기는 것 (goals/ · workflows/ · reports/ · memory/archive.sqlite)
```

---

## 9. 차용 · 기각

### 9.1 차용 권고

| # | 항목 | 자리 |
|---|---|---|
| ① | **필드 단위 3단 병합** + 명시된 병합 규칙(스칼라 override · 테이블 deep-merge · code/id 배열 replace+append · 그 외 append) | `[0] 골격` 자산 해석 |
| ② | **결정론 스크립트 + 산문 폴백** — 같은 규칙을 3곳에 적는다 | 리졸버 설계 |
| ③ | **정체성 고정 / 페르소나 설정 가능** — 이름을 바꾸려면 새 에이전트 | 자산 계약 |
| ④ | **한 아티팩트 = 한 오너** | `_status.yaml` · `[3] 실행` |
| ⑤ | **의도 전달 shim + 메이저 컷 제거 정책** | 자산 ID 하위호환 |
| ⑥ | **2패스 검증기** + 1패스 통과분 제외 규칙 | `solosquad validate` 후신 |
| ⑦ | **규칙 5필드 정의**(Severity/Applies to/Rule/Detection/Fix) | `skills/skill-core/core.md` |
| ⑧ | **스킬 → 렌즈 통합** — 리뷰 3종이 아니라 리뷰 1종 + 관점 3개 | 번들 스킬 정리 |
| ⑨ | **아이콘 접두로 화자 식별** | 에이전트 SKILL.md · 메신저 복귀 |
| ⑩ | **`user_skill_level`** 설치 질문 | `solosquad init` |

### 9.2 조건부

| 항목 | 조건 |
|---|---|
| **아티팩트 3분할**(planning/implementation/knowledge) | SoloSquad 는 `<org>/` 하위에 이미 workflows·goals·memory·domain·reports 를 갖고 있어 **재분류가 아니라 명명 정합** 문제. §B3(org docs vs repo docs 재분류)에서 함께 판단 |
| **지연 생성** | §8.7 의 기준으로 폴더별 판정 |
| **활성화 훅**(prepend/append) | org 별 컴플라이언스 수요가 실제로 생길 때. 지금 넣으면 [[260810-hermes-agent-orchestration-topology]] §15.3 의 *"소비자 없는 투기적 인프라"* 에 해당 |

### 9.3 기각

| 항목 | 사유 |
|---|---|
| **에이전트 5종 로스터** | SoloSquad 는 25종을 이미 보유하고 §B2/§M9 에서 재편 중. 숫자를 베낄 이유 없음 |
| **`party-mode`**(전 에이전트 동시 등장) | 데모 가치는 있으나 1인 창업자의 실작업 가치가 낮고 토큰 비용이 곱해진다 |
| **모듈 시스템**(bmm/core 분리 + 외부 모듈) | SoloSquad 는 org 계층이 같은 역할을 한다. 모듈을 더하면 층이 하나 늘어난다 |
| **`uv run` 스크립트 의존** | 아이러니하게도 SoloSquad 도 `uv` 를 채택(M4)하므로 **수단은 같아진다**. 기각 대상은 *"스킬이 스크립트를 호출하는 것"* 이며, BMAD 자신도 2026-08-08 에 그 방향을 되돌렸다(#2698 `conversational skill, no script`) |

---

## 10. 미확인 · 후속

1. **`tools/skill-validator.md` 규칙 26개 전문 미판독**(1~55줄만 읽음) — 2패스 검증기를 실제
   구현할 때 규칙 카탈로그 전체가 필요
2. **`plan/`·`ship/` 17 스킬 본문 미판독** — 특히 `bmad-spec` · `bmad-build-auto` ·
   `bmad-code-review` 는 SoloSquad `workflow`/`goal` 과 직접 대응
3. **v4 → v5 → v6 전환의 구체 내용 미확인** — 커밋 제목만으로는 무엇이 왜 갈렸는지 불명.
   `CHANGELOG.md` 와 v6 alpha 23판의 이력이 남아 있으므로 필요 시 추적 가능
4. **`resolve_customization.py` 원문 미판독** — §3.2 병합 규칙의 실제 구현
5. **`module-help.csv`** — 스킬 라우팅/도움말 카탈로그 형식. `bmad-help` 스킬과 함께 볼 것

---

## 참조

- [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) — 1차 소스
- 본문 인용 원문 — `src/bmm-skills/module.yaml` · `src/bmm-skills/agents/bmad-agent-pm/{SKILL.md,customize.toml}` ·
  `src/bmm-skills/v6-shims/README.md` · `tools/skill-validator.md` · `AGENTS.md`
- 사내 — [[260810-hermes-agent-orchestration-topology]] §15.3(라우터 스킬 금지 — §5.1-① 과 같은 계열) ·
  [[260810-gstack-skill-harness]] §8.1(스킬 평가) ·
  [[260803-solosquad-architecture-redesign]] §B2 · §B3 · §M1 · §M9 ·
  `docs/prd/v1.3.2-asset-managers-validate.md` · `docs/prd/v1.3.6-skill-agent-authoring-internalization.md`
