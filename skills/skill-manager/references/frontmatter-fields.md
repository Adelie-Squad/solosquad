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
| `category` (v1.3.6 §3.4) | discovery/그룹화. **파싱+kebab-case 검증**(format lint; enum 강도는 org 레이어 소유) |
| `pm_conventions.{anti_sycophancy,post_labeling,hard_gate,minimum_approaches}` (v1.3.6 §3.4) | **파싱+검증**(`minimum_approaches` 정수≥1 강제) → decorative 아님 |

## 2. ⚠️ 감사 — pm_conventions·category 의 부채 해소 (v1.3.6 §3.4)
2026-06 실측(28 skill)에서 `pm_conventions`·`category` 는 `known` 집합에 없어 **`extra` 로 떨어지는 죽은
메타데이터**였다. v1.3.6 §3.4 에서 **파서가 surface + validator 가 강제**하도록 만들어 **load-bearing(core.md
§7 기준 ⑵ — validator-enforced)**으로 전환됐다(위 §1). 값 분포가 *남은* 처리(behavior 주입/글로벌화-제거)를 가른다:

| 필드 | 분포 | §6.1 결정 A — 잔여 처리 |
|---|---|---|
| `pm_conventions.anti_sycophancy` | 28/28 true | per-skill 정보 0 → **글로벌화**(Chief/PM base 1곳 + 28 skill 제거) |
| `pm_conventions.post_labeling` | 26 true / 2 false | 거의 균일 → **글로벌화 + 드문 예외**(예외는 본문에 사유) |
| `pm_conventions.hard_gate` | 17 false / 11 true | **진짜 가변** → exit_criteria 게이팅 behavior 주입 |
| `pm_conventions.minimum_approaches` | 16×1 / 12×2 | **진짜 가변** → "≥N 접근 비교" behavior 주입 |
| `category` | 7개 값 분산 | enum 강도 = org 레이어 taxonomy 소유(여기선 format lint 만) |
| `tier`/`used_by` | — | skill 에선 `extra`(agent-spec 에선 load-bearing) — skill 라우팅 미구동, **표시·문서용** |

> **완료(§3.4):** 파싱+검증(load-bearing 전환). **잔여(org 마이그레이션 합류):** 글로벌화-제거(28 skill 에서
> anti_sycophancy/post_labeling 삭제) + behavior 주입(skill 실행 프롬프트 경로) + category enum. 이유 — 28
> 파일 프론트매터·category taxonomy 가 조직 재편과 같은 파일을 건드려 그 패스에서 일괄 처리가 충돌 없음.
> **새 decorative 필드는 지금부터 추가 금지**(core.md §7).

## 3. 작성 시 체크 (skill 판)
- [ ] 추가하려는 커스텀 필드가 위 §1 `known` 표에 있나? 없으면 → `extra` 로 무시됨 → **추가 보류**.
- [ ] core.md §7 의 3-체크(known? enum/포맷 강제? 유도 가능?)를 통과하는가.
