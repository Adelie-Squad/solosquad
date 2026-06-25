---
name: prd
description: PRD 작성 (phuryn template + gstack design doc 컨벤션). 8-section 1-pager + v1.3.5 메인별 2 양식(new-build/improvement) 분기 + 요구사항 3대 유형(개발·콘텐츠·리포트) 렌더 + 섹션 누적 기입 + v1.3.8 작성 8규칙(R1–R5 맥락·오버스펙 축 — 버전계층 목표상속·스코프 비포함경계·지시 요구사항 전사·As-Is/To-Be 개념+형태·체크리스트 워크플로 리뷰 / R6–R8 확률성·검증 축 — AI 제품 PRD 분기[허용 답변 범위·Eval Plan]·완성도 단계 척도·Given-When-Then AC). 프레임워크 체인·서브워크플로 출력을 입력으로 받아 PRD 생성.
schema_version: 2
tier: leader
team: _skill
category: planning
used_by: ["product-manager", "chief"]
dev_capability: false
triggers:
  keyword:
    - "prd"
    - "요구사항 문서"
    - "design doc"
    - "기획서"
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: false
  minimum_approaches: 2
---

# PRD Writer Skill

## 8 Section (phuryn `create-prd` template 차용)

```markdown
# [Title]

## 1. Summary
1-2 문단. 무엇을 만들고 왜.

## 2. Background
- 사용자 needs (JTBD 인용)
- 시장 상황
- 기존 시도와 한계

## 3. Objective
team OKR 의 어떤 KR 과 정합하는가. 명시.

## 4. Target Segments
- 주 segment + 정의
- non-target (명시적으로 제외)

## 5. Value Proposition
1-line value statement + 사용자 가치 구조.

## 6. Solution
- ≥ 2 approaches 비교 (gstack rule)
- Recommended + rationale + falsification
- V/U/V/F assumption 분류
- Hard gate 조건

## 7. Release Plan
wbs 출력 inject:
- Milestone 1: ...
- Milestone 2: ...
- 의존성 graph

## 8. Metrics & Verification
- Success threshold (formula + window)
- Leading indicator (실험 진행 중 관찰)
- Lagging indicator (사후 평가)
- (AI 제품 한정 — R6) AI 부록: 허용 답변 범위 · Eval Plan(회귀셋) · 실패 정의+가드레일 · 3단계 평가 피라미드
```

## v1.3.5 — 메인별 2 양식 + 섹션 누적 기입 (§3.4)

기획 워크플로(new-build / improvement)는 **메인 종류로 분기**하는 2개 PRD 양식을 쓴다. 각
서브워크플로가 완료될 때 **해당 섹션을 양식에 누적 기입**한다(한 번에 다 쓰지 않음).

| 메인 | PRD 양식 섹션(누적 순서) |
|---|---|
| **new-build** | §아이디어(또는 §요구사항) → §시장(요약 + 리포트 evidence_ref) → §가설 |
| **improvement** | §KPI → §데이터 → §가설 |

위 두 양식은 §1~§8 1-pager 와 충돌하지 않는다 — 1-pager 는 problem-definition 워크플로의 종착
산출이고, 2 양식은 메인 기획 워크플로의 누적 컨테이너다. Chief/PM 이 메인 종류로 어느 양식을 쓸지 분기.

### 요구사항 섹션의 구조 — 3대 유형 (§3.4.1)

PRD 의 요구사항은 **3대 유형**으로 나뉘고, 한 PRD 가 섹션을 나눠 복수·혼재 가능:

| 유형 | 산출물 | 예시 |
|---|---|---|
| **개발** | 코드 | 웹사이트, 제품(앱/기능) |
| **콘텐츠 제작** | 글·미디어 | 광고 소재 · 아티클(긴 글) · 포스트(짧은 글) |
| **리포트 작성** | 문서 | 보고서(docs) · PPT(슬라이드) |

- **디자인 = 내포(embedded)**, 독립 4번째 유형 아님. 요구사항이 디자인 요소(글 내부 도표·인포그래픽·
  UI·콘텐츠 이미지·영상/시나리오·데이터 시각화·PPT 레이아웃 등)를 포함하면 그 요구사항 *안에* 디자인
  요구사항이 딸린다.
- **요구사항 1건 = ① 핵심 내용(무엇을·왜) + ② 작업 체크리스트(실행 단위 to-do).** 디자인 요소가
  있으면 체크리스트에 디자인 작업이 포함된다. 이 단위가 다운스트림 실행(스페셜리스트 dispatch)의 입력.

