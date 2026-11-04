# gstack 실측 조사 — 빌드타임 프리앰블 합성과 planted-bug 스킬 평가

> **조사일** 2026-08-10 · **대상** [garrytan/gstack](https://github.com/garrytan/gstack)
> (main, TypeScript/Bun · **127,279 stars** · 1,338 파일 · **362 커밋** · 2026-03-11 ~ 2026-08-08)
>
> **위치** — SoloSquad 가 v0.7(uninstall `--keep-state` 매트릭스) · v1.1(5-layer 위계 통합
> 입력 중 하나)에서 이미 차용한 소스. 재작성 시점에 다시 읽는 이유는
> **§C1 하네스 계약**보다 **v1.3.6~1.3.7 이 내재화한 스킬 작성·평가 체계**에 직접 걸리기 때문이다.
>
> **1차 소스만 사용** — 전체 히스토리 362 커밋 + repo 파일 직접 판독.

---

## 0. 한 문장

**gstack 은 오케스트레이션 프레임워크가 아니라, "Claude Code 에 브라우저 데몬 하나와
컴파일되는 스킬 53개를 얹은 것"이다.** 그런데 그 스킬들이 **빌드 단계를 갖고**,
**심어놓은 버그로 평가**된다 — 이 두 가지가 조사 가치의 전부다.

---

## 1. 규모와 수렴 곡선

| 월 | 커밋 |
|---|---:|
| 2026-03 | **176** |
| 2026-04 | 76 |
| 2026-05 | 55 |
| 2026-06 | 18 |
| 2026-07 | 35 |
| 2026-08 (8일) | 2 |

**첫 달에 절반, 그 뒤 단조 감쇠.** Hermes·OpenClaw 가 가속하는 동안 gstack 은 **수렴했다.**

> **이 곡선 자체가 발견이다.** 런타임은 멈추지 않고(외부 세계가 계속 변하므로),
> **큐레이션된 스킬 집합은 수렴한다.** SoloSquad 의 번들 자산 98파일도 같은 성질을 가지며,
> §0.0.3 이 *"자산은 언어 중립이라 이식 대상이 아니다"* 라고 본 것과 정합한다.

### 1.1 구조 — 스킬이 곧 디렉토리

```
gstack/
├── ETHOS.md            빌더 철학 — 모든 워크플로 스킬 프리앰블에 자동 주입
├── ARCHITECTURE.md     왜 이렇게 만들었나 (브라우저 데몬 중심)
├── SKILL.md            루트 스킬 = 라우터 + 프리앰블 (602줄)
├── SKILL.md.tmpl       그 소스
├── <skill>/            53개, 리포 루트에 평면
│   ├── SKILL.md        생성물
│   └── SKILL.md.tmpl   소스
├── browse/             브라우저 데몬 (Bun 컴파일 바이너리)
├── scripts/resolvers/  프리앰블 합성기
├── test/               380 파일 — eval 스위트 포함
└── bin/                CLI 헬퍼
```

**53 스킬** (실측): `autoplan benchmark benchmark-models browse canary careful codex
context-restore context-save cso design-consultation design-html design-review design-shotgun
devex-review diagram document-generate document-release freeze gstack-upgrade guard health
investigate ios-clean ios-design-review ios-fix ios-qa ios-sync land-and-deploy landing-report
learn make-pdf office-hours open-gstack-browser pair-agent plan-ceo-review plan-design-review
plan-devex-review plan-eng-review plan-tune qa qa-only retro review scrape setup-browser-cookies
setup-deploy setup-gbrain ship skillify spec sync-gbrain unfreeze`

---

# A. 두 개의 진짜 발견

## 2. 🔴 빌드타임 프리앰블 합성 — `SKILL.md.tmpl` → `SKILL.md`

### 2.1 스킬은 소스에서 컴파일된다

```yaml
# review/SKILL.md.tmpl
---
name: review
preamble-tier: 4          # ← 이 한 줄이 공통 프리앰블의 두께를 정한다
version: 1.0.0
description: |
  Pre-landing PR review. Analyzes diff against the base branch for SQL safety,
  LLM trust boundary violations, conditional side effects, and other structural issues.
  Use when asked to "review this PR", "code review", "pre-landing review", "check my diff".
  Proactively suggest when the user is about to merge or land code changes. (gstack)
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, Agent, AskUserQuestion, WebSearch]
triggers: [review this pr, code review, check my diff, pre-landing review]
---

{{PREAMBLE}}
{{BASE_BRANCH_DETECT}}
...
```

`{{PREAMBLE}}` 은 `scripts/resolvers/preamble.ts` 가 **빌드 시** 채운다.

### 2.2 4단 티어 — 스킬이 자기 공통 문맥의 두께를 선언한다

```
T1  core + upgrade-check + lake + telemetry + voice(축약) + completion
T2  T1 + voice(전체) + ask-format + completeness + context-recovery +
         confusion-protocol + continuous-checkpoint + context-health + question-tuning
T3  T2 + repo-mode + search-before-building
T4  T3 와 동일 (test-failure-triage 는 별도 {{}} 자리표시자)
```

**실제 배치** (소스 주석 원문):

| 티어 | 스킬 | 성격 |
|---|---|---|
| **T1** | browse · setup-cookies · benchmark | 기계적 도구 |
| **T2** | investigate · cso · retro · doc-release · setup-deploy · canary · context-save · context-restore · health | 판단이 들어가는 운영 |
| **T3** | autoplan · codex · design-consult · office-hours · plan-{ceo,design,eng}-review | **저장소를 읽고 설계하는** 것 |
| **T4** | ship · review · qa · qa-only · design-review · land-deploy | **코드를 바꾸고 내보내는** 것 |

**`preamble-tier` 는 1~4 만 허용하고 벗어나면 빌드가 실패한다** (`throw new Error`).
기본값은 4 — 즉 **선언하지 않으면 가장 두꺼운 문맥**을 받는다.

### 2.3 순서가 동작을 바꾼다는 것을 주석으로 박제했다

```ts
// AskUserQuestion Format renders BEFORE the model overlay so the pacing rule
// is the ambient default; the overlay's behavioral nudges land as subordinate
// patches. Opus 4.7 reads top-to-bottom and absorbs the first pacing directive
// it hits; reversing this order regresses plan-review cadence (v1.6.4.0 bug).
```

**프리앰블 섹션의 순서를 뒤집었더니 회귀가 났고, 그 사실이 코드 주석으로 남았다.**
`generatePlanModeInfo` 에도 같은 종류의 주석이 있다 —
*"bash 다음(env 변수가 살아 있도록), 모든 온보딩 게이트 앞에(모델이 다른 지시보다 먼저
권위 있는 규칙을 읽도록)"*.

