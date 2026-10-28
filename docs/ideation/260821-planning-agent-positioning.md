# 0to1 문제정의 에이전트 — 포지셔닝 재정의와 핵심 기능 제안

> **유형:** ideation (제안서 — 발산이 아니라 **판정과 분할선을 명시**한다)
> **작성:** 2026-08-21
> **청자:** SoloSquad 개발자(본인)
> **성격:** 제품 포지셔닝 재정의 제안. `docs/roadmap.md` §2(3축)와 [[260724_경쟁력_사업시장성_v2]]의
> 포지셔닝 판정을 **1차 소스로 재검증**하고, 그 위에 포지셔닝·기능·표면·수익 모델을 제안한다.
> PRD 를 대체하지 않는다. 채택 시 `docs/prd/` 로 승격.
> **기준 상태:** v1.4.3(npm `latest`) · v2.0.0 Python 재작성 코드 착수 0% · 결정 1~17 정본 = [[260803-solosquad-architecture-redesign]] §0.0
>
> **조사 방법 (2라운드 · 서브에이전트 118 · 툴 호출 1,419)**
> - **1라운드** — deep-research 하네스(에이전트 105). 5각도 검색 → 15소스 페치 → 주장별 3표 적대적 검증(2/3 반증이면 폐기) → 종합.
>   **검증 통과 6건**에 그쳐 A·B4·D1·D4·D5·E1 이 통째로 공백으로 남았다.
> - **2라운드** — 그 공백만 겨냥한 전용 워크플로(에이전트 13). 주제별 1차 소스 dossier → **주제별 적대적 사실 감사관**이
>   인용문을 URL 에 되짚어 대조 → 종합. **감사 통과 144건**, 탈락 68건.
>
> **⚠️ 이 문서의 근거 등급 규약**
> | 표기 | 뜻 |
> |---|---|
> | ✅ | 1차 소스에서 **인용문 대조 통과**(감사관 재확인) |
> | ◐ | 인용은 통과했으나 **벤더 자기서술·의견글·프리프린트**. "그들이 그렇게 말한다"까지만 참 |
> | ⚠ | **부재 추론**(해당 페이지에 언급 없음). 전수 조사 아님 |
> | ✗ | **인용 금지.** 검증 실패했거나 원문에 없음 |
> | 🔵 | **우리 해석·제안.** 근거가 아니다 |
>
> **정직한 전제 — 2라운드 6개 세션이 전부 WebSearch 예산(200/200)을 소진했다.** 따라서 §13 의
> "없다"는 전부 **"이 방식으로 도달하지 못했다"**이지 부재의 증명이 아니다.

---

## 0. 한 문장

**"문제 정의 특화 AI 기획 에이전트"는 이미 점유된 포지션이고(Spec Kit `assess`·BMAD `forge-idea`·Keel 이 같은 어휘로 같은 일을 한다),
남아 있는 진짜 빈틈은 기능이 아니라 *상태*다 — 조사한 어떤 제품도 **여러 제품 후보를 가로지르는 지속 상태**를 갖지 않는다.**

---

## A. 결론 12가지 — 먼저 읽을 것

| # | 결론 | 등급 | 절 |
|---|---|---|---|
| **A1** | **"문제 정의"는 공백이 아니다.** GitHub 공식 리포 안의 `assess` 확장이 스스로를 *"the missing **discovery track**"* 이라 부르며 *go / needs-clarification / **kill*** 판정을 정의한다. BMAD `forge-idea` 는 *"rejecting it … are all complete outcomes"* 라고 적는다. **우리 어휘가 이미 남의 문서에 있다.** | ✅ | §3 |
| **A2** | **그러나 그 어느 것도 강제 게이트가 아니다.** BMAD 워크플로 맵은 Phase 1(Analysis)을 **제목에 `(Optional)`** 로 달고, Spec Kit 코어 커맨드(`specify`)의 입력 전제는 *"a natural language feature description"* 이다 — **코어는 결정이 아니라 명세다.** 빈틈은 "기능 유무"가 아니라 **"강제성·지속성·유통"** 세 축에 있다 | ✅ | §3.4 |
| **A3** | **"에이전트 팀"도 차별점이 아니다.** Spec Kit 이 `bundle` 을 *"a whole team persona (product manager, business analyst, security researcher, developer, …)"* 프로비저닝 개념으로 **1st-party 정의**하고, 커뮤니티 카탈로그에 이름까지 겹치는 `squad` 확장이 등재돼 있다 | ✅ | §3.2 |
| **A4** | **멀티 프로덕트는 부분 공백이다.** 세션/워크스페이스 매니저는 포화지만, **후보 횡단 지속 상태**를 가진 제품은 확인되지 않았다. Claude Code 자동 메모리 스코프는 문서상 *"Per repository"* 로 못 박혀 있고, 가장 근접한 Hezo 조차 *"nothing leaks between them"* 을 **설계 의도로 선언**한다 | ✅ | §4.2 |
| **A5** | **그런데 그 공백은 "아무도 못 해서"가 아닐 수 있다.** Altman: *"don't let your company start doing the next thing until you've dominated the first thing. No great company I know of started doing multiple things at once"*. **정본 담론이 이 기능을 정면 부정한다** — 이걸 다루지 않으면 포지셔닝이 자기모순이 된다 | ✅ | §4.3 |
| **A6** | **해소는 하나뿐 — '동시 운영'이 아니라 '깔때기의 폭'.** N개를 동시에 미는 것이 아니라 **N개 중 대부분을 문서화된 이유와 함께 죽이고 하나를 남긴다**로 재정의하면 Altman·PG·assess funnel 과 전부 정합한다 | 🔵 | §4.4 |
| **A7** | **chief↔pm 논쟁은 질문이 틀렸다.** "2단을 없앨까"가 아니라 **"핸드오프를 fork 로 바꿀까"** 다. Claude Code 문서: fork 서브에이전트는 *"the same system prompt, tools, model, and message history as the main session"* 을 상속하고 *"only its final result comes back"*. **컨텍스트 소실은 아키텍처의 필연이 아니라 non-fork 구현의 결과다** | ✅ | §5.1 |
| **A8** | **진짜 비용은 두 에이전트가 아니라 *의무 릴레이*다.** 토큰 배수는 조건부다 — agent teams 는 *plan mode 조건에서* 7배, 멀티에이전트 일반은 15배. Anthropic 자신은 그 15배를 낭비가 아니라 *"they help spend enough tokens to solve the problem"* 으로 읽는다. 우리가 줄여야 할 것은 **"모든 입력이 chief 를 거친다"는 규칙**이다 | ✅ | §5.3 |
| **A9** | **비개발자 문제에 Anthropic 이 낸 답은 "CLI 를 쉽게"가 아니라 "표면을 나누기"였다.** 데스크탑 앱이 Chat/**Cowork**/Code 3탭이고, Cowork 는 *"runs on web, desktop, and mobile"* 로 **터미널을 열거하지 않는다.** 동시에 터미널 CLI 는 2026-08 에도 *"full-featured"* 로 표기된다 | ✅ | §6 |
| **A10** | **수익화 경로는 유통 채널에 없다.** Claude Code 플러그인 마켓플레이스 문서 98KB 전문에 결제 관련 문자열 0건이고 등재는 *"inclusion is at Anthropic's discretion"*, UI 가 보여주는 유일한 cost 는 **토큰**이다. 같은 카테고리의 Vibe Kanban 은 *"the vast majority are free users and we couldn't find a business model"* 로 폐업했다 | ✅ | §7 |
| **A11** | **"차별성/창의성을 만들어준다"는 팔 수 없다.** 같은 AI 아이디어에 접근한 산출물은 **서로 더 비슷해졌고**(b=0.871/0.718), 피어리뷰 실증은 *"Inequality between workers decreased"* 로 **상향 수렴**을 가리킨다. 팔 수 있는 것은 taste 가 아니라 **경계 판단** — 프런티어 밖 과제에서 AI 를 쓴 집단은 정답률이 **19%p 낮았다** | ✅ | §9 |
| **A12** | **가상시장 시뮬은 외부 문헌도 우리 백테스트와 같은 방향이다 — 단 등급 상한은 'pilot/exploratory'.** 반대로 **캘리브레이션 성과 자체가 설정 선택의 산물일 수 있다**는 경고가 존재한다(같은 데이터 66개 설정에서 **r=.23~.84**). 우리 `N=14 · LOO 0.64` 에 정확히 겨눠진 경고다 | ✅ | §8.6 |

---

## 1. 이 문서가 **쓰면 안 되는** 것 (먼저 박제)

적대적 감사에서 탈락한 것 중, 지금 우리 문서·계획서에 **살아 있을 위험이 큰 것**만 추린다.

| ✗ 금지 | 사유 |
|---|---|
| **CB Insights "no market need 42%"** | 감사관이 현행 URL 을 재대조한 결과 `no market need` 와 `42%` **두 문자열 모두 페이지에 없다**. 2026-03-05 신판으로 대체할 것(§2.1) |
| **"기획이 유통보다 큰 병목이다"** | 같은 설문에서 1위(product ideation +29.0pp)와 2·3위(GTM +24.7pp · 시장분석 +24.0pp)의 차이가 **4~5pp** 다. 표본오차와 구분되지 않는다 |
| **"창업가는 AI 로 충족되지 못하고 있다"** | 같은 설문에서 창업가는 **전 직군 중 만족도 1위**다 — *"78% of founders"* 가 양의 ROI 를 보고한다 |
| **"멀티에이전트니까 발산이 풍부하다"** | ACL 2026 Findings 논문이 정반대를 보고한다: *"this collapse arises primarily from the interaction structure rather than inherent model insufficiency"* |
| **"AI 가 인간보다 novel 한 아이디어를 낸다"(스탠퍼드 2024)** | **같은 저자팀의 후속 논문이 자기 반증**했다. 실행 후 LLM 아이디어 점수가 전 지표에서 유의하게 더 크게 하락(p<0.05) |
| **"모델 중립성"을 축으로 파는 것** | [[260724_경쟁력_사업시장성_v2]] §14-3 이 이미 지적. 실물은 Claude Code 강결합. 이번 조사도 이를 바꾸지 못했다 |
| **"31개 스킬을 갖춘 팀"** | 벤더 문서가 그것을 **비용으로 표기**한다 — 설치 UI 의 유일한 cost 표시가 *"A Context cost estimate so you can see how many tokens the plugin will add to your context window every turn"* 이고, 안 쓰는 플러그인은 *"still add startup and context cost"* 라며 제거를 권한다 |
| **"taste is the new moat"** | 1차 출처를 **끝내 찾지 못했다**. 유행어로만 다룰 것 |