```markdown
## 요구사항
### [개발] 랜딩 페이지 리뉴얼
**핵심 내용**: …(무엇을·왜·수용 기준)
**작업 체크리스트**:
- [ ] …
- [ ] (디자인) 히어로 섹션 인포그래픽
### [콘텐츠] 런칭 아티클
**핵심 내용**: …
**작업 체크리스트**: - [ ] … - [ ] (디자인) 본문 도표
```

## v1.3.8 — PRD 작성 shape 보강 (8규칙)

> 내부 dev PRD·founder 제품 PRD 공통 작성 규칙. 두 축으로 구성:
> **(A) R1–R5 = 맥락·오버스펙 축** — 세부 구현에 매몰돼 그 버전의 기획 의도를 해치지
> 않도록 경계와 상위 목표를 PRD 가 직접 들고 있게 한다.
> **(B) R6–R8 = 확률성·검증 축** — AI 제품 PRD 는 결정론적 SW PRD 와 다른 종(種)이라는
> 외부 담론(ideation `260625-ai-planning-insights.md`, 21개 소스)을 흡수. "AI 제품을
> 위한 PRD 칸"을 분기·신설한다.

**R1. 버전 계층 인지 (상위 목표 상속).** 파일명 `vX.Y.Z` 의 어느 자리가 바뀌었나로
그 PRD 가 *정의*할 범위가 달라진다:

| 바뀐 자리 | 그 PRD 가 정의 | 이후 하위 PRD |
|---|---|---|
| **X**(major) | `X.n.n` 전체의 대략적 목표·개요(umbrella) | X.*.* 가 인용 |
| **Y**(minor) | `n.Y.n` 전체의 목표·개요 | n.Y.* 가 인용 |
| **Z**(patch) | 상위 X·Y 목표를 **인용만**(재정의 금지) + 그 안에서 맡는 조각 | — |

- 모든 PRD 상단에 **소속 목표** 블록: major 목표 1줄 + (해당 시) minor 목표 1줄 +
  "이 버전이 그 안에서 맡는 조각" 1줄. 상위가 미정의면(과거 누락) fix-forward 로
  관측·합성하고 "synthesized" 표기.
- 목적: 하위 버전이 상위 경계를 인지해 scope 이탈·중복·재정의를 막는다.
- **버전은 항상 3자리 `vN.N.N` (0부터). 4자리 절대 금지.** 핫픽스도 별개 버전이 아니라
  **다음 patch**(예: `1.3.8` → `1.3.9`)다. PRD↔버전 1:1 은 핫픽스에도 그대로 — 핫픽스도
  *자체 PRD* 를 갖되 아래 **핫픽스 PRD 양식**으로 가볍게 쓴다.

**R2. §스코프 = 포함 + 의도적 비포함(이번 버전 한정).** 스코프 섹션에 "이번 버전에서
*다루지 않음*(후속/보류)" 을 나란히 명시. §비범위(영구 non-goal)와 **구분** — 여기는
*이 버전만* 보류(후속 버전 가능). anti-over-spec: 경계선을 스코프에서 직접 그어 세부
매몰을 차단.

**R3. 지시 요구사항 전사 + 결정 표시.** 사용자/Chief 지시의 요구사항을 PRD 에 **그대로
전사**해 "요구사항 → 충족" 추적(누락 방지). 방법 결정이 필요한 지점은 본문에
`[결정 필요: A vs B — 근거]` 인라인 표시 → §approaches 비교 또는 open_questions 로 승격.
임의 선택해 묻어두지 않는다.

**R4. As-Is/To-Be = 개념 + 형태 이중 표현.** 이해를 돕도록 표·다이어그램(트리·플로우)
사용. 두 층을 모두 명시:
- **개념적 변화** — 역할·의미축·책임의 이동(무엇이 무엇으로 의미가 바뀌나).
- **형태(코드) 변화** — 경로·파일·시그니처·디렉토리 구조의 전후(어디가 어디로).

한 층만 있으면 "왜"(개념) 또는 "어떻게"(형태)가 빈다.

**R5. 작업 체크리스트 = 워크플로 리뷰 대상(초안, 확정 아님).** PRD 초안의 작업
체크리스트(§3.4.1)·손댈 파일은 *제안*이다. `requirements-analysis` §리뷰 게이트에서
담당 실행 스페셜리스트가 ① 실행가능성 ② **오버스펙(버전 목표 대비 과대 — gold-plating)**
③ 누락·사이드이펙트를 검토해 합리적으로 가감·확정. 리뷰 전 체크리스트는 binding 아님.

