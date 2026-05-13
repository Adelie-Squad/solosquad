# Changelog

All notable changes to SoloSquad are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] — 2026-05-13

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
- `src/migrations/scripts/1.2.5-to-1.3.0.ts` (신규) — 비파괴 마이그레이션:
  각 org에 `<org>/goals/` 생성, 워크스페이스 루트 `AGENTS.md` 생성
  (기존 CLAUDE.md 컨텐츠 1회 복사, 원본 untouched), `workspace.yaml`에
  `goal:` 섹션 추가, 버전 1.2.5 → 1.3.0.
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

## [1.2.5] — 2026-05-13

**v0.3 — PM mode (single-release bundle).** The bot's `#owner-command`
handler now drives a long-lived Claude Code PM session per (user, org)
instead of single-shot keyword routing. Specialist subagents are delegated
through Claude Code's native `Task` tool. Includes boot-time recovery,
snapshot/rollback, full `pm`/`workflow` CLI surface, slash command
pre-processor, and the pm-compaction routine. Bundles all of what the
internal narrative tracks as v0.3.0 / v0.3.1 / v0.3.2.

This is a single npm patch bump (1.2.4 → 1.2.5) — semver-clean,
auto-upgrades existing `^1.2.0` installs.

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
  1.2.4 → 1.2.5.

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
- `src/migrations/scripts/1.2.4-to-1.2.5.ts` — non-destructive workspace
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
  restores the pre-1.2.5 workspace.yaml and removes the new directories on
  next sync.

### Manual integration test
Required before `npm publish` — see
`docs/plan/V0.3-INTEGRATION-TEST-PLAN.md`. Automatable sections §1·§2·§3·§7·§8
already passed; §4·§5·§6 (auth-expired, concurrent messages, long-running
cache) need a real Slack/Discord workspace.