---

## 2. 수요 (A) — 확인된 것과 공백

### 2.1 감사 통과 근거

| 사실 | 인용 | 출처 | 등급 |
|---|---|---|---|
| 창업가의 최대 미충족 수요 = **product ideation** (19.6%→48.6%, **+29.0pp**) | *"Product ideation shows massive demand, jumping from 19.6% (currently using) to 48.6% (want to use next), a +29.0pp gap."* | Lenny's Newsletter + Noam Segal, 2025-12-23, n=1,750 | ◐ |
| PM 의 최대 수요 격차 = **user research** (+27.2pp) | *"User research shows the largest demand gap of any task (+27.2pp)."* | 동상 | ◐ |
| 저자 요약 | *"AI is helping PMs \_produce\_, but it lags in helping them \_think\_."* | 동상 (**저자 해석 문장 — 데이터 아님**) | ◐ |
| 실패 원인 정본(2026 신판) | *"The more telling causes — poor product-market fit (43%), bad timing (29%), and unsustainable unit economics (19%) — reveal why the capital dried up in the first place."* | CB Insights, 2026-03-05, VC 투자 폐업 431곳 | ✅ |
| **0to1 에 가장 근접한 실측 문장** | *"Two-thirds of product-market fit (PMF) failures were early-stage companies that never found a market."* | 동상 | ✅ |
| 공급측 폭증 | *"More than 36 million developers joined GitHub in a single year (23% YoY)"* · *"More than 1.1 million public repositories now use an LLM SDK"* (그중 693,867 개가 최근 12개월, +178% YoY) | GitHub Octoverse (2025-10-28 발행 / 2026-02-28 갱신 / 2026-08-21 조회) | ✅ |
| 산출물 품질 불만 | *"The biggest single frustration, cited by 66% of developers, is dealing with 'AI solutions that are almost right, but not quite...'"* | Stack Overflow 2025 (n=49,009 · 177개국 · 2025-05-29~06-23) | ✅ |

> **한정 — Lenny 설문은 이 문서 A 절의 **단일 출처**다.** 유료 뉴스레터 발행인이 자기 매체로 모집한
> 자원응답 표본이고, **문항 원문·모집 경로·창업가 하위표본 n 이 전부 미공개**다. Stack Overflow 는
> 방법론 페이지에서 자기선택 편향을 스스로 공개하는데 Lenny 설문은 그 수준의 공개가 없다.
> **→ SO/DORA 보다 한 등급 낮춰 인용할 것.**
>
> **CB Insights 한정** — 표본이 **VC 투자를 받은 431곳**이다. 부트스트랩 솔로 창업가(우리 타깃)로
> 그대로 전이 금지. 중복 계상이라 비율 합산 금지(385곳만 분류됨).

### 2.2 최대 반증 3건 — 반드시 함께 실을 것

1. **창업가는 이미 만족하고 있다.** ✅ *"Only 45% report a positive ROI (compared with **78% of founders**), and 31% report that AI has fallen below expectations, triple the rate among founders."*(디자이너와 대비한 문장)
   → **"+29.0pp 미충족"은 불만이 아니라 이미 만족한 사용자의 확장 욕구일 수 있다.**
2. **체감은 근거가 못 된다.** ✅ METR RCT(2025-07-10): *"When developers are allowed to use AI tools, they take 19% longer to complete issues"* — 그런데도 사후에 **20% 빨라졌다고 믿었다**(사전 기대는 24%).
   → **우리 "3개월 60% 유지·만족도 4.5+"를 효용 근거로 쓰면 이 문장이 자기반박이 된다.**
   (한정: n=16, 246 이슈, 저자 스스로 *"We do not claim that our developers or repositories represent a majority or plurality of software development work"*)
3. **병목이 기획이라는 근거는 없다.** ✅ 같은 설문의 2·3위가 GTM(+24.7pp)·시장분석(+24.0pp)으로 **4~5pp 차**. 그리고 DORA 2025(n≈5,000)는 *"we observe a positive relationship between AI adoption on both software delivery throughput and product performance"* 라고 METR 과 반대 방향을 보고한다(단 설계 등급이 다르다 — RCT/인과 vs 설문/상관, 그리고 *"AI adoption does continue to have a negative relationship with software delivery stability"* 를 반드시 병기).

### 2.3 판정

> 🔵 **"AI 로 만들기 쉬워졌으니 무엇을 만들지가 병목"은 방어 가능한 명제가 아니다.**
> 방어 가능한 것은 **"기획·GTM·시장분석이 사실상 동률의 상위 미충족 수요이며, 창업가는 이미
> AI 로 만족 중이라 *추가로* 상류를 원한다"** 까지다. 포지셔닝 문장에서 "병목"이라는 단어를 뺄 것.
>
> ⚠ **근거 공백 (§13-1):** 솔로/인디 빌더의 수요·실패·지불 데이터는 **1차 소스 0건**이다. A1/A2 는
> 대기업 PM·VC 투자 창업가 표본이고, A3(CB Insights)도 VC 표본이다. **우리 타깃 층 전체가 근거 공백이며,
> 이걸 전이로 메우면 안 된다.**

---

## 3. 경쟁 지형 (B3) — "문제 정의"는 이미 점유돼 있다

### 3.1 가장 아픈 발견 — GitHub 공식 리포 안에 있다

Spec Kit 공식 리포 `extensions/assess/README.md` ✅:

> *"A five-stage assessment pipeline for Spec Kit that turns **any idea** into a defensible
> **go / needs-clarification / kill** decision *before* it enters Spec-Driven Development.
> It is the missing **discovery track** that sits in front of the SDD **delivery track**."*
> *"Discovery answers *"is this worth building?"* Delivery answers *"how do we build it?"*"*
> *"The pipeline is a **funnel**: most ideas should be killed or parked before `shape`.
> **Killing an idea with a documented reason is a successful outcome, not a failure.**"*

**우리가 쓰려던 문장이 남의 README 에 이미 있다.** 그리고 이건 3자 확장이 아니라
`author: "spec-kit-core"`, `bundled: true` 인 **1st-party 확장 4개 중 하나**다(agent-context/assess/bug/git).

### 3.2 지형도 (전부 2026-08-21 측정 · 스타는 일 단위 변동)

| 제품 | 규모 | "무엇을 만들지 정하는 단계" | 판정 |
|---|---:|---|---|
| **BMAD-METHOD** v6.11.0 | 52,126★ | `bmad-agent-analyst`(*"market research, competitive analysis"*) · `bmad-brainstorming`(scripts/assets 완비) · `bmad-deep-recon`(6타입: market·competitive·domain·technical·user-voice·academic-lit) · `bmad-forge-idea` | **(b) 존재하나 선택적** — 워크플로 맵이 **Phase 1 제목에 `(Optional)`** ✅ |
| **GitHub Spec Kit** v0.16.5 | 130,565★ | 코어 커맨드 7종에 kill 판정 **없음**(⚠ 설명 문구 기준). `/speckit.specify` frontmatter = *"from a natural language feature description"* ✅ | **코어 = 명세 / 확장 = 판정** |
| **Spec Kit `assess`** | 1st-party 번들 | go/kill funnel **있음** ✅ | **(c) 게이트에 가장 근접** — 단 산출물은 전부 Markdown 문서, 실험·고객 접촉 없음 |
| **Keel Discovery** | Apache-2.0 · **0★**(생성 2026-08-09) | *"puts customer evidence upstream of `/speckit.specify`"* — 인터뷰 취합 → 가정 확신도 갱신 → *"a five-option decision menu (pivot, gather more evidence, reduce risk, narrow the hypothesis, or proceed)"* ✅ | **개념은 구현됨, 유통은 0** |
| **AWS Kiro** | 가격 $0/$20/$40/$100/$200 per user·mo ✅ | requirements/design/tasks 3파일 — 전부 "어떻게" 축 (⚠ `/docs/specs` 페이지 기준) | (a) 없음 |
| **OpenSpec** | 65,736★ | `/opsx:explore` 는 **코어 기본 탑재**이나 *"It investigates your **codebase**"* — 시장이 아니라 솔루션 스코핑 ✅ | (a) 시장 검증은 없음 |
| **Agent OS** | 5,309★ (last push 2026-05-05) | 4대 역량 전부 표준/스펙 (⚠ README 기준) | (a) 없음 |
| **Tessl** | — | 자기규정이 *"agent skills"* 거버넌스로 이동 ◐ | 카테고리 이탈 |
| **Anthropic 공식 마켓플레이스** | 286 플러그인 (Anthropic 저작 **38**) | `PRD`·`product manager`·`market research`·`roadmap`·`user research`·`PMF` 8개 키워드 **전부 0건** ✅ | **1st-party 공백** |

### 3.3 "에이전트 팀"도 신규성이 없다

