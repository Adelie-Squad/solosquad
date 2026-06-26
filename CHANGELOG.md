# Changelog

All notable changes to SoloSquad are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [1.4.2] — 2026-06-27 (Hotfixes: `solosquad start` bot-startup + rate-limit notice spam)

See `docs/prd/v1.4.2_start-cron-blocking-hotfix.md`.

**`solosquad start` now actually starts the bot.** In 1.4.1, `solosquad start` /
`bot --with-cron` started only the cron scheduler — the bot never connected to
Discord (so it never replied). `startScheduler()` ends with an infinite
keep-alive (for standalone `cron start`), and the bot path awaited it before
`startBot()`, blocking forever. `startScheduler({ keepAlive: false })` now returns
after registering crons; the bot path uses it so `startBot()` runs and owns the
process lifetime (cron timers + the fs-watcher stay live on the shared event
loop). Standalone `cron start` keeps the default keep-alive; the scheduler
singleton lock is unchanged.

**Rate-limit notice no longer spams every reply.** Claude Code reports a
rate-limit status each turn (`allowed` / `warning` / `exceeded`); 1.4.1 echoed any
non-allowed status on EVERY reply, so a user approaching their usage cap saw the
⚠️ notice on every message. Now a `warning` (approaching) is announced once per
reset window per user (with the reset time), and only an actual `exceeded` raises
the urgent notice.

Continuity migration `1.4.1-to-1.4.2` is a plain version bump (no data changes,
no session reset).

## [1.4.1] — 2026-06-27 (Works-thread chat — Chief reads/replies in task threads)

See `docs/prd/v1.4.1_works-thread-chat.md`. Until now the Discord listener only
processed `command-<handle>` channels, so messages in `works-<handle>` task
threads were silently dropped — a code boundary, **not** a permission gap (the
invite already grants `SendMessagesInThreads` + the `MessageContent` intent).

- **Chief reads & replies in works task threads.** The listener now also accepts
  a message whose channel is a thread under `works-<handle>` (owner-handle
  isolation preserved — other users'/bots' channels and non-works threads stay
  ignored). The reply lands in the thread automatically.
- **Thread → task context.** The thread's workflow id is reverse-looked-up from
  `discord-thread.txt` and injected as a `[thread-context]` line so the shared
  Chief session knows which task the thread is about.
- **Single session (Approach A).** The thread shares the existing `(user,org)`
  Chief session; per-task child-session isolation ("그 작업에 대해서만") is the
  follow-up (Approach B / S-4).

**Also: one-command bot + cron (`solosquad start`).** `solosquad bot` starts only
the messenger bot; the cron scheduler (`cron start`) was a separate process.

- `solosquad start` — bot + cron + supervisor in one (single-host all-in-one);
  `solosquad bot --with-cron` runs the scheduler in the bot process without the
  supervisor.
- A `scheduler.pid` singleton lock prevents double-firing if a separate
  `cron start` (or Docker scheduler service) is also running — the second
  scheduler skips cron registration. Docker/systemd users can keep the 2-service
  split unchanged.

Continuity migration `1.4.0-to-1.4.1` is a plain version bump (no session reset
— spawn behaviour unchanged).

## [1.4.0] — 2026-06-27 (Session orchestration — re-scoped low-risk subset)

See `docs/prd/v1.4.0-session-orchestration.md`. v1.4.0 ships the non-destructive
subset of the session-orchestration PRD; session 교대 (token-threshold handoff +
session rotation, S-2b) and GC destructive deletion (S-3b) are deferred to
v1.4.x after their side-effects are validated.

**Shipped.**
- **S-1 — external-path repo cwd for crons.** `resolveOrgCwd` (scheduler/cron
  cwd) now resolves v1.0+ path-reference repos (`repositories/<slug>.yaml` →
  external `path:`) via `resolveRepoCwd`, instead of falling through to org-root.
  Crons are no longer repo-blind.
- **S-2a — passive token-usage telemetry.** The Chief turn records a
  `chief.usage` event (contextTokens = input + cache_read + cache_creation) from
  the stream-json `result` usage block. Observation only — nothing rotates on it.
- **§5.5 — leading-indicator cron preset.** `solosquad cron preset
  leading-indicator` enables the previously-orphaned prompt (opt-in; writes the
  def + copies the bundled prompt). The prompt gains an `avg_context_tokens`
  indicator sourced from S-2a.
- **§5.7 — spawn-change session reset helper.** `archiveOrgChiefSessions` rotates
  each org's Chief session; future spawn-affecting releases call it for a clean
  slate (this release does not — spawn behaviour is unchanged).
- **S-3 — `_log.md` durable file + memory formalization (docs).** Per-workflow
  append-only audit log, additive to `_handoff.md` (no Layer[7] regression);
  3-layer memory mapping documented in AGENTS.md (GC deletion deferred).
- **🆕 session-start marker.** A new/reset/rotated Chief session shows a
  "🆕 세션 시작" marker before the Chief name on its first Discord reply.

Continuity migration `1.3.11-to-1.4.0` is a plain version bump (no session
reset — spawn behaviour unchanged).

## [1.3.11] — 2026-06-25 (Windows --add-dir hotfix on 1.3.10 — append-system-prompt newline)

See `docs/prd/v1.3.11_windows-add-dir-prompt-newline-hotfix.md`. A Windows-only
hotfix: 1.3.10 still failed to read registered repos on Windows because of a
*second* bug 1.3.10 didn't catch.

- **Root cause.** On Windows the bot spawns claude with `shell: true`, joining
  args into a command STRING. The Chief `--append-system-prompt` value contains
  newlines (`[identity]` / `[surface]` / `[permissions]` blocks) — a newline in
  a cmd.exe command line truncates the command, dropping every flag after it,
  including `--add-dir`. So Chief silently lost access to registered external
  repos even on 1.3.10. (macOS/Linux spawn without a shell, so they were fine.)
- **Fix.** The system prompt is written to a temp file and passed via
  `--append-system-prompt-file`, so its newlines never hit the command line and
  `--add-dir` survives. Cross-platform; the temp file is cleaned up after each
  run. Regression test pins "multi-line prompt ⇒ `--append-system-prompt-file` +
  `--add-dir` preserved".
- Continuity migration `1.3.10 → 1.3.11` (no-op). Windows users on 1.3.10:
  `solosquad update` → `migrate --apply` → restart the bot.

## [1.3.10] — 2026-06-25 (bot permission UX + claude-code --add-dir/stream-json compat fix)

See `docs/prd/v1.3.10_bot-permission-ux-and-add-dir-fix.md`. An operational
stabilization patch (orthogonal to the 1.3.x authoring theme, like 1.3.1). Three
bot fixes that converged on one symptom — "can't read registered repos / every
action asks for approval". Bundle-only; spawn args rebuild per turn, so resumed
sessions pick up the fixes on their next turn (no data changes).

- **`--add-dir` works again (claude-code compat).** Claude Code 2.1.x silently
  ignores `--add-dir` when input arrives as `--input-format stream-json` over
  stdin — which blocked Chief from reading registered external repos
  (`<org>/repositories/*.yaml.path`). The bot now feeds the user message as
  **plain text over stdin** (no `--input-format stream-json`); `--output-format
  stream-json` + partial-message streaming are unchanged. Regression test pins
  both invariants. (Upstream claude-code bug; reported separately.)
- **Safe operations no longer interrupt the flow.** Reading/editing registered
  repos, Bash, WebFetch, git add/commit, and **feature-branch `git push`** run
  with no approval. Only a push to a **protected branch** (main/master/develop)
  or `gh pr merge`/`gh pr close` gates — and a protected push now surfaces the
  existing ✅승인/❌거절 approval card (was a hard block).
- **No more hallucinated "press 허용".** The Chief system prompt states that
  permissions are system-handled (safe ops auto-run; the rare gated ones post
  their own button card), so the agent stops inventing a non-existent approval
  prompt.

## [1.3.9] — 2026-06-25 (hotfix on 1.3.8 — migration collision + 3-segment version model)

See `docs/prd/v1.3.9_migration-collision-hotfix.md`. A hotfix surfaced by a dogfood
`migrate --apply` (1.2.9 → 1.3.8) that failed at the bundled `1.3.2 → 1.3.3` step.
1.3.8 shipped to npm with this defect; **1.3.9 is a same-day hotfix on it — upgrade from 1.3.8 to 1.3.9** (cf. the 1.2.2 → 1.2.3 precedent).

- **Migration collision fix.** `1.3.2 → 1.3.3` folds both `.solosquad/schedules` and
  `.solosquad/routines` into `crons/`. The old one-level `moveDir` left same-named
  entries behind (verify failed: "legacy cron dirs still present"). `moveDir` now
  merges subdirectories recursively and, on a leaf collision, keeps the newer
  override (`schedules`) and drops the superseded duplicate (preserved in the
  migration backup) — so the legacy dir always empties. Regression test added for
  the both-dirs + same-name + colliding-subdir case.
- **Migrations 1.3.2 → 1.3.8 re-reviewed.** Only `1.3.2 → 1.3.3` was blocking;
  `1.3.4 → 1.3.5` already tolerates collisions in verify; the rest are no-op bumps
  or the idempotent 1.3.8 seed.
- **3-segment version model correction.** Versions are always `vN.N.N` (never 4
  segments). A hotfix is the next patch (1.3.8 → 1.3.9) with its own lightweight
  **hotfix-format PRD** (PRD↔version 1:1 holds). The `prd` skill gains the rule +
  hotfix PRD format; the stray `1.3.8.1` / "parent-PRD §Hotfix" wording is removed.
- Continuity migration `1.3.8 → 1.3.9` (no-op bump). Recovery for a stuck upgrade:
  `solosquad migrate --rollback` then `--apply`.

## [1.3.8] — 2026-06-25 (docs management system + `docs` skill)

See `docs/prd/v1.3.8_docs-management.md`. The docs (documentation) slice of the
1.3.x "primitive & doc authoring internalization" umbrella. Repository-scoped
docs/versioning + a single curation authority. Bundle-only — the migration only
force-seeds org-layer dirs in the workspace; no repo working tree is touched.

- **(A) Docs scope = repository unit.** docs and version are per-repo (each repo
  owns its `package.json`/`docs/`/CHANGELOG/manual and bumps x/y/z independently;
  work ≠ release). Two orthogonal axes: external/internal (enforced by
  `package.json` `files`) and **repo layer** (prd · architecture · roadmap ·
  README · CHANGELOG · manual = release-bound) vs **org workspace layer**
  (ideation · reports = cross-repo research). A single-repo project (SoloSquad
  itself) collapses both layers into the same `docs/`.
- **(B) New `docs` skill.** `skills/docs/SKILL.md` — the single curation authority
  for classification, naming (`<version>_<name>_<date>`), PRD↔release-version 1:1
  (hotfix = next 3-segment patch with its own hotfix-format PRD), the publish gate, INDEX upkeep, and
  PRD-shape branching. `prd` stays the per-PRD writer (role split); PM gains
  `docs` in `skills_used` + an autonomous-chain `g) docs` step.
- **(C) `prd` 8 authoring rules.** R1–R5 (context / over-spec) + R6–R8 (AI-product
  PRD branch — range of acceptable answers · Eval Plan · guardrails; completeness
  score; Given-When-Then AC), distilled from ideation `260625-ai-planning-insights`
  (21 sources).
- **(D) 6-doc conditional gate.** `scripts/check-docs-freshness.ts` expanded 4→6:
  roadmap · architecture · CHANGELOG · README required + manual conditional (skip
  if absent) + PRD existence + a `docs/`-leak invariant, with backward-compat for
  the promoted paths.
- **(E) Dogfood reorg.** architecture / product-roadmap promoted to `docs/`
  top-level (living); `docs/reports/` added with prd/reports/ideation `INDEX.md`
  (scattered reports kept in place — fix-forward). Continuity migration
  `1.3.7-to-1.3.8` force-seeds org-layer ideation/reports; repo layer untouched.

## [1.3.7] — 2026-06-24 (workflow/goal/cron authoring internalization + workflow restructure)

See `docs/prd/v1.3.7-workflow-goal-cron-authoring-internalization.md`. Extends the
v1.3.6 authoring-authority pattern from skill/agent to the remaining three
primitives, plus a bundled-workflow restructure and a goal validator. Bundle-only
— no user-workspace data changes.

- **(A) Single primitive core.** `skills/skill-core/core.md` → `primitive-core.md`,
  restructured into §0 classification + unit/composition (skill·agent = workspace
  bases; workflow·goal·cron = org composites that reference them) · §1 universal
  authoring philosophy · §2 tacit-knowledge interview with a draft-anchored
  4-mode (explicit / migration / conversational / mining) · §3 SKILL.md format
  (skill·agent, absorbing the old core) · §4 composition format (workflow·goal·cron)
  incl. the **workflow essence principle** (goal + rationale + method → conclusion →
  handoff; "just an action" ⇒ a skill, not a workflow) and the **planning 3-bias
  guards** (self-negation, training bias, confirmation bias) · §5 acceptance rubric.
  Six reference files repointed (§N → §3.N).
- **(B) Manager authority + interview.** `workflow/goal/cron-manager` raised to
  authoring authorities; `skill-manager` gains the structured interview; agent
  `lifecycle.md` Phase 1 gains the 4-mode. Chief emits a `[creation_case:N]`
  marker so managers pick the interview mode (migration is first-class:
  analyze → draft → elicit the WHY the artifact omits → resolve agent-refs).
- **(C) Bundled-workflow restructure.** Legacy workflows retired
  (discovery-cycle, pmf-validation, autoplan-pm, weekly-retro); the monolithic
  `problem-definition` chain dissolved — `scqa`/`five-whys`/`tdcc` promoted to
  workflows (absorbing the deleted same-named skills), `mece`/`xyz-hypothesis`
  kept as skills; `idea-refinement`/`market-research`/`kpi-check` re-narrated to
  the essence principle (kpi-check = a goal-alignment gate, not a metric lookup).
  Seed set, README, agent `skills_used`, and the leading-indicator/retro wiring
  updated. The published `1.1.0-to-1.2.6` migration's now-obsolete
  problem-definition seed + package-integrity guard were removed (deliberate,
  user-authorized immutable-migration exception, parallel to v1.3.5 B-D1).
- **(D) Goal validator.** `src/bot/goal-validate.ts` (`validateGoal`) — metric
  provenance, pipeline agent existence, termination presence, composite-vs-single
  Goodhart guardrail — exposed as `solosquad goal validate` and folded into the
  `solosquad validate` aggregator (now covers all five primitives).
- **Continuity migration** `1.3.6-to-1.3.7` (version-bump no-op).

## [1.3.6] — 2026-06-23 (Authoring internalization + self-improvement scaffold + squad restructure)

See `docs/prd/v1.3.6-skill-agent-authoring-internalization.md` and
`docs/ideation/260623-squad-org-restructure.md`. Four threads:

- **(A) Authoring authority** — the "what good looks like" standard now lives in
  the manager skills. `skills/skill-core/core.md` holds the shared ~70%
  (description formula, quantitative limits, body discipline, bundle structure,
  progressive disclosure, field audit, eval skeleton); skill-manager and
  agent-manager reference it, keeping only domain deltas in their `references/`
  (agent-manager rewritten lean + 4 references: delegation-graph, role-boundary,
  lifecycle, guardrails). `validateSkill`/`validateAgent` aligned to the formal
  standard (reserved words anthropic/claude, vague-phrasing + missing-trigger
  warnings, 500-line body lint) plus a static anti-reskin originality gate
  (`src/analyze/originality.ts`, 8-word shingle, FAIL≥40%/WARN≥20%, wired into
  `agent validate --graph`). `pm_conventions` + `category` are now parsed and
  validator-enforced (decorative→load-bearing).
- **(B) Self-improvement scaffold** — deterministic cores for skill eval
  (`src/analyze/eval-corpus.ts`: trigger-rate, seeded train/val split, output
  A/B deltas) and the SkillOpt-style refine gate (`src/analyze/refine-gate.ts`:
  held-out strict-improvement acceptance, edit budget Lt=4/floor 2, rejected-edit
  buffer). The scorer/refiner is the logged-in Claude (skill-manager /
  skill-refinement in-session, judging via Task sub-agents) — not an API client;
  the code is only the arithmetic. The experience layer (memory) is deferred to
  v1.4.0.
- **(C) CLI** — `solosquad asset list|show|validate` deprecated (removed in v2.0);
  the cross-kind gate is promoted to a noun-free top-level `solosquad validate
  [kind]` (the CI gate); `validate-bundled` dogfoods it.
- **(D) Squad restructure** — five teams (core, product, engineering, business,
  brand); agents 25→19 (renames + five merges + `fde` removed +
  product-designer/sales/creative-designer added); skill renames (okr, prd, wbs,
  primitive-review, interview-script) + new governance skills (design-system,
  policy). Bundled actor renames don't break user org-layer actors (isolated), so
  this ships minor with no migration.

