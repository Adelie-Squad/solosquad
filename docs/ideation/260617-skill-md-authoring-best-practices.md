# SKILL.md 작성의 모든 것 — 빅테크·커뮤니티·마켓플레이스 전수 분석과 SoloSquad 전략

> **청자:** SoloSquad 개발자(본인). dev 워크플로·내부 구현 관점의 설계 메모이며,
> 확정 기획(PRD)이 아니라 방향 탐색이다.
>
> **문서 목적.** "좋은 SKILL.md 란 무엇인가"의 **궁극의 단일 레퍼런스**. 우리는 SKILL.md 를
> 두 방향으로 다룬다 — ⑴ `agents/**/SKILL.md`(73개)처럼 직접 *쓰는* 쪽, ⑵
> `src/bot/skill-author.ts`·`skill-parser.ts` 로 *생성/검증하는* 쪽. 이 문서는 Anthropic
> 공식 가이드 + 빅테크 5사(OpenAI·Google·MS·Meta) + 오픈표준(MCP·agentskills.io) +
> 커뮤니티 컬렉션 4종 + 마켓플레이스 4종 + 최신 연구(MS SkillOpt)를 전수 조사해, **객관적
> 현황 → 인사이트 → SoloSquad 적용 전략** 순으로 정리한다.
>
> **조사 방법 주의.** 본 조사는 7개 리서치 에이전트의 병렬 웹 조사(2026-06-17) 결과다.
> 일부 환경에서 WebFetch 가 차단돼 도메인 한정 WebSearch + 1차 출처 교차검증으로 수집했다.
> 정량 수치(문자 한도 등)는 복수 공식 페이지에서 교차확인했으나, **verbatim 인용 전엔 라이브
> 페이지 재확인 권장**.
>
> **2026-06-22 갱신(v1.3.6 착수).** 4개 리서치 에이전트로 추가 소스를 조사해 통합했다 — ⑴
> **agentskills.io 공식 skill-creation 3-가이드**(`optimizing-descriptions`·`evaluating-skills`·
> `best-practices`): description 최적화·output eval 을 *측정 가능한 절차*로 박제한 가장 큰 신규
> 발견(→ 新 **B.6**), ⑵ **addyosmani/agent-skills**(SDLC 24-skill 컬렉션, anti-rationalization
> 테이블·verification 게이트 → 新 **D.6**), ⑶ **SkillOpt 정정**(Lt=4 기본/floor 2, rejected-edit
> buffer, *기계가 쓰는* protected slow-update 필드, **자동 검증기 전제조건** → **Part F** 전면 갱신).
> 이 갱신은 **v1.3.6 = "좋은 skill/agent 작성법 내재화 + 자가개선 asset 구조 도입"** 의 1차 근거다 —
> B.6·F 가 자가개선 루프의 청사진, H 가 적용 경로.

---

## 목차

- **Part A** — TL;DR (한 장 요약)
- **Part B** — Anthropic SKILL.md 정본 (기준선)
- **Part C** — 객관적 현황: 벤더·생태계 전수 비교
- **Part D** — 객관적 현황: 커뮤니티 컬렉션 4종 실측
- **Part E** — 객관적 현황: 마켓플레이스 4종 (패키징·디스커버리)
- **Part F** — 객관적 현황: 최신 연구 — MS SkillOpt (스킬 자동 최적화)
- **Part G** — 인사이트 도출 (수렴점·차이점·신호)
- **Part H** — SoloSquad 적용 전략
- **Part I** — 궁극의 체크리스트
- 출처

---

# Part A — TL;DR

전 벤더·커뮤니티를 관통하는 **단 하나의 진실**: **`description` 이 곧 디스커버리다.**
Anthropic·OpenAI·Google·MS·Meta·MCP·LangChain·LlamaIndex 가 *예외 없이* "모델은 tool/skill 의
description 을 읽고 호출 여부를 결정한다"고 말한다. 이것이 가장 깊은 산업 수렴점이다.

그 위에 올라가는 7가지 합의:

1. **description = 선택 메커니즘.** "무엇을 + 언제(트리거) + 언제 안 쓰는지"를 담아라.
   골드 패턴: **"…한다. `&lt;방법론&gt;` 기반. 사용 시점: A, B, C." (`Use when …`)**
2. **점진적 공개(progressive disclosure).** metadata(~100토큰, 항상 로드) → 본문(트리거 시) →
   번들 파일(필요 시). 본문 < 500줄 / < 5000토큰.
3. **이름은 hard gate.** kebab-case·소문자·≤64자·디렉터리명 일치 — 마켓플레이스가 *거부*한다.
4. **툴셋은 작게.** 활성 10–20개 초과 시 선택 정확도 하락(모든 벤더 공통).
5. **명시적 non-goal.** "이럴 땐 쓰지 말 것"을 적어라(긍정+부정 스코핑).
6. **스킬은 릴리스 아티팩트.** semver, 검증기 통과, README 가 품질 기준.
7. **스킬은 *학습/최적화* 가능한 대상.** (SkillOpt) — write-once 가 아니라 eval 로 다듬는다.

**가장 큰 거시 발견:** SKILL.md 는 Anthropic 발이지만 **사실상 크로스벤더 오픈표준으로 수렴**
중이다 — 40+ 툴이 읽고, **Google 이 자체 SKILL.md(Gemini API + ADK Skills)를 출시**했으며,
LangChain Deep Agents 가 네이티브 구현하고, agentskills.io(벤더중립)가 정본 스펙을 호스팅하며,
Anthropic 은 MCP 때와 같은 "originate → open → 재단 기부" 플레이북을 돌리고 있다.

---

# Part B — Anthropic SKILL.md 정본 (기준선)

모든 비교의 기준. 출처: [Anthropic best-practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices),
[overview](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview).

### B.1 파일 모델
스킬 = **폴더** 하나. `SKILL.md`(= YAML frontmatter + Markdown 본문) + 선택적 번들:
`scripts/`(실행됨, 컨텍스트에 안 올라감), `references/`(필요 시 읽힘), `assets/`(템플릿 등).

### B.2 정량 규칙 (비교의 앵커)
| 항목 | 규칙 |
|---|---|
| `name` | **≤64자**, 소문자+숫자+하이픈, XML 태그 금지, 예약어(`anthropic`/`claude`) 금지, **gerund 권장**(`processing-pdfs`), **부모 디렉터리명과 일치** |
| `description` | **≤1024자**, 비어있으면 안 됨, XML 금지, **3인칭**, "무엇을 + 언제" 둘 다 |
| 본문 | **<500줄 (~<5000토큰)** |
| 참조 파일 | **1단계 깊이**까지만, **>100줄이면 ToC** 첨부 |
| (Claude Code) | description + 선택적 `when_to_use` 합산 **1536자**에서 잘림 — **트리거를 첫 문장에** |

### B.3 점진적 공개 3단계
1. **metadata**(name+description) — 시동 시 *모든* 스킬에 대해 프롬프트에 로드, **~100토큰/스킬**.
2. **SKILL.md 본문** — 트리거될 때만 로드.
3. **번들 파일/스크립트** — 필요 시만. 스크립트는 bash 로 *실행*되어 코드 본문이 컨텍스트에 안 올라감(출력만 토큰 소모).