> 🔴 **SoloSquad 8-layer JIT 과의 결정적 대비.**
> SoloSquad 의 8-layer 는 **런타임 조립 + 토큰 상한 도달 시 우선순위 낮은 층부터 drop**
> (`spawn.max_context_tokens` 80,000)이다. gstack 은 **빌드타임 합성 + 티어 선언**이다.
>
> | | SoloSquad 8-layer JIT | gstack preamble-tier |
> |---|---|---|
> | 시점 | 스폰 런타임 | **빌드** |
> | 결정 주체 | 러너(키워드·팀·토큰 예산) | **스킬 작성자가 프론트매터에 선언** |
> | 실패 모드 | 예산 초과 시 **조용한 drop** | **빌드 실패** (티어 범위 밖) |
> | 관측 | `spawn-decisions.jsonl` 사후 로그 | 생성된 `SKILL.md` 를 **git diff 로 본다** |
>
> **둘은 배타적이지 않다.** 동적 문맥(메모리·핸드오프·repo)은 런타임이 맞고,
> **불변 규범(음성·완결성·질문 형식·완료 프로토콜)은 빌드타임이 맞다.**
> 후자를 런타임 drop 대상으로 두는 것은 *"예산이 빠듯하면 규범을 버린다"* 는 뜻이 된다.

