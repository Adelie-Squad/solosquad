# Changelog

All notable changes to SoloSquad are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.8.6] — 2026-05-20

**v0.8.6 — migrate Hotfix + Agent PR Workflow Doc.** v0.8.5 release 직후
사용자 테스트에서 발견된 회귀 hotfix. v0.8.5에서 `init.ts`의 stale 버전
상수를 동적 참조로 고쳤는데, *같은 패턴*이 `migrate.ts`에도 있었던 것을
grep 누락했었음. 결과: v0.4 이후 모든 minor/patch 버전에서
`solosquad migrate` (옵션 없이)가 `"Nothing to migrate."`로 silent no-op
되어 있었음. doctor는 mismatch 잘 감지했지만 안내 따라가도 결과 없음 →
workaround로 `--to 0.X.Y --apply` 명시해야 했던 잠재 회귀. 부수:
master-guide §10.4 (Uninstall 안전 순서 + 재설치로 migration 우회) +
§10.5 (봇·스케줄러·dev_capability 운영 + 다중-에이전트 PR 워크플로 setup)
박제. v1.x 자동 다중-에이전트 PR 토론 → 머지 설계 슬롯 박제.

자세히: `docs/plan/v0.8.6-migrate-hotfix-pr-workflow.md`

### Fixed — migrate.ts 회귀 (v0.4 이후 1년 잔존)
- `src/cli/migrate.ts:8` `CLI_VERSION_TARGET = "0.4.0"` 하드코딩 제거
- `src/util/version.ts`의 `SOLOSQUAD_VERSION` import로 동적 참조
- 효과: `solosquad migrate` (옵션 없이) → 현재 CLI 버전을 target으로 사용,
  워크스페이스가 구버전이면 정상적으로 chain 따라 migration
- 동일 패턴 회귀 방지: grep 결과 src/cli 디렉터리에서 stale 버전 상수
  추가 0건 확인

### Changed — master-guide §10.4 신설 (uninstall · 재설치 · migration 회피)
- 안전한 uninstall 6단계 (봇·스케줄러 정지 → dry-run → mode 선택 → archive
  보관 → REVOKE-CHECKLIST 외부 자원 정리 → npm 제거)
- uninstall + reinstall로 큰 migration chain 우회 흐름
  (`--mode archive-only` → re-init → `solosquad import`)
- 새 init 후 doctor 경고 7종 분류 표 (항상 표시 vs 조치 필요 vs 선택)
- "uninstall 직전 PID 정지 필수" warn callout — archive snapshot SHA 일치

### Changed — master-guide §10.5 신설 (봇·스케줄러·dev_capability 운영)
- 스케줄러는 디폴트 실행되지 않음 명시 — daemon / 자동 시작 0건
- `detectLivePids()` PowerShell 매칭 로직 공개
- PR 워크플로 전제 조건 3건 (gh CLI install + auth, repo Write 권한,
  workspace.yaml dev_capability 활성)
- 단일 에이전트 PR 생성 흐름 (PM 분류 → BD spawn → dev-confirm gate
  → push → gh pr create → works-handle URL 회신)
- 다중-에이전트 PR 리뷰·토론 현재 상태 표 — v0.8.6은 *반자동*
  (사용자가 spawn 명시 트리거), v1.x에서 자동
- 온보딩 추가 항목 5건 — Step 3.5/7.5/7.7/8.5/8.7 (gh auth / repo 검증 /
  dev_capability 활성 / 메신저 dry test / branch protection)
- 자동 머지 영구 거부 정책 재명시 (v0.8.2 박제)

### Added — v1.x agent PR workflow 설계 박제 (코드 없음, plan only)
- workflow.yaml schema v2: `git_workflow` (branch_pattern, auto_pr,
  pr_title_pattern) + `reviewers` 리스트 (agent, focus, timing) + cap
  (`discussion_rounds`, `auto_merge: false`)
- SKILL frontmatter 확장: `can_review_pr` + `review_focus` +
  `review_comment_template`
- `<org>/memory/pr-discussions.jsonl` audit log (FTS5 인덱싱)
- v1.x-workflow-goal-routine-evolution.md에 §추가 슬롯

### Migration
- `src/migrations/scripts/0.8.5-to-0.8.6.ts` — schema 변경 없음, version bump

## [0.8.5] — 2026-05-18

**v0.8.5 — Onboarding QA & Release-Gate.** v0.8.4 출시 직후 fresh init을
실제로 돌려본 결과 박제 patch. 핵심 회귀: `src/cli/init.ts:29`의
`SOLOSQUAD_VERSION = "0.4.0"` 하드코딩으로 신규 사용자가 init 직후 항상
migration 경고를 받던 문제 종료. 부수: master-guide가 v0.6.0 기준으로
정지된 것을 v0.8.5까지 backfill하고, 3-docs(product-roadmap·architecture·
master-guide) pre-publish gate를 `prepublishOnly`에서 자동 강제. wizard
prompt마다 *왜 묻는지* 헬프 1줄 추가 (handle/name/role/messenger/provider).

자세히: `docs/plan/v0.8.5-onboarding-qa.md`

### Fixed — init.ts hardcoded version 회귀 (§1)
- `src/util/version.ts` 신설 — `package.json`에서 동적 참조
- `src/cli/init.ts:29` `SOLOSQUAD_VERSION = "0.4.0"` 제거 → version.ts import
- 효과: fresh `solosquad init` 직후 `solosquad bot`이 CLI↔workspace mismatch
  경고 없이 정상 기동

### Added — 3-docs pre-publish gate (§2)
- `scripts/check-docs-freshness.ts` 신설 — `package.json.version`이
  product-roadmap · architecture · master-guide 3건에서 발견되지 않으면
  exit 1
- `npm run docs-check` script + `prepublishOnly`에 자동 게이트
- `.claude/rules/git-workflow.md`에 3-docs 룰 박제 (기존 stale 항목 정정)

### Changed — wizard 문구 정합 (§3, §4)
- Step 2 heading: "Initialize Workspace" → "Create Workspace"
- 부모에 `.solosquad/` 없을 때 redundant CWD prompt 제거 (mkdir로 이미 결정한
  디렉터리를 또 묻지 않음)
- 각 prompt 위에 헬프 1줄 추가 — name/role(PM·agent 톤), messenger(1 워크
  스페이스 = 1 메신저), org(사업 단위), provider(host 추정), handle(`[a-z0-9_]+`만)
- Slack scope 안내: `channels:manage` 굵게 + "Reinstall to Workspace"
  경고 강조 (`missing_scope` 마찰 해소)

### Added — master-guide §3.12 `.solosquad/` 위계 설명
- workspace/org/repo 3 단계 각각의 *시스템 메타 vs 사용자 콘텐츠* 분리 의도
- §4.2 Step 5: "초기화" → "생성" + mkdir 예시를 자유 이름 placeholder로
- §4.2.1 마법사 q&a 표 신설 (12 prompt × 왜 묻는가 × 입력 제약 × 저장 위치)
- §6.4 자동 루틴 표 갱신 — 디폴트 3건(Morning/Evening Brief + PM Compaction)
  + 인프라 2건 + 비-디폴트 4건으로 재정렬 (roadmap §3.2.8 정합)
- 버전 헤더 v0.6.0 → v0.8.5

### Removed — 분석 routine 4건 영구 제거 (roadmap §3.2.8)
- `assets/routines/signal-scan.md` · `experiment-check.md` · `weekly-review.md` ·
  `v06-retrospective-stats.md` 삭제
