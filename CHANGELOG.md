# Changelog

All notable changes to SoloSquad are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] — 2026-05-12

**Phase A of v0.3 PM mode.** The bot's `#owner-command` handler now drives a
long-lived Claude Code PM session per (user, org) instead of single-shot
keyword routing. Specialist subagents are delegated through Claude Code's
native `Task` tool. Foundational scope only — workflow reconciler, rollback,
slash commands, compaction, and full `pm`/`workflow` CLIs ship in v0.3.1+.

### Added
- `src/bot/claude-process.ts` — `ClaudeProcessFactory` abstraction over
  `claude --print` subprocess. Real impl uses pre-allocated session UUIDs +
  `--resume` + stream-json I/O + `--exclude-dynamic-system-prompt-sections`.
  Provides `authStatus()` helper that wraps `claude auth status --json`.
- `src/bot/pm-runner.ts` — `PmRunner.handleUserMessage(call)` is the bot's
  single entry point. Per-(user, org) async mutex serializes concurrent
  `--resume` calls (Claude Code does not lock the session jsonl). Three
  recoverable failure modes: `AuthExpiredError` on "Not logged in" stdout,
  one-shot session rotation on "No conversation found" stderr, generic
  `pm.error` event on other non-zero exits.
- `src/bot/session-store.ts` — persists `(user-id, org-slug) → session-id`
  mapping with bookkeeping (last interaction, cumulative cost USD, archived
  rotations). Transcript itself stays in `~/.claude/projects/`.
- `src/bot/events.ts` — `_events.jsonl` schema with task_id-based dedup for
  spawn events. `FileEventSink` + `MemoryEventSink`.
- `src/bot/agents-builder.ts` — syncs `assets/agents/{team}/{agent}/SKILL.md`
  into `<org>/.claude/agents/<name>.md` with YAML frontmatter for Claude
  Code's subagent discovery. Per-team tool/model defaults; per-agent
  overrides for qa-engineer (Bash), idea-refiner (haiku), etc.
- `test/fake-claude-process.ts` — `FakeClaudeProcessFactory` with scripted
  stream-json scenarios. Makes PM unit tests deterministic.
- `assets/orchestrator/SKILL.md` — full PM-mode rewrite. Delegation via
  built-in Task tool, target_repo absolute-path injection, PRD/_status.yaml/
  _handoff.md responsibilities, 5 slash command stubs.
- 22 new unit/migration tests; full suite is 29 green.

### Changed
- `src/bot/index.ts` — replaces single-shot `agent-router → claude --print`
  flow with `PmRunner.handleUserMessage(...)`. Bot start now calls
  `auth status` and emits a clear "run `claude login`" hint if logged out.
- `src/messenger/base.ts` + Discord/Slack adapters — `MessageContext` carries
  `userId` (Discord author.id / Slack event.user) so PM-runner can key
  session-store correctly.
- `src/util/config.ts` — `WorkspaceYaml.pm` (`PmConfig`) added with defaults
  in `DEFAULT_WORKSPACE_SETTINGS` (max_budget_usd $5, invoke_timeout 300s,
  partial messages on, dynamic-system-prompt exclusion on, mutex queue 4).
- `src/migrations/scripts/1.2.4-to-1.3.0.ts` — non-destructive workspace
  upgrade: per-org `.solosquad/sessions/` scaffold, `.claude/agents/` sync
  for all 25 specialists, `pm` section seeded in workspace.yaml.
  `solosquad migrate --apply` chains automatically from earlier versions.

### Compatibility
- Existing `claude-runner.ts` single-shot path is retained for the scheduler
  (routines remain stateless). Only the bot's interactive path moved.
- Existing JSONL memory (`signals.jsonl`, etc.) and `workflows/` artifacts
  are untouched.
- Migration is idempotent; rolling back via `solosquad migrate --rollback`
  restores the pre-1.3.0 workspace.yaml and removes the new directories on
  next sync.

### Known limitations (Phase A scope)
- `WorkflowReconciler` (boot-time stage / undelivered-message recovery) is
  designed in `docs/plan/RECOVERY-AND-TEST-DESIGN.md` but not yet implemented.
- `cc-jsonl-reader.ts` (extract last assistant turn after mid-stream SIGTERM)
  not implemented.
- `solosquad pm status / reset / compact`, `workflow list / show`, and
  `rollback` CLI not exposed yet.
- Slash commands (`/think`, `/plan`, `/build`, `/review`, `/ship`) are
  documented in the PM SKILL.md but the bot does not have explicit slash
  parsing — PM interprets the prefix from its own SKILL guidance.
- `pm-compaction` routine for old-workflow externalization not yet scheduled.

Phase B will land these in v0.3.1 / v0.3.2 patches.

### Manual integration test
Required before `npm publish` — see `docs/plan/V0.3-INTEGRATION-TEST-PLAN.md`.