## 3. 🔴 planted-bug 평가 — 스킬을 결과로 채점한다

히스토리에서 가장 밀도 높은 이틀(2026-03-13~14)이 전부 **평가 인프라**다.

```
03-13  feat: SKILL.md **template system**, 3-tier testing, DX tools (v0.3.3) (#41)
03-13  fix: enrich SKILL.md docs to **pass LLM evals**, upgrade judge to **Sonnet 4.6** (#43)
03-14  feat: **3-tier eval suite with planted-bug outcome testing** (EVALS=1)
03-14  fix: pass all LLM evals — severity defs, rubric edge cases
03-14  simplify: one command for evals — `bun run test:evals`
03-14  fix: rewrite session-runner to **`claude -p` subprocess**, lower flaky baselines
03-14  feat: **stream-json NDJSON parser** for real-time E2E progress
03-14  feat: eval **persistence with auto-compare against previous run**
03-14  feat: template-ify all skills + E2E tests for plan-ceo-review, plan-eng-review, retro
03-14  feat: E2E **observability — heartbeat, progress.log, NDJSON persistence, savePartial()**
03-14  feat: wire **runId + testName + diagnostics** through all E2E tests
03-14  feat: **eval-watch dashboard** + observability unit tests
03-14  fix: detect is_error from `claude -p` result line (**ConnectionRefused was PASS**)
03-14  fix: **never clean up observability artifacts** — partial file persists after finalize
03-14  fix: fail fast on API connectivity — pre-check before E2E suite
```

### 3.1 무엇을 재는가

**"planted-bug outcome testing"** — 코드에 **버그를 심어두고**, 스킬(`/review`·`/qa`)이 그것을
찾아내는지를 잰다. 즉 **스킬의 문장이 아니라 결과**를 채점한다. LLM judge 가 심각도 정의와
루브릭으로 판정하며, judge 모델 자체도 업그레이드 대상이다(Sonnet 4.6).

### 3.2 평가가 스킬 문서를 바꿨다

`fix: **enrich SKILL.md docs to pass LLM evals**` — 평가가 먼저 있고 **문서가 그것에 맞춰
개선됐다.** 스킬 작성이 창작이 아니라 **최적화 루프**가 된 지점이다.

### 3.3 신뢰성이 진짜 문제였다

평가 인프라 커밋의 **절반이 flakiness 대응**이다 — 베이스라인 낮추기(3회) · 25턴 완주 위해
프롬프트 단순화 · max_turns/browse 오류에 견디게 · 타임아웃 상향(plan-ceo-review 420초) ·
테스트 디렉토리 격리 · 서버 재시작 · API 연결 사전 점검 · **`ConnectionRefused` 가 PASS 로
집계되던 버그**.

> **가장 값비싼 교훈 하나** — `fix: detect is_error from claude -p result line
> (**ConnectionRefused was PASS**)`. **에이전트 평가에서 "실패를 성공으로 세는" 것이
> 가장 위험한 버그다.** SoloSquad `eval-corpus.ts`/`refine-gate.ts`(v1.3.6 (B) 자가개선 골격)에
> 직접 걸린다.

> **`never clean up observability artifacts — partial file persists after finalize`** 도 같은 계열이다.
> 관측 산출물을 정리하면 **실패한 런의 증거가 사라진다.**

---

# B. 나머지 구조

## 4. ETHOS.md — 철학을 주입 가능한 자산으로

169줄 문서가 **모든 워크플로 스킬 프리앰블에 자동 주입**된다. 문서 자체가 그렇게 선언한다.

### 4.1 세 원칙

**① Boil the Ocean** — *"'바다를 끓이지 마라' 는 엔지니어링 시간이 병목일 때 맞는 조언이었다.
그 시대는 끝났다."* 완전한 구현이 지름길보다 몇 분 더 든다면 **매번 완전한 쪽**을 하라.
근거로 압축비 표를 든다:

