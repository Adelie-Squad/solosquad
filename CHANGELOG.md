# Changelog

All notable changes to SoloSquad are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [1.3.2] — 2026-05-13

**Phase B refinements.** Closes the three known limitations called out in
1.3.1's CHANGELOG. No new subsystems — three small contract upgrades that
make the bot's behavior more precise and inspectable.

### Added
- `src/bot/spawn-prompt-markers.ts` — parser for the `[stage:<id> wf:<id>]`
  marker PM embeds in Task tool prompts. Replaces the agent-name substring
  heuristic the WorkflowReconciler used in 1.3.1.
- `src/bot/focus-markers.ts` — round-trip for `[focus:<wf-id>]` /
  `[focus:none]` markers PM emits in its replies. pm-runner detects the
  last marker, updates SessionStore.activeWorkflowId, and strips the marker
  from the user-facing text via `stripFocusMarkers`.
- `src/cli/workflow-focus.ts` — `solosquad workflow focus <wf-id>` (or
  `--clear`) for manually setting the active workflow on a user's PM
  session. Multi-user orgs get an interactive picker.
- 13 new unit tests for the marker parsers + the precise reconciler path.
  Full suite is 75 green.

### Changed
- `src/bot/events.ts` — `SpawnStartEvent` gains optional `stageId` and
  `workflowId` fields populated from the spawn prompt marker.
- `src/bot/pm-runner.ts` — extracts `[stage:]` from `task_started.prompt`
  on every spawn and writes both ids onto the `spawn.start` event. Also
  appends a stable `[ambient] currently-focused workflow` line to the
  Claude system prompt when the session has an `activeWorkflowId` — same
  text every turn ⇒ prompt cache stays warm. Strips `[focus:]` markers
  from the reply before forwarding to the messenger.
- `src/bot/workflow-reconciler.ts` — no more agent-name substring
  matching. Builds a `stage_id → [task_ids]` index from `spawn.start`
  events, then checks `spawn.complete` coverage per stage. A stage with
  no recorded spawn at all is still flipped to `needs_revision` (PM never
  got to delegate, or it omitted the marker).
- `assets/orchestrator/SKILL.md` — documents the `[stage:]` marker
  convention with an example and adds a "Compaction Notes" rule: PM reads
  `memory/pm-skills/_recent.md` at the start of every turn, drops any
  noted workflow details from thread context, then truncates the
  processed lines.
- `assets/routines/pm-compaction.md` — routine now appends one line to
  `memory/pm-skills/_recent.md` for each workflow it externalizes,
  closing the previously-passive notification gap.

### Compatibility
- No migration script. Existing 1.3.1 workspaces keep working; new fields
  on `SpawnStartEvent` are optional. Workspaces without `memory/pm-skills/`
  get the directory on first compaction run.
- PM SKILL.md instructs the marker convention but treats it as optional —
  spawn events without the marker still record correctly, just with
  `stageId` undefined.

## [1.3.1] — 2026-05-12

**Phase B of v0.3.** Closes the recovery + CLI gaps that were intentionally
deferred from 1.3.0. No breaking changes; bots running 1.3.0 will pick this
up via `solosquad update`.

### Added
- `src/bot/cc-jsonl-reader.ts` — reads the last assistant turn out of
  Claude Code's session jsonl (`~/.claude/projects/<cwd>/<sid>.jsonl`).
  Defensive against format drift — returns null on any parse miss.
- `src/bot/workflow-reconciler.ts` — bot-startup recovery. Flips orphaned
  `in_progress` stages to `needs_revision` (with a stage_needs_revision
  event) so PM can ask the user how to proceed on next interaction. For
  PM sessions whose last `pm.message_in` has no paired `pm.message_out`,
  pulls the reply text from Claude Code's jsonl and re-delivers via the
  messenger (or surfaces a fallback "bot restarted, please resend"
  notice). Writes `pm.message_out` so the next boot doesn't re-notify.
- `src/bot/workspace-meta.ts` — typed read helper used by the new CLIs
  and the reconciler: `listWorkflows`, `loadWorkflowSummary`,
  `resolveTargetRepoPath`, `latestHandoffPath`. Pure read; no mutation.
- `src/bot/slash-commands.ts` — `/think /plan /build /review /ship /help`
  pre-processor. Wraps known prefixes as `[SLASH /xyz] <args>` so the PM
  SKILL.md has a stable parse target; unknown slashes short-circuit with a
  bot-side hint; `/help` short-circuits with usage text. Natural-language
  messages pass through unchanged.
- `src/bot/git-snapshot.ts` — per-org internal bare repo at
  `<org>/.solosquad/snapshot.git` tracking only `memory/` + `workflows/`.
  bot/index.ts now commits before + after every PM turn. Repo code under
  `<org>/repositories/<repo>/` stays in its own .git and is never touched.
- `src/cli/pm.ts` — `solosquad pm status / reset / compact` commands.
  `status` lists active sessions per org with cumulative cost and last
  interaction. `reset` archives a user's session and mints a new UUID
  (interactive picker when args are omitted; `-y` to skip confirmation).
  `compact` points users at the routine.
- `src/cli/workflow.ts` — `solosquad workflow list / show <id>`. `list`
  groups by org with colored per-status stage counts. `show` prints the
  stages table, PRD/handoff paths, and the last N events.
- `src/cli/rollback.ts` — `solosquad rollback [--workflow <id>] [--to <sha>] [--list]`.
  Defaults to the most recent `before-spawn:` snapshot. Repo code is
  untouched.
- `assets/routines/pm-compaction.md` + scheduler entry — daily 23:00
  routine (`workspace.yaml.pm.compaction_time`) that externalizes
  fully-completed workflows into `memory/pm-skills/<wf-id>.md` ≤400 words.
  Skip rules avoid recompacting and ignore workflows >180 days old.
- 31 new unit tests covering cc-jsonl-reader, workflow-reconciler,
  workspace-meta, slash-commands, and git-snapshot. Full suite is 60 green.

### Changed
- `src/bot/index.ts` — startup runs `WorkflowReconciler.reconcileAll()`
  after adapters connect; pending deliveries are forwarded to
  `#owner-command`. Each `handleCommand` now: (1) pre-processes slashes,
  (2) commits a `before-spawn:` snapshot, (3) calls PM, (4) commits
  `after-spawn:` on success.
- `src/messenger/base.ts` already had `userId` from 1.3.0 — used now by
  the recovery delivery header.
- `src/util/config.ts` — `PmConfig.compaction_time` field added; default
  "23:00". `applyWorkspaceDefaults` fills it in for older workspaces.

### Compatibility
- No migration script needed for 1.3.0 → 1.3.1. `applyWorkspaceDefaults`
  injects the new field at runtime. Bots running an older 1.3.0 keep
  working; reconciler + slash + snapshot land automatically on next start.
- `solosquad rollback` requires an internal git binary; falls back to
  no-op (with a warning) if git is missing.

### Known limitations
- The reconciler matches in-flight stage to spawn events by a substring
  heuristic on `agent` name; a proper stage_id ↔ task_id mapping ships
  with v0.3.2 (`workspace-meta.ts` extension).
- The pm-compaction routine prompt is run as a regular routine (single
  shot `claude --print`) — it does not yet update the PM session
  directly. The PM picks up the compacted file lazily when asked.

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
