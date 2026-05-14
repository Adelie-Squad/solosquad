# Changelog

All notable changes to SoloSquad are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

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