| 작업 | 사람 팀 | AI 보조 | 압축 |
|---|---|---|---:|
| 보일러플레이트 | 2일 | 15분 | ~100x |
| 테스트 작성 | 1일 | 15분 | ~50x |
| 기능 구현 | 1주 | 30분 | ~30x |
| 버그 수정 + 회귀 테스트 | 4시간 | 15분 | ~20x |
| 아키텍처/설계 | 2일 | 4시간 | ~5x |
| 리서치/탐색 | 1일 | 3시간 | ~3x |

안티패턴을 명시한다 — *"B 를 골라라, 90% 를 더 적은 코드로 커버한다"*(A 가 70줄 더 많으면 A 를
골라라) · *"테스트는 후속 PR 로 미루자"*(테스트가 가장 싼 lake 다) · *"2주 걸립니다"*
(*"사람 2주 / AI 보조 ~1시간"* 이라고 말하라).

> ⚠️ **Hermes·OpenClaw 와 정면 충돌한다.** Hermes 는 *"smallest footprint"* 와 Footprint Ladder 로,
> OpenClaw 는 *"production LOC 는 1급 제약, 버그 수정은 net ≤ 0"* 로 **절제**를 규범화했다.
> gstack 은 **완전성**을 규범화했다.
> **모순이 아니라 적용 대상이 다르다** — 앞의 둘은 **수만 명이 매 API 호출마다 값을 치르는
> 코어 스키마**를 말하고, gstack 은 **한 사람의 한 기능 구현**을 말한다.
> SoloSquad 는 양쪽에 다 걸린다: 코어(`src/`)는 절제, 사용자 작업(`goal`/`workflow` 산출물)은 완전성.

**② Search Before Building** — 3층 지식 모델.
`L1 tried-and-true`(이미 알지만 확인 비용이 0이고, 가끔 이걸 의심하는 데서 탁월함이 나온다) ·
`L2 new-and-popular`(검색하되 **군중은 새것에 대해서도 똑같이 틀릴 수 있다** — 검색 결과는
사고의 입력이지 답이 아니다) · `L3 first-principles`(가장 값지다).
*"유레카 순간"* 을 **관례가 틀린 이유를 발견하는 것**으로 정의한다.

**③ User Sovereignty** — *"AI 모델은 추천하고, 사용자가 결정한다. 다른 모든 규칙을 덮는 하나의 규칙."*
**두 모델이 합의해도 mandate 가 아니다.** Claude 와 Codex 가 둘 다 *"이 둘을 합쳐라"* 하고
사용자가 *"아니, 따로 둬"* 하면 **사용자가 옳다. 항상.**
Karpathy 의 "Iron Man suit" · Simon Willison 의 *"에이전트는 복잡성의 상인"* ·
*"숙련 사용자는 Claude 를 **덜**이 아니라 **더** 자주 중단시킨다"* 를 근거로 든다.
안티패턴 4개 중 특히: *"내 판단을 'My Assessment' 열에 확정 사실로 제시하는 것"*(양쪽을 제시하고
평가는 사용자가 채우게 하라).

## 5. 역할 기반 스킬 파이프라인

23개 "전문가" + 8개 도구를 **직함으로** 프레이밍한다 — CEO/창업자(`/plan-ceo-review`) ·
엔지니어링 매니저(`/plan-eng-review`) · 시니어 디자이너(`/plan-design-review`) ·
디자이너-코더(`/design-review`) · QA 리드(`/qa`) · QA 리포터(`/qa-only`) ·
보안 책임자(`/cso` — OWASP + STRIDE) · 릴리스 엔지니어(`/ship`).

**핵심은 파이프라인이 산출물로 이어진다는 점이다.**

```
/office-hours   →  설계 문서 작성
      ↓                  ↑ 읽음
/plan-ceo-review   →  범위 재고 (4모드: 확장/선택확장/유지/축소)
      ↓
/plan-eng-review   →  아키텍처 확정 + **테스트 계획 작성**
      ↓                  ↑ 픽업
/qa                →  실제 브라우저로 테스트, 회귀 테스트 자동 생성
      ↓
/review            →  버그 발견
      ↓                  ↑ 수정 확인
/ship              →  PR
```

