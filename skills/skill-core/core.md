# SKILL.md 작성 공통 코어 (skill·agent 공유)

> **단일 진실원.** `skill-manager` 와 `agent-manager` 가 *둘 다* 적용하는 공통 작성 표준(~70%).
> skill·agent 는 같은 `SKILL.md` 포맷(frontmatter + 본문)을 쓰므로 작성 규칙의 대부분이 공통이다.
> **도메인 고유분(~30%)은 각 매니저의 `references/` 에 둔다** — skill 고유(triggers·loop_mode·번들
> 세부)는 `skill-manager/references/`, agent 고유(위임 그래프·역할 중첩·budget 상속·생애주기)는
> `agent-manager/references/`. 이 파일을 두 매니저가 참조해 **드리프트 0**(우리가 설파하는 single-source).
>
> 근거: `docs/ideation/260617-skill-md-authoring-best-practices.md`(Part B·B.6·F·I) +
> `260618-agent-authoring-best-practices.md`(Part C·G·H) + agentskills.io 공개 스펙.
> 점진공개 — 필요할 때만 읽힌다. 본문 <150줄 유지(넘으면 분할).

## 목차
- 1. SKILL.md = frontmatter(명함) + 본문(지침). description = 디스커버리
- 2. description 작성 공식
- 3. 정량 한도 (validate 가 강제)
- 4. 본문 작성 — 절차적 규율 + 명명 패턴
- 5. 번들 구조 — scripts / references / assets
- 6. 점진공개 3단계
- 7. frontmatter 필드 감사 — load-bearing vs decorative
- 8. eval 골격 — description 트리거 + output A/B

---

## 1. SKILL.md = frontmatter(명함) + 본문(지침). description = 디스커버리
모델은 모든 자산의 description 을 *항상* 읽고(시동 시 ~100토큰/자산), 본문은 *트리거될 때만* 읽는다.
따라서 **품질 노력의 절반은 description 에 간다.** 본문은 "트리거된 다음"의 이야기다.
- frontmatter = 부모/오케스트레이터가 읽는 **라우팅 명함**(description = *위임 트리거*).
- 본문 = 자산 자신이 실행 기준으로 삼는 **지침**. 둘은 독자가 다르다 — 짧은 명함 + 트리거 시 풀 본문.

## 2. description 작성 공식
**`<3인칭 동사> <역량>. <방법론/출처> 기반. 사용 시점 — A(광의), B(구체). (제외 — X)`**

> ⚠️ **frontmatter 의 description 은 YAML-safe.** 따옴표 없는 값에 `: `(콜론+공백)을 넣지 말 것 — YAML 이
> 매핑 키로 오인해 파싱이 깨진다. "사용 시점 —"처럼 콜론 대신 대시를 쓰거나 값 전체를 따옴표로 감싼다.

- **3인칭** 서술("…한다") 또는 imperative("Use this when…"). **1인칭("I can"/"You can") 금지.**
- **트리거를 첫 문장에** — Claude Code 는 description+when_to_use 를 1536자에서 자른다.
- **약간 pushy** — under-trigger(필요한데 발화 안 됨)가 더 위험. "명시적으로 X 라 말 안 해도" 식 포함.
- **non-goal 명시** — "이럴 땐 쓰지 말 것"(긍정+부정 스코핑)이 매칭 정확도를 올린다.
- ⚠️ **capability-only 금지** — 역량 나열만 하고 "언제"가 없으면 자동 매칭이 약하다.
- ⚠️ **overfit 금지** — eval 실패 쿼리의 키워드를 그대로 박지 말 것. 그 쿼리의 *상위 개념*을 잡아라.

## 3. 정량 한도 (hard limit — validate 가 강제)
| 항목 | 규칙 |
|---|---|
| `name` | ≤64자, `^[a-z0-9]+(-[a-z0-9]+)*$`(연속·양끝 하이픈 금지), **부모 디렉터리명 일치**, 예약어(`claude`/`anthropic`) 금지 |
| `description` | ≤1024자, 비어있으면 안 됨, 3인칭, XML 태그 금지 |
| 본문 | **<500줄(~<5000토큰)**, 이상적 중앙값 **~920토큰** |
| 참조 파일 | **1단계 깊이**까지만, **>100줄이면 ToC** |

## 4. 본문 작성 — 절차적 규율 + 명명 패턴
**원칙: "모델이 모르는 것만 적고, 아는 건 뺀다."** 테스트 — *"이 지침이 없으면 틀릴까? 아니면 잘라라."*
가장 가치 있는 내용은 **사실이 아니라 절차적 규율**(출력 포맷, 근거-결속, 단계 체크리스트) — 프런티어
모델이 zero-shot 으로 *안 하는* 행동.