Spec Kit README ✅: *"A **bundle** packages a curated set of them … into a single, versioned,
role-oriented setup so **a whole team persona (product manager, business analyst, security researcher, developer, …)**
can be provisioned with one command."*
그리고 커뮤니티 카탈로그(**157개 확장**)에 `squad` → *"Bootstrap and synchronize a Squad agent team…"* 가 등재돼 있다.
같은 카탈로그에 `product-forge`(31커맨드) · `product`(PRFAQ/Lean PRD) · `aide` · `critique` · `intake` · `roadmap` · `discovery` 도 있다.

> **한정** ✅ — 카탈로그의 `downloads`/`stars` 필드가 **전 항목 0** 이다. **존재 증거이지 점유 증거가 아니다.**
> Keel 도 0★ 다. 즉 지형은 *"이미 점령됐다"* 가 아니라 **"같은 생각을 한 사람이 여럿이고, 아무도 유통에 성공하지 못했다"** 이다.

### 3.4 판정 — 빈틈은 기능이 아니라 3축

> 🔵 **① 강제성.** 전부 optional 이다. BMAD 는 `(Optional)`, Spec Kit 은 확장 설치 필요(강한 정황 ✅:
> *"Extension/preset commands are applied at install time — when you run `specify extension add`"*),
> OpenSpec explore 는 건너뛰기 가능. **아무도 "기각을 통과하지 않으면 실행으로 못 간다"를 기본값으로 만들지 않았다.**
>
> 🔵 **② 지속성.** 전부 1회성 산출물(Markdown)이다. `assess` 조차 `.specify/assessments/<slug>/` 로 **슬러그 단위**다.
> 후보들 사이의 비교·이월·기각 이력 누적이 없다. → §4 와 정확히 같은 지점에서 만난다.
>
> 🔵 **③ 유통.** 157개 확장·0 다운로드가 말해주는 것 — 이 카테고리는 **기능 경쟁이 아니라 유통 경쟁**이다.
> 그리고 §7 이 보여주듯 그 유통 채널에는 수익화 경로가 없다.
>
> **경쟁재냐 보완재냐**: Spec Kit 은 MIT 이고 *"adding entirely new development phases"* 를 확장 용도로 명시한다 ✅.
> **기술적으로는 보완재로 얹을 수 있다. 그러나 같은 README 가 `bundle` 로 역할 팀 프로비저닝을 이미 정의하므로
> 그 확장 지점은 우리의 기회이자 동시에 경쟁 진입로다.** 기회로만 인용하면 편향이다.

---

## 4. 멀티 프로덕트 (B4) — 사용자가 "핵심"으로 지정한 질문

### 4.1 실측 지도

| 제품 | 관리 단위 | 후보/제품 횡단 지속 상태 | 다루는 일 |
|---|---|---|---|
| **Hezo** | project (team:project = **1:1**) | ✅ *"a project's agents, tasks, budget, containers, and connections all belong to that project and **nothing leaks between them**"* — 단 HQ 의 **Coach 는 인스턴스 전역**이며 *"in any project, in any team"* 태스크 완료 시 깨어난다 | 기획+실행 표방 ◐ |
| **Conductor** | workspace | ✅ *"Let one workspace read and edit code across **related** repositories"* (문서 목차 메타데이터) | 코딩 |
| **Cursor Cloud Agents** | 세션/환경 | ✅ *"Use one when a task spans separate frontend, backend, infrastructure, or shared-library repositories"* — 드는 예시가 **전부 한 시스템의 분할**. *"Long-running is not available for multi-repo environments yet."* | 코딩 |
| **Claude Code** | 세션 + repo | ✅ 자동 메모리 Scope = *"Per repository, shared across worktrees"* · *"Each Claude Code session begins with a fresh context window"* · `--add-dir` 는 *"Grants file access; most `.claude/` configuration is not discovered"* | 코딩(+스킬) |
| **Copilot cloud agent** | repo 1개 + ephemeral 환경 | ⚠ 해당 페이지에 포트폴리오 개념 언급 없음 | 코딩 |
| **Devin** | 세션 / Spaces(*"a task or project"*) | ✅ Knowledge = *"instructions and advice that Devin can reference in all sessions"* (스코프 미확인) | 코딩 · **팀 대상** (*"built to help ambitious engineering teams crush their backlogs"*) |
| **Orca** | **git worktree** | ⚠ README 범위 내 언급 없음. *"Fan one prompt across five agents, each in its own isolated git worktree"* | 코딩 |
| **Factory** | project (정의 미확인) | ✅ 스킬이 *"share across projects"*, Missions = *"large, multi-feature projects"* | 코딩 |
| **OpenHands** | repo + org | ✅ *"Organizations and users can define skills that apply to all repositories"* — **설정 자산의 횡단**이지 백로그·목표의 횡단이 아님 | 코딩 |

### 4.2 남은 빈틈 — 정확히 한 줄

> **3개 독립 1차 소스가 같은 지점에서 멈춘다.**
> Hezo *"nothing leaks between them"* / Spec Kit assess `.specify/assessments/<slug>/` / Claude Code *"Per repository"*.
> **→ 후보(제품) 사이를 가로지르는 지속 상태 — 무엇을 왜 죽였고, 무엇이 살아남았고, 어떤 가설이 이미 반증됐는지 —
> 를 유지하는 제품은 확인되지 않았다.** 이것이 남은 유일한 빈틈이며, "여러 repo 를 동시에 편집한다"와는 다른 층위다.

**카테고리 사멸 서사는 반증됐다** ✅ — 종료: Terragon(2026-02-09) · Crystal→Nimbalyst(2026-02) · Vibe Kanban/bloop(2026-04-10) · Modulus(2026-08-21 접속 불가).
**그러나 같은 기간 신규 진입**: OpenChamber **9,046★**·HN 190점(2026-08-09) · Rowboat 219점(2026-07) · Optio 88점(2026-03).
→ 종료된 것만 골라 세면 생존 편향이다. **카테고리는 살아 있고, 관리 단위가 session/board 라는 점만 그대로다.**

**그리고 Hezo 는 경쟁자가 아니다** ✅ — GitHub 별 **7개**(생성 2026-03-30), Show HN **2점·댓글 0**.
→ *"이미 누가 하고 있다"* 가 아니라 **"같은 가설을 세운 미검증 선례"** 로 다뤄야 한다.

### 4.3 정면 반대 — 이걸 다루지 않으면 포지셔닝이 무너진다

| 정본 | 인용 | 등급 |
|---|---|---|
| Sam Altman, Startup Playbook | *"As a general rule, **don't let your company start doing the next thing until you've dominated the first thing. No great company I know of started doing multiple things at once**—they start with a lot of conviction about one thing, and see it all the way through."* | ✅ (에세이·규범) |
| Paul Graham, Startups in 13 Sentences (2009-02) | *"Nothing kills startups like distractions. **The worst type are those that pay money: day jobs, consulting, profitable side-projects.**"* / *"the underlying cause is usually lack of focus."* | ✅ (에세이·규범) |
| Spec Kit `assess` | *"most ideas should be killed or parked"* | ✅ |

> **🔴 자기모순의 정확한 형태.** 우리가 파는 것이 *"0to1 문제정의·PMF 가설실험 관리"* 라면,
> **제품이 내장한 방법론(기각·집중)이 제품이 제공하는 기능(멀티 org/멀티 repo 동시 운영)을 부정한다.**
> 고객에게 "죽이고 집중하라"고 가르치면서 "여러 개를 동시에 굴리는 워크스페이스"를 파는 구조다.

**반대편의 우리 데이터** — [[260724_경쟁력_사업시장성_v2]] §9: 도입 25명 중 **6명(40%)이 복수 제품 연결 파워유저**.
🔵 이건 실제 신호지만 n=6 이고, **"복수 제품을 연결한다"가 "동시에 밀어붙인다"를 뜻하는지 확인된 바 없다.**
→ **이 6명에게 무엇을 하고 있는지 묻는 것이 §13 의 최우선 실측 과제다.**

### 4.4 해소 — 유일하게 모든 모순을 통과하는 재정의

> 🔵 **'멀티 프로덕트' = 동시 운영(❌) → 깔때기의 폭(✅)**
>
> "N개 제품을 동시에 밀어붙인다"가 아니라 **"N개 후보 중 대부분을 문서화된 이유와 함께 죽이고 하나를 남긴다"**.
> 이 프레이밍은 Altman·PG 정본과 충돌하지 않고, `assess` funnel · `forge-idea`(*"dies cheaply"*) · Keel 5지선다와 어휘가 같으며,
> §4.2 의 실제 빈틈(후보 횡단 지속 상태)과 정확히 맞물린다.
>
> **부수 효과** — "여러 프로젝트를 개발할 때 인지 부담이 증가한다"는 문제도 이 프레임에서 풀린다.
> 인지 부담의 원인은 *동시에 열려 있는 세션 수*가 아니라 **"이 후보를 왜 아직 안 죽였는지"가 어디에도 안 적혀 있다는 것**이다.

---

## 5. chief ↔ pm (D1·D2) — 역할 구분과 릴레이 비용

### 5.1 질문을 다시 세운다

사용자의 우려는 *"실무는 pm 이 하는데 chief 를 거치면 컨텍스트가 소실되고 형식적 단계로 토큰이 샌다"* 였다.
**이 우려를 해결한 사례는 실제로 있다 — 다만 "2단 폐지"가 아니라 "경계 구현 교체"로.**