README 원문 — *"각 스킬이 다음으로 이어진다. 아무것도 틈으로 빠지지 않는다.
**모든 단계가 자기 앞에 무엇이 있었는지 알기 때문이다.**"*

> **SoloSquad `_handoff.md` 와 같은 문제, 다른 해법.** SoloSquad 는 **범용 핸드오프 문서**를
> 규격으로 두었고, gstack 은 **스킬 쌍마다 구체적 산출물**(설계문서 → 테스트계획 → 회귀테스트)을
> 못박았다. 후자가 검증 가능하다.

## 6. 브라우저 데몬 — ARCHITECTURE.md 가 다루는 것

gstack 의 `ARCHITECTURE.md` 435줄은 대부분 **브라우저 데몬**이다.
*"브라우저가 어려운 부분이다 — 나머지는 전부 Markdown."*

```
Claude Code ──tool call──> CLI(Bun 컴파일 바이너리 ~58MB)
                             │ localhost HTTP (랜덤 포트 10000-60000)
                           Server (Bun.serve)
                             │ CDP
                           Chromium (headless, 영속 탭/쿠키, 30분 idle 종료)
```

첫 호출 ~3초, 이후 **~100-200ms**. 설계 근거 3개 — ⑴ 명령마다 브라우저를 띄우면
QA 20+명령에 40초+ 오버헤드이고 **쿠키·localStorage·로그인 세션이 매번 사라진다**
⑵ Bun 을 고른 이유는 시작 속도가 아니라 **컴파일 바이너리**(`~/.claude/skills/` 에 설치되는데
사용자가 Node 프로젝트를 관리할 것을 기대하지 않는다)와 **네이티브 SQLite**(Chromium 쿠키 DB 직접 읽기,
네이티브 애드온 컴파일 없음) ⑶ **버전 자동 재시작** — 빌드가 `git rev-parse HEAD` 를 기록하고,
바이너리와 실행 중 서버의 버전이 다르면 CLI 가 서버를 죽이고 새로 띄운다
(*"stale binary 버그 부류를 통째로 제거한다"*).

**보안 — 이중 리스너**(v1.6.0.0). `pair-agent --client` 로 ngrok 터널을 열 때
헤더 추론(`x-forwarded-for`/Origin 검사)이 **신뢰할 수 없어서**, 로컬 리스너와 터널 리스너를
**물리적으로 다른 TCP 소켓**으로 분리했다. 터널 호출자는 `/health`·`/cookie-picker` 에
**도달할 수 없다 — 그 경로가 그 소켓에 존재하지 않기 때문이다.**

> **차용 가치** — *"헤더 추론은 신뢰할 수 없다, 소켓 분리는 신뢰할 수 있다"* 는
> 인증 경계 설계의 일반 원칙이다. SoloSquad v2.1.0 클라우드 배포에서 대시보드/봇 표면을
> 나눌 때 그대로 적용된다.

## 7. 호스트 감지 — 스킬이 자기가 어디서 도는지 안다

루트 `SKILL.md` 프리앰블이 실행 환경을 판별하고 **행동을 바꾼다.**

| 감지 | 대응 |
|---|---|
| **Conductor 호스트** | `AskUserQuestion` 이 불안정 → 결정을 **산문으로 렌더**. 단 `GSTACK_HEADLESS`(CI/eval) 이면 산문 대신 **BLOCK** |
| **plan mode** | `CLAUDE_PLAN_FILE` 로 best-effort 감지. Codex 호스트와 Claude 실행 모드는 inactive 로 떨어지고 그것이 안전한 기본값 |
| **`SPAWNED_SESSION=true`** | **AI 오케스트레이터(예: OpenClaw)가 스폰한 세션.** `AskUserQuestion` 금지(권장 옵션 자동 선택) · 업그레이드 체크/텔레메트리/라우팅 주입/소개 전부 생략 · **완료 보고로 끝낸다**(무엇을 냈는지, 어떤 결정을 했는지, 불확실한 것) |
| **vendored 설치** | deprecated 경고 1회 → team mode 마이그레이션 제안 |

