# SoloSquad 스쿼드 조직 재구성 — 팀·에이전트·스킬 네이밍/구성 (2026-06-23)

> **상태:** ✅ **구현 완료 (2026-06-23).** 19 agents(5 main + 14 specialist) · 30 skills(6 category) ·
> 5 teams. 검증: `agent validate --all/--graph` 0 fail · `workflow validate --all` 13/13 · **npm test 959/959**.
> 구 설계/매핑 기록은 본문 유지(historical).
>
> **목적.** agent 25개·skill 28개의 **팀 구조·네이밍·역할 경계**를 재정렬한다. 근거 = `260618-agent-
> authoring-best-practices.md`(SRP·역할중첩·specialist>generalist, Part C·G). v1.3.6(작성법 내재화)와
> **별개 축**(조직 재설계)이라 별도 문서로 둔다.
>
> **분류:** major(번들 actor 대량 개명·통합·이동). 사용자 actor(org 레이어)는 영향 없음.

---

## 0. 조사 근거 (3건, 2026-06-23)

1. **`triage` = 업계 표준 용어.** OpenAI Agents SDK 의 canonical 패턴이 "triage agent"(라우팅/분류 액터).
   → SoloSquad `triage`(Chief 4-way 분류) 이름 **유지**.
2. **skill 디렉토리 카테고리 그루핑 = 하지 않음(flat 유지).** 공개 스펙·Anthropic skills·Hermes·Claude Code
   디스커버리 모두 **flat `skills/<name>/`**, 카테고리는 **`category` frontmatter**로 표현. 중첩 폴더는
   SoloSquad ID 해소(`skills/<id>/SKILL.md`)·flat 디스커버리 관례를 깸. → **폴더 flat + `category` 필드 그룹핑**,
   `solosquad skill list`가 category별 출력(표시 레벨).
3. **`skills_used` = advisory(런타임 제한 아님).** 코드상 검증·표시·문서용일 뿐, spawn 시 주입/제한 안 함.
   실제 skill 발동 = Claude Code description 매칭(점진공개) — 선언 밖 skill도 사용 가능. → **자율성 제한 없음.**
   **권장:** `skills_used`를 **prefetch floor**(선언분 항상 주입)로 승격하되 **ceiling(화이트리스트)으로는 금지**
   → 보장 + 자유 양립. "꼭 쓸 skill 못 씀"은 `skills_used`가 아니라 **description 품질** 문제(→ v1.3.6 §3.2 eval).

---

## 1. 팀 재구성

| before | after | 비고 |
|---|---|---|
| chief | **core** | 시스템/오케스트레이션 |
| product | product | 유지 |
| engineering | engineering | 유지 |
| marketing | **business** | 전략·수익·시장 진입 |
| design | **brand** | 브랜드·비주얼·콘텐츠 |

## 2. 에이전트 재구성 (5 main + 14 specialist = 19, was 25)

### 2.1 최종 조직

| 팀 | leader (main) | specialists |
|---|---|---|
| **core** | `chief` | — |
| **product** | `product-manager` ⬅`pm` (+`pmf-planner` 흡수) | `data-analyst` · `product-designer`🆕 · `researcher`(+`ux-designer` 흡수) |
| **engineering** | `engineer` | `system-architect`⬅architect · `backend`⬅backend-engineer · `frontend`⬅creative-frontend · `data-engineer`(유지·analyst 구분) · `infra`⬅cloud-admin · `qa`⬅qa-engineer · `security`⬅security-engineer |
| **business** | `business-strategy`🆙 ⬅business-strategist(승격) | `go-to-market`⬅gtm-strategist · `sales`🆕 |
| **brand** | `marketer` (brand 총괄 + 콘텐츠+퍼포먼스, `performance-marketer` 흡수) | `creative-designer`⬅graphic-designer🆕 · `communication`⬅brand-marketer |

### 2.2 변경 내역