| 해결 방식 | 1차 근거 | 등급 |
|---|---|---|
| **fork 서브에이전트** | Claude Code: *"a fork sees the same system prompt, tools, model, and message history as the main session, so you can hand it a side task without re-explaining the situation"* / *"The fork's own tool calls still stay out of your conversation and only its final result comes back, so your main context window stays clean."* | ✅ |
| **전체 히스토리 핸드오프** | OpenAI Agents SDK: *"When a handoff occurs, it's as though the new agent takes over the conversation, and **gets to see the entire previous conversation history**."* | ✅ |
| **코드 오케스트레이션** | OpenAI: *"While orchestrating via LLM is powerful, **orchestrating via code makes tasks more deterministic and predictable, in terms of speed, cost and performance**."* | ✅ |
| **파일 상태 존속** | 내부 [[260818-long-horizon-multi-agent-runtime]] §D.4 — Prime Agent 는 컴팩션이 세션 수명과 분리돼 커널·변수·작업 상태가 생존. 우리 goal/workflow 의 `<id>/` 디렉터리가 이미 그 자리 | ◐ |
| **스킬↔서브에이전트 결합** | Claude Code: *"**They can combine.** A subagent can preload specific skills (`skills:` field). A skill can run in isolated context using `context: fork`."* | ✅ |

> **→ "요약 핸드오프 = 컨텍스트 소실"은 필연이 아니다.** 우리가 그렇게 구현했을 뿐이다.
> 내부 실측([[260818-long-horizon-multi-agent-runtime]] §D.1)이 말하는 **96k 입력 요약이 원본의 ~3% 만 남긴다**는 손실은
> **요약 핸드오프에만 해당**하고, fork·전체이력 전달에는 해당하지 않는다.

### 5.2 근거가 양방향으로 존재한다 (한쪽만 인용하면 왜곡)

| 분리(2단)에 **유리** | 분리에 **불리** |
|---|---|
| ✅ *"Each subagent also provides **separation of concerns**—distinct tools, prompts, and exploration trajectories—which reduces path dependency and enables thorough, independent investigations."* (Anthropic) | ✅ *"some domains that require all agents to share the same context or involve many dependencies between agents are **not a good fit** for multi-agent systems today"* (Anthropic) |
| ✅ 리드 Opus 4 + 서브 Sonnet 4 가 단일 Opus 4 대비 **+90.2%** (읽기 중심 리서치, 자사 내부 평가) | ✅ 멀티에이전트 **토큰 ~15배**, agent teams **~7배**(*plan mode 조건*) |
| ✅ *"Sequential investigation suffers from **anchoring**: once one theory is explored, subsequent investigation is biased toward it."* / *"With multiple independent investigators actively trying to disprove each other, the theory that survives is much more likely to be the actual root cause."* | ◐ Cognition: *"running multiple agents in collaboration **only results in fragile systems**"* / *"The simplest way to follow the principles is to just use a single-threaded linear agent"* |
| ✅ *"Multi-agent systems work mainly because they help **spend enough tokens** to solve the problem."* | ✅ *"For sequential tasks, same-file edits, or work with many dependencies, a single session **or subagents** are more effective."* / *"Three focused teammates often outperform five scattered ones."* |
| ✅ MAST: ChatDev 에 **CEO 최종결정권 부여 +9.4%**, 상위 목표 검증 단계 추가 **+15.6%** | ✅ MAST: 7개 SOTA 오픈소스 MAS 에서 **41%~86.7% 실패율** |
| ◐ 내부 [[260818-long-horizon-multi-agent-runtime]] §E.5 는 오케스트레이터-전문가가 독립앙상블에 **파레토 지배당함**을 보고 — 단 저자 스스로 검정력 부족을 인정 | |

> ⚠ **결정적 공백**: *"역할이 다른 두 에이전트 분리"* vs *"한 에이전트가 스킬로 두 역할 수행"* 을
> **동일 토큰 예산·동일 과제로 A/B 한 1차 실측은 찾지 못했다.**
> → D1 은 **"실측으로 판정된 사안"이 아니라 "벤더 설계 기준이 양방향으로 존재하는 미결 쟁점"** 이다.

### 5.3 권고 — 역할은 남기고, **의무 릴레이를 없앤다**

> 🔵 **판정: chief 와 pm 은 별도로 유지한다. 대신 `agents/main/chief/SKILL.md` 의
> *"solo founder 가 대화하는 **유일한** agent"* 규칙과 `product-manager` 의 *"너는 사용자와 직접 대화하지 않는다"* 규칙을 폐기한다.**

근거 정합:
- **소유하는 산출물의 종류가 다르다.** chief = skill/agent/workflow/cron/goal + 지식 wiki + 오케스트레이션 문서.
  pm = 문제정의·가설·실험·PRD. 내부 [[260810-bmad-method-skill-lifecycle]] 의 **"한 아티팩트 = 한 오너"** 원칙이 이 분리를 지지한다.
- **비용은 "두 에이전트"가 아니라 "모든 입력이 chief 를 통과한다"에서 나온다.** Anthropic 의 무효 조건
  (*"many dependencies between agents"*)과 Cognition 의 *"conflicting decisions carry bad results"* 가 겨냥하는 것이 정확히 **강제 릴레이**다.
- **작업 성격에 따라 토폴로지를 바꾼다** — 근거가 갈리는 지점이 곧 분기선이다:

| 작업 | 성격 | 토폴로지 | 근거 |
|---|---|---|---|
| 경쟁 가설 반증 · 데스크 리서치 · 후보 스크리닝 | breadth-first · read | **독립 팬아웃**(앵커링 회피) | anchoring 인용 ✅ · Anthropic breadth-first ✅ |
| PRD · 브리프 · 가설 문서 산출 | 순차 · write · 고의존 | **단일 스레드 + 스킬** | *"sequential tasks … a single session or subagents"* ✅ · LangChain *"Read actions are inherently more parallelizable than write actions"* ✅ |
| chief → pm 인계 | 고의존 | **fork**(요약 아님) | fork 인용 ✅ |
| 반복 결정 절차 | 결정론적 | **코드 오케스트레이션** | OpenAI *"orchestrating via code"* ✅ |

### 5.4 chief 의 "메타 에이전트" 구상은 어디까지 가능한가 (D2)

사용자가 원래 의도한 chief = *암묵지를 워크플로로 만들고, 루프 엔지니어링으로 skill/agent/workflow/cron/goal 을 스스로 생성·개선하고, 컨텍스트·프롬프트·지식 wiki 를 관리하는 층.*
**이 역할은 pm 과 다른 것이 맞다. 그러나 "자율 생성"은 아직 제품화 등급이 아니다.**

| 사례 | 보고된 성과 | 실패 모드 | 등급 |
|---|---|---|---|
| **ADAS / Meta Agent Search** | DROP F1 **+13.6/100**, MGSM **+14.4%**, GSM8K **+25.9%**(도메인 내 전이 조건) | 생성 에이전트 오류 시 최대 **5회** self-reflection 재설계 필요. 대상은 **폐쇄형 정답 벤치마크**·2024 모델 | ✅ (HTML 본문) |
| **Darwin Gödel Machine** | SWE-bench **20.0%→50.0%**, Polyglot 14.2%→30.7% | ⚠️ **유닛 테스트를 실행한 척 환각**하고, *"it removed the markers we use in the reward function to detect hallucination"* | ✅ ◐(자사 블로그) |
| **Voyager** | 고유 아이템 3.3×, 기술트리 최대 15.3× | Minecraft + GPT-4(2023). "스킬 축적이 에이전트 추가보다 낫다"는 **비교를 한 적이 없다** | ✅ |
| **Anthropic 공식** | — | 2025-10 시점 서술이 *"we **hope** to enable agents to create, edit, and evaluate Skills on their own"* — **희망사항** | ✅ |
| **skill-creator 플러그인** | *"Isolated runs: spawns a subagent per test case so each run starts with a clean context, and records token count and duration"* | 문서상 역할은 **eval·벤치마크·비교 루프**이지 SKILL.md 자율 생성이 아님 | ✅ |

> 🔵 **판정: chief 의 메타 역할은 "자율 생성"이 아니라 "제안 + eval 루프 + 사람 게이트"로 스코프를 잠근다.**
> DGM 의 objective hacking 은 **관측된** 실패이고, 우리가 만들려는 것은 자기 자신의 평가 기준을 고치는 루프다.
> **자기개선 루프가 자기 평가 기준을 건드릴 수 있으면 그 루프는 결국 그것을 건드린다** — 이 한 줄이 설계 제약이 되어야 한다.
> 반대로 **eval 루프는 이미 제품화돼 있으므로**(skill-creator) 그 층은 지금 만들어도 된다.

---

## 6. 표면 (D4) — 어디로 파고들까

### 6.1 실측

| 사실 | 인용 | 등급 |
|---|---|---|
| 표면은 교체가 아니라 **증설** | *"Claude Code is an agentic coding tool… **Available in your terminal, IDE, desktop app, and browser**."* | ✅ |
| **코어/표면 분리가 정답** | *"**Each surface connects to the same underlying Claude Code engine**, so your CLAUDE.md files, settings, and MCP servers work across all of them."* | ✅ |
| CLI 는 격하되지 않았다 | 2026-08 에도 *"The **full-featured** CLI for working with Claude Code directly in your terminal."* | ✅ |
| 웹은 2025-10-20 추가, **10개월 뒤에도 preview** | *"Claude Code on the web is in **research preview**…"* | ✅ |
| 표면 이동은 **비대칭** | *"session handoff is one-way: you can pull cloud sessions into your terminal with `--teleport`, but **you can't push an existing terminal session to the web**."* | ✅ |
| **비개발자 해법 = 별도 표면** | 데스크탑 앱이 *"three tabs: Chat …, **Cowork** for Dispatch and longer agentic work, and Code for software development"*, Cowork 는 *"runs on web, desktop, and mobile"* (터미널 ⚠ 열거 안 됨) | ✅ |
| 메신저는 **표면이 아니라 세션 생성기** | *"When you mention @Claude with a coding task, Claude … **creates a Claude Code session on the web**"* / *"In Slack: You'll see status updates, completion summaries, and action buttons."* / *"**Web access required**: users need access to Claude Code on the web; without it, Claude replies with standard chat responses."* | ✅ |
| **1인 사용자에겐 메신저가 여전히 정식 경로** | Team/Enterprise 는 Claude Tag 로 이전하지만 *"**Pro and Max plans**: Claude Tag isn't available on individual plans, so **this page remains the setup path**."* | ✅ |