> **(B) 확률성·검증 축 (R6–R8)** — AI 제품 PRD 대응. 결정론적 SW 제품엔 R6 분기가
> "No" 로 떨어져 기존 양식 그대로, AI 제품일 때만 추가 칸이 활성화된다.

**R6. AI 제품 PRD 분기 (결정론/확률론 = 세 번째 축).** PRD 생성 시 먼저 묻는다 —
**"이 제품에 LLM/에이전트가 들어가나?"**

- **No(결정론적 SW):** 기존 §8 Metrics & Verification 그대로. R6 추가 없음.
- **Yes(확률적 AI 제품):** §8 에 **AI 부록 4칸**을 강제한다. AI 기능은 같은 입력에 출력이
  달라지므로 "단일 행동"이 아니라 **"받아들일 만한 답변의 범위"** 를 설계한다.

  | 칸 | 정의 | 비고 |
  |---|---|---|
  | ① 허용 답변 범위 | "무엇이 일어나야"가 아니라 **"어떤 답이 받아들일 만한가"**(range of acceptable answers) | 미슐랭 레시피처럼 범위로 |
  | ② Eval Plan | 입력·기대출력·실제출력·합격여부 셋 **20~30 케이스로 시작**(운영 시 누적 성장). 프롬프트 수정마다 **전체 재실행(회귀)** | "프롬프트 수렁" 탈출의 유일 수단 |
  | ③ 실패 정의 + 가드레일 | 무엇이 실패인가 + **Always do / Ask first / Never do** 3단 경계 | 자율성·통제 균형 |
  | ④ 3단계 평가 피라미드 | 규칙 기반(자동·저렴) → LLM-as-Judge(빠르나 편향) → 사람(느리나 최종) | 일상=①②, 중대변경=③ |

  > 근거(evidence_ref): 외부 4소스(원티드랩 PO "정답 대신 시험지", "AI PRD는 무엇이 달라야",
  > "PRD는 죽었다 Evals=Moat", "AI PM 2026 로드맵")가 **"AI PRD = 허용 범위 + Eval"** 로 수렴.
  > 평가 기준·가드레일·데이터셋은 모델 교체 후에도 남는 **고유 자산(Moat)**.
  > ※ 외부/내부(1차 축)와 결정론/확률론(세 번째 축)은 **직교** — 내부 dev PRD 도 AI 기능이면 Yes.

**R7. PRD 완성도 단계 척도 (binary → 단계).** HARD GATE 의 이진 충족과 별개로 PRD 의
*성숙도*를 상단에 표기해 "지금 리뷰 시작 가능 / ship 가능"을 구분한다:

| 점수 | 도달 조건 | 의미 |
|---|---|---|
| **30** | 가치정의 · 퍼소나 · 메인 시나리오 | 리뷰 시작 가능 |
| **50** | + 배경 · 맥락 · 중요 유즈케이스 | 본격 검토 |
| **100** | 전 섹션 + HARD GATE | ship 직전 (= `docs` frozen 판정) |
| **70(리셋)** | ship 후 | 운영 갱신 여지 (다음 릴리즈 재상승) |

`docs` 스킬의 PRD frozen 판정(어디에·어떤 버전)과 연결: **frozen = 100 도달**.

**R8. 수용 기준 = Given-When-Then AC.** §8(또는 §검증)의 수용 기준을 **Given-When-Then**
구조로 써 테스트로 직역 가능하게 한다. 문서 위계 인지 — **PRD**(무엇을 만드나) → **AC**
(언제 완성인가) → **Policy**(어떤 기준으로 일관성). AC 는 테스트 자동화·QC 연계 지점.

```
Given  사용자가 비회원 상태
When   이메일로 가입 시도
Then   인증 메일이 발송된다
```

### 어휘·프레임 정렬 (P4 — 저비용 흡수)

- **Spec Kit 4게이트** — `requirements-analysis` 단계를 Specify → Plan → Tasks → Implement
  어휘로 정렬(이미 사실상 동형). 외부 담론과 호환.
- **가치문장 4요소** — §5 Value Proposition 의 1-line 을 **"누가 · 왜 · 어떻게 · 어떤 가치"**
  구조로(yozm 3221). 이 문장이 PM·디자이너·개발자·AI 에이전트 공통 방향타.