- `src/scheduler/routines.ts` ROUTINES 배열에서 4건 제거
- `src/scheduler/index.ts` `resolveSchedules` switch에서 3 case 제거
- `src/scheduler/v06-stats-extract.ts` + `test/v06-stats-extract.test.ts` 삭제
- `src/messenger/base.ts` SYSTEM_THREADS에서 분석 routine threads 3건 제거
- `assets/templates/goal.md` `## Signal Trigger` 절 제거 (parser는 optional이라 호환)
- `src/util/config.ts` `applyWorkspaceDefaults`가 `background_routines` 기본값을
  더 이상 주입하지 않음 (기존 키는 untouched pass-through)
- 사유: 분석 routine은 사용자 도메인 prompt가 있어야 의미. cron 슬롯/UI 자리
  차지할 가치 없음. 도메인 분석은 워크플로우/goal로 표현하는 게 맞음
- backward-compat: `workspace.yaml.background_routines` 키 read-ignore (에러 X)

### Changed — 인프라 routine 2건 통합 → `system-housekeeping`
- `assets/routines/archive-rotate.md` + `log-rotate.md` 삭제 →
  `assets/routines/system-housekeeping.md` 1건 신설
- `src/scheduler/routines.ts` ROUTINES: 2건 → 1건 (총 9→4)
- `src/scheduler/index.ts` inline dispatch에서 `rotateArchive()` + `rotateLogs()`
  를 try/catch로 각각 격리 후 순차 실행
- cron: 00:00 단일 슬롯 (이전 00:00 archive + 00:30 log 분리)
- 결정적 함수(`rotateArchive`, `rotateLogs`)는 변경 없이 그대로 호출
- 사유: 둘 다 silent · 결정적 · 멱등인 자정 housekeeping. 분리 cron 둘 이유
  없음. UI 1행 · cron 1슬롯 절약 + 사용자 인지 마찰 감소

### Migration
- `src/migrations/scripts/0.8.4-to-0.8.5.ts` — schema 변경 없음, version bump
- 기존 워크스페이스의 `background_routines` 키는 그대로 두되 schedule 등록 X

## [0.8.4] — 2026-05-16

**v0.8.4 — CLI Surface Reduction.** v1.0 정식 출시 전 마지막 비파괴적 플래그
정리. `docs/api-stability.md` §4가 "Removing a flag is major"라 박제 →
v1.0 이후엔 플래그 제거 불가. 이 슬롯에서 6축 정리: (a) `uninstall` 플래그
8→5 (`--mode <full|keep|archive-only>`), (b) `add repo --inspect` 별칭
deprecated, (c) `import --mode <merge|replace>` 패턴 정합, (d) `agent
validate --corpus` 내부 이동, (e) `solosquad backup list|delete|purge`
subgroup 신설, (f) `solosquad init` 워크스페이스 경로 명시 확인 prompt.

자세히: `docs/plan/v0.8.4-cli-surface-reduction.md`

### Added — `solosquad backup` subgroup (§7)
- `src/cli/backup.ts` 신규 — `~/.solosquad-backups/` 라이프사이클 단일 책임
- `backup list` — 모든 마이그레이션 백업 조회
- `backup delete <id>` — 단일 백업 삭제
- `backup purge [--keep-recent N] [--dry-run] [-y]` — 일괄 삭제(전체 또는
  최근 N개 유지)

### Added — `solosquad uninstall --mode` (§3)
- 3-state mode를 단일 플래그로 통합: `full`(기본·완전 정리) / `keep`
  (workflows·memory·knowledge 보존) / `archive-only`(아카이브만)
- `--mode keep` 선택 시 명시적 경고 — 봇 토큰/OAuth는 디스크에 남으므로
  REVOKE-CHECKLIST 별도 확인 필요
- `src/cli/uninstall-mode.ts` 신규 — 매트릭스 격리(테스트 가능)

### Added — `solosquad import --mode <merge|replace>` (§5)
- boolean `--merge`/`--replace` 두 플래그를 단일 `--mode`로 통합
- `src/cli/import-mode.ts` 신규 — 매트릭스 격리

### Added — `solosquad init` 워크스페이스 경로 확인 (§8)
- 기존 walk-up 자동 감지가 신규 init 의도와 어긋날 수 있는 시나리오 대응.
  CWD 기본 + 상위 워크스페이스 발견 시 3-way 선택지(현재 경로·기존 사용·
  커스텀 경로) 명시 prompt
- `src/cli/init.ts:resolveInitWorkspace()` 신규 함수 — `init` 한정 분기.
  다른 명령(`bot`/`status`/`logs` 등)은 walk-up 그대로 유지

### Added — Deprecation infrastructure (§10)
- `src/util/deprecation.ts` 신규 — `warnDeprecated()`·`warnDeprecatedOnce()`
- stderr 출력 + `SOLOSQUAD_NO_DEPRECATION_WARN=1` 환경변수로 silence 가능

### Changed — Deprecated alias 처리 (§10.1)
다음 플래그는 v0.8.4에서 동작 유지 + deprecation warning, **v1.0에서 제거**:

| 기존 | 대체 |
|---|---|
| `uninstall --archive-only` | `uninstall --mode archive-only` |
| `uninstall --keep-workspace` | `uninstall --mode keep` |
| `uninstall --also-purge-backups` | `backup purge` |
| `add repo --inspect` | `add repo --dry-run` |
| `import --merge` | `import --mode merge` |
| `import --replace` | `import --mode replace` |
| `migrate --list-backups` | `backup list` |
| `migrate --delete-backup <id>` | `backup delete <id>` |

### Removed — 즉시 제거 (v1.0 약속 발효 전이라 SemVer 안전)
- `uninstall --scrub-content` — speculative + best-effort regex 신뢰도 낮음.
  `src/lifecycle/archive.ts`에서 `ScrubMatch`/`PII_PATTERNS`/`scrubText`/
  `isScrubbableTextPath`/`renderScrubReport` 함수 + `scrub-report.tsv` 출력
  삭제. PII-NOTICE는 "자동 스크럽 없음, 외부 보관 전 별도 스캔 권장" 명시로
  단순화
- `agent validate --corpus` — dev-only regression. `npm run test:corpus`로
  이동(`package.json` scripts). CI 워크플로우는 `validate-skills` 한 줄로
  자동 호출

### Added — v1.0 Surface Freeze 체크리스트 (§11)
- 12 top-level + 30 subcommands across 11 groups = **42 commands**
- v1.0 진입 시 본 enumeration이 SemVer 약속 대상이 됨
- `docs/api-stability.md` §4가 본 plan §11을 canonical reference로 link

### Added — Tests
- `test/cli-deprecation.test.ts` — 5 cases (helper unit)
- `test/uninstall-mode-matrix.test.ts` — 6 cases (mode 매트릭스)
- `test/import-mode-matrix.test.ts` — 5 cases (mode 매트릭스)

### Changed — Documentation
- `docs/api-stability.md` §4 — v0.8.4 surface freeze link + migrate
  dry-run-by-default convention exception 명시
- `docs/manual/master-guide.html` §6 — uninstall/import/backup 명령 표
  갱신, init wizard에 `Initialize workspace at` step 안내 추가
- `docs/plan/v0.8.4-cli-surface-reduction.md` 신규 — 14절 + 17 작업 분해
- `docs/plan/product-roadmap.md` §5.1·§6 — v0.8.4 부활 entry 박제 (오늘
  오후 박제된 "v0.8.4 plan 폐기"의 amendment — 그 폐기는 메신저 polish
  한정이었음을 명시)

### Migration
- 별도 schema 마이그레이션 없음. CLI 표면 변경만이라 workspace.yaml 갱신
  불필요. 사용자는 자동으로 v0.8.4 binary로 업그레이드되며, 기존 스크립트는
  deprecation warning과 함께 동작 유지