### 6.2 판정과 단계

> 🔵 **표면을 고르는 것이 아니라, 코어를 표면에서 떼는 것이 답이다.** 이는 결정 10(코어↔표면 JSON 계약을
> `[1] 계약` 단계에서 함께 설계)과 **정확히 같은 결론이며, 이제 1차 소스 근거가 붙었다.**

| 단계 | 표면 | 근거 |
|---|---|---|
| **[0] 유지** | **터미널 CLI = full-featured 코어** | 벤더가 웹·앱을 3개 붙이고도 CLI 를 격하하지 않았다 ✅. 우리 개발자 사용자(2트랙 중 딥워크 트랙)의 정식 표면 |
| **[1] 계약** | 코어↔표면 **JSON 경계** | *"the same underlying engine"* ✅ = 결정 10 |
| **[2] 웹 = 읽기 우선** | **후보 깔때기 보드**(무엇이 살아있고 무엇이 왜 죽었는지) | §4.4 의 인지 부담은 시각적 상태판으로 푸는 문제다. 웹을 "실행 표면"으로 만들면 Anthropic 조차 10개월째 preview 인 난이도를 그대로 짊어진다 🔵 |
| **[3] 메신저 = v2.1.0 동반**(결정 16) | **알림 + 승인 게이트 + 세션 생성기**. 풀 표면 아님 | Anthropic 구현이 정확히 이 형태 ✅. 그리고 **1인 플랜에서는 메신저가 폐기 대상이 아니다** ✅ — 결정 16 을 지지 |
| **기각** | 데스크탑 앱 | 벤더조차 비개발자를 위해 **앱을 만든 게 아니라 탭(제품)을 나눴다** ✅. 우리 인력으로 표면 하나를 더 유지할 근거가 없다 🔵 |

> **비개발자(PM/디자이너)에게 CLI 가 치명적인가** — ⚠ **확인 실패.** Anthropic 공식 문서에서 비개발자
> 포지셔닝 선언을 찾지 못했고(키워드 탐색 미완), 확인된 것은 사내 사례 블로그(2025-07-24)의 그로스마케팅·법무팀 사례뿐인데
> **원문 스스로 법무팀 사례를 *"a particularly unique use case"* 라 부른다** ✅. 존재 증명 이상으로 쓰면 안 된다.
> 우리 쪽 근거는 [[260724_경쟁력_사업시장성_v2]] §7 의 **2트랙 관찰**(비개발 기획자=Discord, 개발자=터미널)이 더 강하다 — 단 n 미상.

---

## 7. 수익 모델 (D5)

### 7.1 실측

| 사실 | 인용 | 등급 |
|---|---|---|
| **유통 채널에 결제가 없다** | 플러그인 마켓플레이스 문서 전문(98KB)에 payment/paid/purchase/sell/monetiz/pricing/billing **0건**. *"The official marketplace is curated by Anthropic, and **inclusion is at Anthropic's discretion**."* | ✅ |
| 단 "미문서화 ≠ 금지" | `marketplace.json` 의 metadata 필드 설명이 *"Free-form object for your own fields, such as **entitlement** or catalog data. Claude Code doesn't read it."* | ✅ |
| **채널이 보여주는 유일한 cost = 토큰** | *"A Context cost estimate so you can see how many tokens the plugin will add to your context window every turn"* | ✅ |
| **같은 카테고리의 폐업 사유** | Vibe Kanban/bloop: *"Thousands of software engineers use Vibe Kanban every day … but **the vast majority are free users and we couldn't find a business model** that we could get excited about."* | ✅ |
| seat 과금은 죽지 않았다 | Cursor Teams *"Standard ($40/user/mo) and Premium ($120/user/mo)"* · Claude Code *"On Teams and Enterprise plans, usage draws from each member's seat allowance."* | ✅ |
| 확인된 유일한 공개 매출 | Cursor: *"We've also crossed **$1B in annualized revenue**…"*(2025-11-13, 자기공시·미감사) | ◐ |
| 원가 기준선 | Claude Code: *"the average cost is around **$13 per developer per active day** and **$150-250 per developer per month**"*(엔터프라이즈 자기보고) | ◐ |
| **BYOK 는 로컬 표면에만** | *"The Terminal CLI and VS Code also support third-party providers."* / *"`--cloud` requires an Anthropic account. It's not available when Claude Code is configured for Amazon Bedrock, Google Cloud's Agent Platform, or another third-party provider."* | ✅ |
| OSS + 유료 클라우드의 실제 형태 | OpenHands: *"a full, MIT licensed version … can run locally on your machine with your own LLM key"*, 개인 클라우드 무료·일일 10대화·*"at cost, with no markup"* | ✅ |
| 기획 SaaS 가격 앵커 | Productboard **$19/maker/월**(연간, AI 크레딧 250) · Kiro **$0/$20/$40/$100/$200** per user·월 · Dovetail 은 **유료 단가 비공개**(Free / Custom 뿐) | ✅ |

### 7.2 판정

> 🔵 **팔 수 있는 것은 "스킬"도 "플러그인"도 아니다 — §4.2 의 지속 상태다.**
>
> 논리: ① 채널에 결제가 없다 ✅ ② 무료 사용자만 모으면 죽는다(Vibe Kanban) ✅
> ③ 확인된 성공 구조는 전부 **"OSS/무료 배포 + 별도 유료 백엔드·자산"** ✅
> ④ 우리 차별점(후보 횡단 지속 상태)은 **호스팅 가능한 자산**이고 플러그인이 복제하기 어렵다 🔵
> → **CLI·스킬은 전부 무료 OSS 로 풀고, 값은 "상태를 대신 지켜주는 것"에 매긴다.**

| 층 | 무엇 | 과금 | 근거 |
|---|---|---|---|
| **L0 무료 OSS** | CLI · 에이전트 · 스킬 전부 | $0 · BYOK | 유통이 병목(§3.4-③). BYOK 는 로컬 표면에서만 가능하다는 벤더 제약과도 정합 ✅ |
| **L1 유료 — 지속 상태** | 후보 횡단 깔때기 상태 · 기각 이력 · 반증된 가설 대장 · 24/7 cron · health 알림 | 월 구독 | v2.1.0(클라우드+메신저, 결정 16)이 정확히 이 층을 만든다 |
| **L2 유료 — 회당 과금** | 시뮬레이션 스크리닝 등 고비용 1회성 | 회당 | 이미 지불의사 확인됨(5명·회 $3·월 $8, [[260724_경쟁력_사업시장성_v2]] §9). **단 §8.6 의 표기 제약을 반드시 지킬 것** |
| **L3 (분리)** | 워크샵·교육 | 인당 | 계획서가 이미 *"제품 매출이 아니다"* 로 스스로 구분 — 이 구분을 유지할 것 |

> **가격 앵커 🔵** — 확인된 자가결제 앵커는 Productboard $19/maker·월과 Kiro $20 이고, 우리 사용자 표명치는 **월 $8**.
> ⚠ **솔로 빌더가 기획 도구를 자가결제한다는 증거는 여전히 0건**이다(§13-2). Productboard 는 **호가**이지 거래 데이터가 아니다.
> → L1 가격은 **$8~19/월 사이에서 실측으로 정할 문제**이지, 지금 문서로 정할 문제가 아니다.

---

## 8. 기능 후보 판정 — 사용자가 나열한 것들

| # | 기능 | 판정 | 근거 · 조건 |
|---|---|---|---|
| **F1** | **문제 정의 프레임워크 워크플로** | ⚠️ **차별점 아님 — 기본기로 유지** | `assess`·`forge-idea`·Keel 이 같은 일을 한다 ✅. 우리 31 스킬(mece·xyz-hypothesis·opportunity-tree·premortem…)은 유지하되 **홍보 축에서 내린다**(스킬 수 = 벤더가 비용으로 표기 ✅) |
| **F2** | **후보 횡단 지속 상태 · 기각 대장** | ✅ **GO — 이것이 축이다** | §4.2 의 유일한 확인된 빈틈. 3개 독립 소스가 여기서 멈춘다 ✅ |
| **F3** | **애자일 스프린트 + 실험** | ✅ **GO — 단 "살아남은 후보"에만** | 기각 게이트를 통과한 하나에 실행을 몰아주는 구조여야 §4.3 정본과 충돌하지 않는다 🔵 |
| **F4** | **데이터 수집/측정 + 데이터 기반 의사결정 자율 실행** | 🟡 **조건부 — 판정은 게이트, 실행만 자율** | 자율 판정을 켜면 4개 근거가 동시에 발화: SO 66% *"almost right, but not quite"* ✅ · METR 체감-실측 괴리 ✅ · 시뮬의 세그먼트 2~4배 부풀림 ✅ · DGM objective hacking ✅. **"자율로 돌려서 정한다"(❌) vs "정하기 위해 무엇을 자율로 돌릴지 사람이 정한다"(✅)** |
| **F5** | **디지털 풋프린트 + 데스크 리서치** | 🟡 **유지하되 차별점 아님** | BMAD `deep-recon` 이 6타입(market·competitive·domain·technical·user-voice·academic-lit)을 이미 배포 ✅ |
| **F6** | **온톨로지 LLM wiki** | 🟡 **GO — 단 "제품 기능"이 아니라 "L1 상태의 형식"으로** | 지식그래프 단독으로는 수요 근거가 없다(⚠ D3 미조사). 그러나 F2 의 상태를 담는 그릇으로는 필연적이다. `docs/prd/v2.x-knowledge-ontology.md` 와 F2 를 **하나로 합칠 것** 🔵 |
| **F7** | **가상 시장 수요 검증 시뮬레이션** | 🟡 **GO — 등급 상한 'pilot/exploratory' 표기 의무** | §8.6 |
| **F8** | **브레인스토밍·창의적 발산** | 🔴 **차별점으로 팔지 말 것** | BMAD 가 완결된 `bmad-brainstorming` 스킬(scripts/assets 포함)을 이미 배포 ✅. 게다가 **멀티에이전트 발산은 다양성이 붕괴**하고 ✅, **LLM 아이디어의 novelty 우위는 실행 후 소멸**한다 ✅ |
| **F9** | **기업가정신 발굴 프로세스** | 🟡 **차별화 후보 1순위 — 단 근거 0** | 조사 범위에서 **경쟁 제품이 하나도 없다**(⚠ 부재 추론). Altman *"Agency, willfulness, and determination will likely be extremely valuable"* ◐ 로 어휘는 있으나 **이해관계자 의견**이다. C3(창업가 동기와 생존의 상관, 코칭 효과)는 **1차 근거 확보 실패** — §13 |

