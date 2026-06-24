# Primitive 작성 공통 코어 (skill·agent·workflow·goal·cron)

> **단일 진실원.** 5종 primitive 의 대화형 매니저(`{skill,agent,workflow,goal,cron}-manager`)가
> *작성/개선할 때만* 읽는 작성 표준. universal 레이어(철학·인터뷰·4-mode)는 5종 공유, 포맷-고유분은
> §3(SKILL.md)·§4(조립)로 분리. 매니저는 ToC 로 자기 섹션만 점프(점진공개 — 우리가 설파하는 규율을
> 스스로 실천). **드리프트 0** = single-source.
>
> 근거: `docs/ideation/260617-skill-md-authoring-best-practices.md` · `260618-{agent,workflow,goal,
> cron}-authoring-best-practices.md` · `docs/prd/v1.3.7-*.md` + agentskills.io 공개 스펙.

## 목차
- **§0 primitive 분류 + 단위·조립 관계** (5종이 무엇이고 어떻게 엮이나)
- **§1 universal 작성 철학** (5종 공유 ~70%)
- **§2 인터뷰 — 암묵지 추출 + 초안-앵커 4-mode** (5종 클러스터)
- **§3 SKILL.md 포맷 작성** (skill·agent)
- **§4 조립 포맷 작성** (workflow·goal·cron) — 워크플로 본질 원칙 + 기획 3대 편향 가드
- **§5 수용 게이트 rubric** (primitive별 binary)

---

## §0 primitive 분류 + 단위·조립 관계

| primitive | 단위 | 포맷 | 정체 |
|---|---|---|---|
| **skill** | 워크스페이스(번들/글로벌·org 오버레이) | `SKILL.md` | 재사용 절차/역량 |
| **agent** | 워크스페이스 | `SKILL.md` | 행위자(역할·위임) |
| **workflow** | **org** | `workflow.yaml` | 다단계 판단 흐름(조립물) |
| **goal** | **org** | `goal.md` | metric keep/discard 루프(조립물) |
| **cron** | **org** | `<id>.yaml`+`.md` | 정기/일회 작업(조립물) |

- **skill·agent = 베이스.** 워크스페이스 단위로 존재하는 *재료*. (작성 = §3.)
- **workflow·goal·cron = org 단위 조립물.** stage/pipeline 이 **기존 skill·agent 를 참조**해 구성된다
  (validator 가 agent-ref 실존 검사). ⇒ 이들 작성은 *발명*이 아니라 **조립**. (작성 = §4.)
- **함의(필수):** 조립물을 만들 때 필요한 skill·agent 가 없으면, 추측으로 ref 를 박지 말고
  [[skill-manager]]·[[agent-manager]] 로 **베이스부터 만든 뒤 조립**한다. 마이그레이션(§2 case⑵) 시에도
  stage 의 agent-ref 가 워크스페이스 베이스에 해소되는지 검증 — 미해소면 함께 adopt 하거나 베이스 생성.

## §1 universal 작성 철학 (5종 공유)