> 🔴 **`SPAWNED_SESSION` 이 중요하다.** 스킬이 *"나는 사람과 대화 중인가, 다른 에이전트에게
> 불려온 것인가"* 를 알고 **대화형 요소를 전부 끈다.** SoloSquad 에서 같은 스킬이
> `solosquad chat`(사람) 과 `goal` 무인 사이클(에이전트) 양쪽에서 실행되므로 **동일한 구분이 필요하다.**
> 현재 SoloSquad 에는 이 신호가 없다.

---

# C. SoloSquad 로의 환류

## 8. 미결·설계에 주는 것

### 8.1 🔴 v1.3.6 자가개선 골격(B)에 직결 — 평가의 함정 3개

SoloSquad 는 `src/analyze/eval-corpus.ts`(trigger-rate·A/B·train/val split)와
`refine-gate.ts`(held-out 채택·edit 예산·rejected buffer)를 이미 갖고 있다.
gstack 의 이틀치 커밋이 **그 위에 얹을 실전 교훈**을 준다.

| 함정 | gstack 사례 | SoloSquad 대응 |
|---|---|---|
| **실패를 성공으로 집계** | `ConnectionRefused was PASS` | 러너 종료 코드/`is_error` 를 **명시 판정**하고, 판정 불가는 PASS 가 아니라 **INCONCLUSIVE** |
| **증거 인멸** | `never clean up observability artifacts` | 실패 런의 부분 산출물(`savePartial`)을 **정리 대상에서 제외** |
| **flaky 를 임계 완화로 덮음** | 베이스라인 3회 하향 | 임계를 낮추기 전에 **격리·사전점검**(테스트 디렉토리 격리, API 연결 pre-check)을 먼저 |

**그리고 가장 큰 것 하나** — gstack 은 **결과(planted bug 탐지)** 로 채점한다.
SoloSquad 의 현재 지표는 trigger-rate 중심이라 *"불려는 지는데 잘 하는가"* 를 못 잰다.

> **권고** — `agents/`·`skills/` 번들 자산에 **planted-defect 코퍼스**를 하나 만든다.
> §0.0.5 의 "검증 앵커"(구 TS 파서 ↔ 신 Py 파서 파싱 동등성)는 **재작성 진척** 지표이고,
> planted-defect 는 **자산 품질** 지표다. 둘은 다른 축이며 둘 다 필요하다.

### 8.2 🔴 빌드타임 프리앰블 — `[1]`·`[2]` 에 넣을 분할선

§2.3 의 대비표가 결론이다. **불변 규범은 빌드타임, 동적 문맥은 런타임.**

```
빌드타임 (스킬/에이전트 정의에 컴파일)      런타임 8-layer JIT (drop 가능)
────────────────────────────────         ────────────────────────────
음성·톤 · 완결성 규칙 · 질문 형식          [1] knowledge (키워드 선별)
완료 프로토콜 · 혼란 시 프로토콜            [2] team KNOWLEDGE.md
체크포인트 규칙 · 컨텍스트 건강             [6] org domain/
repo 모드 · search-before-building         [7] handoff slice + memory recall
        ↑ 티어로 두께 선언                  [8] target repo context
        ↑ 범위 밖이면 빌드 실패                     ↑ 예산 초과 시 우선순위 drop
```

현재 SoloSquad 의 layer [3](에이전트 SKILL.md) · [4](org core) · [5](agent-profile)는
*"never drop"* 으로 표시돼 있는데, **never drop 이라면 애초에 런타임 예산 계산에 넣을 이유가 없다.**
빌드타임으로 옮기면 예산 산술이 단순해지고 drop 결정 로그도 짧아진다.