### 8.6 F7 의 표기 제약 (자사 연구 + 외부 문헌 합치)

**우리 백테스트**: raw 시뮬 = 反예측, 캘리브레이션 LOO 0.40→0.64 (N=14).
**외부 문헌이 같은 방향을 가리킨다** ✅:
- Chen et al.(2026-07): *"at the individual level no LLM beats even the strongest baseline"*, 세그먼트 격차를 **2~4배 부풀려** *"would direct a team to the wrong segment in half of U.S. … cases"*.
  ⚠ **단 저자의 범위 한정절을 떼면 안 된다** — *"Under demographic prompting and the survey-simulation protocols we test"*. **캘리브레이션 파이프라인은 검증 대상이 아니었다.**
- Bisbee et al.(Political Analysis 2024): 평균은 맞지만 *"there is less variation in responses than in the real surveys, and regression coefficients often differ significantly"*.
- Miklian et al.(개발자 420명): *"none were able to capture the counterintuitive insights that made the human survey valuable"* — **그러나 저자 결론은 폐기가 아니다**: *"an increasingly reliable pre- or post-fieldwork instrument"*.

**반대편도 실재한다** ✅: Maier et al. 의 SSR 은 57개 퍼스널케어 설문·9,300 응답에서 *"90% of human test-retest reliability … (KS similarity > 0.85)"* 를 보고한다(단 저자 다수가 상업적 이해관계자).
Gui & Toubia 는 **40개 실제 제품 수요추정 벤치마크**에서 unblinding 이 *"consistently enhances model performance across all tested models"* 라고 보고한다 — **B5 문헌 중 우리 용도에 가장 가까운 도메인이다.**

> 🔴 **가장 아픈 한 건 — 우리 캘리브레이션 수치에 직격.**
> Cummins: 252개 설정을 만들어 평가하니 기준마다 최적 설정이 달랐고, Argyle Study 3 를 **66개 대안 설정으로 재분석하자
> 인간–실리콘 상관이 r=.23~.84 로 벌어졌다** ✅.
> → **`N=14 · LOO 0.40→0.64` 는 "캘리브레이션이 통했다"의 증거일 수도, "설정을 고른 결과"일 수도 있다.**
> ⚠ 다만 이 논문이 우리 수치를 검증한 것은 아니다. 그리고 **LOO 상관의 임계값이나 N 하한을 제시한 문헌은 없다** —
> "의사결정 등급이 아니다"라는 판정조차 근거가 없으므로, 유일하게 인용 가능한 등급 문장은 Anthis et al. 의
> *"can already be used for **pilot and exploratory studies**"* ✅ 다.
>
> **표기 규약(유료 출시 시 UI·약관에 그대로):** "예측"이 아니라 **"파일럿·탐색 등급의 상대 랭킹/스크리닝"**.
> 카테고리 선두 벤더조차 스스로를 *"a discovery co-pilot, **not a replacement for real research**"* 라고 적는다 ✅.

---

## 9. 창의성 패러다임 (E1) — 팔 수 있는 것과 없는 것

사용자 가설: *"AI 에이전트의 가치가 생산성에서 창의성(차별성, 나만의 것)으로 이동한다."*

**담론은 존재한다. 그러나 1차 실증은 반대 방향을 가리킨다.**

| 방향 | 근거 | 등급 |
|---|---|---|
| **반증 ①** | Noy & Zhang, *Science* 381:6654 — n=453, 시간 **−40%**, 품질 **+18%**, 그리고 ***"Inequality between workers decreased"*** | ✅ |
| **반증 ②** | Doshi & Hauser, *Science Advances* — GenAI 아이디어 접근 시 개인 novelty 는 +5.4%/+8.1% 올랐지만, **스토리들이 서로 더 비슷해졌다**(b=0.871, P<0.001 / b=0.718, P=0.003). 저자들이 이를 **사회적 딜레마**로 규정 | ✅ |
| **반증 ③** | Humlum & Vestergaard, *PNAS* — 채택 자체가 계층화: *"Women are 16 percentage points less likely to have used the tool for work"*, 그리고 사용자는 **도입 전부터 이미 더 벌고 있었다** | ✅ |
| **담론측** | Altman: *"Agency, willfulness, and determination will likely be extremely valuable. **Correctly deciding what to do** …"* — 단 **해당 카테고리를 파는 회사의 CEO 의 의견** | ◐ |
| **담론측 조건절 주의** | Altman: *"experts will probably still be much better than novices, **as long as they embrace the new tools**."* — 잘라 인용하면 뜻이 뒤집힌다. 조건은 taste 가 아니라 **도구 채택**이다 | ✅ |
| **원전 확인** | Paul Graham, *Taste for Makers*(**2002-02**): *"a lot of people will tell you that 'taste is subjective.' … The trouble is, it's not true."* — **AI 담론보다 20년 이상 앞서고, taste 를 해자가 아니라 학습 가능한 판단 기준으로 다룬다** | ✅ |
| **회의론 선례** | a16z(2019): *"Instead of getting stronger, **the data moat erodes as the corpus grows**"* — 'X가 새로운 해자' 수사에 대한 선례 | ✅ |
| **대안 정본** | Andreessen(2007), Rachleff's Law 인용: *"**The only thing that matters is getting to product/market fit.**"* | ✅ |

### 9.1 팔 수 있는 것 — 두 가지뿐

> ✅ **① 경계 판단(frontier judgment).** Dell'Acqua et al., *Organization Science*(2026-03-11), BCG 지식노동자 758명 사전등록:
> 프런티어 **안**에서는 *"completing 12.2% more tasks and completing them 25.1% more quickly"*,
> 프런티어 **밖**의 복합 관리 과제에서는 ***"subjects using AI were 19% less likely to produce correct solutions"***.
> → **"이 과제에 AI 를 쓰면 안 된다"를 아는 것이 19%p 급 결과 차이를 만든다.** 이것은 측정 가능한 결과로 환금된다.
>
> ✅ **② 저품질 구간 상향.** Doshi & Hauser 에서 효과는 **저창의성(low-DAT) 작가에게서 가장 컸다.**
> → 팔 대상은 "이미 잘하는 사람을 더 특별하게"가 아니라 **"처음 하는 사람을 평균 위로"** 다.

> 🔴 **팔 수 없는 것: "차별성".** 모두가 같은 도구를 쓰면 산출물이 서로 수렴한다(반증 ②).
> **"AI 로 나만의 것을 만든다"는 문장은 그 도구가 널리 쓰일수록 스스로 거짓이 된다.**
> 이 모순은 마케팅 수정으로 해소되지 않는다 — **명제 자체를 바꿔야 한다.**
>
> **주의 🔵** — ①은 §8-F4 와 충돌한다. "경계 판단을 판다"면서 "자율 실행"을 같이 팔 수 없다.
> 경계 판단의 주체가 사람이라는 것이 ①의 내용이기 때문이다.

---

## 10. 포지셔닝 제안

### 10.1 후보 3안

| 안 | 문장 | 통과 | 걸리는 근거 |
|---|---|---|---|
| **①** 문제정의·기각 게이트 | *"만들지 않을 것을 정해주는 AI 기획 팀"* | 어휘 정합 ✅ | **`assess` 가 같은 문장을 이미 쓴다** ✅. 차별점이 "우리도 있다"로 축소됨 |
| **②** 후보 깔때기 운영 | *"여러 제품 후보를 가로지르며 대부분을 문서화된 이유와 함께 기각하고, 살아남은 하나에 실행을 몰아주는 0to1 운영 시스템"* | **모든 모순 통과** | 누가 돈 내는지 근거 0 (§13-2) |
| **③** 빌더 판단체계 자산화 | *"당신의 판단 기준·기각 이력·비전을 자산으로 쌓는 창업 OS"* | 경쟁 0(⚠) | **수요 근거 0.** F9 와 함께 근거 공백 |

### 10.2 권고 — ② 를 척추로, ③ 을 해자층으로, ① 을 기구로

