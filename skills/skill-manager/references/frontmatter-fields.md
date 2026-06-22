# SKILL.md frontmatter 필드 레퍼런스 + 감사 (load-bearing vs decorative)

> skill-manager 가 frontmatter 를 쓰거나 검토할 때의 기준. **원칙 하나로 압축된다:**
> **모든 커스텀 필드는 ⑴ 동작을 구동하거나(load-bearing) ⑵ 검증기가 강제(enum/포맷)해야 한다.
> 둘 다 아니면 순수 부채** — 작성 부담 + 드리프트 + "적혀 있으니 작동한다"는 착각(stale lie).
> 근거: agency-agents 필드 드리프트(`color: cyan` vs `"#4285F4"`), addyosmani(필드 2개로 극단 미니멀).

## 1. 필수 (Anthropic 표준)
| 필드 | 규칙 |
|---|---|
| `name` | ≤64자, kebab-case, **폴더명 일치**, 예약어 금지. → `references/authoring-guide.md` §4 |
| `description` | ≤1024자, 3인칭, 트리거 첫 문장. → authoring-guide §2 |

## 2. SoloSquad 확장 — skill-parser 가 *실제로 파싱*하는 것 (load-bearing)
`src/bot/skill-parser.ts` 의 `known` 집합에 든 키만 `SkillSpec` 으로 파싱된다:

| 필드 | 구동하는 동작 |
|---|---|
| `team` | `<team>/<x>` 네임스페이스 해소 |
| `triggers.{slash,keyword,freq}` | description 자연어 매칭을 **구조화 트리거로 보강**(표준 대비 우위). slash 예약어 비충돌·freq cap(20) 검증 |
| `schema_version` | 포워드호환. 누락 시 deprecation warning |
| `dev_capability` / `dev_permissions` | **쓰기 권한 게이트(보안)**. `true` 면 `dev_permissions` 정합 필요(`merge.auto` 영구 금지) |
| `stateful`·`loop_mode`·`budget`·`inputs`·`outputs`·`handoff_to`·`scope`·`collab_pattern`·`confidence`·`source` | 각 런타임 동작(상태·피드백루프·예산 등) |

## 3. ⚠️ 감사 — SKILL.md 에서 *parsed-but-ignored* (현재 decorative)
다음 필드는 다수 SKILL.md 에 적혀 있으나 **skill-parser 의 `known` 집합에 없어 `extra` 백으로 떨어진다**
— 파싱은 되지만 **검증·구동되지 않는다**(2026-06 실측):

| 필드 | 현실 | 판정 |
|---|---|---|
| `pm_conventions.{anti_sycophancy,hard_gate,post_labeling,minimum_approaches}` | ~28개 파일에 있으나 **읽어서 행동을 바꾸는 코드 0** | **죽은 메타데이터** — wire 하거나 제거 |
| `category` | `extra` 행. agent 쪽에서만 표시(`console.log`)·scaffold 기본값 | **decorative** — 폴더서 유도 가능, enum 강제 안 하면 드리프트 |
| `tier` | skill 에선 `extra`(agent-spec 에선 load-bearing). skill 라우팅을 frontmatter tier 로 구동하지 않음 | skill 에선 **약함** |
| `used_by` | skill 에선 `extra`(agent-validate 의 그래프는 agent frontmatter 용) | skill 에선 **표시·문서용** |

> **v1.3.6 결정 대상:** pm_conventions·category 를 **(a) 런타임에 연결**(예: 실행 시 `minimum_approaches`/
> `hard_gate` 강제)하거나 **(b) 일괄 제거**. 한 skill 만 손대지 말고 **전 skill 통일 적용**(스냅샷 드리프트 방지).
> 결정 전까지는 **기존 필드 유지**(형제 skill 과 일관) — 단 *새 필드를 decorative 로 추가하지 말 것*.

## 4. 작성 시 체크
- [ ] 추가하려는 커스텀 필드가 `known` 집합에 있나? 없으면 → `extra` 로 무시됨을 인지하고 **추가 보류**.
- [ ] enum/포맷 제약이 없는 자유 문자열 필드인가? → 대규모에서 반드시 드리프트. 검증기 강제 없으면 빼라.
- [ ] 폴더 위치·다른 필드에서 유도 가능한 정보인가? → 중복, 빼라.
