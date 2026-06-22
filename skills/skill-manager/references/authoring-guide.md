# SKILL.md 작성 가이드 (skill-manager 권위 본)

> skill-manager 가 새 skill 을 만들거나 기존 skill 을 개선할 때 적용하는 **작성 표준**.
> 근거: `docs/ideation/260617-skill-md-authoring-best-practices.md`(Part B·B.6·F·I).
> 이 파일은 필요할 때만 읽힌다(점진공개). 본문은 <150줄 유지 — 넘으면 분할.

## 목차
- 1. 단일 진실: description = 디스커버리
- 2. description 작성 공식
- 3. 본문 작성 — 절차적 규율 + 명명 패턴
- 4. 정량 한도 (hard limit)
- 5. 번들 구조 — scripts / references / assets
- 6. 점진공개 3단계

---

## 1. 단일 진실: description = 디스커버리
모델은 모든 skill 의 description 을 *항상* 읽고(시동 시 ~100토큰/skill), 본문은 *트리거될 때만* 읽는다.
따라서 **품질 노력의 절반은 description 에 간다.** 본문은 "트리거된 다음"의 이야기다.

## 2. description 작성 공식
**`<3인칭 동사> <역량>. <방법론/출처> 기반. 사용 시점: A(광의), B(구체). (제외: X)`**

- **3인칭** 서술("…한다"). 또는 imperative("Use this skill when…"). 1인칭("I can"/"You can") 금지.
- **트리거를 첫 문장에** — Claude Code 는 description+when_to_use 를 1536자에서 자른다.
- **약간 pushy** — under-trigger(필요한데 발화 안 됨)가 더 위험. "명시적으로 X 라 말 안 해도" 식 포함.
- **non-goal 명시** — "이럴 땐 쓰지 말 것"(긍정+부정 스코핑)이 매칭 정확도를 올린다.
- ⚠️ **capability-only 금지** — "전문 X 가" 식 역량 나열만 하고 "언제"가 없으면 자동 매칭이 약하다.
- ⚠️ **overfit 금지** — eval 실패 쿼리의 키워드를 그대로 박지 말 것. 그 쿼리의 *상위 개념*을 잡아라.

## 3. 본문 작성 — 절차적 규율 + 명명 패턴
**원칙: "Claude 가 모르는 것만 적고, 아는 건 뺀다."** 테스트 — *"이 지침이 없으면 틀릴까? 아니면 잘라라."*
가장 가치 있는 내용은 **사실이 아니라 절차적 규율**(출력 포맷, 근거-결속, 단계 체크리스트) — 프런티어
모델이 zero-shot 으로 *안 하는* 행동.

- **위험도에 처방 강도 보정:** 여러 방법 OK인 열린 작업 → "왜"를 설명+자유. 깨지기 쉽거나 파괴적 →
  "정확히 이 순서, 플래그 추가 금지"(낮은 자유도, 가능하면 scripts/ 로).
- **메뉴 말고 디폴트:** 동급 옵션 나열 금지 → 1개 추천 + 탈출구 1개.
- **"왜"를 설명:** "Do X **because** Y" > "ALWAYS do X, NEVER do Y".
- **명명 패턴(필요한 것만):**
  - **Gotchas** — 가정을 뒤집는 환경 사실(예: soft-delete 는 `WHERE deleted_at IS NULL`). *틀려서
    교정할 때마다 여기에 추가* → skill 이 자란다.
  - **Plan-validate-execute** — 배치/파괴적 작업.
  - **Validation loop** — 품질 중요 작업(validator → 수정 → 반복).
  - **Verification 게이트** — 종료를 *구체 증거*로("intuition alone is insufficient").
  - **anti-rationalization 테이블** — 에이전트가 둘러댈 변명을 선제 반박(예: "'단순해서 spec 불필요' →
    수용기준은 여전히 적용"). spec-gate 류 skill 에 강력.
  - **Red Flags** — 오용 징후 목록.
- **시간 의존 정보 금지**(폐기분은 `<details>` Old patterns). **용어 일관.** **예시는 구체적**(input/output 쌍, 복잡 skill 은 ≥3).

## 4. 정량 한도 (hard limit — validate 가 강제)
| 항목 | 규칙 |
|---|---|
| `name` | ≤64자, `^[a-z0-9]+(-[a-z0-9]+)*$`(연속·양끝 하이픈 금지), **부모 디렉터리명 일치**, 예약어(`claude`/`anthropic`) 금지 |
| `description` | ≤1024자, 비어있으면 안 됨, 3인칭, XML 태그 금지 |
| 본문 | **<500줄(~<5000토큰)**, 이상적 중앙값 **~920토큰** |
| 참조 파일 | **1단계 깊이**까지만, **>100줄이면 ToC** |

## 5. 번들 구조 — scripts / references / assets
skill = 폴더 1개 + `SKILL.md`(필수) + 선택적 하위 3종. **각각 역할이 다르다:**

| 폴더 | 용도 | 컨텍스트 적재 | 규칙 |
|---|---|---|---|
| `scripts/` | bash 로 *실행*되는 코드(깨지기 쉬운 정밀·반복 로직) | ❌ 코드 본문 미적재, 출력만 토큰 | **빈 `scripts/` 금지**(실제 실행물 없으면 만들지 말 것). forward slash. magic number 금지. |
| `references/` | 가끔 필요한 상세를 본문에서 링크, 필요 시 읽음 | 읽을 때만 | **1단계 깊이.** >100줄이면 ToC. 참조자료를 본문에 다 욱여넣지 말 것. |
| `assets/` | 복사해서 쓰는 **원본 틀**(템플릿) | ❌ 복사용 | 인스턴스는 별도 위치로 복사(예: workflow-manager 가 `assets/workflows/` → `<org>/workflows/`). |

판단 기준: **반복 로직이 trace 에 보이면 scripts 번들**, **길고 가끔 필요하면 references**, **찍어내는 틀이면 assets**.

## 6. 점진공개 3단계
1. **metadata**(name+description) — 시동 시 전 skill 로드(~100토큰/skill).
2. **SKILL.md 본문** — 트리거 시 로드. **얇게** 유지.
3. **번들 파일** — 필요 시만. (이 가이드 파일 자체가 3단계의 실례다.)
