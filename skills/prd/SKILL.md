---
name: prd
description: PRD 작성 (phuryn template + gstack design doc 컨벤션). 8-section 1-pager + v1.3.5 메인별 2 양식(new-build/improvement) 분기 + 요구사항 3대 유형(개발·콘텐츠·리포트) 렌더 + 섹션 누적 기입 + v1.3.8 작성 5규칙(버전계층 목표상속·스코프 비포함경계·지시 요구사항 전사·As-Is/To-Be 개념+형태·체크리스트 워크플로 리뷰). 프레임워크 체인·서브워크플로 출력을 입력으로 받아 PRD 생성.
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

## v1.3.8 — PRD 작성 shape 보강 (5규칙)

> 내부 dev PRD·founder 제품 PRD 공통 작성 규칙. **목적 = 맥락 상실·오버스펙 방지**:
> 세부 구현에 매몰돼 그 버전의 기획 의도를 해치지 않도록 경계와 상위 목표를 PRD 가
> 직접 들고 있게 한다.

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

## 저장 위치 (gstack design doc 컨벤션 차용)

```
# v1.3.5 §3.4 — PRD 본체와 리포트는 <org>/docs/ 아래로 (PM 이 관리·INDEX.md 유지)
<org>/docs/prd/<slug>.md                 ← PRD 본체 (메인별 2 양식)
<org>/docs/reports/market-research-<slug>-<date>.md  ← 시장조사 리포트 (evidence_ref 대상)
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
- [ ] (v1.3.8) R1 버전 계층 목표 블록 존재 · R2 §스코프에 이번-버전 비포함 명시 ·
      R3 지시 요구사항 전사 + 결정 필요 항목 표시 · R4 As-Is/To-Be 개념+형태 둘 다 ·
      R5 작업 체크리스트 §리뷰 게이트 통과

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