**개명(rename):**
- `pm` → `product-manager` · `architect` → `system-architect` · `cloud-admin` → `infra` ·
  `creative-frontend` → `frontend` · `backend-engineer` → `backend` · `qa-engineer` → `qa` ·
  `security-engineer` → `security` · `gtm-strategist` → `go-to-market` · `business-strategist` → `business-strategy` ·
  `graphic-designer`(신규였음) → `creative-designer` · `brand-marketer` → `communication`.
- **`data-engineer` 는 suffix 유지** — `data-analyst`(product)와 구분.

**승격/강등/해소:**
- `business-strategist` → `business-strategy`, **main 격상**(business 팀 leader).
- `marketer`(구 marketing main) → **main 유지·brand 팀 leader 로 이동**. `performance-marketer` 흡수 →
  콘텐츠+퍼포먼스 마케팅 + 브랜드 총괄.
- `designer`(구 design main) → **해소(dissolved)**(2026-06-23). 디자인 총괄을 분산: 제품디자인 →
  `product-designer`(product), 비주얼 → `creative-designer`(brand). 별도 디자인 supervisor 두지 않음.

**이동(team move):**
- `business-strategist`: product → business · `marketer`: marketing → brand ·
  `brand-marketer`(→communication): marketing → brand · `researcher`: design → product.

**통합(merge) — 역할 흡수 후 소멸:**
- `pmf-planner` → `product-manager`(PMF 가설·검증을 PM 역할에).
- `feature-planner` + `policy-architect` + `idea-scoper` + `ui-designer` → **`product-designer`🆕**
  (기획+UI+정책+발산/수렴 통합). 디자인시스템·정책은 **skill 로 분리**(§3, governance).
- `ux-designer` → `researcher`(user flow·wireframe·interaction 흡수).
- `performance-marketer` → `marketer`.

**제거:**
- `fde` — 효용 분석(§5) 결과 제거. end-to-end/통합/프로토타입은 `engineer`(main) 오케스트레이션으로 흡수.

**신규(new):**
- `product-designer`(product) · `sales`(business) · `creative-designer`(brand).

## 3. 스킬 재구성

### 3.1 카테고리 재편 (폴더 flat, `category` 필드)

| category | 의미 | skills |
|---|---|---|
| **core** | SoloSquad **플랫폼/시스템 관리**(오케스트레이션 아님) | `agent-manager`·`skill-manager`·`workflow-manager`·`goal-manager`·`cron-manager` · `triage` · `primitive-review`⬅asset-review |
| **agile** | 애자일/스프린트 cadence | `okr`⬅okr-writer · `retrospective` · `skill-refinement` · `workflow-refinement` |
| **discovery** | | `discovery-synthesis` · `interview-script`⬅interview-script-author · `market-research` |
| **problem-definition** | | `five-whys` · `mece` · `scqa` · `tdcc` · `xyz-hypothesis` |
| **planning** | | `prd`⬅prd-writer · `wbs`⬅wbs-decomposition · `experiment-design` · `hypothesis-design` · `jobs-stories` · `lean-canvas` · `opportunity-tree` · `premortem` · `prioritization` |
| **governance** 🆕 | 거버넌스(디자인시스템·정책) | `design-system`🆕 · `policy`🆕(⬅service-policy 개념) |

### 3.2 스킬 개명
`okr-writer`→`okr` · `prd-writer`→`prd` · `interview-script-author`→`interview-script` ·
`wbs-decomposition`→`wbs` · `asset-review`→`primitive-review`.

### 3.3 신규 스킬
- **`design-system`** (governance) — 디자인 토큰·컴포넌트·일관성 규칙. `product-designer`·`creative-designer`·`frontend` 활용.
- **`policy`** (governance) — 서비스 정책·약관·규제·Hard Gate. `product-designer`·`product-manager` 활용.

### 3.4 매핑 자유도 (조사 ③ 반영)
`skills_used` = **prefetch floor**(선언 skill 보장 주입) + Claude Code 디스커버리로 **그 외도 자유 사용**.
화이트리스트(ceiling) 아님. 누락 skill 미사용 방지는 description 품질(v1.3.6 §3.2 eval).