> ## 🔵 한 문장
> ### **"제품 후보를 여러 개 가지고 다니는 1인 빌더를 위해, 무엇을 왜 죽였는지가 남는 유일한 작업대."**
>
> - **주어(타깃)**: 1인 빌더 · 여러 후보를 가진 상태 — [[260724_경쟁력_사업시장성_v2]] §9 의 파워유저 40% 가 유일한 실측 신호
> - **동사(가치)**: *남는다(persist)* — §4.2 의 확인된 빈틈, §7 의 과금 대상, §3.4-② 의 미점유 축이 **전부 이 단어에 모인다**
> - **뺀 것**: "병목"(§2.3) · "차별성/창의성"(§9) · "자율 판정"(§8-F4) · "멀티에이전트 발산"(§8-F8) · "스킬 N개"(§1)

**포지셔닝 문장 안에서의 역할 분담**
```
③ 판단체계·기업가정신   ← 해자층 (복제 어려움 · 근거 0 · 실측 필요)
──────────────────────────────
② 후보 깔때기 지속 상태  ← 척추 (유일한 확인된 빈틈 · 과금 대상)
──────────────────────────────
① 기각 게이트 · 프레임워크 ← 기구 (기본기 · 차별점 아님 · 무료 OSS)
```

> **[[260724_경쟁력_사업시장성_v2]] §2 의 "Anthropic 은 don't-build 를 팔 수 없다"는 여전히 유효하고, 이제 실증이 붙었다** ✅ —
> 공식 마켓플레이스 286개 중 기획 키워드 8종이 **전부 0건**이다. 다만 그 논거의 **적용 범위를 좁혀야 한다**:
> Anthropic 은 안 팔지만 **GitHub 는 자기 리포에 `assess` 를 넣어뒀다.** 인센티브 비대칭은 **파운데이션 모델 제공자에게만** 성립한다.

---

## 11. 모순 검수 체크리스트 — 포지셔닝 문장에 **같이 넣으면 안 되는 쌍**

> 초안을 쓸 때마다 이 표로 검수할 것. 사용자가 경고한 *"데이터 분석 실행 전략인데 만들지 않을 것을 정한다"* 류의 모순을 잡는다.

| 넣으면 안 되는 쌍 | 발화하는 반대 근거 | 대체 프레이밍 |
|---|---|---|
| 자율 실행 + 기각 판정 | SO 66% · METR 체감괴리 · 시뮬 세그먼트 오도 · DGM objective hacking | **판정은 게이트, 실행만 자율** |
| 멀티에이전트 발산 + 문서 산출 특화 | 다양성 붕괴 · write 병렬화 난제 · 15배/7배 원가 | **단계별 혼합**(read=팬아웃 / write=단일+스킬) |
| 멀티 프로덕트 동시 운영 + 집중 규율 | Altman · PG · assess funnel | **깔때기의 폭** |
| 차별성 + AI 기획 | Doshi & Hauser 수렴 · Noy & Zhang 격차 감소 · Humlum 채택 계층화 | **경계 판단** 또는 **저품질 구간 상향** |
| 0to1 기획 차별점 + 플러그인 유통 | BMAD 동일 채널 28스킬 · 157개 확장 · 결제 경로 부재 · Vibe Kanban 폐업 | **무료 OSS 유통 + 유료 상태 백엔드** |
| 31 스킬 = 자산 | 스킬 목록 예산 1% · *"still add startup and context cost"* | **빈도 상위 소수 + 나머지 지연 로드** |
| 시뮬레이션 = 수요 예측 | 자사 백테스트 · Chen · Bisbee · Cummins | **파일럿 등급 랭킹/스크리닝** |
| chief 가 유일한 user-facing + 토큰 효율 | 릴레이 비용 · fork 대안 · *"many dependencies"* | **소유권은 분리, 릴레이는 폐지** |

---

## 12. 단계별 제안 (v2.0 계보에 얹기)

> 결정 1~17 을 바꾸지 않는다. **범위를 재해석할 뿐이다.**

| 슬롯 | 기존 성격 | 이 문서가 더하는 것 |
|---|---|---|
| **v2.0.0** `[0]골격`~`[3]` | 오케스트레이션·하네스 재설계 | **① `[1] 계약` 에 "후보(candidate) 엔티티"를 1급으로 넣을 것** — 지금 안 넣으면 나중에 repo/org 위에 덧붙이게 된다. ② chief↔pm 경계를 **fork 계약**으로 규정. ③ *"chief 가 유일한 user-facing"* 규칙 폐기를 SKILL.md 수준에서 반영 |
| **v2.1.0** 클라우드+메신저(결정 16) | 배포 + 메신저 복귀 + health 알림 | **이 릴리스가 L1 과금층이다.** 메신저는 **풀 표면이 아니라 알림·승인·세션 생성기**로 스코프 잠금 ✅ |
| **v2.x** knowledge-ontology | 지식 온톨로지 | **F2(후보 횡단 상태)와 병합.** 온톨로지를 독립 기능으로 팔 근거가 없다 |
| **v2.4.0** 시뮬레이션 | 스크리닝 특징 + 진단 플래그 | 이미 스코프가 잠겨 있다. **§8.6 의 Cummins 경고를 PRD §5 Open Questions 에 추가**할 것 |
| **신규 후보** | — | **웹 읽기 표면 = 후보 깔때기 보드**(§6.2 [2]) |

### 12.1 다음 행동 3개 (근거 채우기 — 코드보다 먼저)

1. **파워유저 6명 인터뷰**(§4.3). 질문은 하나다 — *"여러 제품을 동시에 미는가, 아니면 후보를 재는가?"*
   답에 따라 §10 의 척추가 유지되거나 무너진다.
2. **MicroConf State of Independent SaaS 2020·2021·2022년판**(Dropbox 공개 PDF, 2024년판은 이메일 게이트) —
   §13-1 의 솔로 빌더 근거 공백을 메울 유일하게 확보된 경로 ✅.
3. **`assess` · Keel 을 실제로 설치해 돌려볼 것.** 우리 `prd`·`hypothesis-design`·`opportunity-tree` 스킬과
   산출물을 나란히 놓고 비교하면 §3.4 의 3축(강제성·지속성·유통) 중 무엇이 진짜 빈틈인지 확정된다.

---

## 13. 아직 근거가 없는 것 (정직한 공백)

> **전제:** 아래는 전부 **"이번 조사 방식으로 도달하지 못함"**이다. 2라운드 6개 세션 전부 WebSearch 예산 0 소진.

| # | 없는 것 | 왜 치명적인가 |
|---|---|---|
| **1** | **솔로/인디 빌더의 수요·실패·지불 1차 데이터** | 타깃 층 전체가 근거 공백. A1/A2(대기업 PM·VC 창업가)를 전이해 메우면 안 됨 |
| **2** | **솔로 빌더가 기획 도구를 자가결제한다는 증거** | 확정된 것은 Productboard **호가** 1건뿐. §7 의 L1 가격을 정할 수 없다 |
| **3** | **"역할 2개 = 별도 에이전트" vs "1 에이전트 + 스킬 2역할" 의 동일 예산 A/B** | D1 전체가 정황 조합. **"실측 판정"으로 쓰면 허위** |
| **4** | **`taste is the new moat` 의 1차 출처** | E1 핵심 명제 자체가 출처 불명 |
| **5** | **기업가정신(F9)의 실증** — 동기/미션과 생존의 상관, 액셀러레이터 코칭 효과 | **차별화 후보 1순위인데 근거가 0이다** |
| **6** | **LOO 상관의 문헌상 등급 기준** | 우리 `N=14 · 0.64` 를 "파일럿 등급"이라 부르는 것조차 근거 없음(유추) |
| **7** | 온톨로지/지식그래프(D3)의 실측 성능·구축 비용 | F6 을 독립 기능으로 정당화할 수 없다 |
| **8** | Conductor `project` 의 격리 대상, Devin Knowledge 스코프, Hezo 트랙션·과금 | §4.1 표의 3칸이 미확정 |
| **9** | Kiro GA 선언 여부, Devin 공식 가격·ACU, Continue/Factory BYOK 조건 | §7 비교의 결측 |

### 13.1 인용 위생 (문서화·재사용 시 지킬 것)

1. **합성 인용**(원문에서 떨어진 위치를 이어붙인 것)은 **생략표시 유지 + 출처 위치 분리 표기**.
   해당: BMAD 워크플로 맵 3조각 · Hezo Coach · Vibe Kanban 종료문 · Orca README · Anthropic 무효조건 · PG 13sentences.
2. **표 셀 값을 산문처럼 인용하지 말 것**: progressive disclosure 표 · Claude Code memory scope 표 · Jules 한도 표 · Cursor 가격 표.
3. **벤더 자기서술에는 "자사 문서 기준"을 병기**: Hezo · Synthetic Users · Evidenza · Tessl · Devin 태그라인.
4. **날짜 3중 표기**: Octoverse(2025-10-28 발행 / 2026-02-28 갱신 / 2026-08-21 조회).
5. **프리프린트는 최초 공개일 + 개정일 병기**: Padmakumar & He(2023-09-11/2024-07-01) · Yakura(2024-09-03) · Wang(2024-02-02) · Dominguez-Olmedo(2023-06-13) · Miklian(2026-02-10/2026-08-05) · ADAS(2024-08-15/2025-03-02) · MAST(2025-03-17/2025-10-26).
6. **arXiv 는 `abs` 가 아니라 HTML 본문 URL**: MAST(`arxiv.org/html/2503.13657v3`) · ADAS(`arxiv.org/html/2408.08435v2`).
7. **스타·마켓플레이스 수치는 측정일 병기** — 전부 2026-08-21 측정, 일 단위 변동.

---

## 14. 출처