## [0.8.3] — 2026-05-15

**v0.8.3 — Onboarding UX + Observability.** v0.8.x 시리즈의 마지막 패치.
사용자가 처음 SoloSquad를 만났을 때의 경험과 문제가 생겼을 때 디버깅하는
경험을 동시에 잡는다. 5축: (a) 기존 리포 마이그레이션 UX (`add repo
--dry-run`/`--inspect`/`--keep-original`), (b) logger 확장 + `solosquad
logs` CLI + log-rotate routine, (c) `solosquad logout` 제거, (d) doctor
CLI↔workspace version mismatch 감지, (e) trajectory 자동 등록 ROI 측정
박제.

자세히: `docs/plan/v0.8.3-onboarding-ux-observability.md`

### Added — 기존 리포 마이그레이션 UX (§3)
- `src/util/repo-inspect.ts` — 위험 시나리오 5종 감지 walker. 활성
  프로세스(lsof/handle.exe), 외부에서 들어오는 심링크, repo 내부 절대경로
  참조, slug 충돌, IDE workspace 파일 절대경로 설정. 각 detector는
  best-effort — 도구 부재 시 throw 대신 `available: false` 반환
- `solosquad add repo --dry-run` / `--inspect <path>` — 시뮬레이션
  보고서, 디스크 변경 0건
- `solosquad add repo --keep-original` — 이동 대신 복사

### Added — Logger 확장 + `solosquad logs` CLI (§5)
- `src/util/logger.ts` 확장 — `SOLOSQUAD_LOG_LEVEL`·`SOLOSQUAD_LOG_FORMAT=json`·
  `SOLOSQUAD_LOG_FILE=1` (rolling 14일). 기존 API backward-compat
- `src/cli/logs.ts` (신규) — `--level/--tail/--follow/--since/--type` (다중 type)
- `assets/routines/log-rotate.md` — 매일 00:30 silent retention

### Added — Doctor CLI ↔ workspace mismatch 감지 (§7.3)
- `recommendForVersionMismatch()` + `compareSemver()` — CLI > workspace →
  migrate 권고, CLI < workspace → update 권고

### Added — Trajectory ROI 측정 스크립트 (§8)
- `scripts/measure-trajectory-roi.ts` — v0.6 §3.X 4지표 측정. 측정값은 자체
  사용 데이터 30일 누적 후 별도 commit으로 박제. 본 패치는 스크립트만 commit

### Added — Migration 0.8.2 → 0.8.3
- `src/migrations/scripts/0.8.2-to-0.8.3.ts` — version bump + trajectory
  auto_register 기본값 + log-rotate routine 복사

### Removed — `solosquad logout` (§6)
- `src/cli/logout.ts` — deprecation stub만. v0.7 사용자 0명 전제로
  backward-compat 없음. `src/lifecycle/lockfile.ts`의 `logoutLockPath()`
  + `src/bot/index.ts`·`schedule`의 logout.lock 차단 제거

### Changed — Master-guide 재정합
- `docs/manual/master-guide.html` §3/§4/§6/§8/§9/§10 v0.7→v0.8 모델 흡수
  (멀티 유저 채널·dev_capability·archive/import/add-repo dry-run·
  update↔migrate 흐름도·관측성 절·6건 FAQ 추가)

### Tests
- 27 신규 (add-repo-dry-run·logger·logs-cli·doctor-version-mismatch)

## [0.8.2] — 2026-05-15

**v0.8.2 — Dev Capability.** 메신저로 코드 수정 + commit + push + PR 생성
end-to-end. SKILL frontmatter `dev_capability`·`dev_permissions` 신설.
**자동 머지 영구 거부**.

자세히: `docs/plan/v0.8.2-dev-capability.md`

### Added
- SKILL frontmatter `dev_capability` + `dev_permissions` (bash allow/deny,
  network, push_targets.requires_confirmation, merge.auto: false 영구 거부)
- 25 SKILL 박제: engineering 5건(backend-developer / fde / api-developer /
  creative-frontend / qa-engineer) `dev_capability: true` + 나머지 20건 false
- `workspace.yaml.dev_capability.enabled` 마스터 토글
- `src/bot/spawn-assembler.ts` `applyDevPermissions()` + read-only/dev-enabled
  reason 트래킹
- `src/bot/claude-process.ts` `--allowed-tools` + bashAllowlist pre-check
- `src/bot/dev-confirm.ts` — git push/gh pr merge 감지 + 30분 timeout +
  `<org>/memory/dev-confirmations.jsonl` audit
- `assets/orchestrator/SKILL.md` Engineering Spawn Template 절
- `src/cli/doctor.ts` `gh --version` + `gh auth status` 점검
- `src/migrations/scripts/0.8.1-to-0.8.2.ts`

### Tests
- 25 신규 (dev-capability-spawn / confirm / master-toggle / denylist)

## [0.8.1] — 2026-05-15

**v0.8.1 — Security & Lifecycle Pair.** npm audit 7건 → 0, archive 페어
완결(import + verify), API stability 문서 신설. v1.0 정식 출시 *전제* 항목 묶음.

자세히: `docs/plan/v0.8.1-security-lifecycle-pair.md`

### Added
- `solosquad import <archive.zip>` — dry-run + --merge[default]/--replace +
  journal idempotent (archive 페어 완결)
- `solosquad archive verify/info/list` — yauzl 기반 reader + manifest SHA
  대조 + schema 호환 확인
- `src/lifecycle/{import,archive-reader,merge-strategy}.ts`
- `docs/api-stability.md` — 6 schema_version의 bump 룰 + deprecation 기간
- 25 SKILL.md `schema_version: 1` 백필 (`scripts/inject-skill-schema-version.ts`)
- validator `SCHEMA_VERSION_MISSING` 경고 (v0.9 error로 promote)

### Changed
- discord.js `^14.16.0` → `^14.26.4` (undici 6.21.3 → 6.24.1)
- `package.json` overrides — axios·lodash·path-to-regexp·follow-redirects
- `.github/workflows/ci.yml` — `npm audit --audit-level=high` 게이트
- `src/migrations/scripts/0.8.0-to-0.8.1.ts`

### Security
- **npm audit 7 vulnerabilities → 0** (3 moderate + 4 high 모두 해소)

### Tests
- 26 신규 (import / archive-verify / merge-strategy)

## [0.8.0] — 2026-05-15

**v0.8 — Multi-User Messenger.** "1 워크스페이스 = 1 owner = 1 봇 = 2 채널"
가정을 깬다. 같은 Discord 서버·Slack 워크스페이스에 N명의 팀원이 각자
머신에서 SoloSquad를 설치할 수 있으며, 각 사용자는 자기 명령/작업 채널
페어를 가진다. 정식 출시 전 마지막 *큰 모델 변경*.

자세히: `docs/plan/v0.8-multiuser-messenger.md`

### Added — Multi-user identity layer
- `src/bot/user-registry.ts` — `<org>/.solosquad/users/<handle>.yaml`
  파서 + `findUserByBotId` (봇 startup 자기 매칭) + handle 정규화·충돌
  명시적 거부 (§3.5 박제 — silent `-2` suffix 안 함)
- `src/bot/author-guard.ts` — `(command|works)-<handle>` 채널에서 owner ↔
  author handle 비교, 미일치 시 ephemeral DM 후 메시지 무시 (defense in
  depth; 메신저 ACL이 1차 방어선)
- `src/bot/channel-bootstrap.ts` — `bot_user_id` → user yaml 매칭 +
  designated 봇 단일 발송 결정 (broadcast §3.6)

