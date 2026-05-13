# Changelog

All notable changes to SoloSquad are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

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