### 8.3 🔴 primitive 선택 기준 — Footprint Ladder 의 짝

[[260810-hermes-agent-orchestration-topology]] §16.6 은 SoloSquad primitive 5종에
**선택 기준이 없다**고 지적했다. gstack 은 다른 각도의 답을 준다 —
**`preamble-tier` 처럼 "무게"를 프론트매터에 선언하게 하는 것.**

```
제안 — SKILL.md / agent SKILL.md 프론트매터에 무게 선언 필드 1개
  context-tier: 1..4      (1 = 기계적 도구 · 4 = 코드를 바꾸고 내보내는 것)
  → 스폰 조립기가 티어로 공통 규범 블록을 고르고, 범위 밖이면 validate 실패
```

v1.3.2 `solosquad validate` 와 v1.3.6 매니저 스킬 표준이 이미 검증 지점을 갖고 있어 **얹기 쉽다.**

### 8.4 🔴 `SPAWNED_SESSION` 상당 신호 — 지금 없는 것

SoloSquad 의 같은 스킬이 세 맥락에서 돈다: ⑴ `solosquad chat`(사람과 대화)
⑵ `goal` 무인 사이클 ⑶ cron. 현재 스킬 본문은 이 셋을 구분하지 못한다.

> **`[2] 컨텍스트` 에 넣을 것** — `ExecutionContext`(§B4 단일 스키마)에
> **`interactive: bool`** 과 **`spawned_by: user|goal|cron|agent`** 를 1급 필드로 넣고,
> 스킬 프리앰블이 그것을 읽어 대화형 요소를 켜고 끄게 한다.
> gstack 의 3분기(Conductor / plan-mode / SPAWNED_SESSION)가 실증한 요구다.

### 8.5 🟡 스킬 파이프라인의 산출물 계약

§5 의 *"모든 단계가 자기 앞에 무엇이 있었는지 안다"* 는 SoloSquad `_handoff.md` 의 강화판이다.
현재 SoloSquad 핸드오프는 **형식**(Summary/Artifacts/Key Decisions/Context/Open Questions)만 규정하고
**무엇이 무엇을 읽는지**는 규정하지 않는다.

> **권고** — 4개 워크플로 타입(PMF Discovery · Feature Expansion · Rebranding · Rapid Prototype)의
> 스테이지 쌍마다 **구체 산출물 이름**을 못박는다. gstack 의
> *"plan-eng-review 가 **테스트 계획**을 쓰고 qa 가 그걸 픽업한다"* 수준의 구체성.

### 8.6 🟡 ETHOS 주입 — 이미 갖고 있으나 배선이 다르다

SoloSquad 는 `user/{profile,voice,preferences}.md` 와 `<org>/core/{PRINCIPLES,VOICE}.md` 를
**런타임 layer [4]** 로 넣는다. gstack 은 `ETHOS.md` 를 **빌드타임 프리앰블**로 넣는다.
§8.2 의 분할선을 적용하면 **`core/` 는 빌드타임 후보**다 — never drop 으로 표시된 층이기도 하다.

## 9. 차용 · 기각

### 9.1 차용 권고

| # | 항목 | 자리 |
|---|---|---|
| ① | **판정 불가 ≠ 통과** — 에이전트 평가에서 오류/연결실패를 PASS 로 세지 않는다 | `eval-corpus.ts` |
| ② | **실패 런의 관측 산출물 보존** (`savePartial`, 정리 제외) | eval 러너 |
| ③ | **planted-defect 코퍼스** — 결과 기반 스킬 채점 | 번들 자산 QA |
| ④ | **불변 규범 = 빌드타임 / 동적 문맥 = 런타임** 분할 | `[1]`·`[2]` |
| ⑤ | **무게 선언 프론트매터**(`context-tier` 상당), 범위 밖이면 validate 실패 | primitive 표준 |
| ⑥ | **`interactive` / `spawned_by` 를 ExecutionContext 1급 필드로** | §B4 |
| ⑦ | **프리앰블 섹션 순서가 동작을 바꾼다** — 순서 결정에 근거 주석을 남긴다 | 조립기 |
| ⑧ | **소켓 분리 > 헤더 추론** (인증 경계) | v2.1.0 배포 |
| ⑨ | **버전 자동 재시작** — 바이너리 해시 불일치 시 데몬 재기동 | `[6]` 배포 / bot 재시작 |
| ⑩ | **User Sovereignty** — 두 모델의 합의는 신호이지 mandate 가 아니다 | Chief SKILL.md · dev confirm gate |

