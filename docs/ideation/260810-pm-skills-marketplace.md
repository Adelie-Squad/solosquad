# pm-skills 실측 조사 — 명사/동사 분리와 독립 설치 가능성 제약

> **조사일** 2026-08-10 · **대상** [phuryn/pm-skills](https://github.com/phuryn/pm-skills)
> (main, 마크다운 전용 — GitHub 언어 감지 `null` · **25,069 stars** · 257 파일 ·
> **62 커밋** · 2026-03-02 ~ 2026-07-03 · 현재 `v2.1.0` · MIT)
>
> **위치** — SoloSquad 가 v1.1 통합 입력 4건 중 하나로 이미 인용한 소스
> (*"Hermes V2 + gstack + RO-PNA pna-builders + **phuryn pm-skills**"*).
> 이 4건 조사 중 **가장 작고 가장 규범이 선명하다.** 런타임이 0줄이라
> 남는 것이 **자산 설계 규칙**뿐이기 때문이다.
>
> **1차 소스만 사용** — 전체 히스토리 62 커밋 + repo 파일 직접 판독.

---

## 0. 한 문장

**코드가 한 줄도 없는 25k-star 프로젝트.** 그래서 이 조사에서 얻을 것은 아키텍처가 아니라
**"스킬이란 무엇이고 커맨드란 무엇인가"에 대한 가장 명확한 답 한 줄**과,
**독립 설치 가능성이 강제하는 참조 규율**이다.

---

## 1. 규모와 곡선 — "수렴"이 아니라 "완료"

| 월 | 커밋 |
|---|---:|
| 2026-03 | **51** |
| 2026-04 | 1 |
| 2026-05 | 2 |
| 2026-06 | 7 |
| 2026-07 | 1 |
| 2026-08 | 0 |

**첫 주에 40건, 그 뒤 4개월간 22건.** 마지막 커밋이 **2026-07-03**(v2.1.0)이고 그 뒤 정지다.

gstack 의 감쇠(176→2)가 **수렴**이라면, 이것은 **완료**에 가깝다.
`.md` 파일만 있는 프로젝트가 도달할 수 있는 종착점이며, 이 사실 자체가 발견이다 —
**런타임이 없으면 유지보수 곡선이 0으로 간다.**

> **SoloSquad 대비.** 번들 자산 98파일(`agents/` 21 · `skills/` 55 · `teams/` 15 · `crons/` 7)은
> pm-skills 와 같은 성질이고, `src/` 49.8k LOC 는 Hermes/OpenClaw 와 같은 성질이다.
> §0.0.3 이 *"자산은 언어 중립이라 이식 대상이 아니다"* 라고 본 판단이 **유지보수 곡선 관점에서도 옳다.**

### 1.1 히스토리가 말하는 3가지

```
2026-03-02  Initial commit → v1.0 → 그날 하루에만 30+ 커밋 (대부분 README 수정)
2026-03-03  "Improve skill **discoverability**"          ← 첫 설계 변경
2026-03-05  validate_plugins.py Windows UnicodeEncodeError
2026-03-09  ~ 2026-04-22 **6주 공백**
2026-06-04  **"Add CLAUDE.md and AGENTS.md agent guidance"**   ← 3개월 뒤에야 규범 문서
2026-06-05  v2.0.0 — pm-ai-shipping 플러그인 + red-team 스킬
2026-07-03  v2.1.0 — **"Opus 4.8-tuned** pm-ai-shipping audits + CHANGELOG-driven release automation"
```

- **초기 40커밋이 대부분 README 다.** 스킬 자체보다 **발견 가능성(discoverability)** 이 먼저였다
- **규범 문서가 3개월 늦었다.** Hermes(갓파일 해체 다음날) · OpenClaw(독트린 398줄)와 달리
  pm-skills 는 **작동한 뒤에 규범을 적었다**
- **v2.1.0 제목이 `Opus 4.8-tuned`** — 스킬을 **특정 모델 버전에 맞춰 튜닝**했다.
  자산이 모델 중립이 아니라는 것을 릴리스 제목으로 인정한 사례

---

# A. 구조

## 2. 9 플러그인 × (스킬 + 커맨드)

```
pm-skills/
├── .claude-plugin/marketplace.json   ← 루트 마켓플레이스 매니페스트 (9 플러그인 목록)
├── CLAUDE.md                          ← 에이전트 지침 단일 진실 원천
├── AGENTS.md                          ← CLAUDE.md 로 보내는 포인터
├── CHANGELOG.md                       ← 릴리스의 진실 원천
├── validate_plugins.py                ← 검증기
├── tests/                             ← 정합성 테스트
└── pm-{name}/                         ← 9개
    ├── .claude-plugin/plugin.json
    ├── skills/{skill}/SKILL.md        ← 68개
    ├── commands/{command}.md          ← 42개
    └── README.md
```

| 플러그인 | 초점 |
|---|---|
| `pm-product-discovery` | 아이디에이션·실험·가정 검증·우선순위·인터뷰 종합 |
| `pm-product-strategy` | 비전·전략/린/비즈니스모델 캔버스·SWOT·PESTLE·Ansoff·Porter·수익화 |
| `pm-execution` | PRD·OKR·로드맵·스프린트·프리모템·이해관계자맵·유저스토리·레드팀 |
| `pm-market-research` | 페르소나·세그멘테이션·감성분석·경쟁분석·시장규모 |
| `pm-data-analytics` | SQL 생성·코호트/리텐션 분석 |
| `pm-go-to-market` | GTM 전략·그로스 루프·모션·비치헤드 세그먼트·ICP |
| `pm-marketing-growth` | 마케팅 아이디어·가치제안·North Star·네이밍·포지셔닝 |
| `pm-toolkit` | 이력서 리뷰·NDA·개인정보처리방침·문법/흐름 점검 |
| `pm-ai-shipping` | 바이브코딩 앱 문서화·테스트 커버리지 매핑·보안/성능 감사·출하 패킷 |

> ⚠️ **`AGENTS.md` 방향이 SoloSquad 와 반대다.** pm-skills 는 `CLAUDE.md` 가 정본이고
> `AGENTS.md` 가 포인터(5줄)이며, SoloSquad 는 `AGENTS.md` 가 정본이고 `CLAUDE.md` 가 리다이렉트다.
> pm-skills 의 이유는 *"Claude Code 와 Cowork 용으로 만들었다"* 이고,
> SoloSquad 의 이유는 *"모든 AI 도구가 이 파일을 읽는다"* 다. **둘 다 자기 전제에서 옳다.**

## 3. 🔴 명사/동사 분리 — 이 조사의 핵심 한 줄

`CLAUDE.md` §Key Design Rules 첫 두 줄이 전부다.

> - **Skills = nouns/concepts.** 주제가 맞으면 Claude 가 **자동 로드**하는 프레임워크·분석 지식
>   (`lean-canvas`, `pre-mortem`, `market-sizing`).
> - **Commands = verbs.** 사용자가 트리거하는, **하나 이상의 스킬을 엮는 워크플로**
>   (`/write-prd`, `/discover`, `/plan-launch`).

### 3.1 실물 대조

```yaml
# 스킬 — pm-product-strategy/skills/lean-canvas/SKILL.md
---
name: lean-canvas
description: "Generate a Lean Canvas with problem, solution, metrics, cost structure, UVP,
  unfair advantage, channels, segments, and revenue. Use when exploring a lean startup canvas,
  testing a business hypothesis, or modeling a new venture."
---
# Lean Canvas
## Metadata
- **Triggers**: lean canvas, startup canvas, lean model, business hypothesis
## Instructions
You are a business model strategist designing a Lean Canvas for $ARGUMENTS.
## Input Requirements / ## Lean Canvas Template / ### Section 1 …
```

```yaml
# 커맨드 — pm-execution/commands/write-prd.md
---
description: Create a comprehensive Product Requirements Document from a feature idea or problem statement
argument-hint: "<feature or problem statement>"
---
# /write-prd -- Product Requirements Document
## Invocation
  /write-prd SSO support for enterprise customers
  /write-prd Users are dropping off during onboarding — we need to fix step 3
  /write-prd [upload a brief, research doc, or strategy deck]
## Workflow
### Step 1: Understand the Feature   ← 입력을 어떤 형태로든 수용 (이름/문제진술/요청/막연한 아이디어/문서)
### Step 2: Gather Context           ← "대화하듯 물어라 — 중요한 질문 먼저, 빈칸은 진행하며 채워라"
### Step 3: …
```

**형태 차이가 명확하다.**

| | 스킬 (명사) | 커맨드 (동사) |
|---|---|---|
| 로드 | 주제 일치 시 **자동** | 사용자가 `/` 로 **명시 호출** |
| 프론트매터 | `name` + `description` | `description` + `argument-hint` |
| 본문 | **템플릿·프레임워크·섹션 정의** | **Step 1..N 워크플로** |
| 인자 | 불필요 (대화에서 문맥을 읽음) | 단일 `$ARGUMENTS` |
| 강제 호출 | `/plugin-name:skill-name` 또는 `/skill-name` | — |

> 🔴 **SoloSquad primitive 5종에 그대로 걸린다.**
> SoloSquad 는 `skill` / `agent` / `workflow` / `goal` / `cron` 5종의 **작성법**을
> v1.3.6~1.3.7 에서 내재화했지만 **선택법**이 없다
> ([[260810-hermes-agent-orchestration-topology]] §16.6 · [[260810-gstack-skill-harness]] §8.3).
> pm-skills 의 축은 **품사**다 —
>
> ```
> 명사(개념·프레임워크·판단 기준)  → 자동 로드되어야 한다 → skill
> 동사(절차·단계·산출물 생성)      → 명시 호출되어야 한다 → workflow / cron
> 인격(관점·목소리·책임)           → 스폰 대상이다        → agent
> 목표(측정·사이클·중단 조건)      → 자율 실행이다        → goal
> ```
>
> **이 한 축만으로 5종 중 3종의 경계가 정해진다.** 현재 SoloSquad 문서에서
> "언제 skill 이고 언제 workflow 인가"가 가장 흐린 지점인데, 답은 **"명사냐 동사냐"** 다.

### 3.2 같은 개념의 스킬과 커맨드가 공존한다

`pm-execution` 에는 스킬 `create-prd` 와 커맨드 `/write-prd` 가 **둘 다 있다.**
중복이 아니라 **역할 분담**이다 — 대화 중 PRD 주제가 나오면 스킬이 자동으로 붙고,
사용자가 "PRD 써줘"를 명시하면 커맨드가 워크플로를 돌린다.

## 4. 🔴 독립 설치 가능성이 참조를 규율한다

> - **크로스 플러그인 참조 금지.** 커맨드는 후속 작업을 **자연어로만** 제안한다
>   (*"그로스 루프를 설계해 드릴까요?"*). **다른 플러그인의 커맨드를 하드 참조하지 마라 —
>   플러그인은 독립적으로 설치되므로 하드 참조는 깨질 수 있다.**
> - **같은 플러그인 안의 "Uses" 참조는 괜찮다** — 같은 플러그인의 스킬과 커맨드는 항상 함께 배송된다.

**배포 단위가 참조 규칙을 결정한다**는 원칙이 명시적으로 코드화된 드문 사례다.
그리고 그 규칙이 검증기에 들어가 있다 —
`validate_plugins.py` 가 *"intra-plugin command→skill references"* 를 확인한다.

> **SoloSquad 대비.** 번들 자산은 **한 덩어리로 배송**되므로 이 제약이 지금은 없다.
> 그러나 §B2(내부 마켓플레이스 — overlay + 승격 파이프라인)가 실현되면
> **org 별로 다른 자산 부분집합**이 생기고, 그 순간 같은 문제가 발생한다.
> **자산 간 참조가 "같은 배송 단위 안인가"를 판정할 수 있어야 한다.**

## 5. 🟡 "What's Visible Where" — 설명문의 노출 지점 표

`CLAUDE.md` 에 표가 하나 있다. **각 description 이 어디에 보이는지**를 못박는다.

| 위치 | 보이는 곳 | 비고 |
|---|---|---|
| `marketplace.json.description` | Cowork 마켓플레이스 브라우저, Claude Code | 마켓플레이스 전체 한 줄 |
| `plugin.json.description` | Cowork 플러그인 목록, Claude Code | 플러그인별 요약 |
| `SKILL.md` 프론트매터 `description` | Cowork 스킬 목록, **Claude 자동 로딩** | **트리거 구문을 포함시켜야 적시에 로드된다** |
| 커맨드 프론트매터 `description`+`argument-hint` | Cowork · Claude Code (`/` 입력 시) | 짧고 실행 가능하게 |
| `README.md` (루트) | **GitHub 에서만** | 전체 문서. **런타임에 Claude 가 로드하지 않음** |

> **차용 가치 높음** — 작성자가 *"이 문장을 누가 언제 읽는가"* 를 모르면 톤과 길이를 정할 수 없다.
> SoloSquad 는 SKILL.md frontmatter · agent SKILL.md · `crons/*.md` · `manual/` ·
> `README` · Discord 임베드 등 노출 지점이 더 많은데 **이 표가 없다.**

**progressive disclosure 규칙도 한 줄로 있다** —
*"프론트매터를 얇게 유지하라(항상 로드됨). 상세는 SKILL.md 본문에 넣어라(트리거될 때 로드됨)."*

## 6. 🟡 릴리스 정합성 — CHANGELOG 가 진실 원천

```
CHANGELOG.md 의 최신 `## vX.Y.Z — YYYY-MM-DD` 헤딩 = 릴리스된 버전
      ↓ main 에 새 헤딩을 추가하는 커밋을 push
CI (tag-on-merge.yml) → 버전 동기 검증 + 테스트 → 태그 vX.Y.Z → GitHub Release
                                                    (해당 섹션이 릴리스 노트가 됨)
```

**버전 동기화가 강제된다** — `marketplace.json` + **9개 `plugin.json` 전부** + CHANGELOG 최신 헤딩이
**항상 같은 버전**을 갖는다(`tests/test_consistency.py` 가 강제).
**플러그인별 독립 버전은 없다.**

검증이 2층이다.

```
validate_plugins.py   plugin.json 필수 필드/이름 일치/semver/author/keywords ·
                      스킬 프론트매터 + **name 이 디렉토리명과 일치** ·
                      커맨드 프론트매터(description + argument-hint) ·
                      README 존재 · **intra-plugin command→skill 참조**

tests/                README 개수 vs 디스크 · marketplace 목록 vs 디렉토리 ·
                      전 매니페스트 + CHANGELOG 버전 동기 · CHANGELOG 헤딩 형식 ·
                      플러그인 README 의 /plugin:command 참조
```

**README 의 개수를 테스트가 3곳에서 검사한다** — headline · 플러그인별 요약 · 플러그인 README
섹션 헤더. 즉 *"스킬을 추가하면 README 숫자가 틀어진다"* 를 **CI 가 잡는다.**

> **SoloSquad 의 `npm run docs-check`(4-docs 게이트)와 같은 계열**이되,
> SoloSquad 는 *"버전 문자열이 문서에 언급되는가"* 를 보고 pm-skills 는
> *"개수·목록·버전이 서로 맞는가"* 를 본다. **후자가 더 강하다.**

## 7. 🟡 두 개의 소소하지만 좋은 규칙

**① Further Reading 톤 강제.** 스킬 말미에 저자 블로그(Product Compass) 링크를 다는데,
*"**톤은 중립을 유지해야 한다** — 홍보 언어 금지, CTA 금지, 'subscribe'/'check out' 금지.
제목과 URL 만."* 그리고 *"Claude 는 대화 관련성에 따라 이 링크를 노출하지, 매 응답마다 하지 않는다."*
제목에 "Masterclass"/"Course" 가 있으면 `(video course)` 태그를 붙인다.

**② 작업 후 제안 목록.** `CLAUDE.md` 가 *"작업을 끝낸 뒤 무엇을 제안할지"* 를 명시한다 —
구조 변경 후 *"검증기 돌릴까요?"* · 스킬 추가/제거 후 *"README·marketplace 개수 갱신할까요?"* ·
description 변경 후 *"README/plugin.json 에 동기화할까요?"* · 아무 변경 후 *"버전 올릴까요?"*.

> **후자가 특히 좋다** — 에이전트가 **자기 작업의 파급 효과를 알고 먼저 제안**하게 만든다.
> SoloSquad `AGENTS.md` 에는 "무엇을 하지 마라"는 있어도 **"끝낸 뒤 무엇을 제안하라"** 가 없다.

---

# B. SoloSquad 로의 환류

## 8. 미결·설계에 주는 것

### 8.1 🔴 primitive 선택 기준 — 품사 축 (3건 중 마지막 조각)

세 조사가 각각 다른 각도로 같은 공백을 지적했고, **이 문서가 마지막 조각을 준다.**

| 출처 | 축 | 답하는 질문 |
|---|---|---|
| [[260810-hermes-agent-orchestration-topology]] §15.2 | **Footprint Ladder** | *"코어에 얼마나 영구 표면을 더하는가"* → 가장 발자국 작은 단을 골라라 |
| [[260810-gstack-skill-harness]] §2.2 | **무게 티어** | *"이 자산에 공통 규범을 얼마나 실을 것인가"* → 프론트매터에 선언 |
| **본 문서** §3 | **품사** | *"명사인가 동사인가"* → 자동 로드 vs 명시 호출 |

**세 축을 합치면 primitive 선택표 1장이 나온다.**

```
┌─ 품사 ─────────────────────────────────────────────────────────┐
│ 명사(개념·프레임워크·판단기준) → skill   · 자동 로드 · 트리거 필요 │
│ 동사(절차·단계·산출물)         → workflow · 명시 호출 · 단계 정의   │
│ 인격(관점·목소리·책임)          → agent    · 스폰 대상             │
│ 목표(측정·사이클·중단)          → goal     · 자율 실행             │
│ 시각(반복·무인)                → cron     · 스케줄 트리거          │
└────────────────────────────────────────────────────────────────┘
     ↓ 그 다음
┌─ 발자국 ── 위 분류로 안 되면: 기존 자산 확장 > 새 자산 > 코어 도구 ┐
└────────────────────────────────────────────────────────────────┘
     ↓ 그 다음
┌─ 무게 ──── context-tier 1..4 를 프론트매터에 선언 (범위 밖 = validate 실패) ┐
└──────────────────────────────────────────────────────────────────────┘
```

> **권고** — 이 표를 `skills/skill-core/core.md`(v1.3.6 공유 코어)에 넣는다.
> 작성법은 이미 내재화됐고, **선택법만 비어 있다.**

### 8.2 🔴 §B2(내부 마켓플레이스)의 선행 제약

§4 가 §B2 에 직접 걸린다. overlay + 승격 파이프라인이 실현되면 **org 마다 자산 부분집합**이
생기고, 그 순간 *"이 스킬이 참조하는 저 에이전트가 이 org 에 있는가"* 가 런타임 실패가 된다.

```
권고 — §B2 설계 시 함께 넣을 규칙 3줄
  ① 자산 간 하드 참조는 **같은 배송 단위 안에서만** 허용한다
  ② 단위를 넘는 관계는 **자연어 제안**으로만 표현한다 ("리서치 에이전트에게 넘길까요?")
  ③ 검증기가 **단위 경계를 넘는 하드 참조를 잡는다** (pm-skills `validate_plugins.py` 형태)
```

**배송 단위의 정의**가 선행 결정이다 — 번들 전체인가, 팀인가, org overlay 인가.
현재 SoloSquad 문서에 이 정의가 없다.

### 8.3 🔴 docs-check 게이트 강화 — 개수·목록 정합

§6 의 형태가 `npm run docs-check`(v0.8.5 4-docs 게이트)의 다음 단계다.

| | 현행 SoloSquad | pm-skills |
|---|---|---|
| 검사 | 4개 문서가 `package.json.version` 을 **언급하는가** | 개수·목록·버전이 **서로 맞는가** |
| 놓치는 것 | 자산을 추가해도 문서 숫자가 안 맞는 것 | — |

SoloSquad 는 `agents/` 25 · `skills/` 55 · `teams/` 4 · `crons/` 7 을
`AGENTS.md` · `architecture.md` · `manual/` 2종 · README 등 **여러 곳에 숫자로 적는다.**
자산이 바뀌면 이 숫자들이 조용히 틀어진다.

> **권고** — 재작성의 `[0] 골격`에서 검증기를 만들 때 **"디스크의 자산 개수 ↔ 문서의 숫자"**
> 정합 검사를 처음부터 넣는다. Python 리졸버가 이미 자산을 세고 있으므로 **추가 비용이 거의 없다.**

### 8.4 🟡 "노출 지점 표" 를 자산 표준에 추가

§5 의 표를 SoloSquad 버전으로 만든다. 노출 지점이 더 많다.

```
frontmatter.description   → 라우터 키워드 매칭 · agents-builder 가 .claude/agents/ 로 동기화
SKILL.md 본문             → 스폰 시 layer [3]
crons/*.md                → 스케줄러 프롬프트 (사용자 편집 가능)
teams/*/composition.yaml  → 팀 멤버십 (데이터)
manual/*.html             → 사람이 읽는 문서 (런타임 미로드)
Discord/Slack 임베드      → v2.1.0 복귀 시
```

작성자가 *"이 문장을 누가 언제 읽는가"* 를 알아야 톤·길이·트리거 구문을 정할 수 있다.

### 8.5 🟡 "끝낸 뒤 무엇을 제안하라"

§7-② 가 SoloSquad `AGENTS.md` 의 공백을 짚는다. 현재 `AGENTS.md` 는
불가침 경로 · 수정 가능 경로 · 코드 컨벤션 · **출력 가드(하지 마라)** 를 갖고 있으나
**작업 완료 후의 파급 제안**이 없다. 후보:

```
자산(agents/skills/teams/crons) 추가·제거 후 → "validate 돌릴까요? 문서 개수 갱신할까요?"
package.json.version 변경 후                → "CHANGELOG 항목과 4-docs 게이트 확인할까요?"
migrations/ 신규 스크립트 후               → "dry-run 돌려볼까요?"
PRD/ideation 신규 후                       → "INDEX 에 등재할까요?"
```

마지막 항목은 **이번 조사 4건에서 실제로 필요했던 것**이다.

### 8.6 🟢 자산은 모델 중립이 아니다

v2.1.0 제목 `Opus 4.8-tuned pm-ai-shipping audits` 가 불편한 사실 하나를 인정한다 —
**스킬 문구는 특정 모델에 튜닝된다.**

§0.0.3 은 *"번들 자산 98파일은 마크다운·YAML 이므로 **언어 중립** — 이식 대상이 아니다"* 라고 적었다.
**언어 중립인 것은 맞지만 모델 중립은 아니다.** 재작성 후 하네스가 여러 백엔드를 지원하면
(§C3 Tier-1/Tier-2), 같은 SKILL.md 가 백엔드마다 다르게 동작한다.

> **기록해 둘 것** — §0.0.5 의 검증 앵커(구 TS ↔ 신 Py 파서 **파싱 동등성**)는
> *"같은 파일을 같게 읽는가"* 만 보장하고 *"같은 파일이 같은 결과를 내는가"* 는 보장하지 않는다.
> 후자는 **모델이 바뀌면 깨진다.** [[260810-gstack-skill-harness]] §3 의 planted-defect 평가가
> 그 축을 재는 유일한 방법이다.

---

## 9. 차용 · 기각

### 9.1 차용 권고

| # | 항목 | 자리 |
|---|---|---|
| ① | **명사/동사 축** — 자동 로드 vs 명시 호출 | primitive 선택표 (§8.1) |
| ② | **배송 단위를 넘는 하드 참조 금지** + 검증기가 잡는다 | §B2 내부 마켓플레이스 |
| ③ | **단위를 넘는 관계는 자연어 제안으로** | 자산 작성 표준 |
| ④ | **개수·목록·버전 정합 검사** | `[0] 골격` 검증기 · docs-check 후신 |
| ⑤ | **"노출 지점 표"** — 각 설명문을 누가 언제 읽는가 | `skills/skill-core/core.md` |
| ⑥ | **스킬 name = 디렉토리명 강제** | 검증기 (SoloSquad 도 이미 유사, 명문화 가치) |
| ⑦ | **"끝낸 뒤 무엇을 제안하라" 목록** | `AGENTS.md` |
| ⑧ | **description 에 트리거 구문을 넣어라** — 자동 로드의 유일한 신호 | 자산 표준 |
| ⑨ | **CHANGELOG 헤딩이 릴리스 트리거** | `[6] 배포` (npm 폐기 후 릴리스 방식 재설계 시) |

### 9.2 조건부

| 항목 | 조건 |
|---|---|
| **플러그인별 독립 버전 없음** (전 매니페스트 동기) | SoloSquad 는 단일 패키지라 지금은 자명. §B2 실현 시 다시 판단 |
| **Further Reading 톤 규칙** | SoloSquad 자산이 외부 링크를 달게 될 때. 지금은 해당 없음 |
| **커맨드/스킬 이름 중복 허용**(`create-prd` 스킬 + `/write-prd` 커맨드) | 역할이 다르면 허용하되, **v1.3.6 이 정리한 개명·통합과 충돌하지 않게** 판정 기준 필요 |

### 9.3 기각

| 항목 | 사유 |
|---|---|
| **68 스킬 이식** | SoloSquad `skills/` 55종이 이미 PM Tier-1/2 + Chief-invoked 로 편성돼 있다. 내용 중복이 크고, v1.3.6 이 originality 게이트(8-word shingle)를 두고 있어 **그대로 넣으면 검증에 걸린다** |
| **마켓플레이스 구조**(`.claude-plugin/marketplace.json`) | Claude Code 플러그인 규격에 종속. SoloSquad 는 자체 자산 로더를 갖는다 |
| **9 플러그인 분류** | SoloSquad 는 4팀(Strategy/Growth/Experience/Engineering)으로 이미 나뉘어 있고 축이 다르다(기능 vs 직능) |

---

## 10. 미확인 · 후속

1. **68 스킬 본문 미판독** — 3개만 표본 확인. `strategy-red-team` · `pre-mortem` ·
   `prioritization-frameworks` 는 SoloSquad `skills/` 대응물과 **originality 대조** 가치
2. **`pm-ai-shipping` 플러그인 미판독** — v2.0.0 의 신규 축이고
   *"바이브코딩 앱을 문서화 → 테스트 커버리지 매핑 → 의도 대비 보안/성능 감사 → 출하 패킷"*
   파이프라인이 SoloSquad `dev_capability` 흐름과 대응
3. **`validate_plugins.py` 원문 미판독** — §8.3 검증기 구현 시 참조
4. **정지 원인 미확인** — 2026-07-03 이후 커밋 0. 완료인지 중단인지 판정 불가
5. **`Opus 4.8-tuned` 의 실제 변경 내용 미확인**(§8.6) — 모델 튜닝이 스킬 문구를 어떻게 바꾸는지의
   구체 사례. `git show v2.1.0` 으로 추적 가능

---

## 참조

- [phuryn/pm-skills](https://github.com/phuryn/pm-skills) — 1차 소스
- 본문 인용 원문 — `CLAUDE.md`(117줄) · `AGENTS.md`(5줄) ·
  `pm-product-strategy/skills/lean-canvas/SKILL.md` · `pm-execution/commands/write-prd.md`
- 사내 — [[260810-hermes-agent-orchestration-topology]] §15.2 · §16.6 ·
  [[260810-gstack-skill-harness]] §3 · §8.3 · [[260810-bmad-method-skill-lifecycle]] §7 ·
  [[260803-solosquad-architecture-redesign]] §B2 · §0.0.3 · §0.0.5 ·
  `docs/prd/v1.1-multi-agent-team-architecture.md`(pm-skills 를 통합 입력으로 인용) ·
  `docs/prd/v1.3.6-skill-agent-authoring-internalization.md`