## 4. 팀 OKR 재작성 (초안 — `teams/<team>/OKR.md`)

> `okr` 스킬(Chief 의사결정)로 갱신. 아래는 새 팀 구조에 맞춘 1차 초안.

- **core** — O: 사용자 의도를 정확히 과제화하고 스쿼드를 오케스트레이션한다.
  KR: triage 분류 정확도 · 위임 그래프 무결성(순환 0) · 회고 반영률.
- **product** — O: 검증된 문제·기능 정의로 "올바른 것"을 만들게 한다.
  KR: PMF 가설 검증 수 · PRD→ship 전환율 · 메트릭 기반 의사결정 비율.
- **engineering** — O: 안정적이고 빠르게 출하한다.
  KR: ship velocity · 품질 게이트 통과율 · 인시던트/회귀 수.
- **business** — O: 수익화 경로와 시장 진입을 검증한다.
  KR: GTM 채널 검증 수 · 전환/매출 · 가격·수익화 가설 검증.
- **brand** — O: 일관된 브랜드·콘텐츠로 도달·인지를 만든다.
  KR: 브랜드 자산 일관성(design-system 커버리지) · 콘텐츠/캠페인 성과 · 메시징 일관성.

## 5. Chief 팀간 협업·시너지 맵

```
                         core (chief) — 오케스트레이션·과제화·회고
                              │ (DECOMPOSE→DISPATCH→SYNTHESIZE)
        ┌──────────────┬──────┴───────┬───────────────┐
     product ───────► engineering    business ───────► brand
        │ PRD/design     ▲ build        │ GTM/수익        │ 캠페인/콘텐츠
        │ doc            │              │                │
        └─ PMF·메트릭 ◄──┘              └─ 시장신호 ──► product (우선순위)
        product ─ feature → brand (메시징) ; engineering(frontend) ◄ design-system ─ brand(creative-designer)
```

- **product ↔ engineering:** PRD/design doc 핸드오프(정의→구현), 메트릭 피드백 역류.
- **product ↔ business:** PMF ↔ 수익화/시장. business 시장신호가 product 우선순위에 반영.
- **product ↔ brand:** feature → 메시징/콘텐츠. policy(governance) 공동 활용.
- **business ↔ brand:** GTM ↔ 브랜드/캠페인 정합.
- **engineering(frontend) ↔ brand(creative-designer):** `design-system`(governance) 단일 진실원 공유.
- **core(chief):** 모든 팀 위 supervisor — 위임 그래프 무결성·역할중첩 게이트(G1/G2) 적용.

## 6. 미결 / 결정 필요

1. ~~brand 팀 leader 네이밍 충돌~~ → ✅ **해결(2026-06-23): `marketer`가 brand main, `designer` 해소.**
2. **`data-engineer`(eng) vs `data-analyst`(product)** — 이름 근접하나 도메인 다름 → 유지(확정).
3. **governance 신규 skill 2종의 작성** — design-system·policy 본문(§3.3) 실제 작성은 구현 단계.

> **전 항목 확정 — 구현 진행 승인됨(2026-06-23).** 마이그레이션은 §7.

## 7. 마이그레이션 영향 (구현 시)

- 폴더 rename/move·`name`·`team` 갱신 + 전 actor 의 `collaborators`/`used_by`/`skills_used`/`triggers`
  상호참조 일괄 수정(특히 제거된 `fde`, 통합된 5개 참조 정리).
- `teams/<team>/OKR.md` 5팀으로 재작성(§4) — 구 marketing/design 경로 이전.
- skill 개명 5건 → 참조하는 agent `skills_used` + `triggers` 동기화.
- `agent validate --graph`(또는 `solosquad validate`)로 참조 무결성·순환·역할중첩 재검(G1/G2).
- 번들 불변 원칙 하 사용자 org actor 영향 없음 확인.