1. **2층 분해.** 영속 정의(정책/스키마) + 휘발 실행(시도/사이클). 둘을 섞지 않는다.
2. **validation-as-gate.** parse(스키마) → semantic(참조 실존·평가가능) → pre-exec(미리보기·"리뷰 없이
   돌릴 자신?") 순으로 전진을 *게이트*한다.
3. **measurement contract.** 성공을 *명시적으로* 정의(metric·exit_criteria·overlap 정책). 단일 지표
   게이밍 방지 = **composite + guardrail**. 자원은 **bounded**(budget cap·max-iter·min-interval).
4. **idempotency.** 정확히-한번은 불가 — 재실행/적어도-한번에 안전하게(handoff replay·고정커밋 재측정·
   중복 invocation).
5. **event sourcing/audit.** append-only 로그로 상태 재구성·감사(`_events.jsonl`·results·heartbeat).
6. **메타데이터 디스커버리.** description ~100토큰은 항상 로드, 본문/상세는 트리거 시만.
7. **simplicity.** start simple — 정적 체인 < 정적 DAG < 동적 오케스트레이션. 유연성이 *진짜* 필요할 때만 위로.

## §2 인터뷰 — 암묵지 추출 + 초안-앵커 4-mode

**목적은 폼-필링이 아니다 — 사용자가 *암묵적으로 아는 것*(절차·판단·예외·품질 기준)을 끌어내
primitive 로 시스템화**한다. 인터뷰 클러스터 = 수용 rubric(§5) = validator 검사 필드와 1:1 정렬:
인터뷰가 끌어내고 → rubric 이 채점하고 → validator 가 강제한다.

**추출 클러스터** (enumerable AskUserQuestion — 폼 심문 아님. 사용자/초안이 채운 건 *남은 것만* 묻는다):

| primitive | 클러스터 (굵게 = 암묵지) |
|---|---|
| **skill** | trigger(비명시 케이스) · **procedure(습관적 절차)** · **gotchas(피하려 배운 실수)** · I/O · non-goal · **verification(됐는지 판단 기준)** · bundle · shape |
| **agent** | job · done(완료 정의) · inputs · outputs · cadence · **boundaries(경계)** · **learning(개선)** · shape(단일 vs 멀티) |
| **workflow** | objective/done · stages(머릿속 DAG) · **handoff(다음 단계가 알아야 할 것)** · exit_criteria(측정가능) · agents · **failure(단계 실패 복구)** · simplicity |
| **goal** | objective · metric(name/formula/source/threshold/direction) · **guardrail(개선하며 깨면 안 될 것)** · pipeline · termination(수렴·포기) · 비가역 액션 승인 |
| **cron** | task · cadence · timezone · **overlap/catch-up(늦거나 겹치면)** · report · idempotency(2회 안전?) · **silent-miss(돌았어야 했는데 안 돈 기준)** |

**초안-앵커 4-mode.** 인터뷰는 *항상 매니저가 만든 초안에 앵커링*된다(백지 심문 금지). 4-mode 는
초안의 원재료가 *어디서 오고 얼마나 완성돼 있나*로 갈린다. case 는 Chief 가 `[creation_case:N]` 마커로 전달:

| case | 초안 원재료 | 인터뷰 |
|---|---|---|
| ⑴ 명시 지시 | 사용자 첫 서술 | 초안 제시 → 빈 클러스터 추출 |
| **⑵ 마이그레이션(adopt)** | **아티팩트 역공학** | 매니저가 리포 아티팩트 분석→초안 제시 → 코드에 없는 **WHY·판단·예외** 추출. wf/goal/cron 이면 **agent-ref 가 베이스에 해소되는지 검증**(§0). |
| ⑶ 대화 감지 | Chief 추론 shape | 추론 shape 제시 → 미정 클러스터만 |
| ⑷ 마이닝 제안 | 마이너 패턴 | 패턴=초안 → "N회 반복, 진짜 절차? 트리거·판단은?" *규칙(암묵지)* 추출 |

> 마이그레이션(⑵)은 1급 — 사용자가 백지에서 답하는 게 아니라, 매니저가 아티팩트로 초안을 깔고 사용자는
> *코드에 없는 판단*을 채운다. (agent 인터뷰도 본 4-mode 를 따른다 — 구 lifecycle Phase 1 의 full 은 case⑴.)

---

## §3 SKILL.md 포맷 작성 (skill·agent)

skill·agent 는 같은 `SKILL.md` 포맷(frontmatter 명함 + 본문 지침)을 쓴다. 도메인 고유분(skill: triggers·
loop_mode·번들 / agent: 위임 그래프·역할 중첩·budget·생애주기)은 각 매니저 `references/` 에 둔다.

### §3.1 frontmatter(명함) + 본문(지침). description = 디스커버리
모델은 description 을 *항상* 읽고(시동 ~100토큰/자산), 본문은 *트리거될 때만* 읽는다. **품질 노력의
절반은 description 에 간다.** frontmatter = 부모가 읽는 라우팅 명함, 본문 = 자산 자신의 실행 기준.

### §3.2 description 작성 공식
**`<3인칭 동사> <역량>. <방법론/출처> 기반. 사용 시점 — A(광의), B(구체). (제외 — X)`**

> ⚠️ description 은 YAML-safe — 따옴표 없는 값에 `: `(콜론+공백) 금지(YAML 매핑 키 오인). 대시를 쓰거나 따옴표.

- **3인칭** 또는 imperative. **1인칭("I can"/"You can") 금지.**
- **트리거를 첫 문장에**(Claude Code 는 1536자에서 자름). **약간 pushy**(under-trigger 가 더 위험).
- **non-goal 명시**(긍정+부정 스코핑). ⚠️ capability-only 금지(언제가 없으면 매칭 약화). ⚠️ overfit 금지(실패
  쿼리 키워드 박지 말고 *상위 개념*을 잡아라).

### §3.3 정량 한도 (validate 가 강제)
| 항목 | 규칙 |
|---|---|
| `name` | ≤64자, `^[a-z0-9]+(-[a-z0-9]+)*$`, **부모 디렉터리명 일치**, 예약어(`claude`/`anthropic`) 금지 |
| `description` | ≤1024자, 비어있으면 안 됨, 3인칭, XML 태그 금지 |
| 본문 | **<500줄(~<5000토큰)**, 이상적 중앙값 **~920토큰** |
| 참조 파일 | **1단계 깊이**, **>100줄이면 ToC** |

### §3.4 본문 작성 — 절차적 규율 + 명명 패턴
**"모델이 모르는 것만 적고, 아는 건 뺀다."** 테스트 — *"이 지침이 없으면 틀릴까? 아니면 잘라라."*
가치는 사실이 아니라 **절차적 규율**(출력 포맷·근거 결속·체크리스트) — 모델이 zero-shot 으로 *안 하는* 행동.

- **위험도에 처방 강도 보정:** 열린 작업→"왜"+자유. 파괴적→"정확히 이 순서"(낮은 자유도, 가능하면 scripts/).
- **메뉴 말고 디폴트**(1추천+1탈출구). **"왜"를 설명**("Do X because Y").
- **명명 패턴(필요한 것만):** Gotchas(틀릴 때마다 추가→자란다) · Plan-validate-execute · Validation loop ·
  Verification 게이트(구체 증거로 종료) · anti-rationalization 테이블 · Red Flags.
- 시간 의존 정보 금지(폐기분 `<details>`). 용어 일관. 예시는 구체(input/output 쌍).

### §3.5 번들 구조 — scripts / references / assets
| 폴더 | 용도 | 적재 | 규칙 |
|---|---|---|---|
| `scripts/` | bash 로 *실행*되는 코드 | ❌ 출력만 | 빈 폴더 금지. forward slash. magic number 금지. |
| `references/` | 가끔 필요한 상세 | 읽을 때만 | 1단계 깊이. >100줄 ToC. |
| `assets/` | 복사용 원본 틀 | ❌ 복사용 | 인스턴스는 별도 위치. |

판단: 반복 로직이 trace 에 보이면 scripts · 길고 가끔이면 references · 찍어내는 틀이면 assets.

### §3.6 점진공개 3단계
metadata(name+description) → SKILL.md 본문(얇게) → 번들 파일(필요 시). (이 코어 파일이 3단계의 실례.)

### §3.7 frontmatter 필드 감사 — load-bearing vs decorative
**모든 커스텀 필드는 ⑴ 동작을 구동(load-bearing)하거나 ⑵ 검증기가 강제해야 한다. 둘 다 아니면 부채.**
필수(Anthropic 표준): `name`·`description`.
- [ ] 파서 `known` 집합에 있나? 없으면 `extra` 로 무시 → 추가 보류.
- [ ] enum/포맷 제약 없는 자유 문자열? → 드리프트 → 검증 강제 없으면 빼라.
- [ ] 폴더 위치/타 필드에서 유도 가능? → 중복, 빼라.
> 자산별 load-bearing 목록 = 각 매니저 references(skill: `frontmatter-fields.md`, agent: `delegation-graph.md`).

### §3.8 eval 골격 — description 트리거 + output A/B
"좋아졌다"를 감 아닌 측정으로. **이 eval 이 자가개선 루프(SkillOpt)의 채점기 — 없으면 행동층 자가개선 없음.**
- **① description 트리거 eval:** 20쿼리(should 8–10 + should-NOT 8–10) ×3런, 임계 0.5, train60/val40 고정 split.
- **② output A/B:** with/without, clean-context·blind judge, assertion=programmatically-verifiable·countable.
  비용 delta(token+duration) 측정 → 품질/비용으로 채택.
- 적용: 모든 자산 ≥① / 검증가능 output =②+자가개선 후보 / 주관 output =② LLM-judge 만(자가개선 보류).

---

## §4 조립 포맷 작성 (workflow·goal·cron)

§0 의 조립 원칙(skill·agent 참조) 위에서 작성한다. 공통 = §1. 아래는 포맷 고유 + 기획 가드.

### §4.0 워크플로 본질 원칙 (워크플로 ↔ skill 구분)
**워크플로는 *행위*가 아니다.** **목표(goal) + 근거(rationale) + 방법(method) → 결론(conclusion) →
다음 단계로의 핸드오프**를 담은 *판단 단위*다. 단순 행위라면 워크플로가 아니라 **skill** 이어야 한다.
- 모든 stage 는 "무엇을 *왜* 어떤 근거·방법으로 하고, 어떤 *결론*을 다음에 넘기는가"를 명시한다. 이게
  없으면 그 stage 는 skill 한 줄로 충분하다(→ skill 로 강등).
- 예: `kpi-check` 는 *지표 조회 행위*가 아니라 — 받은 과제를 진행하기 전 **프로덕트 방향성·북극성 지표·
  기대 성과를 확인해 팀 목표를 얼라인**시키고 그 위에서 PM 이 업무 분장하게 하는 *정렬 게이트*.

### §4.1 workflow
- stage DAG · `depends_on`/`handoff_to` 엣지 · agent 바인딩(`<team>/<agent>`·`_skill/<id>`·`_workflow/<id>`).
- **순환 금지**(제출 시 Kahn 검증, cycle=ERROR) · orphan stage 0 · sub-workflow depth≤2.
- `exit_criteria` 는 **measure+operator+threshold**(free-text 금지 — 모범: 구 pmf-validation 의 stage별 게이트).
- `_handoff.md` 컨텍스트 스냅샷 · timeout/retry · 재실행 idempotent.
- **메인/서브 = 타입 아니라 호출 위치.** `_workflow/` 로 다른 워크플로를 합성하면 메인(composer), 합성되면 서브.

### §4.2 goal
- metric provenance: name/formula/**source(실존)**/threshold/direction. **composite + ALL-pass**(단일 North
  Star = Goodhart). 수렴 patience(N연속 keep) · discard-streak · loop-detection.
- **비가역 액션(push 등) = 인간 승인 게이트.** 재측정은 **고정 커밋**으로 결정적. 영속(정의)/휘발(cycle) 2층.

### §4.3 cron
- **IANA tz 이름**(offset 금지·DST 00:00–03:00 위험대) · 필드 수(5/6) · overlap(skip 기본) · catch-up(off 기본).
- jitter(thundering herd) · idempotent 프롬프트 · **dead-man's-switch**(조용한 미스 경보) · pause≠delete.
- UX: translate-then-confirm(readback) + next-N 미리보기.

### §4.4 기획(planning) 워크플로 — 3대 편향 가드
기획 워크플로의 prompt·context·harness·loop 엔지니어링은 아래 3대 편향을 *경계·해결*한다. 각 편향은
**양 극단 사이 균형점**이 핵심(한쪽만 막으면 반대 실패).

| 편향 | 실패 모드 | 반대 극단(같이 경계) | 가드 |
|---|---|---|---|
| **① 자기부정** | 어제 긍정→오늘 부정→내일 번복(사용자 불신) | 반성 없는 **무작정 고집** | **원칙 있는 수정만** — 입장 변경은 *명시 논리/근거* 있을 때만, 없으면 일관. LLM 의 상태 없는 확률 재생성(매 턴 belief 재구성)을 이해하고 **결정·근거를 durable-md(`_log.md`/`_handoff.md`)에 고정**해 표류 차단. |
| **② 학습편향** | 사용자 천장(RAG·사전지식·습관) 안에 갇혀 **단순 자동화**로 전락 | **할루시네이션**·스코프 벗어난 과잉 디테일 | 천장 위로 **업계 모범·표준 프레임을 근거와 함께 제시**하되 evidence_ref·스코프 게이트로 환각·과잉기획 차단. "더 나은 기획"이 목표. |
| **③ 확증편향** | AI 논리에 사용자가 무의식 동조 → 주객전도 | (사용자 주체성 상실) | **가상 용어 창조 금지 — 업계 표준 용어·통용 개념만.** AI 가 *자기 기획의 한계*(가정·불확실·반증조건)를 명시해 사용자를 검증 주체로. anti-sycophancy(≥2 접근) 정합. |

> Chief/PM: 작성 인터뷰·case 감지·회고(루프 엔지니어링)는 Chief, 워크플로 *실행*·업무 분장은 PM
> (PM 완료→Chief 먼저 공유=agent 간 리뷰→OK 면 Chief 가 사용자 보고).

## §5 수용 게이트 rubric (primitive별 binary)

**"이 primitive 를 *리뷰 없이* 실행할 자신이 드는가?"** — 미달이면 description/본문 sharpen 후 재검(3~6 binary):
- **skill** — description 트리거 충분? · 본문이 절차규율(facts 아님)? · 정량한도 통과? · non-goal 명시?
- **agent** — description=위임트리거 충분? · 역할 SRP(중첩 0)? · 그래프 무결(참조·순환·depth)? · budget 상속?
- **workflow** — acyclic? · stage id unique + agent 실존? · handoff/depends 도달가능? · exit_criteria measurable?
  · 실패행동 정의? · 재실행 idempotent? · **모든 stage 가 목표·근거·방법→결론 갖춤(§4.0)?**
- **goal** — metric 5필드+source 실존+formula 평가가능? · composite ALL-pass? · pipeline agent 실존? ·
  수렴+종료 명확? · 재측정 결정적? · 비가역 승인 게이트?
- **cron** — tz=IANA? · next-N+readback? · overlap 명시? · idempotent? · 다중 jitter? · pause≠delete? ·
  min-interval 가드? · 조용한 미스 경보?