975 tests green; `solosquad validate` green (20 actors, 13 workflows).

## [1.3.5] — 2026-06-22 (Planning workflows + asset-manager consistency)

See `docs/prd/v1.3.5-planning-workflows.md`. Two workstreams: (A) planning
workflows — five framework skills (scqa·five-whys·mece·tdcc·xyz-hypothesis) split
out of problem-definition, `_workflow/<id>` sub-workflow composition (cycle/depth
guards), two main + six sub planning workflows, a market-research skill, prd-writer
two-form + requirement taxonomy, and a requirements review gate; (B) asset-manager
consistency — the B-D1..B-D4 changes below. 947 tests green.

- **B-D1 — `workflow-maker` → `workflow-manager` rename.** The last `{asset}-maker`
  holdout joins the `-manager` lifecycle family. The bundle skill dir, frontmatter,
  every live path/comment reference, and test fixtures move to `workflow-manager`,
  leaving zero `-maker` references. The published `1.1.0-to-1.2.6` migration's
  package-integrity guard hard-codes the bundle path, so it is repointed to the new
  name — a deliberate, owner-authorized one-off exception to the immutable-migration
  rule (safe: the migration is forward-only and only seeds/verifies a bundle file,
  with no path-dependent workspace transform).
- **B-D3 — crons are now org-scoped (`<org>/crons/`).** User crons move from the
  workspace-global `.solosquad/crons/` into per-org dirs, joining `<org>/workflows/`
  and `<org>/goals/`. A cron now fires only for **its own org** (was: every product).
  `getCronsWriteDir(orgSlug)` replaces the no-arg form; the daemon reconciles and
  watches every org's dir (tasks keyed `<org>:<id>`); `cron new/edit/enable/disable/
  delete/show` take `--org` (defaulting to the sole org), and `cron list/validate`
  group by org. Migration `1.3.4-to-1.3.5` relocates legacy global crons into the
  first org (warns on multi-org), never clobbering, and drains the old dir.

## [1.3.4] — 2026-06-21 (Cron reliability: delivery, failure reporting, timezone/jitter guards)

v1.3.4 makes crons trustworthy to run unattended. It fixes a silent delivery bug, reports failures where you can see them, hardens scheduling, and gives the conversational cron-manager a full CRUD flow. See `docs/prd/v1.3.4-cron-mastery.md`.

- **Channel fix (delivery bug).** Built-in and user crons posted to a `#workflow` channel that `init` never creates, so output was silently dropped (saved to file only). Crons now deliver to the org's **`works-<handle>`** channel (resolved at runtime: the broadcast owner, else the sole/first user). The hardcoded `"workflow"` channel is gone; `CronDef.channel` defaults to empty (= auto-resolve). Personalized briefs drop the opt-in gate — **every** user gets morning/evening briefs in their own `works-<handle>`; a workspace brief disabled via `briefings.*.enabled:false` is skipped for everyone.
- **Run + failure reporting.** A failed cron now posts `⚠️ [name] 실행 실패 — <reason>` to its channel (independent of `[SILENT]`, which stays an opt-out for normal output only), with a noise guard that suppresses repeats when the prior run also errored. The dead-man's-switch (missed-run alert) posts to `works-<handle>` too and is surfaced in plain language ("실행 누락 감지").
- **Timezone guard + picker.** New `src/util/timezone.ts` (presets, `isValidIanaTimezone`, fuzzy `suggestTimezone` "did you mean …?", `allTimezones`) — reused by `init`. `cron new`/`edit` take `--timezone` (validated, with a suggestion on typo). Invalid IANA names are rejected at validation time (`CRON_TZ_INVALID`).
- **Jitter + safety guards.** `CronDef.maxRandomDelay` spreads simultaneous fires (built-in briefs default to a 0–120s spread) to avoid a thundering herd. New validations: `CRON_TOO_FREQUENT` extended from every-minute to **sub-5-minute**, `CRON_DST_WINDOW` (a fixed 00:00–02:59 local fire can be skipped/doubled on a DST transition), `CRON_JITTER_TOO_LARGE` / `CRON_JITTER_INVALID`. `CRON_CHANNEL_MISSING` removed (channel auto-resolves).
- **Save-time preview.** `cron new`/`edit`/`show` print the **next 5 fire times** (tz-aware) via `nextRuns()`, replacing the single next-run line.
- **Confirm before write + conversational CRUD.** `cron new`/`edit` confirm before writing (`-y/--yes` to skip; `delete` already confirmed). The Chief SKILL gains a **cron-manager** section: a guided C/R/U/D flow (name → schedule[preview] → task/report → save → test-run; list → select → overview → confirm) that is **asset-aware** — it reuses existing skill/agent/workflow assets and proposes creating + validating a new one only when the work is novel — plus a `cron runs` status query.
- **Rename (code-only).** Built-in cron id `pm-compaction → chief-compaction` (thread `system-pm-compaction → system-chief-compaction`, bundle prompt `crons/chief-compaction.md`). The `workspace.yaml` `pm` config block key is intentionally kept (the pm→chief key rename is a separate migration). No data migration needed — it's a hardcoded built-in.
- **Directory rename.** `src/scheduler/ → src/cron/` (all imports repointed) — finishes the cron-domain terminology alignment. The `scheduler`/`startScheduler` runtime identifiers are kept.
- **Deps.** `node-cron` synced to v4 (declared `^4.2.1`; the installed tree was stale at 3.0.3).
- **Migration.** `1.3.3 → 1.3.4` chain-completion bump (no on-disk transform) keeps the registry continuous.
- 927 tests green (new `timezone.test.ts`, `nextRuns`/`parseDelaySeconds`, new validation codes, `migration-1.3.3-to-1.3.4.test.ts`; `user-crons`/`cron-validate` updated for the channel-model change). `validate-bundled` green.

## [1.3.3] — 2026-06-19 (Cron terminology unification + cron lifecycle)

v1.3.3 unifies the two interchangeable names for scheduled jobs — **routine** (built-in jobs) and **schedule** (user-authored jobs) — into a single noun: **cron**, then gives crons a full create/edit/start-stop/delete lifecycle (referencing the OpenClaw and Hermes cron UX). This is a breaking rename across code, CLI, the bundled asset dir, and on-disk data paths, shipped with a migration that carries existing workspaces along. See `docs/prd/v1.3.3-cron-terminology.md`.