### 9.2 조건부

| 항목 | 조건 |
|---|---|
| **"Boil the Ocean"** | **적용 대상을 명시해야** 한다. 사용자 작업 산출물에는 맞고, **SoloSquad 코어 `src/`** 에는 OpenClaw 의 net ≤ 0 이 맞다. 무조건 채택하면 §T3(*"이 구조가 없으면 코드가 무엇을 못 하는가"*)와 충돌 |
| **역할 직함 프레이밍** | SoloSquad 는 이미 25 에이전트로 갖고 있다. 다만 gstack 의 **4모드 범위 조정**(`/plan-ceo-review` 확장/선택확장/유지/축소)은 Chief 의 스코프 단계에 바로 얹힌다 |
| **브라우저 데몬** | v2.x. 단 SoloSquad 는 사용자의 Claude Code 가 이미 브라우저 도구를 가질 수 있어 중복 위험 |

### 9.3 기각

| 항목 | 사유 |
|---|---|
| **53 스킬 전량 이식** | SoloSquad 는 55 스킬 + 25 에이전트를 이미 보유. iOS 계열 6개 등 도메인 특화분은 무관 |
| **Bun 채택** | 결정 1(Python 전면 재작성)과 충돌. 다만 *"컴파일 단일 바이너리로 설치 전제조건을 없앤다"* 는 **동기**는 `uv` 채택 사유(§M4)와 동일하다 — 결론이 같고 수단이 다르다 |
| **압축비 표(3x~100x)를 의사결정 근거로** | 출처가 저자 경험이며 재현 가능한 실측이 아니다. 서사로는 유효하나 **SoloSquad 문서에 수치로 인용하지 말 것** |

---

## 10. 미확인 · 후속

1. **`test/` 380파일 미판독** — eval 스위트 실물. §8.1 을 실제로 구현할 때 구조 참조 가치 최상
2. **`scripts/resolvers/preamble/generate-*.ts` 20+ 파일 미판독** — 각 프리앰블 섹션의 실제 문구.
   `completeness` · `confusion-protocol` · `context-health` 는 SoloSquad 스킬 표준에 바로 얹힐 후보
3. **`skillify` 스킬** — 스킬을 만드는 스킬. v1.3.6 `skill-manager` 와 직접 대조 대상
4. **`gbrain` 연동**(`setup-gbrain`·`sync-gbrain`·`USING_GBRAIN_WITH_GSTACK.md`) —
   외부 지식 인덱스와의 계약. §v2.x-knowledge-ontology 참조 가치
5. **커밋 감쇠의 원인 미확인** — 수렴인지 관심 이동인지. 2026-08 커밋 2건만으로는 판정 불가

---

## 참조

- [garrytan/gstack](https://github.com/garrytan/gstack) — 1차 소스
- 본문 인용 원문 — `ETHOS.md`(169줄) · `ARCHITECTURE.md`(435) · `SKILL.md`(602) ·
  `scripts/resolvers/preamble.ts`(124) · `review/SKILL.md.tmpl`
- 사내 — [[260810-hermes-agent-orchestration-topology]] §15(Footprint Ladder, ETHOS 와 대립) ·
  [[260810-openclaw-orchestration-topology]] §7.1(production LOC 규범, ETHOS 와 대립) ·
  [[260803-solosquad-architecture-redesign]] §B4 · §D1 ·
  `docs/prd/v1.3.6-skill-agent-authoring-internalization.md` §(B) 자가개선 골격