- **위험도에 처방 강도 보정:** 열린 작업 → "왜"+자유. 깨지기 쉽거나 파괴적 → "정확히 이 순서, 플래그
  추가 금지"(낮은 자유도, 가능하면 scripts/ 로).
- **메뉴 말고 디폴트:** 동급 옵션 나열 금지 → 1개 추천 + 탈출구 1개.
- **"왜"를 설명:** "Do X **because** Y" > "ALWAYS do X, NEVER do Y".
- **명명 패턴(필요한 것만):**
  - **Gotchas** — 가정을 뒤집는 환경 사실. *틀려서 교정할 때마다 여기에 추가* → 자산이 자란다.
  - **Plan-validate-execute** — 배치/파괴적 작업.
  - **Validation loop** — 품질 중요 작업(validator → 수정 → 반복).
  - **Verification 게이트** — 종료를 *구체 증거*로("intuition alone is insufficient").
  - **anti-rationalization 테이블** — 둘러댈 변명을 선제 반박.
  - **Red Flags** — 오용 징후 목록.
- **시간 의존 정보 금지**(폐기분은 `<details>` Old patterns). **용어 일관.** **예시는 구체적**(input/output 쌍).

## 5. 번들 구조 — scripts / references / assets
자산 = 폴더 1개 + `SKILL.md`(필수) + 선택적 하위 3종. **각각 역할이 다르다:**

| 폴더 | 용도 | 컨텍스트 적재 | 규칙 |
|---|---|---|---|
| `scripts/` | bash 로 *실행*되는 코드(깨지기 쉬운 정밀·반복 로직) | ❌ 코드 미적재, 출력만 | **빈 `scripts/` 금지.** forward slash. magic number 금지. |
| `references/` | 가끔 필요한 상세를 본문에서 링크 | 읽을 때만 | **1단계 깊이.** >100줄이면 ToC. 본문에 다 욱여넣지 말 것. |
| `assets/` | 복사해서 쓰는 **원본 틀**(템플릿) | ❌ 복사용 | 인스턴스는 별도 위치로 복사. |

판단: **반복 로직이 trace 에 보이면 scripts**, **길고 가끔 필요하면 references**, **찍어내는 틀이면 assets**.

## 6. 점진공개 3단계
1. **metadata**(name+description) — 시동 시 전 자산 로드(~100토큰/자산).
2. **SKILL.md 본문** — 트리거 시 로드. **얇게** 유지.
3. **번들 파일** — 필요 시만. (이 코어 파일 자체가 3단계의 실례다.)

## 7. frontmatter 필드 감사 — load-bearing vs decorative
**원칙 하나로 압축된다:** **모든 커스텀 필드는 ⑴ 동작을 구동하거나(load-bearing) ⑵ 검증기가 강제
(enum/포맷)해야 한다. 둘 다 아니면 순수 부채** — 작성 부담 + 드리프트 + "적혀 있으니 작동한다"는 착각.

**필수(Anthropic 표준):** `name`·`description`(§2·§3).

**작성 시 체크:**
- [ ] 추가하려는 커스텀 필드가 파서의 `known` 집합에 있나? 없으면 → `extra` 로 무시됨 → **추가 보류.**
- [ ] enum/포맷 제약 없는 자유 문자열 필드인가? → 대규모에서 반드시 드리프트. 검증기 강제 없으면 빼라.
- [ ] 폴더 위치·다른 필드에서 유도 가능한가? → 중복, 빼라.

> **새 decorative 필드 추가 금지.** 자산별 load-bearing 필드 목록은 각 매니저 references 참조
> (skill: `skill-manager/references/frontmatter-fields.md`, agent: `agent-manager/references/delegation-graph.md`).

## 8. eval 골격 — description 트리거 + output A/B
"좋아졌다"를 감이 아니라 측정으로. **이 eval 이 자가개선 루프(SkillOpt)의 채점기다 — 채점기 없이는
행동층 자가개선 없음.**

- **① description 트리거 eval:** **20쿼리 = should 8–10 + should-NOT 8–10(near-miss 네거 포함)** ×3런,
  임계 **0.5**(should>0.5 / should-NOT<0.5), **train60/val40** 고정 split, ~5 iteration·**val 최고본 선택**.
- **② output 품질 A/B:** with_skill / without_skill(또는 이전 버전), **clean-context**·**blind** judge.
  assertion = programmatically-verifiable·specific·countable(良) / "output is good"·exact-phrase(不).
  **비용 delta(token+duration)도 측정** → 품질만이 아니라 품질/비용으로 채택 판단.
- **적용 판단:** 모든 자산 = 최소 ① / 검증가능 output = ②+자가개선 후보 / 주관적 output = ② LLM-judge 만,
  자가개선 보류(정적 게이트 폴백).