- **Code rename.** `scheduler/routines.ts → crons.ts`, `schedule-def.ts → cron-def.ts`, `schedule-validate.ts → cron-validate.ts`, `cli/schedule.ts → cli/cron.ts`, `cli/run-routine.ts → cli/run-cron.ts`. Identifiers `ROUTINES → CRONS`, `RoutineConfig → CronConfig`, `ScheduleDef → CronDef`, `getSchedulesDir → getCronsDir`, error codes `SCHED_* → CRON_*`.
- **CLI consolidation (breaking).** The three split entry points — `solosquad schedule` (daemon), `solosquad schedules` (manage), `solosquad run-routine` (manual) — collapse into one `cron` group: `solosquad cron start | run | list | new | show | validate`.
- **Cron lifecycle (new — OpenClaw + Hermes cron UX).** Full create/edit/start-stop/delete: `cron edit <ref>` (patch fields → auto re-validate), `cron enable`/`cron disable` (pause ≠ delete — the definition is kept), `cron delete <ref>` (archives to `crons/_archived/` by default, `--hard` removes). References accept **id or name** (case-insensitive; ambiguity refused). `cron new`/`edit` take friendly schedules (`@daily`, `every 1h`, raw cron) and print a human readback + **next-run preview**. The daemon **hot-reloads** via a chokidar watcher on `.solosquad/crons` (node-cron v4 task handles), so lifecycle changes apply without restarting `cron start`. Writes are pinned to `<ws>/.solosquad/crons` (never the installed bundle).
- **Cron operations (OpenClaw/Hermes patterns).** `cron run <ref>` now runs user crons too (id or name; an explicit ref runs even a disabled cron). `[SILENT]`/empty output is logged but not posted (quiet pollers). **Run history** — every run records an outcome to `<org>/memory/cron-runs.jsonl`; `cron runs [ref]` lists recent runs (status/when/duration) and `cron show` surfaces the last run. **Dead-man's-switch** — the daily housekeeping pass posts an alert for any enabled cron whose last successful run is older than 2× its estimated cadence. **One-shot crons** — `cron new <id> --at <ISO | "20m">` runs once at that time then auto-deletes (delete-after-run).
- **`/create` — capture work as a SKILL (ambient-knowledge first source).** A new slash (`/create [name]`) and natural language ("save what we just did as a skill") let the user file the recent conversation as a reusable `SKILL.md`. Consistent with the existing slash model, the bot doesn't execute it — it wraps `[SLASH /create]` and forwards to Chief, whose SKILL.md now defines how to author the skill (recall recent turns → write `<ws>/.solosquad/skills/<name>/SKILL.md` with the naming/description conventions → self-check against the `asset validate skill` gate). Freq-miner suggestions stay suggest-only; a skill is filed only on an explicit `/create`.
- **Freq-miner routing suggestions (suggest-only).** The dormant keyword miner is now surfaced: the morning brief gets a one-line suggestion when a keyword has been missed ≥3× in 30 days (`freqSuggestionLine` — null when there's nothing, so the brief stays clean), and `solosquad cron freq` lists suggestions with `--apply <id>` for explicit opt-in. Never auto-applied; the 30-day rejection cooldown is honored.
- **Per-user cron personalization (opt-in, additive).** A user can set `timezone` and a `crons` block in their `<org>/.solosquad/users/<handle>.yaml`; they then receive personalized morning/evening briefs in their own `works-<handle>` channel at their own timezone (`runCronForProduct` gained channel/tz overrides; `scheduler/user-crons.ts` resolves the registrations). Org-level #workflow briefs are unchanged — disable them via `workspace.yaml.briefings.*.enabled:false` if you only want personal ones. `system-housekeeping`/`pm-compaction` stay workspace-scoped.
- **Paths.** Bundled `schedules/ → crons/`; data `.solosquad/{schedules,routines} → .solosquad/crons`, `<org>/memory/routine-logs → cron-logs`. The 1.3.2→1.3.3 migration moves these for existing workspaces (idempotent, no-clobber); `getCronsDir()` still reads the legacy override dirs as a fallback so a workspace keeps working even before the migration runs.
- **Preserved on purpose.** The `scheduler`/`startScheduler` subsystem name (it *runs* crons), the node-cron API, the archive event-type string `routine_log` (stored data contract), and historical migration path literals.
- **Fix — migration chain gap (`1.2.9 → 1.3.2`).** The 1.3.0/1.3.1/1.3.2 line shipped with no migration whose `from` matched `1.2.9`, so `solosquad migrate` on any workspace upgraded to 1.2.9 dead-ended with "No migration found for source version 1.2.9". Added `1.2.9-to-1.3.2.ts` (chain-completion version bump — those releases needed no on-disk transform: `pm.git` resolves defaults at read time, `schedules/` + runtime dirs are created on demand). Added a registry-continuity guard (`findRegistryGaps` + `migration-registry-continuity.test.ts`) that fails CI when any migration `to` has no successor, so a future release that forgets its entry is caught at PR time instead of in a user's upgrade.
- 911 tests green (new `migration-v1.3.3-cron.test.ts`, `cron-schedule.test.ts`, `cron-lifecycle.test.ts`, `cron-runlog.test.ts`, `user-crons.test.ts`, `migration-1.2.9-to-1.3.2.test.ts`, `migration-registry-continuity.test.ts`). `validate-bundled` green.

## [1.3.2] — 2026-06-19 (Asset lifecycle managers + asset adoption)

v1.3.2 gives the five first-class assets (skill · agent · workflow · goal · schedule) a shared **manager abstraction** — the same `validate` / `list` / `show` interface plus shared validation, graph, guardrail and naming cores — and completes an **asset adoption** pipeline that pulls a repo's existing AI assets into the workspace. CLI sprawl is reined in under a **conversational-first** principle. See `docs/prd/v1.3.2-asset-managers-validate.md`.

- **Domain validators (P0, CI gate).** Stronger `validateSkill` (naming/description hygiene), new **agent manager** with `agent validate --graph` (reference integrity, delegation cycles, orphans), `validateWorkflow` (cycle = error), and `schedules validate` over dynamic `schedules/<id>.yaml`. All wired into `npm run validate-bundled` in CI.
- **Shared cores (§9).** `src/util/graph.ts` (Kahn cycle/reachability, reused by agent + workflow), `validation.ts` (Findings collector), `guardrails.ts` (`iterationCapReached` / `budgetStatus` / `LoopDetector`), `naming.ts` (`KEBAB_RE` / `checkId` / `normalizeToKebab` — removes the kebab regex duplicated across 4 validators). Renamed `skill-author.ts → skill-manager.ts`.
- **Asset adoption (§10).** `solosquad adopt <repo> [--apply] [--classify]` discovers a repo's skill/agent/workflow/schedule assets, validates them (validate-then-adopt), and additively adopts them into the workspace (namespaced on collision, idempotent) with heuristic + optional LLM team mapping. `init` / `add repo` surface adoptable assets automatically. The bundled scope now resolves deterministically via `getBundled{Agents,Skills}Dir()` (cwd-independent) — fixes a footgun where a checkout nested inside another workspace validated that ancestor's stale assets. `analyze repo` is deprecated in favor of `adopt`.
- **CLI cleanup (conversational-first).** New unified front door `solosquad asset list|show|validate <kind>` and `solosquad commands` (full CLI tree at a glance). LLM-judgment verbs (review, create-assist) were removed from the CLI and now live in `solosquad chat` via the `asset-review` skill + the existing author/maker loops — matching how leading agent CLIs (Claude Code, Codex, OpenCode) keep LLM verbs in the session and the CLI deterministic.
- 870 tests green. `validate-bundled` green.

## [1.3.1] — 2026-06-18 (Legacy asset cleanup: empty the v1.1-leftover `assets/` + post-release CI/deps hardening)

v1.3.1 is a stabilization release — no user-facing features. It finishes the v1.1 reorg that only got halfway: the old `assets/` tree (left behind when the canonical roster/skills/teams moved to top-level bundle dirs) is now emptied, and the post-release CI/dependency issues surfaced while merging v1.3.0 are closed. See `docs/prd/v1.3.1-legacy-asset-cleanup.md`.

- **CI / deps hardening.** `node-cron` 3→4 (TS rewrite drops the `uuid` dependency → clears 2 moderate advisories without an override); CI now surfaces moderate `npm audit` advisories non-blockingly after the high-severity gate; Node baseline `>=20`, matrix `[20,22]`, `fail-fast: false`.
- **`assets/agents/` removed.** The stale team-nested roster (old taxonomy, 25 agents) was never deleted after v1.1 moved the canonical roster to top-level `agents/` (main + specialists). `init` no longer copies two divergent rosters into a fresh workspace. The dead `collab_pattern` test + inject script were retired with it.
- **`assets/` legacy cleanup.** `routines/` wired to top-level `schedules/` (the v1.1 `getSchedulesDir` was dead code); `knowledge/`/`core/` resolver fallbacks repointed to the bundle; the v0.3 `orchestrator/` Chief-identity doc (superseded by `agents/main/chief/SKILL.md`) removed; all 22 `templates/` cleared — 15 retired (pre-v1.1 workflow scaffolds) and 7 live ones inlined as string constants in their owning code (which also removes the npm-bundle-whitelist regression risk that a file move would carry). `assets/` now holds only `docker/` + `.env.example`.
- **Planning (docs-only).** SKILL.md authoring cross-vendor study (`docs/ideation/260617-skill-md-authoring-best-practices.md`) and the v1.3.2 domain-lifecycle-managers PRD (skill · workflow · goal · schedule).
- 782 tests green. tarball behavior unchanged from 1.3.0 (cleanup is internal/dev-facing).

## [1.3.0] — 2026-06-16 (Messenger UX overhaul: dev-confirm push-approval gate + interaction components + artifact filing)

v1.3.0 lifts the whole way you interact with Chief in the messenger. It pairs a **safety net** — approve before a push runs, recover from a mis-tap, watch and stop work in flight — built from three axes that ship together. The 🛑 stop button + live stage narration landed first; this release adds the approval gate, the interaction components, and artifact filing. See `docs/prd/v1.3.0-dev-confirm-gate-live.md`.

### Part A — dev-confirm push-approval gate (live)

The dev-confirm gate was defined in v0.8.2 but never wired to a spawn — it had never fired. v1.3.0 makes it live by turning the v1.2.9 §E deny-hook into an **approve flow**.

- **`git push` / `gh pr merge` / `gh pr close` now require explicit approval.** A PreToolUse(Bash) hook (`src/bot/dev-confirm-hook.ts`) runs inside the spawned `claude` subprocess: it hard-blocks a direct push to a **protected branch** (`main`/`master`/`develop`), and for a feature branch writes a `pending-confirms/<id>.json` request then polls for the decision — pure file IPC, zero network.
- **A ✅승인 / ❌거절 card** is posted to `command-<handle>` by the bot-side bridge (`src/bot/dev-confirm-bridge.ts`); clicking approves/rejects, and the verdict is written back for the hook to read. The approval is recorded in `<org>/memory/dev-confirmations.jsonl` with the commit-hash + workflow-id mapping.
- **Failure policy:** approval timeout = blocked (fail-closed); a hook error = allowed (fail-open) so a buggy hook never bricks every push — but the protected-branch guard stays fail-closed regardless. The hook is the sole gate when wired (the static `--disallowed-tools` push deny is dropped in dev-ON so an *approved* push isn't blocked; it's kept only as a fail-closed fallback when the hook settings can't be written).
- **Config:** `workspace.yaml` `pm.git` — `protected_branches` (default `["main","master","develop"]`), `require_feature_branch` (default true), `approval_timeout_minutes` (default 30).
- **No push notifications.** SoloSquad never sends a push feed — that stays the user's own GitHub→messenger webhook (the commit stamp surfaces attribution there).

### Part B — interaction UX (buttons/menus + misfire recovery)

Retires free-text `y/n`. Built on the proven onboarding/turn-controls component pattern, resolved via per-message component collectors.

- **`discord-approval.ts`** — the approval card primitive with **2-step reject confirm** (an ephemeral "정말?" before a destructive reject) and **disable-after-click** (no double-submit).
- **`discord-choice.ts`** — single-select via buttons (≤5) or a select menu (6+) with an **undo grace window** for reversible choices.
- **`MessageContext.askApproval` / `askChoice`** (Discord) + `postApprovalToCommandChannel` for the bridge. Slack keeps the text fallback (the methods are optional).
- The 🛑 stop button + live stage narration (Part C P0) shipped earlier in the v1.3.0 line.

### Part C P1 — artifact filing

- **Long Chief replies (≥1500 chars) are saved to `<org>/artifacts/`** and posted as a Discord file attachment + preview card instead of a wall of chunked text. The file is git-versioned (the per-turn snapshot now tracks `artifacts/`).

### Tests

- 790 pass; `tsc` + `npm run build` clean. New coverage: push-branch parsing (incl. whitespace + `+force` refspec bypass guards), the hook decision matrix + fail-open/closed, the bridge file-IPC + audit mapping, component id parse/recovery rows, the artifact store, and `pm.git` config defaults.

### Infra

- **`engines.node` `>=18` → `>=20`** + CI matrix drops Node 18. `better-sqlite3` 12.x (FTS5 archive) requires Node 20+, so Node 18 was already de-facto unsupported — the manifest now states it honestly. CI also sets `fail-fast: false` so a single failing combo no longer cancels (and masks) the others.
- **`npm audit fix`** cleared the high-severity advisories the CI gate enforces (esbuild / form-data / ws), within existing semver ranges — direct dependencies unchanged.

### Out of scope (follow-up)

- P3 token edit-streaming, reaction-toggle voting (recovery ④), Slack Block Kit parity, commit-trailer workflow stamp (§A.4.5), and the dedicated `artifacts-<handle>` archive channel (P2).

## [1.2.10] — 2026-06-16 (Consolidation cleanup: finish the PM → Chief rename, roll back the git-<handle> channel, remove the repo-self-hosting Docker stack)

v1.2.10 is a **consolidation cleanup** release: it removes the half-finished and speculative artifacts left by v1.1 and v1.2.9 to reach a clean baseline — no new features. The three parts share one through-line: *"clean up what a prior version only half-finished or shipped speculatively."* See `docs/prd/v1.2.10-consolidation-cleanup.md`.

- **Part A: finish the v1.1 PM → Chief rename.** The rename was only half-applied — user-facing output said "Chief" while the CLI verb (`solosquad pm`), the event namespace (`pm.*`), the `PmConfig` type, and crucially the orchestrator's own SKILL identity ("You are the PM") still read "pm". Part A finishes it, drawing a hard line between three distinct meanings of "pm" so the cleanup doesn't break persisted data.
- **Part C: roll back the `git-<handle>` VCS channel (v1.2.9 Part B).** SoloSquad no longer creates or notifies a git channel. The only thing actually needed is **push approval** (the dev-confirm gate, designed in `docs/prd/v1.3.0-dev-confirm-gate-live.md`); push *notifications* are better delegated to the user's own native **GitHub→Discord webhook**. Removed `git-event-notify.ts` + `git_events` config + the `git` channel-creation/derivation paths. Code-only removal — existing `git-<handle>` channels and `channels.git` yaml fields (shipped in v1.2.9) are left orphaned (no cleanup migration); the field is retained as a deprecated/inert shim so the released 1.2.8→1.2.9 migration keeps compiling.
- **Part D: remove the repo-self-hosting Docker stack + consolidate user Docker assets.** `deploy/docker/` existed to spin the repo root up as a Docker workspace, but the container installs the npm-published `solosquad` (not local `src/`), so "run the repo in Docker" was never real — it was a maintainer dogfood stack that only caused confusion. Removed `deploy/docker/**`. User Docker stays a first-class, regression-free feature: moved `assets/{Dockerfile,docker-compose.yml}` → `assets/docker/` (a single home) and merged the three maintainer-only features into the user compose (`stop_grace_period: 130s`, `~/.solosquad` and `~/.solosquad-backups` mounts) — without porting the `SOLOSQUAD_WORKSPACE=../..` repo-root override (the removed assumption). `solosquad init` now copies from `assets/docker/` (destination stays the workspace root). README ko/en + manual ko/en hosting guidance corrected to "run `docker compose up -d --build` from the workspace root."
- **Moved out:** the orchestration session-management design (single-session handover, per-repo worker sessions M1–M3) was split into its own doc → `docs/prd/v1.4.0-session-orchestration.md`. No session code ships in v1.2.10.

### Part A — Taxonomy: "pm" was three things

- **(A) session driver / user surface** = the Chief itself → **renamed**.
- **(B) persisted contracts** (on-disk event kinds, `workspace.yaml` `pm:` key, `pm-compaction` routine id, `system-pm-compaction` thread) → renamed only where a read-compat shim or compile-time-only change made it safe; the rest kept with a documented rationale + deferred to a future migration.
- **(C) a "separate PM agent" at `agents/main/pm/`** referenced by a chief-runner comment → **a ghost** (no such agent on disk); the stale comment was corrected.

### Renamed

- **CLI**: `solosquad chief status / reset / compact` is now canonical. `solosquad pm …` is kept as a hidden, deprecated alias (it's documented in the immutable `AGENTS.md` and protects existing muscle-memory/scripts) — it prints a one-line deprecation notice and dispatches to the same implementation. `src/cli/pm.ts` → `src/cli/chief.ts`; `pm{Status,Reset,Compact}Command` → `chief*Command`.
- **Event namespace**: `pm.*` → `chief.*` (`chief.message_in/out`, `chief.error`, `chief.auth_expired`, `chief.session_lost`, `chief.session_rotated`, `chief.rate_limit`); interfaces `Pm*Event` → `Chief*Event`. `WorkflowReconciler` accepts **both** the legacy `pm.*` and new `chief.*` kinds when scanning pre-v1.2.10 `events.jsonl`, so a turn that straddled the upgrade is still recovered. archive.sqlite never indexed these kinds, so no external consumer breaks. `pmEventsPath` → `chiefEventsPath` (on-disk path unchanged); a deprecated `pmEventsPath` alias is retained so the **immutable** `src/engine/**` keeps compiling.
- **Orchestrator identity**: `assets/orchestrator/SKILL.md` no longer says "You are the PM" — it's the Chief. Only identity nouns changed; every behavioral instruction (PRD/stages/Task/handoff/dev-confirm) is preserved.
- **Config type**: `PmConfig` → `ChiefConfig` (compile-time only). The `workspace.yaml` property key stays `pm`.

### Kept (persisted contracts — see PRD §7)

- `workspace.yaml` `pm:` key, the `pm-compaction` routine id + `system-pm-compaction` thread + `memory/pm-skills/` path. Renaming these requires migrating every existing workspace / live Discord thread, deferred to a dedicated migration. The human-readable routine label was updated `"PM Compaction"` → `"Chief Compaction"`.

### cwd default — documented (was a recurring support question)

- `getWorkspaceRoot()` walks **up from the launch cwd** for `.solosquad/`; `solosquad bot`/`chat`/`chief reset` must be run from inside the workspace.
- A Chief conversation spawns with cwd = **`<workspace>/<orgSlug>/`** (`getReposBase()` returns the workspace when `.solosquad/` exists). Registered repos live at external absolute paths and are reachable only via `--add-dir`, not because they're under cwd.

### Tests

- 749 pass. Added `test/chief-cli.test.ts` (`chiefResetCommand` rotates the session + logs `chief.session_rotated`) and reworked `workflow-reconciler.test.ts` to assert legacy `pm.*` read-compat → new `chief.*` write. Part C removed `test/git-event-notify.test.ts` (~10 cases) and dropped the `git` assertions from `user-registry`/`channel-bootstrap` tests.

## [1.2.9] — 2026-06-01 (fix the Discord Application ID source that broke invite-URL 1-click since v1.2.6)

**v1.2.6 shipped an OAuth "invite URL 1-click" onboarding flow that never once worked — a single non-existent API field defeated the whole thing.** Dogfood reported that `solosquad init` (a) never asks for the Application ID and (b) never prints/opens the server invite URL at the end. Both symptoms trace to the same root cause.

### Root cause

`src/cli/init.ts` `fetchBotIdentity()` read the application id from the wrong place:

```ts
const res = await fetch("https://discord.com/api/v10/users/@me", { ... });
const body = (await res.json()) as { id?; username?; application_id? };
return { handle, botUserId: body.id, appId: body.application_id }; // always undefined
```

Discord's `GET /users/@me` returns the bot **User** object — which has **no `application_id` field**. So `appId` was always `undefined`, and:

- `init` Step 4's invite-URL block is gated on `if (... && identityChoice?.bot.appId)` → **always skipped** → no URL printed, no browser opened.
- `user.yaml.bot_application_id` was saved as `undefined`.
- A later `solosquad discord invite-url` then fails with "No bot_application_id found".
- There was **no prompt fallback** either, so when auto-detection silently failed there was simply no step that asked the user — hence "it never asks for the app id".

The same dead field lived in `src/cli/doctor-discord.ts` Hop 2 (`liveAppId = me.application_id ?? null`), so the doctor's "bot_application_id missing" warning and its invite-URL hint were also permanently dark.

### Fixed

- **Correct endpoint** — new `fetchDiscordApplicationId(token)` calls `GET /oauth2/applications/@me` (the only endpoint that returns the application id for a bot token) and reads `.id`. `fetchBotIdentity` now resolves `appId = (await fetchDiscordApplicationId(token)) ?? body.id`, falling back to the bot user id — for Discord bots the bot user id and the application id are the same snowflake, so the fallback is always correct.

- **Explicit Application ID confirmation prompt** (PRD §3.1) — `promptHandleSelection` now surfaces the detected app id for confirmation (Enter accepts the default). On detection failure it lets the user paste it from Developer Portal → General Information → Application ID, validated as a 17-20 digit snowflake. Discord-only; Slack derives its invite differently. This is the prompt the v1.2.6 PRD always specified but was never implemented.

- **`doctor --discord` Hop 2** — now populates `liveAppId` via the same endpoint (fallback to the bot user id), so the Hop 3 "bot_application_id missing" surfacing and the Hop 4 invite-URL hint actually fire.

- **Owner User ID auto-prefill** — the same `/oauth2/applications/@me` call also returns `owner.id`, the Developer Portal account that owns the app. For a solo founder this is the person who will command the bot, so the owner-only-gate prompt now pre-fills with it (Enter accepts). Skipped for team-owned apps (where `owner` is a synthetic team user) — those still type it manually or skip for first-message hydration. The only id that genuinely can't be derived from a bot token is the *human operator's* user id, and this covers the common solo case.

### Net effect

`solosquad init` on the Discord path now (1) auto-detects the Application ID from your bot token, (2) asks you to confirm it (one Enter), and (3) prints + opens the invite URL at the end — restoring the v1.2.6 promise of "finish init → click once → channels auto-create in under 5 minutes".

### Why it slipped past every gate

- `npx tsc --noEmit` clean — `body.application_id` is a *type-valid* optional field access; that Discord doesn't actually send it is a runtime fact outside the type system.
- `npm test` green — `discord-invite-url.test.ts` only exercises `buildInviteUrl()` (a pure function, *given* an app id). Where the app id *comes from* (`fetchBotIdentity`) is a network call and isn't unit-tested.
- `docs-check` is string-matching only — outside the realm of API response shape.
- Manual repro requires running `init` all the way to the invite-URL block; most manual passes stop at the token/handle step. `appId` had never been populated since the v1.2.6 publish.

### Also in 1.2.9 (Parts B–E)

The same publish slot bundles four more scopes (see `docs/prd/v1.2.9-discord-app-id-fix-and-git-events-channel.md`):

- **Part B — `git-<handle>` VCS event channel.** A per-user channel for agent push notifications, split out from command/works. Channel wiring + `git_events` config + the 1.2.8→1.2.9 migration are live; the push notification itself is built (`git-event-notify.ts` + a `createDevConfirm` `onApproved` hook) but **inert** until the dev-confirm gate goes live (designed in `docs/prd/v1.3.0-dev-confirm-gate-live.md`).
- **Part C — Chief surface awareness + terminal chat + voice.** Chief now knows whether it's talking over Discord/Slack/CLI (adapter → `ChiefCall.source` → system prompt). New `solosquad chat` for terminal conversations. Messenger replies are no longer wrapped in a code block, the `-name` sign-off is dropped, and questions are asked inline (not as widgets), batched into one message.
- **Part D — `/cancel`.** Abort in-flight Chief work from Discord/terminal. Previously a second message just queued behind the first; the spawned claude is now killed via the stream abort handle, and the partial reply is suppressed.
- **Part E — dev permission toggle (`/grant` · `/revoke`).** Fixes specialists hanging on Write/git in headless mode — the bot spawned `claude --print` with no `--permission-mode`, so an unapproved tool prompt hung forever with no TTY to answer it. Dev mode ON injects `acceptEdits` + an allow-list (Write/Edit/Bash/Task…) with `git push` / `gh pr merge` / `gh pr close` denied; OFF denies Bash/Edit/Write so they refuse instead of hang. Default ON at onboarding. **Manual bot verification required before publish — spawn permission behavior depends on the live `claude` CLI and isn't unit-testable.**

---

## [1.2.8] — 2026-05-29 (fix ESM `require()` bug that broke v1.2.7 `--add-dir`)

**v1.2.7 was published with a hidden ESM/CommonJS bug that defeated the entire `--add-dir` wiring.** After install + migrate, dogfood reported that Chief *still* said "haven't granted it yet" for every external repo path — the exact problem v1.2.7 claimed to fix. Direct CLI tests proved `claude --add-dir` itself worked; the v1.2.6 trust grants in `~/.claude.json` were correct; the registered repo yamls were intact. But `addDirs` somehow came back empty in the actual spawn.

### Root cause

`src/bot/chief-runner.ts` had two helpers (`collectRegisteredRepoPaths`, `resolveRepoCloneDefault`) that lazy-loaded the standard library via:

```ts
const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const yamlLib = require("js-yaml") as typeof import("js-yaml");
```

The package ships as `"type": "module"` in package.json, so `require` is undefined inside those function bodies. The lazy loads threw `ReferenceError: require is not defined`. The outer `try { ... } catch { /* infrastructure failure */ }` silently swallowed the error → `collectRegisteredRepoPaths` returned `[]` → `addDirs.length > 0 ? addDirs : undefined` evaluated to `undefined` → `claude-process.buildArgs` saw no `addDirs` and skipped the `--add-dir` flag entirely.

### Fixed

- **Top-level ESM imports** for `fs` / `path` / `js-yaml` in chief-runner.ts. The four `require()` call sites (`resolveRepoCloneDefault` x1, `collectRegisteredRepoPaths` x3, cloneHint formatter x1) all collapse to module-scope identifiers. Same behavior every call site intended, except now it actually runs.

- **Migration**: new `src/migrations/scripts/1.2.7-to-1.2.8.ts` (workspace at 1.2.7 → 1.2.8, pure version bump). The pre-existing `1.2.6-to-1.2.7.ts` migration is renamed to `1.2.6-to-1.2.8.ts` so users on v1.2.6 skip straight to v1.2.8 without touching the broken v1.2.7 label.

- **Verification**: a standalone ESM test (no compilation step) confirms `collectRegisteredRepoPaths` against the live dogfood workspace now returns the expected 3 paths (`C:\Dev\bv-po-flow`, `C:\Dev\bv-po-homepage-nextjs`, `C:\Dev\bv-po-platform-policy`).

### User recovery (v1.2.7 installs)

1. `npm install -g solosquad@latest` (pulls 1.2.8)
2. `solosquad migrate --apply` (1.2.7 → 1.2.8 single-step chain)
3. `solosquad pm reset --user <id> --reason "post-v1.2.8-add-dir-fix"` (clears the session whose prior turns learned the "no access" pattern)
4. `solosquad bot` (restart with the fixed wiring)

### Why it slipped past every gate

- `npx tsc --noEmit` clean — the `require` calls were type-cast as `as typeof import("...")`, so TypeScript saw a valid type for the result and didn't flag the ESM/CJS mismatch.
- `npm test` 728/728 pass — none of the 728 tests exercise `collectRegisteredRepoPaths` in an actual ESM-runtime context. The helpers are runtime-injected at bot spawn, not unit-tested.
- The outer `try { ... } catch { /* skip on any infrastructure failure */ }` was an intentional best-effort posture — the migration's trust backfill swallows missing-claude-config errors the same way. But this case the swallowed error was actually programmer error, not infrastructure. Catch-everything postures need a logged warning for the next iteration so a future ESM/CJS slip doesn't disappear into the same hole.

### Also fixed (folded into v1.2.8)

- **Pre-publish ESM purity gate** (§A.11). `npm run prepublishOnly` now runs `scripts/check-esm-purity.ts` after build — walks `dist/**/*.js` and exits non-zero if any bare `require(` call survives compilation. The check is regex-only (not AST), with skips for JSDoc / single-line comments / string literals / `createRequire(import.meta.url)` (the legitimate ESM bridge). Would have caught the v1.2.7 bug 1 second before `npm publish`.

- **Bot PID file + migration auto-restart signal** (§A.10). The bot writes `<workspace>/.solosquad/bot.pid` at startup and releases it on graceful shutdown. `solosquad migrate --apply` reads the PID and sends `SIGTERM` — cloud users with PM2 / systemd / Docker auto-restart on signal; local users with `solosquad bot --supervise` (new flag, also v1.2.8) auto-respawn via supervisor loop. Plain local users still re-run `solosquad bot` manually, but at least the running instance dies cleanly instead of holding stale code in memory while the user wonders why the migration "didn't take effect".

- **`solosquad bot --supervise`** (§A.10) — new flag. Spawns the actual bot as a child process; respawns the child on clean exit (signal or zero exit code). Crash threshold = 3 consecutive non-zero exits, then the supervisor gives up rather than hammer the machine in a crash loop. Mainly for local users who want migration-driven auto-restart without configuring PM2.

  Cloud users shouldn't use `--supervise` — their process manager already handles restart. Documented in the `--help` text.

- **Bot graceful drain on SIGTERM** (§A.12). The previous shutdown handler called `process.exit(0)` the moment a signal arrived — any active Chief turn got cut off mid-stride (orphaned `claude` child, Discord reply not sent, workflow stage left at `in_progress`). v1.2.8 adds an in-flight turn counter (`src/bot/in-flight.ts`):

  - `handleCommand` increments on entry and decrements in a `finally` block — exceptions and early returns still release.
  - SIGTERM/SIGINT handler sets the *drain* flag (new Chief turns refused with a user-visible "🛑 SoloSquad is restarting — please send it again in a few seconds") and waits up to 120 seconds for active turns to finish before exiting.
  - Second signal during drain forces immediate exit so the user isn't held hostage by a stuck turn.
  - Drain timeout (default 120s) covers typical Chief turns (5-30s) plus a buffer for slow Claude API responses; short enough not to hang migration.
  - Goal cycles and scheduler routines run in separate processes (`solosquad goal run`, `solosquad schedule`) — outside the bot's drain responsibility; each owns its own lifecycle.

  Net effect: `solosquad migrate --apply` during an active turn now waits politely for that turn's reply to land before restarting the bot, instead of leaving the user with silence.

---

## [1.2.7] — 2026-05-29 (bot spawn `--add-dir` for registered repos)

**v1.2.6 dogfood within hours of publish revealed a missing piece in the v1.2 trust story.** The Claude trust auto-grant added in v1.2.6 covers the *trust dialog* — Claude will start working in a directory without prompting. It does **not** cover the *additional working directories* permission: when Claude is spawned with `cwd=<org>/bv-po`, it can read/write files inside `<org>/bv-po` but **cannot** reach the user's actual repos at paths like `C:\Dev\bv-po-flow`, because the v1.0 path-reference model registers repos *outside* the workspace tree.

Symptom: Chief replies to "리포지토리 접근 권한 확인해봐" with
> 아직 권한이 없습니다. 3개 리포 모두 동일하게 막혀있어요.
> `/add-dir C:\Dev\... C:\Dev\... C:\Dev\...` 를 직접 실행해 주세요. 이건 사용자가 슬래시 커맨드로 입력해야 추가됩니다 — 제가 대신 호출할 수 없는 명령입니다.

The `/add-dir` slash command Chief is pointing at is a Claude TUI-only command that the bot's `claude --print` process can't invoke. The user can't easily run it either — the slash command lives inside an interactive Claude session, not on the host shell.

### Fixed

- **`claude --add-dir <abs-path1> <abs-path2> ...` passed automatically.** When chief-runner spawns the Claude session, it now calls a new helper `collectRegisteredRepoPaths(orgCwd)` that walks `<orgCwd>/repositories/*.yaml`, extracts each repo's `path:` field, filters out paths that no longer exist on disk, and passes the survivors to the spawn via `ClaudeInvocation.addDirs`. `claude-process.ts:buildArgs` then appends `--add-dir <path...>` to the CLI args (variadic — paths with spaces are auto-escaped by Node's `child_process.spawn`).

- **Default clone location for new repos** (§A.7). When the user asks Chief in conversation to clone an additional repo, the natural default is "next to my existing repos" — same parent dir as the already-registered paths. chief-runner now computes that parent (most-common dirname across all registered repos) and injects it into the system prompt as a `[repo-clone-defaults]` block with the full recipe: `git clone` via Bash (the Bash tool is *not* `--add-dir`-restricted — it inherits OS permissions, so the parent dir doesn't need to be in `--add-dir`), then `solosquad add repo <path>` so the *next* turn picks up the new path in `--add-dir`. The user is told the new repo is accessible starting next turn (current turn's spawn args are already fixed). Empty when no repos are registered yet — Chief then asks the user where to clone.

- **Live-scan per spawn**, not a persisted manifest. Every Chief turn re-reads `repositories/*.yaml`, so `solosquad add repo` / `solosquad remove repo` take effect on the next turn without restarting the bot.

- **Idempotent + safe.** Repos whose registered `path:` no longer points to an existing directory (manually deleted, moved, etc.) are silently skipped — `--add-dir` would otherwise error out and abort the whole spawn.

### Migration

- `src/migrations/scripts/1.2.6-to-1.2.7.ts` — pure version bump. No workspace schema changes; the `--add-dir` plumbing is entirely runtime. The migration exists so `solosquad doctor` stops nagging about CLI ↔ workspace version mismatch after the upgrade.
- Chained from v1.2.3 via `1.2.3 → 1.2.6 → 1.2.7` and from v1.1.0 via `1.1.0 → 1.2.6 → 1.2.7`. Both chains automatic on `solosquad migrate --apply`.

### Relationship to v1.2.6 trust grant

| Mechanism | v1.2.6 (already shipped) | v1.2.7 (this release) |
|---|---|---|
| **Trust dialog** (`hasTrustDialogAccepted`) | Pre-stamped in `~/.claude.json` for every org cwd + every registered repo path so Claude doesn't refuse to start there. | unchanged |
| **Cross-directory access** (`--add-dir`) | not handled — bot stayed locked to its `cwd=<org>` | now passed automatically for every registered repo path |

Together: from v1.2.7 onward, a freshly-installed bot + `migrate --apply` + `bot` is ready to operate across the org cwd *and* every registered repo without any interactive trust prompt or manual `/add-dir`.

### CLI surface

- Zero new commands. Zero command renames. New flag goes onto the *internal* `claude` spawn — users never type it.

---

## [1.2.6] — 2026-05-29 (onboarding + vocabulary polish on 1.2.3)

> **npm version note:** internal work was labeled "v1.2.4" but `1.2.4` and `1.2.5` were burned during pre-launch experimentation (2026-05-11 / 2026-05-13 publish + later unpublish — visible via `npm view solosquad time`). Per npm policy these numbers cannot be re-used, so the actual release lands at **`1.2.6`**. The narrative "v1.2.4 onboarding polish" work content is unchanged — only the version label moves forward. Same pattern as the v1.2.0/v1.2.1 burn → v1.2.2/v1.2.3 jump documented in §[1.2.3].

**Dogfood feedback on v1.2.3 surfaced 11 small but visible UX gaps — bundled into a single patch.** No new functionality; the v1.2 series scope (Chief on Discord, OAuth invite, owner-only, TRIAGE kind routing, etc.) is unchanged. Schema breaking 0, CLI freeze 침범 0.

Details: `docs/prd/v1.2.6-onboarding-and-vocabulary-polish.md`. The prior v1.2.3 hotfix is preserved as a historical record in `docs/prd/v1.2.3-bundle-files-hotfix.md`.

### Fixed — Workspace detection

- **`detectWorkspaceVersion` no longer returns `"0.2.0"` when `.solosquad/` exists but `workspace.yaml` is missing.** Running `solosquad bot` from inside `<org>/` walked up only as far as `<org>/.solosquad/users/` (which is a v0.8 per-user yaml dir, *not* a workspace), treated it as v0.2.0 layout, matched no user yaml, and fell back to legacy `DEFAULT_CHANNELS` (`owner-command`, `workflow`) — creating ghost channels and disconnecting the bot from the real org. The strict workspace.yaml gate forces `findWorkspaceRoot` to keep walking up to the real root. (PRD §A.1)

### Fixed — Onboarding

- **Claude Code directory trust auto-grant** (PRD §A.5). The bot spawns `claude --print` with `cwd=<org>` (and the user's repos when Chief operates inside a registered path). Pre-v1.2.6 every new directory triggered Claude's interactive trust dialog on first use, which a bot process can't answer — so the first turn deadlocked or aborted. New `src/util/claude-trust.ts` writes `~/.claude.json` `projects[<absPath>].hasTrustDialogAccepted = true` (plus the surrounding default fields Claude's reader expects) when:
  - `scaffoldOrg` creates a new org dir (chief-runner's cwd is pre-trusted),
  - `registerRepoInline` in `init` Step 6.1 registers a repo path,
  - `solosquad add repo` registers a repo path.

  Best-effort: a missing `~/.claude.json` (fresh Claude install, never run) logs and skips. Idempotent — re-running on an already-trusted path is a no-op. Atomic write via `tmp + rename`. Quiet mode for `scaffoldOrg` to avoid log spam; chatty for the `add repo` CLI surface so the user sees the grant happened.

- **`messenger_user_id` auto-populate** (PRD §A.2). The v1.2.3 owner-only gate needed `messenger_user_id` to compare against `message.author.id`, but no flow ever populated it — every fresh install fell open at the gate with a startup warning. v1.2.6 lands two complementary paths:
  - `init` Step 3.5 now prompts for the owner's Discord/Slack User ID with how-to-find guidance (Discord: enable Developer Mode → right-click avatar → Copy User ID; Slack: profile → More → Copy member ID). Skip is allowed for users who don't have it handy.
  - `discord-owner-gate.decideOwnerGate` now hydrates the field from the *first message's `author.id`* when the yaml value is empty, persists via `saveUserYaml`, and logs the captured ID. Safe assumption in solo-founder / private-guild setups; the captured ID can be edited manually if wrong.
- **Slack option hidden from `init` messenger picker** (PRD §A.3). The picker step itself is kept so the flow extends naturally once the v1.2.x Slack adapter lands; Slack is shown as `disabled` with a "post-v1.0 슬롯" hint.
- **Path quotes stripped from `add repo` input** (PRD §A.4). PowerShell / Explorer "Copy as path" wraps Windows paths in `"..."` literally, and pre-v1.2.6 those quotes leaked into `path.resolve` and made every pasted Windows path look missing. New `normalizeUserPath()` helper in `src/util/platform.ts` does a balanced-quote strip + trim before `path.resolve`. Wired into both `solosquad add repo` and the `init` repo-loop. The `init` repo prompt copy also calls out the convention.

### Fixed — Chief identity plumbing

- **DiscordMessageContext reply prefix uses `OrgYaml.chief_name`** instead of the org slug. Pre-v1.2.6 the bot replied as `**[bv-po]**` (the org's filesystem slug) even when the user picked `chief_name: "Hermes"` — surfacing org identity where Chief identity belonged. The Chief name is read once from `<org>/.org.yaml`, cached per `DiscordMessageContext` instance, and falls back to `"Chief"` when unset. (PRD §B.1)
- **Chief identity injected into the LLM system prompt** via `chief-runner.invokeWithSessionRecovery.appendSystemPrompt`. New `resolveChiefIdentityHint(orgCwd)` reads `<org>/.org.yaml` once per turn and appends `[identity] You are **<chief_name>** — the org-level Chief / supervisor for "<org name>". Refer to yourself by this name when you sign off ...` to the system prompt. Cache-friendly: same org → same string → same Claude prompt-cache hit across turns. Empty when `chief_name` is unset. (PRD §B.2)
- **Chief name prompt copy boosted in `init` Step 6 + `add org`** (PRD §B.3). The prompt now explains the 6 surfaces the name appears on (bot reply prefix, onboarding embed, works task card footer, owner-only ephemeral, doctor/log, Developer Portal Bot name), with 7 examples (Hermes, Atlas, Apollo, Iris, Janus, Athena, Hephaestus). Pre-v1.2.6 the prompt was a one-liner without context.

### Fixed — Vocabulary (`PM` → `Chief` in user-facing labels)

- **Surface labels renamed** to match the v1.1.0 Chief role: `[Bot] PM turn:` → `[Bot] Chief turn:`, `[Bot] PM error:` → `[Bot] Chief error:`, `[Bot] PM turn done:` → `[Bot] Chief turn done:`, `solosquad pm status` output `"PM sessions:"` → `"Chief sessions:"`, `"Rotated PM session"` → `"Rotated Chief session"`, etc. Inquirer prompts that say "Archive PM session for ..." now say "Archive Chief session for ...". (PRD §C.1, §C.2)
- **`pm.message_in` / `pm.message_out` / `pm.error` jsonl event kinds stay as-is** (PRD §C.3) — schema_version backward-compat per `docs/policy/schema-stability.md` §6, and the archive consumers (`solosquad memory search` / `archive verify`) depend on the literal `kind` strings. Internal vocabulary mismatch is acceptable; user-facing UX takes priority.
- **CLI command `solosquad pm <status|reset|compact>` kept verbatim** — v1.0 CLI surface freeze. A future `solosquad chief` alias is queued for v2 SemVer, where renaming a command is legal.

### Fixed — Manual

- **Master-guide §5 reorder** — Discord is now §5.1 (was §5.2), Slack is §5.2 (was §5.1). Both `_ko.html` + `_en.html`. (PRD §D.1)
- **§5.1 Discord content fully rewritten for v1.2** (PRD §D.2). The pre-v1.2 walkthrough was a v0.2.x artifact:
  - Removed: the "Step 5 — server name rule" block (the v0.2.x mapping that required Discord server names to contain the product slug — superseded by v1.0.3 `ownOrgSlug` direct binding via `<org>/discord/config.yaml`).
  - Removed: the `📁 AI Team Reports` channel tree with `#daily-brief` / `#signals` / `#experiments` / `#weekly-review` / `#owner-command` — that whole topology was v0.2.x. v1.2 uses handle-based channels (`#command-<handle>` / `#works-<handle>`).
  - Added: the v1.2 onboarding flow as 8 steps — Developer Portal Bot creation with name matching the Chief name, Privileged Gateway Intent toggle, Application Client ID copy, Discord User ID copy for owner-only, `solosquad init` walk, OAuth invite URL click, automatic guildCreate onboarding embed + Auto-create button, `solosquad doctor --discord` 5-hop verification.
- **Sidebar release-callout further compressed** (PRD §D.3). Pre-v1.2.6 it was a ~22-line dense paragraph that pushed nav off-screen; v1.2.3 compressed it to one 250-character line; v1.2.6 trims it further to a sub-line teaser pointing to `CHANGELOG.md §[1.2.6]`. KO + EN both. The remaining `· Messenger Connection / v1.2.6 — Discord 자동 연결 + Chief 이름 + owner-only 게이트 + TRIAGE kind 분기. 자세히 CHANGELOG.md §[1.2.6].` text is the *intended* compact teaser, not a layout artifact.
- **§10 reorder — FAQ at the bottom** (PRD §D.4). The pre-v1.2.6 §10 order put FAQ in the middle (10.3) between Migration (10.2) and Uninstall (10.4). v1.2.6 moves FAQ to §10.5 (Uninstall → 10.3, Bot/Scheduler → 10.4, FAQ → 10.5) so the "quick reference" lookup lands at the end of the manual where users expect it. IDs renumbered in lockstep with labels (s10-3 = Uninstall, s10-4 = Bot, s10-5 = FAQ). External anchor links to old `#s10-3` (FAQ) and `#s10-5` (Bot) shift — accepted churn cost for cleaner navigation.

### Migration

- `src/migrations/scripts/1.1.0-to-1.2.6.ts` (renamed from `1.1.0-to-1.2.3.ts`, `TARGET = "1.2.3"` → `"1.2.6"`). Migration body otherwise unchanged — v1.2.6 is purely UX/vocab; no new schema fields, no new bundle seeds.
- **New `src/migrations/scripts/1.2.3-to-1.2.6.ts`** handles workspaces already at v1.2.3 (the typical case for anyone who installed the v1.2.3 hotfix immediately). Two actions: version bump + Claude Code trust backfill (every existing org cwd + every registered repo path). Idempotent on re-run.
- **Both migrations now backfill Claude Code directory trust** for existing org / repo paths via `grantClaudeTrustMany`. So `migrate --apply` on a workspace that predates v1.2.6 *retroactively* fixes the trust dialog for every org cwd and every repo registered before the v1.2.6 install — not just new registrations. Best-effort: a missing `~/.claude.json` (Claude not yet run on this machine) logs and skips.

### Schema

- No new fields. `UserYaml.messenger_user_id` (declared in v1.2.3) is now actively populated by both `init` and the first-message hydration.

### CLI surface

- Zero new commands. Zero command renames. `--chief-name` / `--skip-discord` flags on `add org` (v1.2.3) continue to work.

### Tests

- 728/728 pass (unchanged count — v1.2.6 is repackaging existing behavior, not adding new test surface).

### Recovery for users stuck at `workspace.yaml.version: 1.2.2` (the burned label)

The v1.2.6 migration still chains `1.1.0 → 1.2.6`, not `1.2.2 → 1.2.6`. Anyone whose workspace bumped to 1.2.2 from the broken v1.2.2 release (no actual user known) should:

1. Manually edit `.solosquad/workspace.yaml`: change `version: 1.2.2` to `version: 1.0.4`.
2. `npm install -g solosquad@latest` (pulls 1.2.6).
3. `solosquad migrate --apply` — the full chain re-runs from 1.0.4 with the bundle intact and lands at 1.2.6.

---

## [1.2.3] — 2026-05-28 (hotfix on 1.2.2)

**Bundle resources restored to the npm tarball.** v1.2.2 (published 2026-05-28 ~ KST 17:00) shipped with `package.json.files` whitelisting only `dist/` + `assets/` + `manual/`. The v1.1.0-era root directories (`agents/`, `skills/`, `teams/`, `schedules/`, `user/`, `knowledge/`) were *omitted from the tarball*, so any user running `solosquad migrate --apply` from an earlier workspace hit `Verify failed at 1.1.0: Bundle resources missing — package is incomplete` at step 6/7 of a 0.9.2 → 1.2.x chain (chief SKILL.md + 4 team folders + problem-definition workflow seed all missing from the install).

### Fixed

- **`package.json` `files` whitelist** now includes every v1.1+ bundle root: `agents/`, `skills/`, `teams/`, `schedules/`, `user/`, `knowledge/`. Tarball file count 567 → 649; size 875 kB → 933 kB. `npm pack --dry-run` now lists chief / pm / engineer / designer / marketer SKILL.md, 20 specialist SKILL.md, every team's OKR.md + KNOWLEDGE.md + composition.yaml, and the problem-definition workflow.yaml — exactly the sources that the v1.0.4 → v1.1.0 and v1.1.0 → v1.2.x migrations need at `verify()` time.
- **Migration target renamed** — `src/migrations/scripts/1.1.0-to-1.2.2.ts` → `1.1.0-to-1.2.3.ts`, `TARGET = "1.2.2"` → `"1.2.3"`. Index registry import + tests updated. No user is at workspace v1.2.2 (the broken release was published but no install successfully completed past v1.0.4 → v1.1.0 verify); renaming forward is safe.

### User action

Users who attempted `migrate --apply` on v1.2.2 and saw `Bundle resources missing — package is incomplete`:

1. `solosquad migrate --rollback` — restore the pre-migration backup (path printed in the failure message, e.g. `~/.solosquad-backups/2026-05-28T...-v0.9.2`).
2. `npm install -g solosquad@latest` — pick up 1.2.3.
3. `solosquad migrate --apply` — re-run the full chain. With the bundle present, v1.0.4 → v1.1.0 verify passes and the chain completes at `workspace.yaml.version=1.2.3`.

The v1.0.4 → v1.1.0 migration's `apply()` step skips missing seeds silently (`if (!fs.existsSync(seed.source)) continue;`) and bumps `workspace.yaml.version` *before* `verify()` runs. So a failed v1.2.2 attempt may have left the workspace at version `1.1.0` with zero seeds applied. Rollback (per the runner's preserved backup) is the cleanest recovery.

### Why this slipped past the v1.2.2 publish check

`npm run prepublishOnly` only runs `tsc` + `docs-check`. It doesn't inspect tarball contents. The `npm pack --dry-run` runs done before publishing v1.2.2 reported total file counts but I didn't grep them for the seeded bundle paths. Tests caught nothing because they use the *repo's* on-disk bundle (which is intact); they don't simulate the npm-install-then-migrate path. Tightening the pre-publish gate to assert seed-path presence is queued as a follow-up.

---

## [1.2.2] — 2026-05-28 (npm-burned — superseded by 1.2.3)

> **Status:** Published to npm at 1.2.2 but broken (bundle root dirs missing from tarball). See [1.2.3] above for the hotfix. The *work content* below is identical between 1.2.2 and 1.2.3; only the `files` whitelist + version label changed.

> **npm version note:** the work was originally tagged "v1.2.0" internally, but the `1.2.0` / `1.2.1` numbers on the npm registry were burned during pre-launch experimentation (2026-04-22~23 publish + later unpublish — visible via `npm view solosquad time`). Per npm policy these numbers cannot be re-published, so the v1.2 series first attempted publish at **`1.2.2`** then hot-fixed forward to **`1.2.3`** when the bundle-files gap was caught. The narrative "v1.2 series" (Messenger Connection) is unchanged — 1.2.3 is the *first usable* published release in the series.

**v1.2.2 — Messenger Connection (Chief on Discord, auto-connect first).** v1.1.0 Multi-Agent Team Architecture 위에 *외부 가시 UX* 를 얹어 *조직 1개당 1 Chief 봇* + *OAuth Invite URL 1-click* + *handle 기반 채널 멀티-메신저 portable* + *owner-only 게이트* + *TRIAGE kind 분기로 작업 단위는 `works-<handle>` task hub + thread* + *`solosquad add-org` 가 새 조직을 완전 동작 상태로 부트스트랩 (Chief 이름 + v1.1 위계 + problem-definition workflow 기본 시드)*. 자세히 `docs/prd/v1.2-messenger-connection-discord-first.md`.

### Added — Discord auto-connect (PRD §3, §4)

- **`solosquad discord invite-url` CLI** (`src/cli/discord.ts` + `src/messenger/discord-invite-url.ts`) — `bot_application_id` + v1.2 §4.2 권장 permissions bitfield (10 perms — Manage Channels/View Channels/Send Messages/Embed Links/Attach Files/Read Message History/Manage Threads/Create Public Threads/Send Messages in Threads/Use Application Commands; Administrator/Manage Guild/Manage Roles/Kick/Ban/Mention Everyone 의도적 배제) 으로 OAuth URL 합성 + 브라우저 자동 열기 + clipboard fallback. `bigint` 으로 64-bit 권한 정확도.
- **`OrgYaml.chief_name`** — org 단위 Chief 이름. `init` / `add-org` 가 prompt → `.org.yaml` 박제. Discord onboarding embed 제목 / narration prefix / doctor 출력에 변수화. Developer Portal Bot 이름과 동일 사용 권장.
- **`init` Step 4 강화** — Discord token prompt 전에 *"Bot 이름 = Chief 이름 권장"* guidance. 토큰 입력 직후 invite URL 자동 합성 + 브라우저 open.
- **`solosquad add org` 보강** — `--chief-name <name>` / `--skip-discord` 플래그. Chief 이름 prompt + scaffoldOrg 가 v1.1.0 전체 위계 시드 (`agents/main/chief/SKILL.md`, `teams/{product,engineering,design,marketing}/{OKR.md, KNOWLEDGE.md, composition.yaml}`, `memory/{open-questions,ledger}`, `knowledge/`) + problem-definition workflow 기본 seed + 메신저 inline 연결 prompt (Discord 봇이 이미 등록되어 있으면 즉시 invite URL 출력).

### Added — Onboarding & gating (PRD §5, §4.5)

- **guildCreate onboarding embed + button** (`src/messenger/discord-onboarding.ts`) — 봇이 길드에 추가되면 systemChannel (없으면 첫 writable text 채널) 에 환영 embed 송신. 제목 = Chief 이름. 2 button: `chief:onboard:auto` → ensureChannels 실행 + `#command-<handle>` 에서 첫 인사 / `chief:onboard:manual` → 채널 멘션 prompt. 멱등 — `chief-onboard-embed:v1.2` 마커로 마지막 50 메시지 dedupe, 첫 인사도 채널 last-10 스캔으로 dedupe. systemChannel 권한 부족 시 owner DM fallback.
- **Owner-only gate** (`src/messenger/discord-owner-gate.ts`) — `message.author.id === user.yaml.messenger_user_id` author check. 신규 설치 = `owner_only: true` default, 기존 v1.0.x→v1.1.0→v1.2.2 업그레이드는 migration 이 `owner_only: false` 박제 (v1.0.2 channel-ACL-only 동작 보존, neutral upgrade). 미일치 → silently ignore + 첫 1회 ephemeral 안내 (LRU per-(guild, sender) 1시간 dedupe + 30s auto-delete). `messenger_user_id` 미설정 시 fail-open (브릭 방지). v1.0.2 author-guard 제거의 *진짜* 사유 (= 당시 채널명이 user-id 라 봇 인식 실패) 가 handle 기반 채널명 (v0.8.0~) 으로 해소된 이상 재도입 정당화 + bidirectional configurable.

### Added — TRIAGE kind branch + works task hub (PRD §6.2, §8)

- **`ChiefReply.kind` 필드 + `[kind:...]` 마커 파서** (`src/bot/chief-runner.ts`) — Chief 가 응답 첫 줄에 `[kind:<chat|workflow|schedule|goal>]` 출력하면 runner 가 strip 후 ChiefReply.kind 노출. 마커 부재 시 user-text 휴리스틱 (`/workflow`/`워크플로`/`/schedule`/`스케줄`/`/goal`/`목표`) fallback. agents/main/chief/SKILL.md 에 마커 출력 가이드 신설.
- **`MessageContext.postTaskCard` + `discord-task-card.ts`** — `kind ∈ {workflow, schedule, goal}` 시 `works-<handle>` 채널에 task card embed (`📋 WORKFLOW: <title>` / 색깔 차등: workflow=blurple, schedule=green, goal=amber; 요청 / workflow_id / KST 시각) post → `message.startThread({ autoArchiveDuration: 10080 })` → Chief reply 가 thread 내부에 chunk 분할 송신. `<org>/workflows/<wf-id>/discord-thread.txt` (thread URL + thread_id + works message_id + kind + started_at) 박제로 chief-runner reconcile (§6.3) 가 같은 thread 재개 가능. `command-<handle>` 채널엔 *"📋 작업 등록됨 → <thread URL>"* 1줄 announce. `kind === chat` 은 v1.0 동작 그대로 평탄 응답.
- **Stage event → thread narration** (`src/messenger/discord-narration.ts`) — `chief-stage-events.jsonl` 의 turnId 일치 entry 를 thread 메시지로 projection. DECOMPOSE → `🗂 작업 분해 중...`, DISPATCH → `📤 dispatch: pm, engineer (병렬 2)`, AWAIT (open_questions detail) → `❓ <detail>`. TRIAGE/SYNTHESIZE/DECIDE/RETROSPECT 는 생략 (Chief reply 가 자체 표현). `skills_used` 가 있으면 `↳ skill1, skill2` follow-on 라인 추가. `ChiefReply.turnId` 노출로 adapter 가 정확한 turn 만 가져옴.

### Added — Diagnostics + fallback (PRD §10, §7.4)

- **`solosquad doctor --discord` 5-hop diagnostic** (`src/cli/doctor-discord.ts`) — DISCORD_TOKEN env 존재 + shape → REST `/users/@me` 호출 (live token + 응답 valid) → bot_user_id 가 workspace 의 user.yaml 1개와 일치 → guild membership (proxy: `<org>/discord/config.yaml.guild_id` 박제됨) → command 채널 ID 박제. 매 hop attributable + actionable; Hop 4 실패 시 합성된 invite URL 까지 같이 출력. `--ci` 가 실패 count 를 exit code 로 propagate.
- **`/chat` slash command 등록** (`src/messenger/discord-chat-slash.ts`) — MESSAGE_CONTENT intent 거부 (Discord verification edge case / 100길드 초과) fallback. Guild scope 등록 (immediate REST 반영, 1시간 global 전파 회피). 응답은 same `onCommand` 파이프라인. `postTaskCard` 는 slash MessageContext 에서 의도적 누락 — slash fallback 은 flat 응답 유지.

### Added — Bootstrap + workflow seed (PRD §5.5, §12 #16)

- **`scaffoldOrg` v1.1 + v1.2 전체 위계 시드** (`src/util/scaffold.ts`) — 기존 v0.2 시드 (memory/routine-logs, workflows, repositories, <messenger>, 4 schema JSONL) 위에 v1.1.0 시드 추가 (memory/{open-questions,ledger}, knowledge/, agents/main/chief/SKILL.md, 4 teams × 3 files). 모두 idempotent (bundle copy 가 dest 존재 시 skip — 사용자 customization 보호). 기존 v1.1.0 출시에서 *migration 만 시드하고 add-org 는 시드 누락* 했던 gap 해소.
- **`skills/workflow-maker/assets/workflows/problem-definition/workflow.yaml`** — 새 조직 기본 워크플로 (v1.2 directive #6). 6-stage chain: SCQA (assets/01) → 5-Whys (assets/02) → MECE (assets/03) → TDCC (assets/04) → XYZ Hypothesis (assets/05) → 1-pager PRD (assets/06). 각 phase 가 PM (`product/pmf-planner`) 실행, evidence-refs 또는 open_questions[] 출력. discovery-cycle 보다 *문제 정의 그 자체* 에 집중한 가벼운 entry point.

### Migration

- `src/migrations/scripts/1.1.0-to-1.2.2.ts` — workspace.yaml.version bump + `workspace.yaml.messenger.discord.{owner_only:false, install_mode:byo_manual, thread_token_budget:80000}` 박제 + 기존 org 의 `workflows/problem-definition/workflow.yaml` 시드. Idempotent (재실행 = no-op), 기존 user.yaml / channel / token / config.yaml / open-questions / ledger 무손상. `org.yaml.chief_name` 은 *interactive* — migration 이 자동 박제 안 함, doctor / init / add-org 가 prompt; runtime fallback `"Chief"`.

### Schema

- `org.yaml.chief_name` (신규 optional string)
- `workspace.yaml.messenger.discord.owner_only` (boolean, default `true` 신규 / `false` 업그레이드)
- `workspace.yaml.messenger.discord.install_mode` (`oauth_invite` | `byo_manual`)
- `workspace.yaml.messenger.discord.thread_token_budget` (default 80000)
- breaking 0 (모두 optional + 기존 동작 보존)

### CLI surface

- 신규: `solosquad discord invite-url [--client-id <id>] [--print-only] [--org <slug>]`, `solosquad doctor --discord`
- 확장: `solosquad add org [--chief-name <name>] [--skip-discord]`, `solosquad init` Step 4 / Step 6 (Chief 이름 prompt + 자동 invite URL)
- freeze 침범 0 (`add-org` 는 v1.1.0 신설)

### Tests

- 53 신규 tests across 6 files (`discord-invite-url.test.ts` × 10, `chief-kind-parser.test.ts` × 8, `migration-1.1.0-to-1.2.2.test.ts` × 10, `scaffold-org-v12.test.ts` × 7, `discord-owner-gate.test.ts` × 8, `discord-narration.test.ts` × 8). Suite 675 → **728 / 728 pass**. Pre-flight 검증 7/7 통과 (CLI surface, invite-url 합성, doctor --discord 5-hop, add-org tmpdir end-to-end, migration apply+verify+idempotent).

### Deferred to v1.2.1 (thread 연속성 인프라 선행 필요)

- referencedMessage chain + LRU cache (PRD §7.3 / §12 #8)
- Thread token budget guard (PRD §9.2 / §12 #11)
- 둘 다 messageCreate 가 thread 메시지를 수신 + thread → workflow_id reverse lookup 인프라가 선행되어야 의미 있음. v1.2.2 = 작업 1개 = thread 1개 모델이라 연속성 surface 없음. Slack adapter 와 동일 슬롯.

---

## [1.1.0] — 2026-05-27

**v1.1.0 — Multi-Agent Team Architecture.** Single PM session 패러다임을 Team-Centric Multi-Agent 로 격상. Chief (org-level supervisor) + 4 main bot (pm/engineer/designer/marketer) + 20 specialist + 18 skill + 4 team. Hermes V2 5-layer 위계 + gstack Six Forcing Questions + RO-PNA 6-Phase + phuryn pm-skills 통합. **메신저 연결은 v1.2 별도 plan** (L1 Gateway). 자세히 `docs/prd/v1.1-multi-agent-team-architecture.md`.

### Added — Multi-agent architecture (PRD §3-§8)

- **Chief role** (`<org>/agents/main/chief/SKILL.md`) — org-level 도메인 전문가, 유일한 user-facing bot. 책임 4가지: 사용자 소통 / 과제화 (triage) / 오케스트레이션 / 회고. 6+1 stage state machine (TRIAGE → DECOMPOSE → DISPATCH → AWAIT → SYNTHESIZE → DECIDE → RETROSPECT) 가 `<org>/memory/chief-stage-events.jsonl` 에 자동 기록 (`src/util/chief-stage-events.ts`).
- **PM role** (`agents/main/pm/SKILL.md`) — workspace bundle, 자율 product manager. 사용자와 **직접 대화 안 함** (Chief 경유). 책임: 문제 정의 / 가설·실험 / 마일스톤·WBS / 데이터 기반 판단. open_questions[] 프로토콜로 정보 부족 시 Chief 에게 batch escalate.
- **Engineer / Designer / Marketer** main bot 3개 — 각 팀 specialist 오케스트레이션.
- **20 specialist** (4 병합 + 1 rename): backend-developer+api-developer→backend-engineer, data-collector+data-engineer→data-engineer, idea-refiner+scope-estimator→idea-scoper, user-researcher+desk-researcher→researcher, paid-marketer→performance-marketer. content-marketer 병합은 취소 (`brand-marketer` 유지 + `content-writing` skill 로 분리).
- **4 팀**: product (구 strategy), engineering, design (구 experience), marketing (구 growth). 각 팀에 `KNOWLEDGE.md` + `OKR.md` + `composition.yaml`.
- **OKR ↔ 마일스톤/WBS 의사결정 분리** — Chief 가 OKR (분기 정성+정량), PM 이 마일스톤·WBS (주~월 실행) 결정.

### Added — Skill catalog (18개, agentskills.io 표준)

- Problem definition: `problem-definition`(RO-PNA 6-Phase 6 assets 포함) / `discovery-synthesis` / `opportunity-tree` / `hypothesis-design`
- Planning: `prd-writer` / `prioritization` (9-framework) / `wbs-decomposition` / `experiment-design` / `jobs-stories` / `lean-canvas` / `premortem`
- Discovery: `interview-script-author` (Mom Test)
- Reflection (Chief 호출): `retrospective` (gstack /retro pattern) / `skill-refinement` / `workflow-refinement`
- Orchestration: `okr-writer` / `triage` (Educational Nudge 포함)
- Core (기존): `workflow-maker` / `content-writing` / `search` / `verify` / `code-review` / `citation` / `screenshot`

### Added — Infrastructure

- **9-layer JIT context** — Layer 4a (team OKR) 신설 (`src/bot/spawn-assembler.ts`). Chief 가 작성한 분기 OKR 이 매 spawn 시 자동 inject.
- **`open_questions[]` 프로토콜** (`src/util/open-questions.ts`) — PM 이 컨텍스트로 풀 수 없는 항목을 batch JSON 으로 escalate. Chief 가 사용자에게 묶어 질의.
- **Goal queue** (`src/util/goal-queue.ts` + `solosquad goal queue/active/next` CLI) — 1-active-per-org semaphore, FIFO 대기열.
- **Leading indicator** (`schedules/leading-indicator.md` + `src/util/leading-indicators.ts`) — 매일 5 지표: 대화→작업 변환률, 자동 PR 성공률, autonomous goal cycles, shipping streak, avg confidence score.
- **Experiment 인프라** — `<org>/experiments/<id>/manifest.yaml` 템플릿 (variants + metrics + gates + Amplitude pattern).
- **3 신규 schedule** — leading-indicator, trace-rotate, bot-health-check.
- **4 workflow templates** — discovery-cycle, pmf-validation, autoplan-pm, weekly-retro.
- **composition.yaml** (`src/util/composition.ts`) — 팀 멤버십 데이터 (specialists 평탄 폴더 + 팀 = YAML 으로 정의).

### Changed — Code refactors

- `src/bot/pm-runner.ts` → **`src/bot/chief-runner.ts`** rename (class `PmRunner` → `ChiefRunner`, etc.). Event 이름 `pm.*` 은 backward-compat 유지 (archive consumers).
- `src/util/paths.ts` 신규 path resolver 6개: `getBundleRoot`, `getMainAgentsDir`, `getSpecialistsDir`, `getSkillsDir`, `getTeamsDir`, `getUserDir`, `getSchedulesDir`.
- `src/bot/agent-router.ts` / `src/bot/agents-builder.ts` — v1.1 flat layout (`agents/{main,specialists}/<name>/SKILL.md`) 인식. v1.0.x nested layout 도 그대로 지원 (transition coexistence).
- `solosquad init` 이 v1.1 번들 디렉토리 (`agents`, `skills`, `teams`, `schedules`, `user`, `knowledge`) 도 `.solosquad/` 로 복사.

### Fixed — 빈 agent list 버그

- `syncAgentsToOrg` 가 v0.2.4→v0.3.0 마이그레이션에서만 호출되던 결함 해결. v0.3.0 이후 생성된 org 가 `.claude/agents/` 비어있어 specialist 가 보이지 않던 문제 영구 fix. `solosquad init` / `add-org` / `sync` 세 경로 모두에 sync 추가 (`src/cli/{init,add-org,sync}.ts`).

### Migration

- **No-op for v1.0.x users** (현재 사용자 0 — clean slate). `src/migrations/scripts/1.0.2-to-1.1.0.ts` 는 workspace.yaml 버전 bump + per-org seed (Chief SKILL.md template, team OKR.md × 4, memory/open-questions, memory/ledger) 만 수행. 기존 사용자 데이터 변경 없음. v1.0.3 / v1.0.4 patch 도 본 1.1.0 에 흡수 — chained migration 정상 동작.

### Out of scope (v1.2 plan 으로 위임)

- **L1 Gateway** — Discord/Slack 채널 토폴로지 재편, 9-hop diagnostic, Forum Channel, Echo guard.
- 본 v1.1 은 L2~L5 (internal architecture) 만 다룸.

## [1.0.4] — 2026-05-22

**v1.0.4 — Discord config.yaml 자동 생성 + Slack author-guard 통째 cleanup.** v1.0.3 의 Bug D fix 가 *root cause 의 절반만* 잡았던 정직 자가비판 박제. v1.0.3 이 `syncGuildProductMapping` 의 *서버명 휴리스틱* 만 제거하고 *file-existence early-return* 분기는 그대로 둠 → 사용자가 v1.0.3 설치 후에도 *"No product linked to this server"* 응답 받음. v1.0.4 는 *load-or-empty + auto-write* 패턴으로 진짜 fix + 같은 release 에서 약속된 Slack author-guard 제거. plan §1.3 에 *silent-bail 패턴* 을 v1.0.3 plan §6 *반복 패턴* 의 3번째 변형으로 추가. 자세히 `docs/plan/v1.0.4-messenger-config-auto-create.md`.

### Fixed — Bug G: Discord `config.yaml` 자동 생성 (load-or-empty + auto-write)
- `src/messenger/discord-adapter.ts:syncGuildProductMapping` — pre-v1.0.4 의 `if (!fs.existsSync(configFile)) return;` silent early-return 제거. 파일 없으면 빈 객체로 시작 + `mkdirSync` 로 디렉터리 보장 + 실제 바뀐 필드 있을 때만 writeFile (idempotent).
- 사용자 incident 직접 fix: `scaffoldOrg` 가 `<org>/discord/` *빈 디렉터리만* 만들고 `config.yaml` 은 never 작성 → 모든 fresh `solosquad init` 워크스페이스가 silent-bail 분기에 차단되던 회귀. 봇 첫 시작 시 `[Discord] Bound guild <name> (<id>) → org=<slug>` 로그 *처음으로* 출력.
- `getProductByGuild` 는 동작 변경 0 (주석만 갱신) — `syncGuildProductMapping` 이 항상 file 을 작성하므로 후속 메시지 처리에서 정상 동작.

### Removed — Bug H: Slack author-guard 통째 cleanup (v1.0.2 Discord 대칭 마무리)
- `src/messenger/slack-adapter.ts` — `isAuthorizedAuthor` import 제거 + 가드 블록 (~22줄) 제거 + audit log 1줄 추가 (`[Slack Bot] message in <channel> from author id=<id>`). v1.0.2 Discord 어댑터 fix 와 동일 패턴.
- **`src/bot/author-guard.ts` 파일 통째 삭제** (36줄) — Slack 이 마지막 소비자였음. v1.0.2 가 *유보* 했던 파일 삭제를 v1.0.4 가 마무리.
- **`test/author-guard.test.ts` 파일 통째 삭제** (45줄, 6 cases) — 대상 함수 사라짐. v1.0.2 의 회귀 catcher (`test/v1.0.2-discord-author-guard-removed.test.ts`) 마지막 case 는 *역전된 형태로 보존* — 파일 *부재* 를 assert 하도록 수정해 v1.0.2 → v1.0.4 의 *deletion 순차 진행* 사실 박제.

### Compatibility — v1.0.3 사용자
- workspace.yaml.version 자동 마이그레이션 (1.0.3 → 1.0.4, `src/migrations/scripts/1.0.3-to-1.0.4.ts`, bump-only, idempotent).
- 기존 `<org>/discord/config.yaml` *있는* 사용자: 변경 0 (load → 같은 값 → dirty=false → writeFile 안 함).
- 기존 `<org>/discord/config.yaml` *없는* 사용자 (대다수): 봇 첫 시작 시 *자동 작성*.
- 기존 `<org>/discord/` 디렉터리도 없는 케이스: `mkdir -p` 가 보장.
- Slack 사용자: author-guard false positive (v1.0.2 Discord 와 동일 패턴) 영구 0. audit log 추가.
- breaking 0, schema 변경 0, CLI surface 변경 0 — api-stability 정책 완전 준수.

### Added — regression catchers (2 신규 파일, +10 cases)
- `test/v1.0.4-config-auto-create.test.ts` (4) — `if (!fs.existsSync) return;` silent-bail 부재, load-or-empty 삼항식 존재, mkdir -p 존재, `Bound guild ... → org=` 로그 보존.
- `test/v1.0.4-slack-author-guard-removed.test.ts` (6) — slack-adapter author-guard import/call/DM 부재, audit log 출력, `src/bot/author-guard.ts` 파일 부재, `test/author-guard.test.ts` 파일 부재.
- 순 테스트: 613 → **617 green** (+10 신규 − 6 author-guard.test.ts 삭제).

### Spec retraction — v1.0.3 plan §6 *반복 패턴* 에 3번째 변형 추가
v1.0.3 plan §6 이 박제한 두 갈래 — (a) 외부 자유 입력 ↔ 내부 슬러그 문자열 비교, (b) v0.1.x 잔재 vocab/UX — 에 v1.0.4 가 **3번째 변형**: *권위 결정자가 있는데도 옛 기록 파일 유무로 silently bail 하는 코드*. 본 v1.0.4 G fix 자체가 그 변형의 직접 해소. 향후 회귀 catcher 가이드라인 — `if (!fs.existsSync(x)) return;` 류 silent bail 도 trip-wire 대상.

### Added — Best Practice P 일부 적용: *5-hop binding 진단 메시지*
- `src/messenger/discord-adapter.ts` — *9-reference 조사* (OpenClaw, Claude Code Channels, LangChain, AutoGen, Composio, llmcord, openai/gpt-discord-bot, LibreChat, AnythingLLM) 합의된 **Best Practice 5: 누락값 hard fail + actionable hint** 도입.
- generic *"No product linked to this server. Re-run \`solosquad init\`."* 메시지 제거 → `diagnoseProductByGuildFailure` helper 가 *5-hop chain 의 어느 마디* 가 깨졌는지 명시 (ownOrgSlug null / config.yaml 부재 / guild_id 미박제 / guild_id 불일치 / loadProducts 미포함). 사용자가 *어디부터* 디버깅해야 할지 즉시 파악.
- 향후 binding 회귀 발생 시 *attributable hop* 으로 잡힘 — silent-fail 시대 마감의 디버깅 인프라.
- 신규 catcher 2 cases (`test/v1.0.4-config-auto-create.test.ts`): 진단 helper 존재 + 5 hop 각각의 메시지 string 박제.

### Spec retraction — *9-reference 조사 결과 plan §7.2 박제*
plan doc `docs/plan/v1.0.4-messenger-config-auto-create.md` §7.2 에 *9-reference 조사 보고서 요약* 박제. 모든 레퍼런스 공통 *필수 값 3개* (Bot Token / Message Content Intent / OAuth `bot` scope), 바인딩 패턴 4가지 분류, SoloSquad 의 *(b) 패턴 절반 채택* 진단, 그리고 *5 Best Practice* (L 페어링 + approve CLI / M snowflake branded types / N silent early-return 전수 제거 / O token precedence 명문화 / P actionable hint). v1.0.4 는 P 일부만 흡수, 나머지 L+M+N+O 는 v1.0.5 ~ v1.1 슬롯 후보 박제.

순 테스트 갱신: 613 → **619 green** (+10 신규 + 2 추가 진단 catcher − 6 author-guard.test.ts 삭제).

## [1.0.3] — 2026-05-22

**v1.0.3 — Discord 5-bug fix (migrate · sudo · guild-org binding · update next-step · category rename).** v1.0.2 publish 직후 사용자 dogfood 검증에서 *연속 5건* 의 *문자열 비교·v0.1.x 잔재 vocab* 함정이 노출됨. 다섯 건 모두 **솔로 파운더 정상 사용 시나리오에서 false positive 또는 friction 이 기본값** — *권위 결정자를 무시하고 약한 비교 휴리스틱으로 다시 추측* 하는 동일 패턴. v1.0.2 author-guard incident 와 같은 정신으로 *결정자 직접 사용 + 옛 vocab 은 backward compat lookup 만* 으로 통일. Slack 어댑터의 동등 author-guard 제거는 *v1.0.4 슬롯으로 분리*. 자세히 `docs/plan/v1.0.3-discord-triple-bug-fix.md`.

### Fixed — Bug A: `versionMatches` slice 산수가 patch-level migration 영구 차단
- `src/migrations/detect.ts:versionMatches` — `X.Y.Z.x` 패턴이 *exact `X.Y.Z`* 도 매치하도록 한 줄 수정. `spec.slice(0, -2)` 추가.
- 본 사용자가 workspace v1.0.0 에서 `solosquad migrate --apply` 실행 시 *"No migration found for source version 1.0.0"* 실패 → root cause: `versionMatches("1.0.0.x", "1.0.0")` 가 false (slice 가 `"1.0.0."` 만 남기고 detected 가 그 prefix startsWith 못 함).
- 동일 함정이 v092ToV100 (`from: "0.9.2.x"`), v100ToV101, v101ToV102 + 옛 8건의 patch-exact 패턴에 잠재. 본 한 줄 fix 가 모든 누적 함정 동시 해소 + 미래 patch migration 도 같은 함정 면역.

### Fixed — Bug B: `npmGlobalInstallCmd` 가 nvm/Homebrew 사용자에게 잘못된 `sudo` 권유
- `src/util/platform.ts:npmGlobalInstallCmd` — `process.getuid() === 0` 추측 → `npm config get prefix` 결과에 `fs.accessSync(prefix, W_OK)` 실제 권한 체크.
- nvm / fnm / asdf / Homebrew (Apple Silicon 및 Intel chowned) 사용자: false sudo 권유 사라짐 + `Password:` 입력 단계 사라짐.
- 시스템 패키지 (`apt install nodejs`) 사용자: 정확한 sudo 권유 유지 (fallback 분기).

### Fixed — Bug D: Discord guild-org binding 의 v0.1.x 서버명 휴리스틱
- `src/messenger/discord-adapter.ts:syncGuildProductMapping` — `guild.name.includes(product.slug)` 휴리스틱 제거 + `this.ownOrgSlug` (v0.8 `resolveBotIdentity` 가 이미 결정한 값) 직접 사용.
- 본 사용자 incident: `command-w1n` 채널 메시지 → *"No product linked to this server. Re-run solosquad init"* — root cause: Discord 서버 이름이 SoloSquad org slug `rosyocean` 을 포함하지 않아 `syncGuildProductMapping` IF 가 false → guild_id 박제 안 됨 → `getProductByGuild` null.
- v1.0.3 부팅 로그: `[Discord] Bound guild <name> (<id>) → org=<slug>` — 봇 자기 org 명시적 binding. 다중 guild 일 때는 첫 guild 로 binding + 명시적 안내 로그.
- 인접 정리: `getProductByGuild` 도 `ownOrgSlug` 직접 사용 — 매 메시지마다 yaml read 반복 제거.

### Changed — Bug E: `solosquad update` 가 post-install workspace lag 안내
- `src/cli/update.ts:updateCommand` — install 성공 직후 `detectWorkspaceVersion` 호출, CLI > workspace 면 `Next step: solosquad migrate --apply` 명시 출력. 사용자가 *동일 터미널 세션* 에서 다음 액션 받음.
- 이전: `Run \`solosquad doctor\` to verify.` 만 출력 → 사용자가 `doctor` 후속 round-trip 후에야 `migrate --apply` 학습. 본 사용자 frustration *"업데이트 관련 계속 문제"* 의 한 축.

### Changed — Bug F: Discord 채널 카테고리 이름 → `"solosquad"` (legacy 매칭 유지)
- `src/messenger/discord-adapter.ts:ensureChannels` — 카테고리 lookup 이 `["solosquad", "AI Team Reports"]` 둘 다 매치. 신규 생성은 `"solosquad"` 사용.
- 사용자 명시 요구: *"디코에서 채널 카테고리 생성할 때 이름 solosquad 로 생성되게"*. v0.1.x 시절 *agent-team-as-product* vocab 의 잔재 정리.
- 기존 `"AI Team Reports"` 카테고리는 *그대로 동작* — 봇이 강제 rename 안 함 (ManageChannels 권한 가정 없음 + 사용자가 의도적으로 다른 이름 골랐을 가능성 존중). 원하면 Discord UI 에서 수동 rename.

### Compatibility — v1.0.2 사용자
- workspace.yaml.version 자동 마이그레이션 (1.0.2 → 1.0.3, `src/migrations/scripts/1.0.2-to-1.0.3.ts`, bump-only, idempotent).
- v1.0.0 / v1.0.1 / v1.0.2 워크스페이스 *전부* 이번 1.0.3 CLI 로 단번에 migrate 가능 (Bug A fix 가 모든 누적 patch chain 통과 시킴).
- 기존 `discord/config.yaml` 의 `guild_id` 무손상.
- 기존 `"AI Team Reports"` Discord 카테고리 무손상 (lookup 으로 매치 + 재사용).
- Slack 사용자: 동작 100% 보존 (v1.0.2 author-guard false positive 도 100% 보존 — v1.0.4 fix 대기).
- breaking 0 (사용자 데이터·CLI surface 면), schema 변경 0 — api-stability 정책 완전 준수.

### Added — regression catchers (5 신규 파일, +17 cases)
- `test/v1.0.3-version-matches.test.ts` (5) — `X.Y.Z.x` 가 exact `X.Y.Z` 도 매치, minor-loose 회귀 0.
- `test/v1.0.3-npm-install-cmd.test.ts` (3) — prefix-writable env 에서 no-sudo 형, 아니면 sudo 형.
- `test/v1.0.3-guild-org-binding.test.ts` (4) — discord-adapter source 가 v0.1.x 휴리스틱 없음 + `ownOrgSlug` 게이팅 + `Bound guild ... → org=` 로그.
- `test/v1.0.3-update-next-step.test.ts` (2) — update.ts post-install 분기에 `solosquad migrate --apply` 안내 출력.
- `test/v1.0.3-category-name.test.ts` (3) — `"solosquad"` + `"AI Team Reports"` 둘 다 lookup, 신규 생성은 `"solosquad"`, 강제 rename 없음.
- 총 테스트: 596 → **613 green**.

### Spec retraction — 본 patch 가 박제하는 *반복 패턴 6번째 누적 fix*
v1.0.2 + v1.0.3 의 6 incident 공통 root cause 두 갈래: (a) *외부 자유 입력 (Discord username · workspace.yaml.version 사용자 값 · npm prefix 권한 · guild.name) ↔ 내부 슬러그* 문자열 비교, (b) *v0.1.x 잔재 vocab/UX* (update next-step 안내 부재, "AI Team Reports" category 이름). 향후 회귀 catcher 설계 가이드라인 — 외부 자유 입력 비교 + v0.1.x string literal 모두 trip-wire 대상. 자세히 plan §6.

## [1.0.2] — 2026-05-22

**v1.0.2 — Discord author-guard 정합 + 온보딩 wizard reorder.** v1.0.1 publish 직전 발견된 author-guard false positive (사용자 `Discord username: seungw1n.`, `handle: w1n` 가 자기 자신 채널에서 추방됨) 의 박제 fix + 동시에 *온보딩 narrative 정합 회복*. 두 charset (Discord username vs SoloSquad handle `[a-z0-9_]`) 의 영구 불일치가 폭로한 것: v0.8 §3.4 가 *"username = handle"* 을 암묵 invariant 로 깔고 있었지만 어떤 정규화로도 풀리지 않음. **handle 을 SoloSquad 유일 canonical user identifier 로 격상**, Discord author identity 는 audit log 로 강등. 자세히 `docs/plan/v1.0.2-discord-author-guard-decoupling.md`.

### Fixed — Discord author-guard false positive 영구 해소
- `src/messenger/discord-adapter.ts` — `isAuthorizedAuthor` 가드 블록 (12줄) 제거. `message.author.username` 비교가 root cause. `seungw1n.` 류 *Discord username 에 `.` 포함* 사용자가 *어떤 정규화로도* `command-<handle>` 채널에서 통과 못 하던 회귀 해소.
- 그 자리에 audit log 1줄 추가 (`[Discord Bot] message in <channel> from author id=<id> username=<name>`) — 게이팅 0, 사후 추적용. Discord 채널 ACL 이 유일 permission boundary 임을 정직히 박제.
- 친구를 자기 채널에 의도적으로 초대한 *owner 의도된 협업* 케이스도 같이 풀림 (이전엔 false positive 로 차단).

### Changed — onboarding wizard narrative 정합 (Step reorder)
- **Step 3.5 신설 — Your Handle on {messenger}** (was Step 5.2). 메신저 토큰 입력 직후로 위치 이동. 사용자 narrative: *"방금 Discord 토큰 입력 → 이제 그 메신저에서 어떤 이름으로 불릴지 결정"* — 사이에 timezone/workspace.yaml/org/repos 4단계가 끼던 v1.0.1 까지의 단절 해소.
- `registerUserIdentity` 모놀리식 함수 → 3-phase 분리: `fetchBotIdentity` (API 호출, no UI) + `promptHandleSelection` (UI + guidance) + `saveUserYamlForChoice` (yaml write, no UI). Step 3.5 가 (1)+(2) 호출, Step 6 가 (3) 호출.
- handle prompt guidance 카피 추가 — `💡 Pick a handle that is unique in your messenger server. Different from other discord members' usernames or display names → avoids "who said this" confusion`. 멤버 목록 자동 fetch 는 *안 함* (privileged intent 요구 + init 시점 guild 미가입 가능성).
- Step renumber: 3.5 (was Timezone) → **4**, 4 (was workspace.yaml) → **5** (silent banner 없음), 5 (Org) → **6**, 5.1 (Repos) → **6.1**, 5.2 (User Identification) → **삭제** (3.5 로 흡수), 6 (Security) → **7**, 6.5 (Onboarding track) → **7.5**, 7 (Layout) → **8**.

### Deprecated — author-guard (Discord 면 즉시, Slack 은 v1.0.3 슬롯)
- `src/bot/author-guard.ts` — 파일 *유지* (Slack 어댑터가 여전히 사용). `@deprecated since v1.0.2 (Discord)` JSDoc 추가. v1.0.3 에서 `src/messenger/slack-adapter.ts` 사용처 제거 + 본 파일 통째 삭제 예정.
- `src/messenger/slack-adapter.ts` — **본 v1.0.2 변경 0**. Slack 은 post-v1.0 슬롯 (v1.0 plan §5.3), SemVer 약속 외. 동등 fix 는 별 release (v1.0.3) 분리 → review·yank 용이.

### Compatibility — v1.0.1 사용자
- workspace.yaml.version 자동 마이그레이션 (1.0.1 → 1.0.2, `src/migrations/scripts/1.0.1-to-1.0.2.ts`, bump-only, idempotent).
- `<workspace>/<org>/.solosquad/users/<handle>.yaml` 무손상 — schema 변경 0.
- Slack 사용자: 동작 100% 보존 (v0.8 §3.4 false positive 도 100% 보존 — v1.0.3 fix 대기).
- breaking 0 (사용자 데이터·CLI surface 면), CLI 명령 add/remove/rename 0, schema 변경 0 — api-stability 정책 완전 준수.

### Added — regression catchers (2 신규 파일, +8 cases)
- `test/v1.0.2-discord-author-guard-removed.test.ts` (5) — discord-adapter source 가 author-guard import/call/DM 안 함 + audit log present + `author-guard.ts` 파일은 *유지* (Slack 의존성).
- `test/v1.0.2-init-handle-order.test.ts` (3) — init.ts banner set (3.5 present, 5/5.1/5.2/6.5 부재), Step 3.5 가 `.env saved` 직후 위치, guidance 카피 verify.
- 총 테스트: 588 → **596 green**.

## [1.0.1] — 2026-05-22

**v1.0.1 — 첫 patch.** v1.0.0 publish 직후 발견된 dependency-level deprecation 1건 + 사용자 가치에 어긋나던 onboarding friction 1건을 한 릴리스로 흡수. 같이 해소되는 의미적 빚: *"한 agent 가 여러 repo 를 다룬다"* 는 솔로스쿼드 포지셔닝과 `role=main` 단일 default repo 가정 사이의 모순. 자세히 `docs/plan/v1.0.1-discord-ready-deprecation.md`.

### Fixed — discord.js v15 readiness
- `src/messenger/discord-adapter.ts` — `client.on("ready", …)` → `client.on(Events.ClientReady, …)`. discord.js 14.26 이 `ready` alias 를 deprecate (사유: gateway READY opcode 와 이름 충돌 해소), v15 에서 완전 제거 예고. v1.0.0 봇 시작 시 매번 출력되던 Node `DeprecationWarning` 사라짐 + v15 업그레이드 시 silent failure (ready 핸들러 미발화) 사전 차단.
- 회귀 catcher: `test/v1.0.1-discord-ready.test.ts` — adapter 소스가 `Events.ClientReady` enum 을 사용하는지 + 문자열 `"ready"` 리스너 미등록 확인 (1 case).

### Changed — onboarding 친화도 + 다중-repo 라우팅 메커니즘 신설
- **repo `role` prompt 제거** — `solosquad init` Step 5.1 (`registerRepoInline`) 과 `solosquad add repo` (`confirmRole`) 의 인터랙티브 `Role:` 프롬프트 삭제. 신규 등록은 `role = "main"` silent default. `--role <value>` flag 는 power-user override 로 유지하되 deprecation warning. 사유: `role` 필드의 실제 *load-bearing* 소비처는 `workflow-resolver.ts:79` 의 스케줄러 default cwd 결정 하나뿐이었고, 사용자 메시지 routing 에는 일절 관여 안 함. "frontend / backend / data / infra / docs" 값들은 어떤 라우팅에도 안 쓰이는 cargo cult.
- **`workflow-resolver` `role=main` lookup 제거** — `pickMainRepoSlug` → `pickDefaultRepoSlug` (첫 등록 repo fallback). resolver return reason `"main-repo"` → `"first-repo"`. 스케줄러 routine 은 org-level (morning brief / signal scan / weekly review) 이므로 영향 적음. user-driven routing 은 PM 레벨로 단일화.
- **`@<slug>` mention 라우팅 신설** — `src/bot/mention-parser.ts` 신규. 사용자가 `@landing-site 히어로 수정` 처럼 적으면 bot pre-processor 가 `[target_repo:landing-site]` (single) 또는 `[target_repos:a,b]` (multi) 마커를 메시지 앞에 주입해 PM 에게 전달. **regex 매칭 + 등록 slug 셋과 교집합** — Discord 사용자 핑 (`<@123456789>`) / 타이핑 오류는 silently drop, false positive 0. routing 시점 LLM 호출 0 — GitHub Slack `@<repo>` + Nx `nx run <project>:<target>` 패턴 동일.
- **`assets/orchestrator/SKILL.md` §"Multi-Repo Intent (v1.0.1+)" 추가** — PM 이 마커 honor, 단일 repo 시 자동, 모호하면 *짧은 clarifying question 1번*. **silent guessing 금지** (GitHub Slack / OpenHands 사례 모두 silent inference 가 사용자 confusion 의 주범으로 박제됨).

### Deprecated — schema/CLI surface (api-stability 정책 준수)
- `RepoYaml.role` 필드 — `@deprecated` JSDoc 표시. 필드 hard 제거 = v2.0 (api-stability §schema "2-minor read window" 정책).
- `solosquad add repo --role <value>` flag — `warnDeprecated` 안내. flag 제거 = v2.0 (CLI surface freeze).

### Compatibility — v1.0.0 사용자
- workspace.yaml.version 자동 마이그레이션 (1.0.0 → 1.0.1, `src/migrations/scripts/1.0.0-to-1.0.1.ts`, bump-only, idempotent).
- 기존 `repo.yaml` 파일들의 `role:` 값 그대로 read. workflow-resolver 는 더 이상 그 값을 안 보지만 파일에 남아 있어도 무해.
- 신규 등록 `repo.yaml` 도 `role: main` 으로 채워짐 (default). schema 호환 유지.
- 데이터 손실 0, breaking 0 (사용자 데이터 면). schema 변경 0 (api-stability 정책 면).

### Added — regression catchers (3 신규 파일, +14 cases)
- `test/v1.0.1-discord-ready.test.ts` — Events.ClientReady 사용 trip-wire (1)
- `test/v1.0.1-mention-parser.test.ts` — mention 정확성, dedupe, Discord 핑 무시, multi-mention 마커, unknown drop (8)
- `test/v1.0.1-role-deprecated.test.ts` — resolver `first-repo` reason, legacy-root fallback, `listOrgRepoSlugs` 가 path-ref yaml + legacy dir 모두 인식 (4)
- 1.0.0→1.0.1 migration `test/migration-v0.6.test.ts` 패턴 외 (추가 migration 테스트 없음 — bump-only)
- 총 테스트: 573 → **588** green.

## [1.0.0] — 2026-05-21

**v1.0.0 — Formal launch.** v0.x 전체는 *솔로 파운더 자기 사용*을 위한 빠른 반복 구간이었습니다. v1.0부터는 **공개 사용자 약속이 시작**됩니다 — `docs/policy/schema-stability.md`의 SemVer 정책이 발효되고, `v0.8.4-cli-surface-reduction.md §11`의 42-command CLI surface가 freeze됩니다.

본 plan 초기 draft는 "코드 변경 0건"을 약속했으나, v0.9.2 사용자 검증 회고 결과 *진입 흐름 마찰 2건*을 v1.0에 직접 흡수했습니다. 신규 기능은 추가되지 않으며, 명령 surface는 변하지 않습니다. 자세한 박제는 `docs/plan/v1.0-formal-launch.md`.

### Activated — public API stability promise
- `docs/policy/schema-stability.md` — "Effective as of v1.0.0 (2026-05-21)" 발효. 6개 `schema_version` 표면 (workspace · org metadata · agent profile · SKILL frontmatter · archive metadata · archive manifest) deprecation 정책이 *v1.x.x bullet*로 활성화.
- `workspace.yaml.version`이 SoloSquad CLI SemVer를 1:1 추적. v0.x 자유 bump 윈도우 종료.
- CLI surface 42 명령 freeze — 명령 추가 = minor / 명령·플래그 제거 또는 rename = major (v2.0+). 의도된 컨벤션 예외(`migrate dry-run default`)는 freeze에 포함.

### Changed — onboarding 정합 2건 (v1.0 plan §1.3)
- `solosquad init` Step 1.5 신설 — **Claude Code 인증을 wizard가 흡수**.
  - `commandExists("claude")` 점검 + `claude auth status --json` 호출로 현재 인증 상태 확인.
  - 미로그인 시 `claude login` spawn (inherit stdio) → 브라우저 OAuth 완료까지 대기.
  - 이미 로그인된 사용자는 1초 스킵.
  - 종전 *"`solosquad init` + 별도로 `claude login`"* 2단계 마찰 제거.
- repo 등록 *path-reference 단일화* — URL clone + Move/Copy into workspace 제거.
  - `solosquad init` Step 5.1: 로컬 경로 + git repo만 허용. git URL 입력 시 `clone first, then re-add` 메시지로 거부. 비-git 폴더 시 `git init first` 메시지로 거부.
  - `solosquad add repo`: 동일. 모든 입력이 `registerPathReference`로 funnel. `--keep-original` 은 deprecated no-op (warn → v2.0 제거 예정).
  - **사유**: SoloSquad가 git clone semantics(auth·branch·depth·submodules·LFS)를 *책임지지 않음*. 사용자의 git toolchain을 신뢰하고 경로만 참조.

### Scoped — Slack messenger to post-v1.0 slot (v1.0 plan §5.3)
- README / README.kr / master-guide §5는 *Discord-first* 로 재정렬. §5.1 Slack 9-step walkthrough는 *post-v1.0 슬롯* 배지로 강등.
- `src/messenger/slack-adapter.ts` 코드는 *그대로 보존* — v0.9.x에서 Slack을 운영 중이던 사용자는 *계속 동작*하지만 v1.0 SemVer 약속 / 회귀 보장 대상이 아님.
- 사유: v0.9.1+에서 발견된 Slack `conversations.create` 사용자 invite 자동화 누락 / 6+ OAuth scope 요구 / workspace admin 권한 게이팅 / v0.x dogfood가 Discord 중심 누적 / invite gap이 v1.0 freeze 시점 미해결.

### Compatibility — v0.9.x 사용자
- workspace.yaml.version 자동 마이그레이션 (0.9.2 → 1.0.0, `src/migrations/scripts/0.9.2-to-1.0.0.ts`, bump-only, idempotent).
- legacy `<workspace>/<org>/repositories/<slug>/` 트리(Model A): `resolveRepoCwd` legacy 분기로 *영구 동작*. 코드 제거 0건.
- v0.9.1+에서 발급된 `<slug>.yaml` path-reference: 그대로 동작.
- Slack 토큰을 이미 `.solosquad/.env`에 박은 사용자: 봇 계속 동작 (SemVer 약속만 외).
- 데이터 손실 0건. breaking change 0건 (사용자 데이터 면).

### Added — regression catcher
- `test/v1.0-path-ref-only.test.ts` — 3 tests. `looksLikeGitUrl` 분류 정확성 + non-git 거부 trip-wire 보장. v1.0 진입 흐름이 회귀하면 잡음.
- 총 테스트: 572 → 573 green.

## [0.9.2] — 2026-05-21

**v0.9.2 — Uninstall precheck self-match hotfix (Windows).** 빠른 hotfix.
`solosquad uninstall`이 봇·스케줄러가 실제로 돌고 있지 않은데도
`bot/schedule appears to be running (pid X, Y)` 라며 차단하던 Windows 한정 버그 수정.
PID가 매 호출마다 바뀌어서 사용자가 `--force` 외엔 우회 수단이 없었음.

### Fixed
- `src/lifecycle/precheck.ts:detectLivePids` — Windows WMI 쿼리에 `$_.Name -eq 'node.exe'` 필터 추가.
  - **원인**: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'solosquad' -and $_.CommandLine -match '(bot|schedule|run-routine)' }` 의 `-Command` 인자 문자열이 *그 자체로* 두 정규식 리터럴을 포함. 쿼리를 실행하는 powershell.exe의 CommandLine이 두 조건 모두 통과 → **자기 자신 매칭**. 매 호출마다 새 powershell.exe가 떠서 PID가 바뀌는 증상.
  - **수정**: Where-Object 절 앞에 `$_.Name -eq 'node.exe'` 추가. powershell.exe는 첫 술어에서 제외되므로 regex match가 돌지 않음.
- POSIX 경로(`pgrep -f`)는 영향 없음 — `pgrep` 패턴 `solosquad (bot|schedule|run-routine)`은 alternation 문자열이 들어간 자기 자신 command line에서 실제 `solosquad bot` 등으로 매칭되지 않음.

### Added
- `test/lifecycle-precheck.test.ts` — `detectLivePids` 3회 호출이 동일한 PID 셋을 반환하는지 회귀 catcher. 버그 존재 시 매 호출마다 새 powershell.exe PID가 추가되어 결과가 갈라짐.
- `src/migrations/scripts/0.9.1-to-0.9.2.ts` — `workspace.yaml.version` 0.9.1 → 0.9.2 bump only (스키마 변경 X).

### Compatibility
- 기존 0.9.1 워크스페이스: 자동 마이그레이션. 코드/스키마 변경 X.
- 0.9.1로 우회 사용 중이던 `--force`는 계속 동작 (정직성 차단만 다시 활성).

## [0.9.1] — 2026-05-21

**v0.9.1 — Workspace ↔ Repository 관계 재설계 Model B 구현 + master-guide §4.2 Step 1 prerequisites 보강.** v0.9 plan
(§13.6.10)에서 박제한 *path-reference* 모델 코드 구현. 부수로 master-guide
를 npm 패키지에 포함시켜 사용자가 `npm install` 후 *로컬에서 매뉴얼
접근 가능*. backward-compat 100% — 기존 `<workspace>/<org>/repositories/<slug>/`
트리 영구 동작.

> **Note**: 0.9.0 was published-then-unpublished on 2026-05-20 and its
> version number is burned per npm policy (`npm view solosquad time`에
> 영구 기록). 0.9.1이 Model-B path-reference 디자인의 첫 설치 가능 릴리스.
> 코드 자체는 0.9.0과 동일 + master-guide §4.2 Step 1 prerequisites 박스 3개 추가.

자세히: `docs/plan/v0.9.1-workspace-repo-relationship.md`

### Added — Model B (path reference)
- `src/util/config.ts:RepoYaml`에 `path?: string` 필드 — 외부 경로 참조
- `src/util/paths.ts:resolveRepoCwd` 우선순위:
  1. path-reference yaml의 path 가리키는 외부 경로 (존재 검증)
  2. legacy `<workspace>/<org>/repositories/<slug>/` 트리
  3. legacy 루트 (org=repo, .git at org root)
- `src/cli/add-repo.ts` 확장:
  - `--path <external>` flag — 명시적 path-reference 등록
  - cwd 자동 인식 — 인자 없이 호출 시 cwd가 git repo면 path-reference 제안
  - `registerPathReference()` — workspace yaml + 외부 repo `.solosquad/repo.yaml` 작성
- `src/cli/init.ts:registerRepoInline()` — 외부 path 입력 시 path-reference / move 2-way prompt (default = path-reference)
- `src/cli/doctor.ts:runPathReferenceChecks()` — 외부 path 존재 + `.git/` 검증 (warn-only)
- `test/repo-path-reference.test.ts` (4 tests) — 회귀 catcher

### Changed — docs/manual/ → top-level manual/
- master-guide HTML을 npm 패키지에 포함시키기 위한 폴더 이동
- `docs/manual/master-guide_{ko,en}.html` → `manual/master-guide_{ko,en}.html`
- `package.json` `files`에 `manual/` 추가 (docs/는 dev-only 유지)
- 영향: `npm install -g solosquad` 후 사용자가 `<npm-prefix>/lib/node_modules/solosquad/manual/master-guide_ko.html` 같은 경로로 *로컬 매뉴얼 접근*
- 모든 plan/README/AGENTS.md 등 14개 파일에서 `docs/manual/` 참조를 `manual/`로 일괄 갱신
- `scripts/check-docs-freshness.ts` targets 갱신

### Compatibility
- 기존 `<workspace>/<org>/repositories/<slug>/` 트리 사용자 영구 동작
- `resolveRepoCwd`가 yaml 없거나 외부 path 사라진 경우 legacy 트리로 자동 폴백
- 새 RepoYaml.path는 optional이라 기존 yaml 파일 untouched
- v0.9.2+ slot: `solosquad migrate --externalize-repos` (현재 트리 → 외부 path-reference, opt-in)

### Added — master-guide §4.2 Step 1 prerequisites 박스 3개 (v0.9.1)
- `의존성 종합 표` — `solosquad doctor`가 점검하는 7개 도구 (node·npm·git·claude·gh·pwsh·docker) × 최소 버전 / 필수 여부 / 누락 시 동작
- `환경 변수 종합 표` — `.env` 11종 (메신저 토큰·OWNER_*·REPOS_BASE_PATH·SOLOSQUAD_LOG_* 등). `ANTHROPIC_API_KEY는 사용 안 함` (Claude Code OAuth 위임) 명시
- `자원·네트워크 하한 callout` — 디스크/메모리/OS×arch (better-sqlite3 prebuilt 매트릭스)/outbound 도메인/shell(fish 주의)/타임존/npm 권한(sudo 회피)
- KO/EN 양쪽 동기화 (+46/+46 lines)

### Migration
- `src/migrations/scripts/0.8.7-to-0.9.1.ts` — schema 변경 없음, version bump only (TARGET = "0.9.1")

### Tests
- 571/571 green (567 + 4 path-reference)

## [0.9 plan] — 2026-05-20 (plan only, 구현 X)

**v0.9 — Workspace ↔ Repository 관계 재설계.** 본 entry는 *plan 박제용*.
코드 변경 0건. 구현은 v0.9.1+ patches에서.

v0.8.5~v0.8.6 사용자 테스트에서 *repos-inside-workspace-tree* 강제가
솔로 사용자 4 시나리오 모두 미해결임을 확인. peer agent 모델 (Hermes /
Codex / Copilot Workspace) 비교 후 **모델 B (path reference) default 채택**.

자세히: `docs/plan/v0.9.1-workspace-repo-relationship.md`

### Planned — 모델 B (path reference)
- `repo.yaml.path: <absolute-path>` 필드 — 외부 경로 참조
- `<workspace>/<org>/repositories/<repo>.yaml` (파일, 디렉터리 아님)
- `resolveRepoCwd` 외부 경로 분기 — 원본 사용자 dev tree 무변형
- 사용자 working tree 직접 작업 (Codex 패턴 + dev-confirm gate)
- 워크스페이스 ~ 50 MB config 폴더로 축소

### Planned — 자동화 UX 4종
- cwd 인식 (default): `cd <repo> && solosquad add repo`
- 명시적 flag: `solosquad add repo --path <ext>`
- `solosquad init` Step 5.1 path 입력 허용
- bulk: `solosquad add repo --discover <dir>` (명시 호출만)

### Planned — 워크스페이스 위치 멘탈 모델
- *1 user = 1 workspace + N orgs + N path-referenced repos* default
- 권장 위치: `~/solosquad/` 또는 짧은 이름
- 멀티 워크스페이스는 *멀티 메신저 페르소나 advanced option*

### Skipped (영구 박제) — 모델 C (Hermes sandbox)
- 솔로 founder teammate 시나리오엔 오버스펙 (multi-user / cloud 진화 시 v2.x slot)
- 사용자가 IDE 옆에서 에이전트 commit 실시간 보는 *direct working-tree*가
  솔로에 자연스러움

### Backward-compat
- 현재 `<workspace>/<org>/repositories/<repo>/` 트리 사용자 영구 동작
- 마이그레이션 opt-in only (`solosquad migrate --externalize-repos`, v0.9.2+)

### 구현 슬롯 (별도 patch)
- v0.9.1: 모델 B 핵심 구현 (9-step 작업 분해, plan §8 참조)
- v0.9.2+: backward-compat 마이그레이션 명령
- v1.x slot: gh CLI 연동 (`--discover-github`), 모델 C sandbox

## [0.8.7] — 2026-05-20

**v0.8.7 — Tiny Stabilization.** v0.8.5 + v0.8.6의 *stale 버전 상수 회귀*
패턴 회고 결과 *꼭 필요한 것 2건만* patch. v0.9 안정화 6축 권장안은
오버스펙으로 판정해 *영구 skip*. 인프라 신설 0, 발견된 문제 직접 수정.

자세히: `docs/plan/v0.8.7-tiny-stabilization.md`

### Fixed — master-guide §3.11 dev_capability docs drift
- v0.8.2 plan 초기 design intent의 "4-level enum (read/propose/patch/pr)"
  표현이 master-guide §3.11에 박혀 있었으나, *실제 코드는 boolean +
  dev_permissions sub-tree로 분리*된 상태였음 (1년 가까이 drift)
- KO + EN 양쪽 §3.11 한 문단 직접 edit으로 코드 reality 반영
  - `dev_capability: true` (boolean) 명시
  - 세부 권한은 `dev_permissions` sub-tree (bash.allowed/denied,
    network, push_targets.requires_confirmation, merge.auto=영구 false)
- v0.8.6 작업 중 grep으로 식별된 단일 drift. 인프라 sweep X, 직접 수정

### Added — test/migrate-default-target.test.ts (회귀 catcher)
- v0.8.6 hotfix 클래스 (`CLI_VERSION_TARGET = "0.4.0"` 같은 stale literal
  default가 1년 잠복) 재발 방지
- source inspection 기반 3 assertion:
  1. `CLI_VERSION_TARGET = "X.Y.Z"` 하드코딩 *부재*
  2. `SOLOSQUAD_VERSION` import from `../util/version.js` *존재*
  3. 동적 값이 semver 패턴
- narrow scope: `migrate.ts` 한정. 같은 패턴이 다른 파일에 또 생기면
  *그때 sibling test 추가*. lint rule 일반화는 영구 skip

### Skipped (영구) — v0.9 안정화 6축 권장안
초기에 그렸던 6축 모두 오버스펙으로 판정. 박제만:
- stale constant lint 스크립트 — grep 한 줄 수동 체크가 더 가벼움
- migration chain E2E — v0.8.6 회귀 잡았을 거 주장 *틀림*
- doctor 확장 (push precheck) — 현재 사용자 1명, 시나리오 1회로 충분
- archive round-trip — uninstall/import은 일생 1~2회. 회귀 비용 < 유지 비용
- CLI surface drift 자동 검증 — v1.0 publish 직전 manual 확인이면 충분
- master-guide ↔ 코드 drift sweep 인프라 — 인프라 X, 발견된 drift 직접 수정

→ v0.9 plan doc 작성 안 함. *문제 발견 → patch* 패턴 유지.
v1.0 publish 형식: 코드 변경 없이 5분 manual sweep + tag + api-stability
§4 발효일 박제.

### Migration
- `src/migrations/scripts/0.8.6-to-0.8.7.ts` — schema 변경 없음, version bump

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

### Changed — master-guide §10.5 신설 (봇·스케줄러·에이전트 git 작업)
- **v0.8.6 에이전트 책임 경계 = git push까지로 명시**. PR 생성·리뷰·머지는
  사용자가 GitHub 웹 UI에서 직접 진행 (gh CLI 셋업 불필요)
- 스케줄러는 디폴트 실행되지 않음 명시 — daemon / 자동 시작 0건
- `detectLivePids()` PowerShell 매칭 로직 공개
- push 전제 3건 — git push 인증 / repo 등록 / workspace.yaml dev_capability
  (gh CLI 제거)
- 에이전트 push 흐름 (PM 분류 → BD spawn → dev-confirm gate → push →
  "compare URL" 회신 → 사용자가 웹 UI에서 PR 생성·머지)
- 온보딩 추가 항목 5건 — Step 1.5 git push 인증 확인 / Step 7.5 repo +
  push 검증 / Step 7.7 dev_capability 활성 / Step 8.5 메신저 dry test /
  Step 8.7 branch protection (gh CLI 단계 제거)
- 자동 머지 영구 거부 정책 재명시 (v0.8.2 박제)

### Changed — master-guide §4.2 Step 1에 git 인증 안내 callout (간단)
- *별도 인증 절차 X* — git 표준 흐름에 위임 명시
- Windows: Git Credential Manager 자동 / macOS: osxkeychain 자동 / Linux: 사용자 별도 셋업
- 자세한 절차는 GitHub 공식 docs 링크로 위임

### Added — §10.1 트러블슈팅에 git push 인증 실패 항목
- 에이전트 dev_capability 사용 시 push 실패 케이스 OS별 3줄 안내
- GitHub 공식 docs 링크 — SoloSquad 외부 영역 명시

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
정리. `docs/policy/schema-stability.md` §4가 "Removing a flag is major"라 박제 →
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
- `docs/policy/schema-stability.md` §4가 본 plan §11을 canonical reference로 link

### Added — Tests
- `test/cli-deprecation.test.ts` — 5 cases (helper unit)
- `test/uninstall-mode-matrix.test.ts` — 6 cases (mode 매트릭스)
- `test/import-mode-matrix.test.ts` — 5 cases (mode 매트릭스)

### Changed — Documentation
- `docs/policy/schema-stability.md` §4 — v0.8.4 surface freeze link + migrate
  dry-run-by-default convention exception 명시
- `manual/master-guide.html` §6 — uninstall/import/backup 명령 표
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
- `manual/master-guide.html` §3/§4/§6/§8/§9/§10 v0.7→v0.8 모델 흡수
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
- `docs/policy/schema-stability.md` — 6 schema_version의 bump 룰 + deprecation 기간
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
- `manual/master-guide.html` §6.1 CLI 표 + §8.1 v0.7 절 추가
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