### 14.1 1차 — 공식 문서·리포지토리
- Claude Code: [overview](https://code.claude.com/docs/en/overview) · [sub-agents](https://code.claude.com/docs/en/sub-agents) · [agent-teams](https://code.claude.com/docs/en/agent-teams) · [skills](https://code.claude.com/docs/en/skills) · [memory](https://code.claude.com/docs/en/memory) · [costs](https://code.claude.com/docs/en/costs) · [features-overview](https://code.claude.com/docs/en/features-overview) · [cli-reference](https://code.claude.com/docs/en/cli-reference.md) · [claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web) · [desktop](https://code.claude.com/docs/en/desktop) · [slack](https://code.claude.com/docs/en/slack) · [plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) · [discover-plugins](https://code.claude.com/docs/en/discover-plugins)
- Anthropic: [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) · [공식 마켓플레이스 marketplace.json](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json) · [Cowork](https://claude.com/product/cowork)
- GitHub Spec Kit: [README](https://raw.githubusercontent.com/github/spec-kit/main/README.md) · [extensions/assess/README](https://raw.githubusercontent.com/github/spec-kit/main/extensions/assess/README.md) · [catalog.json](https://raw.githubusercontent.com/github/spec-kit/main/extensions/catalog.json) · [catalog.community.json](https://raw.githubusercontent.com/github/spec-kit/main/extensions/catalog.community.json) · [templates/commands/specify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/specify.md)
- BMAD-METHOD: [workflow-map](https://docs.bmad-method.org/reference/workflow-map/) · [marketplace.json](https://raw.githubusercontent.com/bmad-code-org/BMAD-METHOD/main/.claude-plugin/marketplace.json) · [forge-idea SKILL.md](https://raw.githubusercontent.com/bmad-code-org/BMAD-METHOD/main/src/core-skills/bmad-forge-idea/SKILL.md) · [deep-recon](https://raw.githubusercontent.com/bmad-code-org/BMAD-METHOD/main/src/core-skills/bmad-deep-recon/SKILL.md)
- 기타 프레임워크: [Keel Discovery](https://raw.githubusercontent.com/keeldiscovery/spec-kit-keel/main/README.md) · [OpenSpec explore](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/docs/explore.md) · [Agent OS](https://raw.githubusercontent.com/buildermethods/agent-os/main/README.md) · [Kiro specs](https://kiro.dev/docs/specs/) · [Kiro pricing](https://kiro.dev/pricing/) · [Tessl](https://tessl.io/) · [Amazon Q Developer](https://aws.amazon.com/q/developer/)
- 멀티세션·에이전트 매니저: [Hezo llms.txt](https://hezo.ai/llms.txt) · [Hezo projects-and-teams](https://hezo.ai/docs/concepts/projects-and-teams) · [Hezo coach](https://hezo.ai/docs/concepts/coach-and-self-improving-teams) · [Conductor docs](https://docs.conductor.build/) · [Cursor cloud-agent](https://cursor.com/docs/cloud-agent.md) · [Copilot coding agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) · [Devin llms.txt](https://docs.devin.ai/llms.txt) · [Orca README](https://raw.githubusercontent.com/stablyai/orca/main/README.md) · [Factory llms.txt](https://docs.factory.ai/llms.txt) · [OpenHands llms.txt](https://docs.openhands.dev/llms.txt) · [Jules](https://jules.google/docs) · [Codex CLI](https://raw.githubusercontent.com/openai/codex/main/README.md)
- 종료 공지: [Vibe Kanban shutdown](https://www.vibekanban.com/blog/shutdown) · [Terragon](https://www.terragonlabs.com/) · [Crystal→Nimbalyst](https://raw.githubusercontent.com/stravu/crystal/main/README.md) · [Modulus Show HN](https://news.ycombinator.com/item?id=47327351)
- 가격: [Cursor pricing](https://cursor.com/docs/account/pricing) · [Replit](https://replit.com/pricing) · [Factory](https://www.factory.ai/pricing) · [OpenHands](https://www.openhands.dev/pricing) · [Productboard](https://www.productboard.com/pricing/) · [Dovetail](https://dovetail.com/pricing/)

### 14.2 1차 — 엔지니어링 블로그·리포트
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (2025-06-13)
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09-29)
- [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) (2025-10-16)
- [Cognition — Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents) (2025-06-12)
- [LangChain — How and when to build multi-agent systems](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems) (2025-06-16)
- [OpenAI Agents SDK — handoffs](https://openai.github.io/openai-agents-python/handoffs/) · [multi_agent](https://openai.github.io/openai-agents-python/multi_agent/)
- [Amplitude acquires Kraftful](https://amplitude.com/blog/amplitude-acquires-kraftful) (2025-07-10) · [Kraftful 공지](https://www.kraftful.com/blogs/joining-amplitude)
- [Cursor Series D — $1B ARR](https://cursor.com/blog/series-d) (2025-11-13)
- [Claude Code on the web](https://claude.com/blog/claude-code-on-the-web) (2025-10-20) · [How Anthropic teams use Claude Code](https://claude.com/blog/how-anthropic-teams-use-claude-code) (2025-07-24)
- [Sakana — Darwin Gödel Machine](https://sakana.ai/dgm/) (2025-05-30)

### 14.3 설문·실증
- [Lenny's Newsletter + Noam Segal — AI tools are overdelivering](https://www.lennysnewsletter.com/p/ai-tools-are-overdelivering-results) (2025-12-23, n=1,750)
- [Stack Overflow Developer Survey 2025 — AI](https://survey.stackoverflow.co/2025/ai) · [방법론](https://survey.stackoverflow.co/2025/methodology) (n=49,009)
- [METR — Early 2025 AI experienced OS dev study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) (2025-07-10, n=16)
- [DORA 2025 발표](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report) (2025-09-24, n≈5,000)
- [GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)
- [CB Insights — Top reasons startups fail](https://www.cbinsights.com/research/startup-failure-reasons-top/) (2026-03-05, n=431)

### 14.4 학술
- 멀티에이전트: [MAST — Why do multi-agent LLM systems fail?](https://arxiv.org/html/2503.13657v3) · [Diversity Collapse in Multi-Agent LLM Systems](https://arxiv.org/abs/2604.18005) (ACL 2026 Findings)
- 아이디에이션: [The Ideation-Execution Gap](https://arxiv.org/abs/2506.20803) · [선행 연구](https://arxiv.org/abs/2409.04109)
- 메타 에이전트: [ADAS](https://arxiv.org/html/2408.08435v2) · [Voyager](https://arxiv.org/abs/2305.16291)
- 합성 사용자: [Argyle — Out of One, Many](https://arxiv.org/abs/2209.06899) · [Park et al.](https://arxiv.org/abs/2411.10109) · [Bisbee — Synthetic Replacements for Human Survey Data](https://www.cambridge.org/core/journals/political-analysis/article/synthetic-replacements-for-human-survey-data-the-perils-of-large-language-models/B92267DC26195C7F36E63EA04A47D2FE) · [Dominguez-Olmedo](https://arxiv.org/abs/2306.07951) · [Wang et al.](https://arxiv.org/abs/2402.01908) · [Gui & Toubia](https://arxiv.org/abs/2312.15524) · [Cummins — analytic flexibility](https://arxiv.org/abs/2509.13397) · [Chen et al.](https://arxiv.org/abs/2607.26348) · [Miklian et al.](https://arxiv.org/abs/2603.00059) · [Choi et al.](https://arxiv.org/abs/2606.28963) · [Maier — SSR](https://arxiv.org/abs/2510.08338) · [Heath & Alexander](https://arxiv.org/abs/2607.28550) · [Anthis et al.](https://arxiv.org/abs/2504.02234)
- 창의성·생산성: [Doshi & Hauser](https://pmc.ncbi.nlm.nih.gov/articles/PMC11244532/) · [Noy & Zhang](https://api.openalex.org/works/doi:10.1126/science.adh2586) · [Humlum & Vestergaard](https://api.openalex.org/works/doi:10.1073/pnas.2414972121) · [Dell'Acqua — Jagged Frontier](https://pubsonline.informs.org/doi/10.1287/orsc.2025.21838) · [Padmakumar & He](https://arxiv.org/abs/2309.05196) · [Yakura et al.](https://arxiv.org/abs/2409.01754)

### 14.5 에세이·담론 (의견 — 실증 아님)
[PG — Taste for Makers](https://paulgraham.com/taste.html) (2002-02) · [PG — How to Do Great Work](https://paulgraham.com/greatwork.html) (2023-07) · [PG — Startups in 13 Sentences](https://www.paulgraham.com/13sentences.html) (2009-02) · [PG — How to Get Startup Ideas](https://paulgraham.com/startupideas.html) (2012-11) · [Altman — Startup Playbook](https://playbook.samaltman.com/) · [Altman — Three Observations](https://blog.samaltman.com/three-observations) · [Altman — The Gentle Singularity](https://blog.samaltman.com/the-gentle-singularity) · [a16z — The Empty Promise of Data Moats](https://a16z.com/the-empty-promise-of-data-moats/) (2019-05-09) · [Andreessen — The only thing that matters](https://pmarchive.com/guide_to_startups_part4.html) (2007-06-25)

### 14.6 내부 문서
[[260803-solosquad-architecture-redesign]] §0.0(결정 1~17) · [[260724_경쟁력_사업시장성_v2]] · [[260818-long-horizon-multi-agent-runtime]](§D.1 요약 손실 · §D.4 컴팩션 정책 · §E.5 조율 비용) · [[260818-agent-distribution-channels]](§K 채널 비교 · §L.1 배포 권고) · [[260810-bmad-method-skill-lifecycle]](한 아티팩트=한 오너) · [[260810-pm-skills-marketplace]] · [[260625-ai-planning-insights]] · `docs/prd/v2.0.0_orchestration-and-harness-platform.md` · `docs/prd/v2.5.0_virtual-market-demand-simulation.md` · `docs/research/virtual-market-demand-simulation/final-result.md`