- **산문 우선** — PRD 는 **텍스트 서술형 우선**("어설픈 그림 금지" — 글로 쓰면 머릿속
  에덴동산이 사라진다). 다이어그램은 보조(R4 형태 층).
- **지시의 저주 회피** — 한 프롬프트에 요구사항이 많을수록 각각 준수율이 급락. R5 작업
  체크리스트는 다운스트림 스페셜리스트에 **1건씩** dispatch(한 번에 한 태스크).

## 핫픽스 PRD 양식 (3자리 patch — 출시분 결함 수정)

핫픽스 = 출시된 부모 버전의 결함을 고치는 **다음 patch 3자리 버전**(예: `1.3.8` → `1.3.9`).
별도 4자리 버전이 아니다(R1). 핫픽스도 PRD↔버전 1:1 을 지켜 **자체 PRD** 를 갖되, 전체 내부 dev
양식이 아니라 **가벼운 핫픽스 양식**(증상 추적 중심)으로 쓴다. 선례: `docs/prd/v1.2.3-bundle-files-hotfix.md`.

```markdown
# vN.N.N — <한 줄 제목> (hotfix on vN.N.(N-1))
> 상태 + 로드맵 위치(부모 버전 → 본 hotfix → 다음).

## 1. 발견 경위    — 어떻게 드러났나(재현 명령 + 실제 에러 출력 그대로)
## 2. 근본 원인    — 왜 깨졌나(코드/데이터 한 지점)
## 3. 영향         — 누가/무엇이 깨지나(결정적/음험한 실패 모드 구분)
## 4. 해결책       — 즉시 수정(손댈 파일/diff) + (있으면) 마이그레이션 경로 + 사용자 복구 절차
## 5. 검증         — 회귀 테스트(재발 방지) + 게이트 green
## 6. 회고         — 왜 기존 게이트가 못 잡았나 + 후속 가드 후보
```

- 풀 PRD 의 8-section/approaches/V·U·V·F 는 **생략 가능**(핫픽스는 발산이 아니라 결함 수렴).
- 부모 버전·git 히스토리·CHANGELOG `[N.N.N]` 와 교차 링크. 명명 `vN.N.N_<name>.md`.

## 저장 위치 (gstack design doc 컨벤션 차용)

```
# v1.3.8 둘 계층 분리 — PRD=repo 계층, 리포트/ideation=org 워크스페이스 계층 (docs 스킬 §1)
<repo>/docs/prd/<version>_<name>.md      ← PRD 본체 (repo 계층 · release 버전 1:1)
<org>/docs/reports/<name>_<YYMMDD>.md    ← 리포트 (org 계층 · cross-repo · evidence_ref 대상)
<org>/docs/ideation/<name>_<YYMMDD>.md   ← ideation (org 계층 · 발산)
# (레거시) 워크플로 인스턴스 산출:
<org>/workflows/wf-YYYY-MM-DD-<slug>/PRD.md
<org>/decisions/{user-handle}-{branch}-design-{datetime}.md  ← 결정 누적
```

## HARD GATE: PRD ship 조건

- [ ] 8 section 모두 채움
- [ ] §6 에 ≥2 approaches 비교
- [ ] §6 에 V/U/V/F 분류
- [ ] §7 wbs 결과 inject
- [ ] §8 success_threshold 측정 가능
- [ ] open_questions[] 빈 상태 또는 blocking 모두 resolved
- [ ] (v1.3.8 A축) R1 버전 계층 목표 블록 존재 · R2 §스코프에 이번-버전 비포함 명시 ·
      R3 지시 요구사항 전사 + 결정 필요 항목 표시 · R4 As-Is/To-Be 개념+형태 둘 다 ·
      R5 작업 체크리스트 §리뷰 게이트 통과
- [ ] (v1.3.8 B축) R6 "LLM/에이전트 들어가나?" 분기 — Yes 면 §8 AI 부록 4칸(허용범위·
      Eval Plan·실패+가드레일·평가 피라미드) 채움 · R7 완성도 점수(30/50/100) 표기 ·
      R8 수용 기준 Given-When-Then

## Anti-Sycophancy

PRD 본문에 다음 표현 금지:
- "검토 부탁드립니다 :)"
- "흥미로운 기능"
- "한번 생각해보시면 좋을"

대신:
- "권고: X. 반증 조건: Y."
- "결정 필요 항목: Z 의 trade-off (A vs B)"

## Reference

- phuryn/pm-skills/pm-execution/create-prd
- gstack `/office-hours` design doc naming convention
- v1.1 PRD §9.1 (skill category=planning)