### Added — Broadcast (opt-in)
- `src/messenger/broadcast.ts` — `workspace.yaml.messenger.broadcast_enabled`
  opt-in. `isDesignatedBroadcaster()` 가 true 일 때만 brief push, 나머지
  봇은 자기 `works-<handle>` 로 — N건 중복 0
- `solosquad messenger broadcast-handover --to <handle>` — designation 이양

### Changed — Adapter channel model
- `src/messenger/discord-adapter.ts`: hardcoded `"owner-command"` 비교 제거.
  `command-<handle>` 정규식 매칭 + private 채널 자동 생성 (Discord 채널
  type 0 + permission overwrites)
- `src/messenger/slack-adapter.ts`: `SLACK_COMMAND_CHANNEL` env 제거. auth.test
  로 bot_user_id 획득 후 `conversations.create({is_private: true})`
- `src/cli/init.ts`: Step 5.2 신설 — 봇 토큰 입력 직후 messenger API 호출
  (Discord `/users/@me`, Slack `auth.test`) → handle 추출 → 사용자 확인
  prompt → `<org>/.solosquad/users/<handle>.yaml` 저장
- `src/bot/spawn-assembler.ts`: 8-layer JIT Layer 5 에 user yaml (handle·
  display_name·messenger·channels) 주입 — specialist 가 "누구의 명령인가"
  인식. bot_user_id·토큰은 의도적으로 제외
- `src/cli/doctor.ts`: §4.5 "Multi-user messenger (v0.8)" 점검 — 봇 토큰
  ↔ user yaml 매칭, broadcast designation 일치, 채널 페어 존재

### Migrations
- `src/migrations/scripts/0.7.0-to-0.8.0.ts` — workspace.yaml version 0.7.x
  → 0.8.0 + `messenger` 기본값 + 첫 user yaml 시드 (env 봇 토큰 → API 호출;
  실패 시 OWNER_NAME 폴백). idempotent. v0.7 사용자 0명 전제이므로 legacy
  `owner-command`/`workflow` alias 매핑 작업 0건 (§3.7 박제). verify 단계에서
  legacy 채널 안내 1줄

### Removed
- 채널 이름 `owner-command`/`workflow` — 봇은 더 이상 listen 안 함. 기존
  채널은 메신저에서 수동 archive 권장 (마이그레이션 안내 1회 출력)
- `process.env.SLACK_COMMAND_CHANNEL` — 채널 이름이 yaml 로 이동

### Tests
- 28 신규 (test/user-registry·author-guard·channel-bootstrap.test.ts).
  452 + 28 = 480 회귀 그린 (v0.6.x 보유 회귀와 일부 v0.7 회귀 변경 반영
  후 478 통과)

## [0.7.0] — 2026-05-15

**v0.7 — Uninstall & Lifecycle (Farewell Archive).** install ↔ uninstall
2단으로 라이프사이클을 닫는 인프라 릴리스. `solosquad reset`·`solosquad
clean` 같은 "초기화" 명령은 영구히 추가하지 않음 — 재설치는 *uninstall +
farewell archive + 새 워크스페이스 init*으로 자연 표현. v1.0 정식 출시
직전의 라이프사이클 완성 슬롯.

자세히: `docs/plan/v0.7-uninstall-lifecycle.md`

### Added — Farewell archive infrastructure
- `src/lifecycle/classify.ts` — 데이터 5분류 walker. A(사용자 코드)는 트리
  enumerate 자체를 안 함, A*(repo.yaml)는 whitelist 길이 1로 surgical 추출,
  B(누적 지식)·C(운영 메타)·D(시크릿)·E(외부 자원) 처리 정책 분리
- `src/lifecycle/manifest.ts` — SHA256 + `manifest.tsv` (streaming writer
  단계에서 동시 계산, zip 재오픈 비용 0). `createHashTap()` API
- `src/lifecycle/sqlite-backup.ts` — v0.6 `<org>/memory/archive.sqlite`
  WAL-safe 백업. `better-sqlite3 ^12.10.0` `backup()` API (Hermes 차용 패턴)
- `src/lifecycle/lockfile.ts` — concurrent-uninstall 차단. `<workspace>/
  .solosquad/uninstall.lock` 원자적 acquire (POSIX/Win32 `O_CREAT|O_EXCL`)
  + stale PID 자동 정리 + `LockHeldError`
- `src/lifecycle/journal.ts` — `uninstall.journal.jsonl` append-only +
  idempotent 재개. cleanup 50% 중단 시 워크스페이스 partial 상태 차단
- `src/lifecycle/precheck.ts` — 8개 점검: repositories git drift / PM·
  scheduler PID / archive 경로 writable / 디스크 free × 1.5 / workspace
  git tree / lockfile 상태 / journal 재개 / classification 요약
- `src/lifecycle/repo-meta.ts` — class A* surgical 추출 (whitelist 길이 1)
- `src/lifecycle/revoke-checklist.ts` — `REVOKE-CHECKLIST.md` 동적 생성.
  Discord application ID (.env에서 추출 + base64-decoded token prefix),
  Slack 채널(관례 + .env), ~/.claude/projects 추정 경로, pm2·systemctl·
  crontab 점검 명령 동봉. archive 안 + workspace root에 동시 생성
- `src/lifecycle/cleanup.ts` — 클래스별 삭제 + journal 통합 +
  `--keep-workspace` 매트릭스. repositories/<repo>/는 `.solosquad/` 1개만
  surgical 제거. 다른 모든 repo 경로 SHA1 대조 assertion
- `src/lifecycle/archive.ts` — archiver streaming zip writer.
  PII-NOTICE.md 자동 동봉 + `--scrub-content` opt-in regex 룰셋
  (이메일·카드번호·SSN·주민번호·전화). adm-zip OOM 위험으로 제외하고
  archiver 박제

### Added — CLI commands
- `solosquad uninstall [--dry-run --archive-only --keep-workspace
  --also-purge-backups --scrub-content --force --archive-path <p>]` —
  0-4 단계 오케스트레이션. 사용자 코드는 절대 미손상. archive 강제 selecting
  (`--no-archive` 같은 플래그 없음)
- `solosquad logout [--org <slug> --all --force]` — 가벼운 logout.
  .env 마스킹 + sessions `_archived/`로 + REVOKE-CHECKLIST + `logout.lock`
  드롭. archive 안 함. PM/scheduler PID 살아 있으면 `--force` 없이는 거부
- `solosquad bot` / `schedule` — `logout.lock` 존재 시 진입 거부 (마스킹된
  .env로 재시작 무한 retry 차단)

### Added — doctor v0.7 점검 항목
- npm v7+ 글로벌 훅 한계 경고 (`solosquad uninstall`을 `npm uninstall -g
  solosquad` *전*에 실행 권고)
- stale `uninstall.lock` 감지 (PID 사망)
- `logout.lock` 존재 경고
- PM/scheduler PID 점검
- archive 기본 디렉토리(`~/`) free space 점검 (200MB 미만 시 경고)

### Added — Migration
- `src/migrations/scripts/0.6.0-to-0.7.0.ts` — 0.6.x → 0.7.0 버전 bump +
  `workspace.yaml.uninstall` 기본값 추가 (`default_archive_dir: ~/`,
  `scrub_content_default: false`). schema 변경 거의 없음 (uninstall
  인프라 신설 위주)

### Added — Dependencies
- `archiver ^7.0.1` — streaming zip writer

### Added — Documentation
- `docs/plan/v0.7-uninstall-lifecycle.md` §10 17건 + P0/P1/P2 패치 흡수
- `docs/plan/architecture.md` §13.5 v0.7 lifecycle 추가
- `docs/plan/product-roadmap.md` v0.7.0 entry + 결정 로그
- `docs/manual/master-guide.html` §6.1 CLI 표 + §8.1 v0.7 절 추가
- `assets/.env.example` — 시크릿 키마다 "masked on uninstall — see v0.7
  spec" 주석 추가

