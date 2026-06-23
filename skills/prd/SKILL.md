---
name: prd
description: PRD 작성 (phuryn template + gstack design doc 컨벤션). 8-section 1-pager + v1.3.5 메인별 2 양식(new-build/improvement) 분기 + 요구사항 3대 유형(개발·콘텐츠·리포트) 렌더 + 섹션 누적 기입. 프레임워크 체인·서브워크플로 출력을 입력으로 받아 PRD 생성.
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