### B.4 작성 원칙 (요지)
- **컨텍스트는 공공재.** Claude 가 이미 아는 건 안 적는다("PDF 가 뭔지" 설명 금지).
- **자유도를 위험도에 맞춰라.** 깨지기 쉬운 작업 = 정확한 스크립트(낮은 자유도), 열린 작업 = 방향만(높은 자유도).
- **워크플로 = 단계 + 체크리스트**, 품질 중요 작업엔 **검증 루프**(validator→수정→반복).
- **시간 의존 정보 금지**(폐기분은 `<details>` Old patterns). **용어 일관.** **선택지 1개+탈출구.**
- **예시는 구체적(input/output 쌍).** **(코드) punt 금지, magic number 금지, forward slash.**
- **MCP 툴은 풀네임**(`Server:tool`).
- **eval 우선 개발**: 문서 전에 평가 3개 → 베이스라인 → 최소 지침 → 반복.
- **Claude A/B 패턴**: A=스킬 설계자, B=사용자, B의 실패를 A에 피드백해 반복.

### B.5 SoloSquad 매핑 (우리 코드)
- 필수 `name`/`description`만 hard-require, 나머지는 SoloSquad 확장(`src/bot/skill-parser.ts:202-213`).
- 우리 추가 트리거 확장 `triggers.{slash,keyword,freq}`(`parser:49-55`) = 디스커버리를 자연어 description + *구조화* 트리거로 **이중**으로 검.
- `loop_mode: spec-gate`(`parser:62-66`) = 공식 "피드백 루프"의 구조화 버전.
- `dev_capability`/`dev_permissions`(`parser:97-103`) = 낮은 자유도(위험 작업) 영역.
- `skill-author.ts` = 공식 "Claude A", `validator-corpus`+`test:corpus` = eval 골격.

### B.6 공식 skill-creation 3-가이드 — description 최적화·output eval·작성법 (2026-06-22 신규)
agentskills.io 가 정본 스펙 위에 **3개의 작성 가이드**를 호스팅한다. 이게 본 갱신 최대 발견 —
"좋은 description" 을 *감*이 아니라 **측정 가능한 절차**로 박제했다. SkillOpt(Part F)의 *공식·수동
버전*이며, 우리 `skill-author.ts`+corpus 가 곧장 흡수할 수 있는 레시피다.

**① description 최적화** (`agentskills.io/skill-creation/optimizing-descriptions`)
- **트리거의 진실:** description 이 완벽히 매칭돼도 **단순 1-step 태스크엔 발화 안 할 수 있다** —
  "agents typically only consult skills for tasks that require knowledge **beyond what they can handle
  alone**. A simple 'read this PDF' may not trigger a PDF skill even if the description matches." →
  디스커버리는 description 품질 + *태스크 난이도* 의 함수.
- **4원칙:** imperative("Use this skill when…", "This skill does…" 아님) · 구현 아닌 **유저 의도** ·
  **약간 pushy**("even if they don't explicitly mention 'CSV'") · 간결.