### Tests
- `test/lifecycle-secrets.test.ts` — 시크릿 키 패턴 매칭·.env 마스킹·dry-run
  무변경·user-defined 패턴 확장
- `test/lifecycle-classify.test.ts` — 5분류 + repositories/ 트리 enumerate
  차단 + A* whitelist 길이 1 검증
- `test/lifecycle-manifest.test.ts` — TSV 헤더·tab escape·sha256 일관성·
  hash tap 등가성
- `test/lifecycle-lockfile.test.ts` — 원자적 acquire + stale 자동 정리 +
  cross-platform PID alive 검출
- `test/lifecycle-journal.test.ts` — append + 재개 검출 + runId 스코프 +
  malformed line skip
- `test/lifecycle-archive-e2e.test.ts` — 시크릿 0건 + 사용자 코드 0건 +
  필수 entry 포함 검증
- `test/lifecycle-cleanup.test.ts` — dry-run zero-write + surgical 제거 +
  `.solosquad/` 외 byte-identical 보장 + `--keep-workspace` 보존 +
  repo.yaml 누락 시 cleanup 미진입

회귀 그린: 452/452 (v0.6 421/421 + v0.7 신규 31).

### Removed
- "초기화" 명령 (`solosquad reset` / `solosquad clean`) 영구 거부 결정 —
  install ↔ uninstall 2단으로 충분 (OpenClaw Issue #6289 안티패턴 회피)

### Decision rationale (요약)
- **Hermes** 차용: `--full` 분리, WAL-safe SQLite `backup()`, `import` 페어
  (`solosquad import` 자체는 v1.0 슬롯)
- **gstack** 차용: `--keep-state` 플래그 (본 릴리스의 `--keep-workspace`)
- **gh CLI** 차용: logout/data-removal 분리, server-side revoke 한계 명시
- **OpenClaw** 안티패턴 회피: 전체 삭제 디폴트 + opt-in 거부 → 비복구 데이터
  손실 (Issue #6289 closed as not planned)
- **npm v7+ 글로벌 훅 부재** (npm/cli#3042): user-invoked `solosquad
  uninstall` 서브명령이 라이프사이클의 유일한 신뢰 진입점

## [0.6.0] — 2026-05-14

**v0.6 — 디폴트 워크플로 튜닝 + 메모리 아카이브 + 패턴 자동 추출 + 조직 레이어.**
v0.3~v0.5에서 누적된 실전 데이터를 회고할 인프라 + 누적 메모리의 FTS5 검색 +
반복 패턴 자동 SKILL 추출 + org × agent 색채/budget 분리 + chokidar
hot-reload + CI PR 봇 + 0.5→0.6 마이그레이션을 한 릴리스에 통합. v1.0
정식 출시 전 마지막 안정화 슬롯.

코드 분량: ~12,000 LOC (sprint S1·S2·S3·S4·S5·S6.A·S6.B·S6.C 합산).
신규 테스트: 152 (총 회귀 421/421 그린).

### Added — Org Layer Specialization (S3)
- `<org>/core/{PRINCIPLES,VOICE}.md` — 조직 철학·톤 (workspace core override)
- `<org>/agent-profile.yaml` — 25 agent 조직별 modifier. defaults + 좁힘만
  허용 + `schema_version: 1` forward-compat
- `<org>/domain/` — 조직 도메인 지식
- `~/.solosquad/agent-profile-defaults.yaml` — user-global 상속 (P2 #11)
- `assets/knowledge/` — bundled workspace knowledge 시작 가이드 (§2.3)
- `src/bot/spawn-assembler.ts` — 8-layer JIT inject + token cap (기본
  80,000) + 우선순위 drop 표
- `src/bot/agent-budget.ts` — `<org>/memory/agent-costs.jsonl` 누적 +
  daily/weekly cap + on_cap_action (P0 #1)
- `src/util/agent-profile.ts` — 3-tier merge + budget narrowing invariant
- `src/util/paths.ts` `getKnowledgeDir()` — `.solosquad/knowledge/` >
  `assets/knowledge/`

### Added — FTS5 cold archive (S4)
- `src/memory/{archive-db,archive-rotate,archive-search,
  route-event-sink}.ts` — FTS5 인덱스 + JSONL → SQLite 일일 이전 +
  retention 정책 (기본 365일) + compress_before_delete 옵션
- 4 event_type 인덱싱 — `route_hit / route_miss / author_turn /
  spawn_decision` (§4.6)
- `src/bot/agent-router.ts` archive_fallback — 라우터 미스 시 회상 + 1회
  사용자 통지
- `src/cli/memory.ts` — `solosquad memory search/stats [--disk]`
- `assets/routines/archive-rotate.md` — 매일 00:00 야간 정리
- `better-sqlite3 ^12.10.0` 의존성 추가

### Added — Trajectory + Freq miner + Stop-hook (S5)
- `src/scheduler/trajectory-extractor.ts` — pm-compaction 야간 실행. 같은
  (agent sequence + workflow template) 30일 내 3회+ 패턴 추출. **v0.5
  `applyDraft()` 직접 import 재사용** (P0 #3 — 별도 applier 0)
- `src/scheduler/freq-keyword-miner.ts` — route_miss + author-draft N-gram.
  30일 거절 cooldown. frontmatter-only `applyDraft({ mode })` 정식 옵션
- `src/engine/stop-hook-adapter.ts` — v0.5 `loop_mode.spec-gate` 실 작동.
  DSL 3형식 (`command / metric / natural` — P1 #5). 5초 timeout +
  conservative continue
- `assets/templates/hooks.json` — Anthropic 2025-12 stop-hook 플러그인
  설정 예시

### Added — 폴더 재편 + 핸드오프 3패턴 (S2)
- `agents/_teams/*/TEAM_KNOWLEDGE.md` × 4 → `agents/{team}/KNOWLEDGE.md`
  (§2.1 — `git mv` history 보존)
- `src/bot/agents-builder.ts` `listTeamKnowledge()` 추가
- `assets/templates/handoff-{hierarchical,graph,dynamic}.md` — §2.4 3변형
- 25 SKILL.md `collab_pattern` frontmatter (22 hierarchical / 2 graph /
  1 dynamic) — `scripts/inject-collab-pattern.ts` idempotent

### Added — readiness check + ETL + onboarding (S1 부분)
- `src/cli/readiness.ts` — `solosquad readiness check --target v0.6`.
  v0.5 author 데이터·4종 워크플로 실행 카운트·author SKILL Y건·ledger
  분석 — 통과/부족 판정 + exit code
- `src/cli/detect-v05-usage.ts` — `detectV05Usage(workspace): boolean` —
  §2.6 신규 vs 기존 v0.5 사용자 분기
- `src/scheduler/v06-stats-extract.ts` — 5 v0.5 데이터원 ETL → Markdown
  보고서 (회고 #1~#4 자료)
- `assets/routines/v06-retrospective-stats.md`
- `src/cli/init.ts` Step 6.5 onboarding 두 트랙 분기 (§2.6)

### Added — Hot-reload + CI PR 봇 (S6.A + S6.B)
- `src/bot/fs-watcher.ts` — chokidar 3-tier watch (Windows + WSL은
  강제 polling) + debounce 300ms
- `src/bot/reload-policy.ts` — auto/prompt/manual mode + `git_only` safe
  mode (HEAD ≡ upstream + clean tree만 허용)
- `solosquad agent reload` — manual mode 명시 호출
- `.github/workflows/skill-review.yml` + `scripts/skill-pr-review/` 6
  모듈 — PR diff frontmatter 표 + 키워드 충돌 경고 + agent-profile
  스키마 검증 + core lint + domain term overlap
- `chokidar ^4.0.3` 의존성 추가

### Added — Migration 0.5.0 → 0.6.0 (S6.C)
- `src/migrations/scripts/0.5.0-to-0.6.0.ts` — 2-pass dry-run + 사람
  검수 게이트. v0.5 ledger의 `pending_v0.6_redestination: true` 항목
  자동 재분류 (role → agent-profile.yaml H2/H3 휴리스틱 추출, domain →
  `<org>/domain/`). fail-soft는 `human_review_required: true` 마킹 +
  자동 적용 거부. migration budget cap (P0 #2) + `<org>/memory/
  migration-costs.jsonl` 누적
- `assets/templates/agent-profile.yaml` — minimal defaults + schema_version
- `assets/templates/migration-redestination-report.md`

### Changed
- `src/bot/skill-parser.ts` — `collab_pattern` 정식 `SkillSpec` 필드로
  격상 (v0.5에선 `extra` bag 처리). `serializeFrontmatter` 출력 순서에
  추가
- `src/bot/skill-author.ts` `applyDraft({ mode: "full" | "frontmatter-only" })`
  정식 옵션. `frontmatter-only`는 body 보존 + 재파싱 byte-identical
  invariant 검증
- v0.6 §머리말 "확정 시점 4~6주 격차" — 회고 #1·#2·#3 본문 갱신은
  데이터 누적 후 별도 작업. 코드는 모두 출시
- `solosquad bot` 부팅 시 fs.watch + graceful shutdown 설치
- `solosquad init` v0.6 신설 자산 자동 스텁(`<org>/core/`·
  `agent-profile.yaml`·`domain/`)

### Migration notes (0.5.x → 0.6.0)
1. `npm install -g solosquad@0.6.0`
2. `solosquad migrate --dry-run` — Pass 1 시뮬레이션 + 보고서
   `<org>/memory/migration-2026-XX-dryrun.md`
3. 보고서 검토 후 `solosquad migrate --apply --confirm`
4. `human_review_required: true` 마킹된 항목은 사용자가 사후 수동 보강
5. Pass 2 — `solosquad agent validate --all` 자동 실행 + 실패 항목
   STDOUT 보고

### Removed
- `assets/agents/_teams/` 디렉토리 (KNOWLEDGE.md 4개 이동 후)
- `dist/`에서 사용자 워크스페이스의 *.solosquad/agents/_teams/* 도 마이그레이션이 처리

---

## [0.5.1] — 2026-05-14

**문서 정확성 patch.** 코드 변경 0. `AGENTS.md`와 `README.md`가 v0.5.0
출시 후에도 v0.2.4 / v0.4 시점 표현을 유지하던 부분 일괄 정정. npm
패키지에 포함되는 두 파일이라 *교차 도구 정확성* + *npm registry 페이지*
신뢰성에 영향 — patch bump.

### Changed
- `AGENTS.md` (cross-tool guide) — L130-131 "Legacy keyword routing
  (AGENT_ROUTES) is retained..." 단락을 v0.5 frontmatter 기반 4채널
  라우팅 + 3-tier 검색 설명으로 교체. AGENT_ROUTES 상수가 v0.5에서
  제거됐다는 사실 반영. scheduler routine은 agent name 직접 호출로
  라우터 우회한다는 점 명시.
- `README.md` — v0.2.4 baseline에서 v0.5.0 baseline으로 일괄 갱신:
  - 헤더·CLI Reference 헤더 v0.2.4 → v0.5.0
  - CLI 표 재구성: 7 그룹(workspace ops / PM v0.3 / 자율 v0.4 / agent
    작성 v0.5 / repo analyzer v0.5 / migration / org·repo) + 18 신규
    명령 추가 (pm/workflow/rollback/goal/agent/analyze 그룹)
  - Architecture: keyword routing 설명 → PM session + 4채널 + native
    Task tool. v0.5 author 루프 + v0.4 goal-runner 2 단락 추가
  - "60+ keyword mappings" 단락 제거 → v0.5 4채널 frontmatter 라우팅
  - Five → Six automated routines (v0.3 PM Compaction 23:00 추가)
  - Versions 표 — v0.3/v0.4/v0.5 모두 released
  - Repository Layout 갱신 — engine/, analyze/, AGENTS.md, <org>/.agents/,
    _meta/workflow-maker/, goals/, analysis-ledger.yaml, freqCooldowns,
    author-costs.jsonl, ~/.solosquad/agents/, docs/poc/ 모두 반영
  - 깨진 링크 4건 수정 (concept-guide → master-guide, docs/product-roadmap
    → docs/plan/product-roadmap)

### Removed
- `docs/plan/v0.5-agents-md-patch.md` — AGENTS.md 적용 완료 후 임시
  문서 정리. git history(45ad153 이전 commits)에 보존.

### Notes
- `dist/`·`assets/`·코드 변경 0. 0.5.0 → 0.5.1 사용자 무위험 업데이트.
- `solosquad@latest` = 0.5.1 (자동 갱신).

---

## [0.5.0] — 2026-05-14

**v0.5 — Workflow maker & SKILL.md frontmatter routing.** 메신저 author
루프(`workspace-maker` 메타-skill) + 4채널 라우터(slash/explicit/keyword/freq)
+ 3-tier 검색 경로(org/user/bundle) + repo analyzer를 통합 출시. v0.4
goal-runner와도 `loop_mode.kind: spec-gate`로 연결되어 author 루프
산출이 자율 cycle로 등록 가능.

### Added — frontmatter + routing
- `src/bot/skill-parser.ts` — Anthropic Agent Skills 호환 SKILL.md
  frontmatter 파서 + validator. 필수 필드 `name`·`description`, SoloSquad
  확장(`team`/`stateful`/`triggers`/`loop_mode`/`budget` 등) 옵션.
- `src/bot/agent-router.ts` — `buildRoutes()` 3-tier 스캔 + 4채널 resolver
  (priority slash > explicit > keyword > freq). hot-reload atomic swap.
- `src/bot/meta-skill-scanner.ts` — `_meta/*` 폴더 전용 scanner — explicit
  채널만 등록.
- `src/cli/agent.ts` — `solosquad agent validate / add / list / info` CLI 그룹.

### Added — author loop
- `assets/agents/_meta/workflow-maker/SKILL.md` + references — author 메타-skill.
- `src/bot/skill-author.ts` — CLARIFY → DRAFT → SANDBOX_PROMPT → AWAIT_CONFIRM
  → APPLIED 상태기. 5턴 이내 완결 목표. `loop_mode.kind: spec-gate` draft는
  `<org>/goals/<goal-id>/goal.md`도 자동 생성(§3 분기).
- `src/util/cost.ts` + `src/bot/author-budget.ts` — paperclip envelope 차용
  일/주 budget cap + `<org>/memory/author-costs.jsonl`.

### Added — repo analyzer
- `src/analyze/scanner.ts` · `ledger.ts` · `classifier.ts` ·
  `workflow-matcher.ts` · `report-writer.ts` · `applier.ts` — 4-label 분류,
  결정적 매칭, ledger 증분 처리, applier backup/apply/verify/rollback.
- `src/cli/analyze.ts` — `solosquad analyze repo` 진입점.

### Added — migration 0.4.0 → 0.5.0
- `src/migrations/scripts/0.4.0-to-0.5.0.ts` — 2-pass.
  - Pass 1 (자동): SKILL.md frontmatter backfill (3-tier 검색 경로의 모든
    SKILL.md), `~/.solosquad/agents/`·`<org>/.agents/`·`<org>/.solosquad/
    analysis/` 디렉토리 + README, `workspace.yaml`에 `skill_loader` +
    `author` 섹션, 버전 0.4.0 → 0.5.0.
  - Pass 2 (CI 게이트): `solosquad agent validate --all` — `npm run
    validate-skills` + `.github/workflows/ci.yml`에서 실행.
- `src/migrations/skill-frontmatter-backfill.ts` — `CANONICAL_KEYWORDS` 상수
  (구 `AGENT_ROUTES` 60+ 키워드 → 25 agent 매핑 복원) + `buildBackfillFrontmatter()`
  공유. 번들 backfill 스크립트와 마이그레이션이 동일 로직 사용.
- `scripts/backfill-bundled-frontmatter.ts` — 번들 25개 SKILL.md에
  frontmatter 1회 주입(idempotent). 결과 파일 커밋 — 신규 `solosquad init`
  사용자는 즉시 frontmatter-완전 상태.

### Added — assets
- `assets/agents/{team}/{agent}/SKILL.md` (25개) — frontmatter prepended
  (canonical 키워드 매핑 그대로 보존).
- `assets/templates/goal-from-skill.md` — spec-gate SKILL이 만드는 goal.md
  베이스. 단일 `spec_gate_pass` 메트릭 + 단일 stage 파이프라인 시드.
- `assets/templates/workflow.yaml` — 다단계 workflow chain 템플릿(§9 #15).

### Added — tests
- 15 new unit tests:
  - `test/migration-v0.5.test.ts` (10) — mocked v0.4 workspace → 25 SKILL
    backfill, workspace.yaml patch, 3-tier dirs, idempotency, verify.
  - `test/skill-author-goal-gate.test.ts` (5) — spec-gate draft → goal.md
    parseable by `src/engine/goal-parser.ts`.
- Full suite **269 green** (이전 254 + 15).

### Changed
- `src/util/config.ts` — `SkillLoaderConfig` + `AuthorConfig` 인터페이스 추가,
  `WorkspaceYaml`에 `skill_loader?`/`author?` 필드.
- `src/bot/skill-author.ts` — `applyDraft`가 spec-gate draft에 대해
  `<org>/goals/<goal-id>/goal.md` 자동 emit (caller-supplied `draft.goal_md`가
  있으면 그것을 우선 사용).
- `package.json` — version 0.4.0 → 0.5.0, `validate-skills` 스크립트 추가.
- `.github/workflows/ci.yml` — `npm run validate-skills` 게이트 추가.

### Removed
- `AGENT_ROUTES` 하드코드 상수 (S2 commit b1651d9). 키워드 라우팅은 이제
  각 SKILL.md의 `triggers.keyword` frontmatter에 분산 — `buildRoutes()`가
  부트 시 수집.

### Migration notes (사람 검토)
- `AGENTS.md` L131 "Legacy keyword routing…" 단락은 v0.5 정책에 맞춰
  사람이 직접 수정해야 함. 정확한 교체 문장은 `docs/plan/v0.5-agents-md-patch.md`
  참조. AI 도구는 `AGENTS.md`를 수정하지 않음(immutable).

## [0.4.0] — 2026-05-13

**v0.4 — Autonomous goal engine.** 사용자가 한 번 작성한 `goal.md`를
`solosquad goal run` 1회 호출로 N시간 자율 반복 — 메트릭 게이팅, git
rollback 기반 keep/discard, 누적 비용 캡, 결정론 검증까지 통합. Codex
`/goal` + `AGENTS.md` 2계층 구조 채택, autoresearch의 운영 패턴(메트릭
+ git revert) 차용.

### Added — engine
- `src/engine/goal-parser.ts` — `goal.md` frontmatter + 본문 섹션
  (Metrics·Pipeline·Budget·Termination·Signal Trigger·optional
  Modifiable Paths Override) 파싱. 가드레일은 AGENTS.md로 이전.
- `src/engine/agents-md-loader.ts` — `<workspace>/AGENTS.md` 단일 영속
  가이드 로더. immutable_paths · modifiable_paths · external_side_effects
  · guardrail thresholds 추출. 파일/섹션 부재 시 DEFAULT_GUIDE fallback.
- `src/engine/guards.ts` — 3-tier 가드레일 순수 함수: resolvePaths,
  preflightInputGuard, runtimeGuard (timeout · discard streak · cost cap
  90% 워닝), outputGuard (forbidden side-effects + HTTP whitelist),
  pathMatches (segment 기반 prefix 매칭, placeholder·glob 지원).
- `src/engine/tracker.ts` — `results.tsv` 10필드 append-only + `_best.json`.
  maybeUpdateBest의 CONFIRMING 게이트 (모든 메트릭 ≥ threshold). 
  joinEventsByTaskId로 results.tsv × `_events.jsonl` JOIN.
- `src/engine/evaluator.ts` — 메트릭 측정 → keep/discard → git-snapshot
  호출. MetricMeasurer 인터페이스로 측정 로직 주입.
- `src/engine/reconciliation.ts` — `goal verify` 결정론 재계산 검증.
- `src/engine/goal-runner.ts` — `GoalRunner.run()` 전 흐름: preflight →
  bg PM session (`bg-<goal-id>-<runId>`) → cycle loop (snapshot ·
  pipeline via Task tool · evaluator · CONFIRMING 사다리) → `_last-run.md`
  작성. 메신저 직접 전송 금지 (Output 가드).

### Added — CLI
- `solosquad goal new / list / show / run / status / stop / verify` 7개
  서브커맨드. `goal run`은 `--hours N | --cycles N` 오버라이드 지원.

### Added — assets
- `assets/templates/goal.md` (의도서 템플릿)
- `assets/templates/AGENTS.md` (워크스페이스 단일 영속 가이드 템플릿)
- `assets/orchestrator/goal-md-spec.md` (PM SKILL append — background
  자율 모드 프로토콜)

### Added — tests
- 34 new unit tests (goal-parser, agents-md-loader, guards, tracker,
  migration-v0.4). Full suite is **109 green**.

### Changed
- `src/util/config.ts` — `GoalConfig` interface + `WorkspaceYaml.goal?`
  필드 추가.
- `src/migrations/scripts/0.3.0-to-0.4.0.ts` (신규) — 비파괴 마이그레이션:
  각 org에 `<org>/goals/` 생성, 워크스페이스 루트 `AGENTS.md` 생성
  (기존 CLAUDE.md 컨텐츠 1회 복사, 원본 untouched), `workspace.yaml`에
  `goal:` 섹션 추가, 버전 0.3.0 → 0.4.0.
- `src/cli/index.ts` — `solosquad goal` 그룹 7개 서브커맨드 등록.

### Compatibility
- v0.3 (PM 모드) 인프라 전부 공존 — v0.4가 PM-runner·git-snapshot·events·
  session-store·agents-builder를 재사용.
- `solosquad rollback --workflow <id>`도 자율 run의 cycle commit 동일
  메커니즘으로 revert.
- 자율 run 미사용 사용자에게 v0.4 영향 0 (signal_trigger 디폴트 false).

### Known limitations (v0.4.x patch)
- `MetricMeasurer`는 placeholder (해시 기반 결정론적 값). 실제
  source+formula 평가는 v0.4.x 패치에서 specialist Task 위임 형태로 추가.
- signal-scan active trigger 진입점 wiring은 v0.4.x.
- 4종 디폴트 goal(pmf/feature/rebrand/prototype) 동봉은 v0.4.x.

## [0.3.0] — 2026-05-13

**v0.3 — PM mode (single-release bundle).** The bot's `#owner-command`
handler now drives a long-lived Claude Code PM session per (user, org)
instead of single-shot keyword routing. Specialist subagents are delegated
through Claude Code's native `Task` tool. Includes boot-time recovery,
snapshot/rollback, full `pm`/`workflow` CLI surface, slash command
pre-processor, and the pm-compaction routine. Bundles all of what the
internal narrative tracks as v0.3.0 / v0.3.1 / v0.3.2.

This is a single npm patch bump (0.2.4 → 0.3.0) — semver-clean,
auto-upgrades existing `^0.2.0` installs.

### Added — PM session core
- `src/bot/claude-process.ts` — `ClaudeProcessFactory` abstraction over
  `claude --print` subprocess. Real impl uses pre-allocated session UUIDs +
  `--resume` + stream-json I/O + `--exclude-dynamic-system-prompt-sections`.
  Provides `authStatus()` helper that wraps `claude auth status --json`.
- `src/bot/pm-runner.ts` — `PmRunner.handleUserMessage(call)` is the bot's
  single entry point. Per-(user, org) async mutex serializes concurrent
  `--resume` calls. Three recoverable failure modes: `AuthExpiredError`
  on "Not logged in" stdout, one-shot session rotation on "No conversation
  found" stderr, generic `pm.error` event on other non-zero exits.
- `src/bot/session-store.ts` — persists `(user-id, org-slug) → session-id`
  mapping with bookkeeping (last interaction, cumulative cost USD, active
  workflow id, archived rotations).
- `src/bot/events.ts` — `_events.jsonl` schema with task_id-based dedup
  for spawn events. `FileEventSink` + `MemoryEventSink`.
- `src/bot/agents-builder.ts` — syncs `assets/agents/{team}/{agent}/SKILL.md`
  into `<org>/.claude/agents/<name>.md` with YAML frontmatter for Claude
  Code's subagent discovery. Per-team tool/model defaults; per-agent
  overrides for qa-engineer (Bash), idea-refiner (haiku), etc.

### Added — boot recovery + CLIs
- `src/bot/cc-jsonl-reader.ts` — reads the last assistant turn out of
  Claude Code's session jsonl (`~/.claude/projects/<cwd>/<sid>.jsonl`).
  Defensive against format drift — returns null on any parse miss.
- `src/bot/workflow-reconciler.ts` — bot-startup recovery. Flips orphaned
  `in_progress` stages to `needs_revision` (with a stage_needs_revision
  event) so PM can ask the user how to proceed on next interaction. For
  PM sessions whose last `pm.message_in` has no paired `pm.message_out`,
  pulls the reply text from Claude Code's jsonl and re-delivers via the
  messenger (or surfaces a fallback "bot restarted, please resend"
  notice).
- `src/bot/workspace-meta.ts` — typed read helper: `listWorkflows`,
  `loadWorkflowSummary`, `resolveTargetRepoPath`, `latestHandoffPath`.
- `src/bot/slash-commands.ts` — `/think /plan /build /review /ship /help`
  pre-processor. Wraps known prefixes as `[SLASH /xyz] <args>` so the PM
  SKILL.md has a stable parse target; unknown slashes short-circuit with
  a bot-side hint; `/help` short-circuits with usage text.
- `src/bot/git-snapshot.ts` — per-org internal bare repo at
  `<org>/.solosquad/snapshot.git` tracking only `memory/` + `workflows/`.
  bot/index.ts commits before + after every PM turn. Repo code under
  `<org>/repositories/<repo>/` stays in its own .git and is never touched.
- `src/cli/pm.ts` — `solosquad pm status / reset / compact`.
- `src/cli/workflow.ts` — `solosquad workflow list / show <id>`.
- `src/cli/workflow-focus.ts` — `solosquad workflow focus <wf-id>` /
  `--clear` for setting the active workflow per (user, org).
- `src/cli/rollback.ts` — `solosquad rollback [--workflow <id>] [--to <sha>] [--list]`.
- `assets/routines/pm-compaction.md` + scheduler entry — daily 23:00
  routine (`workspace.yaml.pm.compaction_time`) that externalizes
  fully-completed workflows into `memory/pm-skills/<wf-id>.md` (≤400
  words) and appends one line per externalization to
  `memory/pm-skills/_recent.md` so PM picks up the change on its next turn.

### Added — precision markers (formerly v0.3.2 refinements)
- `src/bot/spawn-prompt-markers.ts` — parser for the `[stage:<id> wf:<id>]`
  marker PM embeds in Task tool prompts. Replaces an agent-name substring
  heuristic the reconciler would otherwise use.
- `src/bot/focus-markers.ts` — round-trip for `[focus:<wf-id>]` /
  `[focus:none]` markers PM emits in its replies. pm-runner detects the
  last marker, updates SessionStore.activeWorkflowId, and strips the
  marker from the user-facing text.

### Added — tests
- 75 unit tests covering claude-process factory, fake harness, session-store,
  events, agents-builder, pm-runner (auth, mutex, rotation, task_notification
  dedup), cc-jsonl-reader, workflow-reconciler, workspace-meta, slash-commands,
  git-snapshot, spawn-prompt-markers, focus-markers, and migration
  0.2.4 → 0.3.0.

### Changed
- `src/bot/index.ts` — replaces single-shot `agent-router → claude --print`
  flow with `PmRunner.handleUserMessage(...)`. Bot start now: (1) calls
  `auth status` and surfaces a "run `claude login`" hint if logged out,
  (2) runs `WorkflowReconciler.reconcileAll()` and forwards pending
  deliveries to `#owner-command`, (3) per `handleCommand` pre-processes
  slashes, commits `before-spawn:` snapshot, calls PM, commits
  `after-spawn:`.
- `src/messenger/base.ts` + Discord/Slack adapters — `MessageContext`
  carries `userId` (Discord author.id / Slack event.user) so PM-runner
  can key session-store correctly.
- `src/util/config.ts` — `WorkspaceYaml.pm` (`PmConfig`) added with
  defaults (`max_budget_usd: 5`, `invoke_timeout_seconds: 300`,
  `include_partial_messages: true`, `exclude_dynamic_system_prompt_sections: true`,
  `mutex_queue_depth: 4`, `compaction_time: "23:00"`).
- `src/migrations/scripts/0.2.4-to-0.3.0.ts` — non-destructive workspace
  upgrade: per-org `.solosquad/sessions/` scaffold, `.claude/agents/` sync
  for all 25 specialists, `pm` section seeded in workspace.yaml.
  `solosquad migrate --apply` chains automatically from earlier versions.
- `assets/orchestrator/SKILL.md` — full PM-mode rewrite with delegation
  via built-in Task tool, target_repo absolute-path injection, the
  `[stage:]` marker convention, and a "Compaction Notes" rule for
  `memory/pm-skills/_recent.md`.

### Compatibility
- Existing `claude-runner.ts` single-shot path is retained for the
  scheduler (routines remain stateless). Only the bot's interactive path
  moved.
- Existing JSONL memory (`signals.jsonl`, etc.) and `workflows/` artifacts
  are untouched by migration.
- Migration is idempotent; rolling back via `solosquad migrate --rollback`
  restores the pre-0.3.0 workspace.yaml and removes the new directories on
  next sync.

### Manual integration test
Required before `npm publish` — see
`docs/plan/V0.3-INTEGRATION-TEST-PLAN.md`. Automatable sections §1·§2·§3·§7·§8
already passed; §4·§5·§6 (auth-expired, concurrent messages, long-running
cache) need a real Slack/Discord workspace.
