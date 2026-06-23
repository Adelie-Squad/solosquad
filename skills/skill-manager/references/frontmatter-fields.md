# skill 고유 frontmatter — parser known set + 감사

> **공통 원칙은 `skills/skill-core/core.md` §7**(load-bearing vs decorative: 모든 커스텀 필드는 동작을
> 구동하거나 검증기가 강제해야 한다 — 둘 다 아니면 부채). 이 파일은 그 원칙을 **skill 에 적용한 실측**이다:
> skill-parser 가 실제로 파싱하는 필드(load-bearing)와 parsed-but-ignored(decorative) 목록.
> 근거: agency-agents 필드 드리프트(`color: cyan` vs `"#4285F4"`), `260617` Part I. 필요할 때만 읽힌다.

## 1. SoloSquad skill 확장 — skill-parser 가 *실제로 파싱*하는 것 (load-bearing)
`src/bot/skill-parser.ts` 의 `known` 집합에 든 키만 `SkillSpec` 으로 파싱된다(필수 `name`·`description`
= core.md §2·§3):

| 필드 | 구동하는 동작 |
|---|---|
| `team` | `<team>/<x>` 네임스페이스 해소 |
| `triggers.{slash,keyword,freq}` | description 자연어 매칭을 **구조화 트리거로 보강**(표준 대비 우위). slash 예약어 비충돌·freq cap(20) 검증 |
| `schema_version` | 포워드호환. 누락 시 deprecation warning |
| `dev_capability` / `dev_permissions` | **쓰기 권한 게이트(보안)**. `true` 면 `dev_permissions` 정합 필요(`merge.auto` 영구 금지) |
| `stateful`·`loop_mode`·`budget`·`inputs`·`outputs`·`handoff_to`·`scope`·`collab_pattern`·`confidence`·`source` | 각 런타임 동작(상태·피드백루프·예산 등) |

## 2. ⚠️ 감사 — SKILL.md 에서 *parsed-but-ignored* (현재 decorative, 2026-06 실측 28 skill)
다음 필드는 다수 SKILL.md 에 적혀 있으나 **`known` 집합에 없어 `extra` 백으로 떨어진다** — 파싱은 되나
**검증·구동되지 않는다.** 값 분포가 처리(글로벌화/wire/드롭)를 가른다(한 필드가 어디서나 같은 값이면
per-skill 정보가 아니라 글로벌 기본값):

| 필드 | 분포 | 판정 (v1.3.6 §6.1 결정 A — 전 skill 일괄) |
|---|---|---|
| `pm_conventions.anti_sycophancy` | 28/28 true | per-skill 정보 0 → **글로벌화**(Chief/PM base 1곳 wire + 28 skill 제거) |
| `pm_conventions.post_labeling` | 26 true / 2 false | 거의 균일 → **글로벌화 + 드문 예외**(예외는 본문에 사유) |
| `pm_conventions.hard_gate` | 17 false / 11 true | **진짜 가변** → **wire(load-bearing 승격)**, exit_criteria 게이팅 |
| `pm_conventions.minimum_approaches` | 16×1 / 12×2 | **진짜 가변** → **wire**, "≥N 접근 비교" 주입 |
| `category` | 7개 값 분산 | list 그룹화에 쓰면 **enum 강제**, 아니면 폴더서 유도 가능하니 **드롭** |
| `tier`/`used_by` | — | skill 에선 `extra`(agent-spec 에선 load-bearing) — skill 라우팅 미구동, **표시·문서용** |

> 구현은 v1.3.6 후속(글로벌화+wire+enum, 마이그레이션). 그 전까지 **기존 필드 유지**(형제 skill 과 일관) —
> 단 **새 decorative 필드는 지금부터 추가 금지**(core.md §7 작성 체크).

## 3. 작성 시 체크 (skill 판)
- [ ] 추가하려는 커스텀 필드가 위 §1 `known` 표에 있나? 없으면 → `extra` 로 무시됨 → **추가 보류**.
- [ ] core.md §7 의 3-체크(known? enum/포맷 강제? 유도 가능?)를 통과하는가.