- **정량 eval 레시피(핵심):** **20쿼리(should-trigger 8–10 + should-NOT 8–10) × 3런 = 60 호출**,
  **trigger-rate 임계 0.5**(should 는 >0.5 통과, should-not 은 <0.5 통과). **train 60% / val 40%
  고정 split**(overfit 방지). **~5 iteration**, **val 점수 최고본 선택**("the best description may **not**
  be the last one"). 라운드마다 1024자 재확인("descriptions tend to grow during optimization").
- **near-miss 네거티브가 고가치.** 약한 네거: "Write a fibonacci function". 강한 네거(키워드는 겹치되
  다른 스킬): "update the formulas in my Excel budget **spreadsheet**". **실패 쿼리의 키워드를 그대로
  description 에 박지 말 것 = overfitting**, 대신 그 쿼리가 대표하는 *상위 개념*을 잡아라.
- 자동화 툴: Anthropic `skill-creator` 스킬(eval split·병렬 trigger-rate·개선 제안·HTML 리포트).

**② output 품질 eval** (`agentskills.io/skill-creation/evaluating-skills`)
- **A/B-against-baseline:** 각 케이스를 **with_skill / without_skill**(또는 이전 버전) 2회 실행. 표준
  레이아웃 `evals/evals.json`(id·prompt·expected·files·assertions) + `iteration-N/{with,without}_skill/`.
- **작게 시작:** "2–3 test cases" 로 출발, **assertion 은 첫 런 *이후* 작성**(미리 X).
- **assertion 품질:** programmatically-verifiable·specific·countable("≥3 recommendations") = 良,
  "output is good"(모호)·exact-phrase(취약) = 不. **"Require concrete evidence for a PASS. Don't give
  the benefit of the doubt."** 기계검증은 코드/스크립트, 나머지는 LLM-judge.
- **비용도 측정:** `total_tokens`+`duration_ms` 의 **delta**. 골든 휴리스틱: "+13초인데 pass +50%p =
  가치 있음; 토큰 2배인데 +2%p = 아닐 수도." → 품질만이 아니라 **품질/비용**으로 채택 판단.
- **clean-context**(매 런 새 세션/서브에이전트) · **blind comparison**(버전 출처 숨기고 judge) ·
  **패턴 분석**(both 에서 항상 pass 하는 assertion = 스킬 가치 은닉 → 제거; both 실패 = 깨진 검증/과난도;
  런 간 high stddev = 모호 지침 → 예시 추가).

**③ 작성 베스트프랙티스** (`agentskills.io/skill-creation/best-practices`)
- **LLM 일반지식만으로 스킬 생성 금지** — "vague, generic procedures('handle errors appropriately')"
  만 나온다. **실제 핸즈온 태스크·런북·코드리뷰 코멘트·patch 히스토리·실패 사례**에 근거하라.
- **"에이전트가 *모르는 것만* 적고, 아는 건 빼라."** 테스트: *"이 지침 없으면 틀릴까? 아니면 잘라라."*
- **스코핑 = 함수 설계처럼**(쿼리+포맷팅 = 1단위 OK, DB 관리까지 = 과욕).
- **위험도에 처방강도 보정**(여러 방법 OK = "왜" 설명+자유 / 깨지기쉬움·파괴적 = "정확히 이 순서, 플래그
  추가 금지"). **"메뉴 말고 디폴트를 줘라"**(동급 옵션 나열 X, 1개+탈출구). **"선언 말고 절차를."**
- **명명된 패턴:** **Gotchas 섹션**(최고가치 — 가정을 뒤집는 환경사실, 예 soft-delete `WHERE deleted_at
  IS NULL`; *"에이전트가 틀려서 교정하면 그 교정을 gotchas 에 추가"*) · Templates · Checklists ·
  Validation loops · **Plan-validate-execute**(배치/파괴적) · 반복 로직 보이면 **스크립트 번들**.
- **"왜를 설명하라"** — "Do X **because** Y tends to cause Z" > "ALWAYS do X, NEVER do Y".

> **SoloSquad 직격:** ①의 trigger-rate eval = 우리 `triggers.{slash,keyword,freq}` 의 정량 검증 루프로,
> ②의 with/without A/B + 비용 delta = `validator-corpus`/`test:corpus` 확장으로, ③의 Gotchas/Plan-
> validate-execute = `skill-author.ts` 본문 템플릿으로 거의 1:1 이식 가능. → **H1·H2·H3 재무장**(Part H).

---

# Part C — 객관적 현황: 벤더·생태계 전수 비교

## C.1 정량 한도 한눈에 (벤더별)

| 벤더/제품 | name 한도 | description 한도 | instructions/본문 | 권장 툴 수 | 비고 |
|---|---|---|---|---|---|
| **Anthropic SKILL.md** | ≤64자, 소문자-하이픈, 디렉터리명 일치 | **≤1024자** | 본문 <500줄/<5kt | — | 유일하게 정량+문체 규칙 공표(3인칭, gerund) |
| **agentskills.io(오픈표준)** | ≤64자, 하이픈 규칙 엄격 | ≤1024자 | <5kt | — | +`compatibility`≤500, `metadata`, `allowed-tools`(실험) |
| **OpenAI Custom GPT** | (미공표, 관례) | (미공표) | **instructions 8000자** | 액션 — | 지식파일 20개/512MB/2Mt |
| **OpenAI Assistants API** | **256자** | **512자** | **instructions 256k자** | **<20 soft / 128 hard** | strict mode 권장 |
| **OpenAI Apps SDK** | 미공표 | 미공표 | — | — | `domain.action` 네이밍 + "Use this when…/Do not use for…" |
| **Google function calling** | **≤64자**, `[a-zA-Z0-9_.-]` | (미공표) | — | **10–20** | enum 활용, 정수형 명시 |
| **Google ADK Skills** | (Python ident) | description "crucial" | L1/L2/L3 | — | **자체 SKILL.md, 점진공개 명시 구현** |
| **Google Playbook** | snake_case | 라우팅 키 | Goal+Instructions+Examples | — | **예시 min1/권장≥4** (instructions보다 중시) |
| **MS Semantic Kernel** | snake_case 권장 | (미공표, 정성) | skprompt.txt+config.json | **10–20(권장 10)** | **SKILL.md 직접 대응물** |
| **MS M365 declarative agent** | **≤100자** | **≤1000자** | **instructions ≤8000자** | actions 1–10 | desc_for_model ≤2048, 전역 4000자 캡 |
| **MS Copilot Studio** | (미확인) | (미확인) | **instructions 8000자** | **25–30 권장 / 128 hard** | "이름>설명" 독특, 트리거구 5–10/<10단어 |
| **Meta Llama** | (미공표) | (미공표, 정성) | user prompt에 배치 | 70B/405B 권장 | **skill 개념 없음**(미머지 제안 #4962만) |
| **MCP** | "unique id"(관례 없음) | "모델 힌트" | inputSchema | — | annotations(readOnly/destructive/idempotent/openWorld) |

> **읽는 법:** Anthropic·agentskills.io 만이 **스킬 레이어에서 정량 규칙**을 공표한다. OpenAI·MS 의
> 강한 숫자(8000/256k/512)는 *제품별*로 흩어져 있다. Google 의 hard number 는 *function-calling
> 레이어*(64자, 10–20툴)에 몰려 있고 스킬/description 레이어엔 한도가 없다.

## C.2 OpenAI — SKILL.md 동등물 없음, 5개 제품에 분산
- **단일 파일 표준 부재.** 역량이 Custom GPT 필드 / Assistants 파라미터 / Agents SDK 독스트링 /
  Apps SDK MCP 메타데이터로 파편화. 포터블 단일 포맷 없음.
- **가장 근접한 공표 규칙 = Apps SDK 툴 공식:** `domain.action` 네이밍(`calendar.create_event`),
  description 은 **"Use this when… 으로 시작 + Do not use for… 명시"**, 파라미터에 enum/예시.
- **메타데이터 = 제품 카피.** golden prompt set 유지, **tool별 precision/recall 추적**, **한 번에 한
  필드만 변경**, 주간 분석 리뷰. (정량 측정 문화가 Anthropic보다 더 명시적.)
- **문체는 imperative**("Use this when") — Anthropic의 3인칭과 대비.
- 점진공개는 *이름 없이* file_search(벡터스토어, 800토큰 청크/400 오버랩/10→50결과) + deferred tools +
  지식파일로 구현. reasoning 모델: 핵심 지시를 description **맨 앞**에 두면 정확도 +6%.

## C.3 Google — 자체 SKILL.md 를 출시 (가장 큰 발견)
- **Google 도 SKILL.md 를 출시했다**: ⑴ Gemini API "Skills"(`skills/` 폴더 + frontmatter),
  ⑵ **ADK Skills** — **L1 메타데이터 / L2 instructions / L3 resources** 의 점진공개를 *명시적으로*
  구현("Level 3 resources remain dormant until invoked"). **Anthropic의 1:1 대응물.**
- 모든 레이어에서 **description = 라우팅 키**: ADK("docstring 이 곧 tool description"), Agent Builder
  ("LLM 이 이 description 으로 호출 여부 결정"), Vertex Extensions(`DESCRIPTION_LLM` "필수").
- **차이: 예시 > instructions.** Playbook 은 예시 ≥4개 권장 + "정확한 지시문보다 충실한 예시에 시간을
  더 써라"고 명시. Anthropic은 지시문 산문에 더 의존.
- **사람용 라벨 vs LLM용 description 분리**(`displayName` vs `DESCRIPTION_LLM`) — 디스커버리 메타와
  표시 메타를 구분.

## C.4 Microsoft — skprompt.txt + config.json = SKILL.md 의 직접 조상
- **SK 의 prompt function = 디렉터리 + 2파일**: `skprompt.txt`(프롬프트 본문 + `{{$input}}` 변수) +
  `config.json`(`description`, `input_variables`, `execution_settings`). **= SKILL.md 의 body +
  frontmatter 거의 1:1.** 차이: SK 본문은 *템플릿*(자유 산문 아님), config 에 temperature/max_tokens
  같은 *실행설정*이 있음(SKILL.md엔 없음), **참조파일 on-demand 로딩 없음**(전체 프롬프트 일괄 로드).
- 역사: 초기 SK 가 literal "Skills" → v1.0.0 직전 **"Plugins"로 개명**(OpenAI plugin spec 정렬, issue #2119).
- **정량 한도가 매우 구체적**: M365 instructions ≤8000 / name ≤100 / description ≤1000 /
  desc_for_model ≤2048 / 전역 string 4000자. Copilot Studio instructions 8000.
- **보안 프레이밍이 독특**: "instructions 8000자 우회하려고 지식소스에 지시문 넣지 말라"(XPIA 경고) —
  *신뢰 instructions* vs *비신뢰 knowledge* 분리. SKILL.md엔 이 강조 없음.
- **"이름이 description보다 중요"**(Copilot Studio) — 거의 모든 벤더의 description-중심과 대비되는 입장.
- 툴 RAG 선택 시 "function 의 name+description 을 concat 해 임베딩 생성"(SK contextual selection).

## C.5 Meta — skill 개념 없음
- 네이티브 "skill" 프리미티브 부재. tools + toolgroups + **MCP**가 Meta 의 스토리.
- description 가이드는 얇고 일반적("clear descriptions 중요"). 정량 한도·3인칭·점진공개 방법론 없음.
- 유일한 skill 형태 = **미머지 커뮤니티 제안**(`llama-stack` #4962) — Anthropic/OpenAI를 origin 으로
  명시하며 *호환용*으로 `SKILL.md` zip 번들 제안. (Meta 발명 아님.)

## C.6 오픈표준: MCP & agentskills.io
- **MCP 3 프리미티브**: tool(모델 제어) / resource(앱 제어, 수동 컨텍스트) / prompt(유저 제어, 슬래시).
  tool = `name`+`title`+`description`+`inputSchema`. **annotations**(hint, 비보장): `readOnlyHint`,
  `destructiveHint`(기본 true), `idempotentHint`, `openWorldHint`. description = "모델 힌트". **네이밍
  관례 없음.** 2025-11 Anthropic 발 → 2026? 채택 확산 → **2025-12 Linux Foundation(AAIF) 기부**(벤더중립).
- **agentskills.io = SKILL.md 정본 스펙**: frontmatter `name`(≤64, 하이픈 규칙 엄격, 디렉터리명 일치),
  `description`(≤1024), `license`, `compatibility`(≤500), `metadata`(string map), `allowed-tools`
  (예: `Bash(git:*) Read`, 실험). 검증기 `skills-ref validate`. **description 이 디스커버리의 전부**
  (코어 스펙엔 tag/category 없음).
- **MCP vs SKILL.md = 경쟁 아닌 레이어 분리**: MCP = *연결* 와이어 프로토콜(Linux Foundation),
  SKILL.md = *워크플로 교육* 파일 포맷. 공유 프리미티브 = "tool description 품질".

## C.7 프레임워크 de-facto (LangChain / LlamaIndex)
- 공통: `name`=함수명 기본, `description`=docstring 기본, **"description 은 모델에 전달되니 서술적이어야"**
  (LangChain), **"tool 선택·인자 생성이 name+description 에 강하게 의존 — 튜닝하면 큰 변화"**(LlamaIndex).
- **LangChain Deep Agents = SKILL.md 네이티브 구현**(폴더+frontmatter+본문 read_file 로딩+`skills-ref`).
- LlamaIndex 는 SKILL.md 를 외부 패턴으로 소비하되 "테스트에서 거의 호출 안 됨"(문서 MCP 대비) 보고.

---

# Part D — 객관적 현황: 커뮤니티 컬렉션 4종 실측

실제 repo 의 frontmatter 를 verbatim 으로 본 결과(2026-06). 우리 `agents/**/SKILL.md` 작성에 직접 참고.

## D.1 pm-skills (phuryn) — **description 작성의 골드 스탠다드**
```yaml
name: opportunity-solution-tree
description: "Build an Opportunity Solution Tree (OST) to structure product discovery —
  map a desired outcome to opportunities, solutions, and experiments. Based on Teresa
  Torres' Continuous Discovery Habits. Use when structuring discovery work, mapping
  opportunities to solutions, or deciding what to build next."
```
- **공식: `&lt;무엇을&gt; — &lt;구조/방법&gt;. Based on &lt;방법론&gt;. Use when &lt;A&gt;, &lt;B&gt;, or &lt;C&gt;.`** ← 본 조사 전체에서
  가장 재사용가치 높은 단일 패턴. 3인칭 + comma-separated 트리거절.
- **이중 트리거 아키텍처**: *skills*(ambient, 자동 로드, `/plugin:skill`로 강제호출 가능) vs
  *commands*(유저 명시 `/command`, 여러 skill 을 체인). "Claude 가 아는 것" vs "유저가 실행하는 것" 분리.
- commands 만 `argument-hint` 추가. plugin.json 에 semver + keywords + SPDX license.

## D.2 gstack (garrytan) — 워크플로 체인 + 자가규제
```yaml
name: office-hours
preamble-tier: 3
version: 2.0.0
description: YC Office Hours — two modes. (gstack)
allowed-tools: [Bash, Read, Grep, Glob, Write, Edit, AskUserQuestion, WebSearch]
triggers: ["brainstorm this", "is this worth building", "help me think through", "office hours"]
```
- **커스텀 필드**: `preamble-tier`(로드 우선순위 정수), `version`(semver), `triggers`(자연어 구 리스트 —
  우리 `triggers.keyword` 와 동형).
- **아티팩트 체이닝**: Think→Plan→Build→Review→Test→Ship→Reflect, 각 스킬이 이전 산출물을 소비.
- **점진공개 via `sections/`**(해당 단계에서만 `design-and-handoff.md` 읽기).
- **명시적 non-goal**("No implementation permitted") + **자가규제 캡**("hard cap at 50 fixes",
  "WTF-likelihood"). 브랜드 접미사 `(gstack)`.

## D.3 ai-marketing-skills (ericosiu) — **안티패턴 사례 포함**
- ⚠️ **`growth-engine/SKILL.md` 에 YAML frontmatter 자체가 없음** → 포터블 자동 디스커버리 깨짐.
  (우리 파서라면 `SkillParseError`. 반면교사.)
- 좋은 점: 본문에 **"Use this skill when:"(6) + "Do NOT use for:"(3)** 명시 리스트 — 긍정+부정 스코핑.
  code-first(얇은 지시 래퍼 + CLI 스크립트), 방법론 출처 명시("Karpathy autoresearch").

## D.4 agency-agents (msitarzewski) — 페르소나 + **필드 드리프트 주의**
```yaml
name: SEO Specialist
description: Expert search engine optimization strategist specializing in technical SEO,
  content optimization, link authority building, and organic search growth. ...
tools: WebFetch, WebSearch, Read, Write, Edit
color: "#4285F4"     # ← 다른 파일은 color: cyan (드리프트!)
emoji: 🔍
vibe: Drives sustainable organic traffic ...
```
- 페르소나 프레젠테이션 필드(`emoji`/`vibe`). ⚠️ **`color` 포맷 드리프트**(`cyan` vs `"#4285F4"`) —
  제약 없는 필드는 대규모 다중 기여 시 *반드시* 어긋남. **우리 검증기가 enum/포맷 강제해야 하는 이유.**
- ⚠️ **capability-only description**("Expert … specializing in A, B, C") — "Use when" 절이 없어 자동
  매칭이 pm-skills 보다 약함.

## D.6 addyosmani/agent-skills — **anti-rationalization + verification 게이트의 골드** (2026-06-22 신규)
Addy Osmani 의 "production-grade engineering skills"(MIT). **24 skill = 23 SDLC + 1 meta-skill**,
Define/Plan/Build/Verify/Review/Ship/Meta 단계로 분류, 8 슬래시커맨드(`/spec`·`/plan`·`/build`·`/test`·
`/review`…)가 단계 진입점. **frontmatter 는 `name`+`description` 단 2필드**(커스텀 필드 0 — 미니멀의 극단).
```yaml
name: test-driven-development
description: Drives development with tests. Use when implementing any logic, fixing any bug, or changing
  any behavior. Use when you need to prove that code works, when a bug report arrives, or when you're about
  to modify existing functionality.
```
- **description 문법(CONTRIBUTING 명문화):** **`<3인칭 동사-s> <역량>. Use when <광의 트리거>. Use when
  <구체 시나리오>.`** — pm-skills 의 "Use when" 골드에 **"Use when 2문장"(광의+구체) 변주**를 더한 형.
- **본문 섹션 *의도* 강제(헤딩 문자열 아님):** Overview → When to Use(**+When NOT**) → Process/Cycle →
  **Common Rationalizations** → **Red Flags** → **Verification** → See Also.
- **NOVEL ①: anti-rationalization 테이블.** 에이전트가 스스로 둘러댈 변명을 *선제 반박*. 예: *"'너무
  단순해서 spec 불필요' → 수용기준은 여전히 적용. 5줄도 OK."* — "에이전트가 규율을 합리화로 회피"하는
  실패모드 직격. **우리 spec-gate 본문에 그대로 넣을 패턴.**
- **NOVEL ②: 비협상 Verification 게이트** — 모든 스킬이 *구체 증거* 종료조건으로 끝남("intuition alone is
  insufficient"). **NOVEL ③: Red Flags**(오용 징후, 예 "tests passing on first run"). **NOVEL ④:
  meta-skill 라우터**(`using-agent-skills` — 모든 스킬의 디스커버리/호출을 관장하는 단일 스킬).
- **점진공개 변주:** per-skill `scripts/references/` 대신 **repo-level 공유 `references/`**(체크리스트
  6종)로 hoist, SKILL.md 는 **flat·<500줄**. CONTRIBUTING: *"reference material 을 skill 디렉터리에 넣지
  말 것 — `references/` 사용."* 4대 품질바: **Specific·Verifiable·Battle-tested·Minimal.**
- ⚠️ 드리프트: README 가 "24/8" 인데 일부 문서/블로그는 "20/7"(stale). AGENTS.md 의 "name/description/
  **when to use**" 3필드 표기 vs 실제 2필드(when-to-use 는 description 에 융합) — 문서/실측 불일치.

## D.5 크로스-repo 수렴 패턴 (실측 종합)
1. `name`+`description` 보편 코어. 2. **"Use when…" 트리거절이 골드**(긍정+부정). 3. **방법론 출처 명시.**
4. kebab-case + 도메인 네임스페이스, **폴더명=호출명**. 5. **1 스킬 = 1 자기완결 디렉터리**(+scripts/sections/data).
6. 얇은 본문 + 점진공개. 7. **명시적 non-goal + 정지 캡.** 8. 유닛에 semver. 9. **ambient skill vs explicit command**
   2계층. 10. 컬렉션 *내부* 본문 템플릿 일관(컬렉션 *간* 상이) — **하나 골라 일관 적용.**
11. 안티패턴: frontmatter 누락 / 제약없는 필드 드리프트 / "Use when" 없는 capability-only description.
12. **(2026-06-22 추가)** anti-rationalization 테이블 + **비협상 Verification 게이트** + Red Flags 가
    엔지니어링 스킬의 차세대 수렴 신호(addyosmani). 본문 섹션은 **헤딩 문자열이 아니라 *의도* 로 강제**.
13. **(2026-06-22 추가)** description 은 *손으로 쓰는 것이 아니라 eval 로 다듬는 대상*(agentskills.io
    optimizing-descriptions): trigger-rate 0.5 임계 + train/val split. **D.1 의 "골드 패턴"은 출발점,
    B.6 의 측정 루프가 종착점.**

---

# Part E — 객관적 현황: 마켓플레이스 4종

## E.1 핵심 사실
- **Anthropic 공식**(`claude.com/platform/marketplace`, `anthropics/claude-plugins-official`): 스킬은
  *plugin 안의 컴포넌트*로 배포. `.claude-plugin/plugin.json`(name=**kebab-case 필수**, displayName,
  version=semver, description, author, license=SPDX, **keywords**, skills/commands/agents 경로,
  defaultEnabled) + `marketplace.json`. **예약 이름 차단**(`agent-skills` 등). 2단계 심사: CLI
  `claude plugin validate`(구조) + 사람 리뷰(문서품질·보안).
- **claudemarketplaces.com**(써드파티 애그리게이터): GitHub 를 **매일 스캔**해 `marketplace.json` 보유
  repo 자동 발견. **품질 필터: 500+ 설치 + 활성 repo + 커뮤니티 신뢰.**
- **github.com/claude-market/marketplace**: `make generate-marketplace-json` 으로 카탈로그 **자동 생성**
  (수동 편집 X). 제출 요건: **README + 사용예시**, 완전한 plugin.json, OSS 라이선스, CODEOWNERS.
- **agentskills.io**: SKILL.md 정본 스펙 + 40+ 클라이언트 쇼케이스. **description 이 디스커버리의 전부**
  (코어 스펙엔 tag/category 없음).

## E.2 마켓플레이스가 함의하는 작성 규칙
1. **description 이 최고 레버리지** — 모든 검색이 여기 키잉. "무엇을+언제+키워드", ≤1024자.
2. **네이밍은 hard gate** — kebab-case·소문자·≤64·하이픈 규칙·**디렉터리명 일치**. 비-kebab 은 Claude.ai
   동기화가 *거부*.
3. **메타데이터 완전성이 큐레이션 게이트** — version/author/SPDX license/keywords/category/tags.
4. **고품질 README + 사용예시 = 품질 기준**(단순 문서 아님).
5. **category/tags/keywords 가 브라우즈/필터 구동**(코어 스펙엔 없으니 마켓 타깃이면 plugin manifest 에 추가).
6. **제출 전 자동검증 통과**(`claude plugin validate`, `skills-ref validate`, CI 에 `--strict`).
7. **채택+활성유지가 실제 랭킹 인자**(애그리게이터 500+ 설치).

---

# Part F — 객관적 현황: 최신 연구 — MS SkillOpt

본 조사 최대의 *신규* 기여. SKILL.md 를 **학습 가능한 파라미터**로 보는 자동 최적화 연구.
출처: [microsoft.github.io/SkillOpt](https://microsoft.github.io/SkillOpt/), [arXiv:2605.23904](https://arxiv.org/abs/2605.23904) (27pp), [code](https://github.com/microsoft/SkillOpt).
**2026-06-22 정정:** 1차 재조사로 편집예산·protected-section·전제조건을 바로잡음(아래 ⚠️).

- **정의(verbatim):** "the skill should… be **trained as the external state of a frozen agent**, with the
  same discipline that makes weight-space optimization reproducible." 가중치 불변, **텍스트만 학습**,
  배포 시 **추가 추론콜 0**(스킬은 그냥 텍스트).
- **4단계 루프:** ⑴ **Rollout**(target 모델이 현 스킬로 실행, scored 궤적 기록 = forward) → ⑵ **Reflect**
  (optimizer 모델이 **실패·성공 미니배치를 *분리* 반영** — "failures and successes are reflected separately
  so edits correct recurring errors **while preserving working behavior**") → ⑶ **Edit**(span 단위
  **append/insert/replace/delete** = patch-mode, 전면 재작성 금지) → ⑷ **Gate**(held-out **selection
  점수가 best 를 엄격 초과할 때만** 채택).
- ⚠️ **편집예산 정정:** 기존 메모의 "스텝당 4–8 sweet spot" 은 부정확. 논문 **기본 = textual learning
  rate `Lt=4`, cosine decay, floor `Lt=2`**(constant/linear/cosine/autonomous 스케줄 선택). "An edit
  budget functions as a **textual learning rate**, preventing useful rules from being overwritten by broad
  rewrites." 4–8 은 ablation 범위일 뿐 *디폴트는 Lt=4*.
- ⚠️ **protected-section 정정(중요):** 손으로 쓰는 "건드리지 마" 헤더가 **아니다**. **2-timescale** 설계 —
  *fast(step)* = 위 bounded 편집, *slow(epoch)* = 같은 항목을 이전/현재 스킬로 재샘플해 improvements/
  regressions/persistent-failures/stable-successes 로 묶어 **기계가 longitudinal guidance 블록을 protected
  slow-update 필드에 *직접 작성***. "Step-level edits **cannot overwrite** the protected slow-update field."
  → 보호 섹션 = *기계가 쓰는 epoch 합의문*. **meta+slow-update 제거 시 SpreadsheetBench 77.5→55.0(−22.5pt).**
- **rejected-edit buffer(자가개선 핵심):** epoch-local buffer 가 **관측된 실패패턴 + 거부된 편집 + 그것이
  부른 점수 하락**을 기록 → 후속 reflection 에 주입("avoid repeating failed edits, focus on unresolved
  failures"). buffer 제거 시 SearchQA 87.1→85.5. = **거부를 텍스트 그래디언트(네거티브 신호)로 전환.**
- **정량:** 효과적 스킬 = **중앙값 ~920토큰(379–1995)** — 손 감사 가능. GPT-5.5 무스킬 대비 **+23.5(chat)
  /+24.8(Codex)/+19.1(Claude Code)**, **52/52 best-or-tied**(human·1-shot·Trace2Skill·TextGrad·GEPA·
  EvoSkill 상회), Codex→Claude Code **무수정 이식 +59.7(22.1→81.8)**.
- **optimizer 셋업:** 별도 frozen target + optimizer(예 target=GPT-5.4-mini, optimizer=GPT-5.5)가 표준,
  단 **"matched target-as-optimizer 도 유용한 편집 발견"** — *옵티마이저가 타깃보다 꼭 강할 필요는 없다.*
- ⚠️ **하드 전제조건(자가개선 설계의 갈림길):** "most directly applicable when the target task has
  **automatic verifiers, exact-match metrics, executable checks, or otherwise reliable feedback signals.**"
  → **자동 채점이 없으면 SkillOpt 루프는 못 돈다.** 주관적 문서작성류는 부적합 → 그쪽은 정적 게이트(lint/
  originality, D.6/agent-doc)로 폴백.
- **작성 골드(ablation 근거):**
  - **가장 가치있는 내용은 절차적 규율**(답변 포맷팅, **evidence binding**=주장↔출처 결속, search-frontier
    관리) — 프런티어 모델이 zero-shot 으로 *안 하는* 행동. → **"이 태스크의 사실"이 아니라 "어떻게
    행동할지"를 써라.** ("every rule is procedural rather than instance-specific.")
  - **작은 bounded 변경 > 큰 재작성.** 몇 문장씩 바꾸고 매번 held-out eval 검증.
  - **검증 게이팅("hope 가 아니라").** 거부 편집을 buffer 로 재제안 차단 + 네거티브 신호화.
  - **스킬은 포터블 자산**(모델·하네스·유사태스크 간 이식 — +59.7 이 증거).

---

# Part G — 인사이트 도출

## G.1 산업 수렴점 (모두가 동의)
1. **description = 모델의 선택 메커니즘.** 단일 최강 수렴(Anthropic·OpenAI·Google·MS·Meta·MCP·
   LangChain·LlamaIndex 전원). → 우리도 description 품질을 **1순위 품질 지표**로 삼아야.
2. **점진적 공개 + 메타/본문 분리**가 표준 아키텍처. Google ADK 가 L1/L2/L3 로 복제, LangChain 네이티브 구현.
3. **툴셋은 작게(10–20).** 우리 freq cap(20)과 우연히 일치 — 근거 있는 숫자였음.
4. **긍정+부정 스코핑**("Use when… / Do not use for…")이 description 의 사실상 표준 포맷.
5. **kebab-case·디렉터리명 일치는 hard gate**(마켓 배포 필수조건).
6. **스킬 = 릴리스 아티팩트**(semver, 검증기, README 품질).

## G.2 의미있는 차이점 (벤더 분기)
| 축 | 한쪽 | 다른쪽 | 우리 선택 |
|---|---|---|---|
| description 문체 | **3인칭**(Anthropic) | imperative "Use this when"(OpenAI Apps) | 3인칭 + "Use when" 절 (pm-skills 형) |
| 지시 vs 예시 | 지시 산문(Anthropic) | **예시 ≥4 우선**(Google) | 둘 다 — 특히 복잡 스킬엔 예시 강제 검토 |
| 이름 vs 설명 비중 | description 중심(다수) | **이름>설명**(MS Copilot) | 이름·설명 *둘 다* 의미충실하게 |
| 한도 | 가이드(Anthropic 스킬층) | **하드 숫자**(MS/OpenAI) | **하드 숫자 채택**(검증기에 강제) |

## G.3 신규 신호 (공식 가이드에 없던 것)
- **SkillOpt = 스킬 자동 최적화의 등장.** Claude A/B 수동 루프를 *자동화·정량화*. "스텝당 4–8 편집",
  "held-out 게이팅", "protected-section", "중앙값 ~920토큰" 같은 **정량 dosing** 은 공식 가이드에 없음.
- **SKILL.md 의 표준화.** 더 이상 Anthropic 전용이 아님 — Google 출시, 40+ 채택, agentskills.io 정본,
  Linux Foundation 궤도(MCP 선례). → **포터빌리티가 곧 자산.**
- **Claude Code 1536자 truncation + "트리거 첫 문장" + "pushy description"**(under-trigger 방어) 같은
  실전 배치 규칙(KDnuggets).
- **마켓플레이스 메타데이터 = 제품 카피**(OpenAI), **precision/recall 추적**, **한 번에 한 필드 변경** —
  description 을 *측정 가능한 자산*으로 취급하는 문화.
- **(2026-06-22) description·output 이 *공식적으로* 측정 절차가 됨**(agentskills.io 3-가이드, B.6):
  trigger-rate 0.5 임계·20쿼리×3런·train/val split·with/without A/B·비용 delta. = 수동 Claude A/B 와
  자동 SkillOpt 사이의 *공식 중간항*. → 우리 corpus 를 이 레시피로 재설계하면 SkillOpt 루프의 발판이 된다.
- **(2026-06-22) protected-section 의 재해석:** 보호 섹션은 *손으로 봉인하는 헤더*가 아니라 **기계가
  epoch 단위로 쓰는 합의문**(SkillOpt). 우리 stateful 스킬/메모리 설계에서 "내구 지침 vs 휘발 노트" 를
  *물리 분리*하되, 내구 쪽도 **자동 갱신 가능**하게 설계해야 함.
- **(2026-06-22) 자가개선엔 자동 검증기가 하드 전제**(SkillOpt 한계). asset 별 scored eval 없으면 텍스트
  학습 루프 불가 → v1.3.6 는 **"검증 가능한 asset 부터 자가개선"** 으로 범위를 그어야 한다.

## G.4 SoloSquad 포지셔닝 진단
- **우리가 이미 앞서 있는 것:** 구조화 트리거(`triggers.{slash,keyword,freq}`)는 표준의 자유어
  description 보다 *더* 정밀. `loop_mode: spec-gate`=피드백루프 구조화. `dev_permissions`=세분 권한.
  `schema_version`=포워드호환. corpus 회귀=eval 골격. → 우리는 표준의 **상위집합(superset)**.
- **우리가 뒤처진 것:** ⑴ 검증기가 공식 정량/문체 규칙(64자·1024자·예약어·kebab·디렉터리일치·3인칭·
  vague)을 **미검사**. ⑵ description 작성 *컨벤션*("Use when" 절) 미명문화. ⑶ SkillOpt 식 자동 최적화
  부재(현재 author 는 1-shot 생성). ⑷ 마켓 배포 경로(plugin.json/kebab) 미정렬.

---

# Part H — SoloSquad 적용 전략

우선순위 순. 각 항목에 **근거(어느 인사이트)** + **착수점(파일)** 명시.

### H1. 검증기를 공식 표준에 정렬 (P0 — 가장 싸고 효과 큼)
근거: G.1·G.2(하드숫자)·D.4(드리프트). 착수: `src/bot/skill-parser.ts` `validateSkill`.
- `name`: ≤64자 + `^[a-z0-9]+(-[a-z0-9]+)*$`(연속/양끝 하이픈 금지) + 예약어(`anthropic`,`claude`) +
  **부모 디렉터리명 일치** 검사 추가(현재 전부 미검사).
- `description`: ≤1024자 상한. **1인칭 린트**("I can"/"You can"→warning). **vague 휴리스틱**
  (`helps with`/`does stuff`→warning). **"Use when"/"사용 시점" 트리거절 부재 시 info**.
- 본문 **500줄 / 참조 1단계 깊이** 린트(`agent validate`).
- 이유: `anthropics/skills` corpus 라운드트립 호환 + 마켓 배포 사전조건.

### H2. description 작성 컨벤션 명문화 + author 프롬프트 반영 (P0)
근거: G.1·D.1·D.6(골드패턴)·G.3(pushy/첫문장)·B.6(eval 레시피). 착수: `src/bot/skill-author.ts`.
- 표준 포맷 채택: **"`&lt;3인칭 동사&gt;` `&lt;역량&gt;`. `&lt;방법론 출처&gt;` 기반. 사용 시점: A(광의), B(구체). (제외: X)"**
  — addyosmani 의 "Use when 2문장(광의+구체)" 변주 채택.
- 규칙: 3인칭(또는 imperative "Use this skill when…"), **트리거를 첫 문장에**(1536자 절단 대비), under-
  trigger 방어 위해 약간 pushy, **실패쿼리 키워드 직박 금지(overfit)** — 상위개념을 잡아라.
- **본문 템플릿에 명명패턴 주입(B.6③):** Gotchas · Plan-validate-execute · Validation loop · Red Flags ·
  **anti-rationalization 테이블** · 비협상 Verification 게이트(addyosmani D.6). "왜를 설명하라"(이유기반 > 명령형).
- `skill-author.ts` 생성 프롬프트에 이 템플릿 주입 → 73개 기존 SKILL 도 점진 리라이트.

### H2.5 description·output eval 루프를 corpus 에 (P0 — B.6 직접 이식, 신규)
근거: B.6①②. 착수: `src/analyze/validator-corpus.ts` + `npm run test:corpus`.
- **trigger-rate eval:** 스킬별 20쿼리(should 8–10 + should-NOT 8–10, **near-miss 네거 포함**) × 3런,
  **임계 0.5**, **train 60/val 40 split** → 우리 `triggers.{slash,keyword,freq}` + description 의 정량 회귀.
- **output A/B:** `evals/evals.json`(prompt·assertions) 을 with_skill/without_skill 로 돌려 pass-rate +
  **token·duration delta** 기록. assertion 은 첫 런 *후* 작성, "concrete evidence for PASS".
- 이 두 루프가 H3(SkillOpt)의 *채점기*가 된다 — **검증기 없이는 자가개선 없음**(F 전제조건).

### H3. SkillOpt 식 자가개선 루프 도입 (P1 — v1.3.6 핵심 차별화)
근거: F·G.3·H2.5. 착수: `skill-author.ts` + `validator-corpus`/`test:corpus`.
- 우리는 이미 author(=Claude A) + corpus(=eval 채점기, H2.5 후) 보유 → **rollout→reflect(성공/실패
  *분리*)→bounded patch-edit(`Lt=4`, floor 2)→held-out gate** 루프를 얹을 수 있음.
- **rejected-edit buffer** 도입: 거부된 편집 + 점수하락을 epoch-local 로 기록해 재제안 차단(네거티브 신호).
- **protected slow-update 필드:** 손봉인 헤더가 아니라 **epoch 단위로 *기계가 쓰는* 합의문** — frontmatter
  그래프(불변)와 별개로, 본문 내 "내구 규율" 블록을 step-edit 가 덮지 못하게 보호하되 epoch 에 자동 갱신.
- **자동 검증기 게이트(전제):** scored eval 있는 스킬(코드/포맷 검증 가능)부터 적용, 주관적 스킬은 H1 정적
  게이트로 폴백. 목표 본문 크기 **~920토큰 중앙값**.
- optimizer 는 별도 모델 불필요 — matched target-as-optimizer 도 동작(비용 절감).

### H4. 마켓플레이스 배포 경로 정렬 (P1 — 외부 확산 시)
근거: E·G.1(표준화). 착수: 신규 `plugin.json` 생성기 + 네이밍 정책.
- 우리 SKILL 을 Claude 마켓/agentskills.io 에 낼 거면: **kebab-case + 디렉터리명 일치 강제**(H1과 연동),
  `.claude-plugin/plugin.json`(semver·SPDX·keywords·category) 자동 생성, `claude plugin validate`/
  `skills-ref validate` 를 `validate-skills` 파이프라인에 추가.
- 우리 SoloSquad 확장 필드는 다른 런타임에서 **무시되며 graceful degrade**(extra bag) — 포터빌리티 OK,
  단 문서화.

### H5. 어휘 정렬 (P2 — 표준 수렴 추적)
근거: C.6(MCP annotations)·C.7. 착수: 문서 + 파서 주석.
- `dev_permissions`(network/push/merge) ↔ MCP `destructiveHint`/`readOnlyHint`, agentskills `allowed-tools`
  와 의미 매핑 표 유지. 표준이 Linux Foundation 으로 가는 만큼 우리 어휘를 주기적으로 재정렬.
- 우리 `triggers` 가 표준 description-only 매칭의 **상위집합**임을 README 에 명시(이식 시 description 이
  자급자족하도록 함께 작성).

### H6. 적용 우선순위 요약
```
P0 (즉시): H1 검증기 정렬 · H2 description 컨벤션 · H2.5 eval 루프(corpus)
P1 (중기): H3 SkillOpt 자가개선 루프 · H4 마켓 배포 경로
P2 (추적): H5 어휘/표준 정렬
```
**v1.3.6 매핑:** "작성법 내재화" = H1·H2(검증기·author 템플릿) + 73 SKILL 점진 리라이트. "자가개선 asset
구조" = H2.5(채점기) → H3(SkillOpt 루프). 둘은 순서 의존 — **채점기(H2.5) 없이 자가개선(H3) 불가.**

---

# Part I — 궁극의 체크리스트

**디스커버리(최우선)**
- [ ] description: 3인칭 · "무엇을+언제(트리거)+제외 케이스" · **트리거 첫 문장** · ≤1024자 · 약간 pushy
- [ ] 방법론/출처 명시(있으면) · 키워드 포함

**네이밍/구조(hard gate)**
- [ ] `name`: kebab-case·소문자·≤64·하이픈 규칙·**디렉터리명 일치**·예약어 회피
- [ ] 1 스킬 = 1 자기완결 디렉터리(+scripts/references/assets)

**점진적 공개**
- [ ] 본문 <500줄 / <5000토큰(이상적 ~920) · 상세는 별도 파일 · 참조 **1단계 깊이** · >100줄엔 ToC

**내용 품질**
- [ ] **절차적 규율** 중심(facts 아님, "에이전트가 모르는 것만") · 명시적 non-goal/정지조건 · 용어 일관 · 시간의존 정보 없음
- [ ] 예시 구체적(복잡 스킬은 ≥3) · **메뉴 말고 디폴트**(선택지 1개+탈출구) · (코드)forward slash·punt금지·magic number금지
- [ ] **Gotchas 섹션**(가정 뒤집는 환경사실) · 위험도에 처방강도 보정 · **"왜를 설명"**(이유기반 > 명령형)
- [ ] (엔지니어링 스킬) **anti-rationalization 테이블 + 비협상 Verification 게이트 + Red Flags**(addyosmani)
- [ ] **protected/stable(기계 갱신 가능) vs volatile 분리**(SkillOpt slow-update 필드)

**검증/반복**
- [ ] **description eval:** 20쿼리(should 8–10/near-miss 네거 8–10)×3런, trigger-rate 0.5, train60/val40, ~5 iter, **val 최고본 선택**
- [ ] **output A/B:** with_skill vs without_skill, assertion 은 첫 런 후 작성, **token·duration delta 도 측정**
- [ ] Haiku/Sonnet/Opus 테스트 · **bounded patch-edit(`Lt=4`/floor 2) + held-out gate + rejected-edit buffer**
- [ ] 자동검증 통과(`agent validate` / `skills-ref validate` / `claude plugin validate --strict` / `skill-creator`)
- [ ] (자가개선 대상이면) **자동 채점기 존재** 확인 — 없으면 정적 게이트로 폴백(SkillOpt 전제조건)

**SoloSquad 확장(우리 검증기)**
- [ ] `schema_version: 1` · slash 예약어 비충돌 · freq cap(20) 이내
- [ ] `dev_capability:true` 시 `dev_permissions` 정합(`merge.auto` 영구 금지)

**마켓 배포(외부 확산 시)**
- [ ] `plugin.json`(semver·SPDX·keywords·category) · README+사용예시 · 채택/유지 신호

---

## 출처

### Anthropic / Agent Skills 표준
- https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices · /overview · /skills
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf
- https://www.kdnuggets.com/anthropics-complete-guide-to-claude-skills-building
- https://agentskills.io · https://agentskills.io/specification · https://github.com/anthropics/skills
- **(2026-06-22) skill-creation 3-가이드:** https://agentskills.io/skill-creation/optimizing-descriptions · /evaluating-skills · /best-practices
- **skill-creator 스킬:** https://github.com/anthropics/skills/tree/main/skills/skill-creator
- https://github.com/obra/superpowers
- (한글) https://wikidocs.net/365032 · /335610 · /333426

### 마켓플레이스
- https://code.claude.com/docs/en/plugin-marketplaces · /plugins-reference
- https://github.com/anthropics/claude-plugins-official
- https://claudemarketplaces.com/ · https://github.com/claude-market/marketplace · https://agentskills.io/home

### OpenAI
- https://developers.openai.com/api/docs/guides/function-calling · /agent-builder
- https://help.openai.com/en/articles/9358033-key-guidelines-for-writing-instructions-for-custom-gpts
- https://help.openai.com/en/articles/8550641-assistants-api-v2-faq
- https://openai.github.io/openai-agents-python/tools/ · https://developers.openai.com/apps-sdk/plan/tools
- https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide

### Google
- https://google.github.io/adk-docs/skills/ · /tools-custom/function-tools/ · /agents/llm-agents/
- https://ai.google.dev/gemini-api/docs/function-calling · /coding-agents · /custom-agents · /prompting-strategies
- https://docs.cloud.google.com/dialogflow/cx/docs/concept/playbook/best-practices · /example
- https://support.google.com/gemini/answer/17102773 · https://blog.google/products/gemini/google-gems-tips/

### Microsoft
- https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/ · /concepts/prompts/yaml-schema
- https://github.com/microsoft/semantic-kernel/issues/2119 · https://github.com/microsoft/SemanticKernelCookBook
- https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.7 · /declarative-agent-instructions · /plugin-manifest-2.4
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-instructions · /add-tools-custom-agent
- **SkillOpt:** https://microsoft.github.io/SkillOpt/ · https://arxiv.org/pdf/2605.23904 · https://github.com/microsoft/SkillOpt

### Meta / MCP / 프레임워크
- https://www.llama.com/docs/model-cards-and-prompt-formats/llama3_1/ · https://github.com/meta-llama/llama-stack · issues/4962
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools · /docs/learn/server-concepts
- https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation
- https://python.langchain.com/docs/how_to/custom_tools/ · https://docs.langchain.com/oss/python/deepagents/skills
- https://docs.llamaindex.ai/en/stable/module_guides/deploying/agents/tools/ · https://www.llamaindex.ai/blog/skills-vs-mcp-tools-for-agents-when-to-use-what

### 커뮤니티 컬렉션 (실측)
- https://github.com/garrytan/gstack · https://github.com/phuryn/pm-skills
- https://github.com/ericosiu/ai-marketing-skills · https://github.com/msitarzewski/agency-agents (https://agencyagents.dev/)
- **(2026-06-22)** https://github.com/addyosmani/agent-skills · https://addyosmani.com/blog/agent-skills/

## 레포 내 관련 코드
- `src/bot/skill-parser.ts` — frontmatter 파서 + `validateSkill` (H1 착수점)
- `src/bot/skill-author.ts` — 스킬 생성 루프 = 공식 "Claude A" (H2·H3 착수점)
- `src/analyze/validator-corpus.ts` + `npm run test:corpus` — corpus 회귀 = eval 골격 (H3)
- `scripts/inject-skill-schema-version.ts` — `schema_version` 백필
- `agents/**/SKILL.md`(73개) — 실제 작성 대상
