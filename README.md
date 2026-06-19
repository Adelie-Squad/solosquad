# SoloSquad

🇰🇷 **한국어 README: [README.kr.md](README.kr.md)**

> A 24/7 AI assistant system for solo founders, small teams, and n-jobbers — Discord bot + scheduled crons + team-based agents, distributed as a single npm package.

Running a company alone doesn't mean working alone. SoloSquad gives you a virtual team — **1 Chief** (org-level supervisor, the only user-facing agent), **4 main bots** (pm / engineer / designer / marketer), and **20 specialists** across 4 teams (product, engineering, design, marketing) — reachable from your messenger, with automated daily crons, per-org memory isolation, and a 6+1 stage decision loop (TRIAGE → DECOMPOSE → DISPATCH → AWAIT → SYNTHESIZE → DECIDE → RETROSPECT).

```
Output ≠ Goal. Output = Means to achieve the goal.
```

### Topology — hierarchical supervisor (orchestrator-workers)

SoloSquad is a **hierarchical orchestrator-workers** system, not a decentralized swarm: a central **Chief** dynamically decomposes and delegates but keeps control to the end (agents-as-tools — Chief owns the SYNTHESIZE step). Three tiers:

```
👤 User (Discord / terminal)
        │ handleUserMessage
        ▼
   Chief  (tier: leader · team: chief)          ── org-level supervisor
        │ DECOMPOSE → DISPATCH
        ├──▶ pm         (leader · product)      ── also a 2nd-tier orchestrator
        ├──▶ engineer   (leader · engineering)     (pm.used_by routes to eng/des/mkt too)
        ├──▶ designer   (leader · design)
        └──▶ marketer   (leader · marketing)
                  │
                  ▼
             specialists (member) ── 20 bounded workers across the 4 teams
```

The delegation graph is a **DAG, not a pure tree** — `pm` calls the other three leaders (plan→hand-off), so reference-integrity + cycle validation matters (`solosquad agent validate --graph`). Each spawn gets an independent context window. Full detail: [`docs/prd/architecture.md` §5.1](docs/prd/architecture.md).

**Platforms:** Windows · macOS · Linux (cross-platform CLI, CI-tested)
**Messenger:** Discord — one per workspace. Slack adapter code ships but is **not part of the v1.0 SemVer promise** (post-v1.0 slot). Telegram support removed in v0.2.4.
**Stack:** TypeScript + Node.js 18+ · Claude Code as the AI engine · file-based memory (JSONL)

---

## Documentation

📖 **The canonical user guide is the menu-divided HTML manual:**

> **[`manual/master-guide_en.html`](manual/master-guide_en.html)** (English) · **[`manual/master-guide_ko.html`](manual/master-guide_ko.html)** (한국어) — open in a browser.

It covers, in ten menu-divided sections:

| # | Section | What's inside |
|---|---|---|
| 1 | Getting Started | Project intent, core concepts, expected value |
| 2 | How It Works | System architecture, folder hierarchy, memory model, workflow definition |
| 3 | Concept Glossary | `SKILL.md`, `KNOWLEDGE.md`, `CLAUDE.md`, `AGENTS.md` comparison; per-layer file inventory; 4-channel routing |
| 4 | Onboarding | Branches for new users, existing-repo migration, and version upgrades |
| 5 | Messenger Setup | 8-step Discord token walkthrough (Slack walkthrough retained as a post-v1.0 reference) |
| 6 | Usage | CLI reference (current + planned), daily ops, first-run checklist, automated crons |
| 7 | Glossary | 60+ core terms, file-name dictionary, acronym dictionary — beginner-friendly |
| 8 | Version Differences | v1.3.2 (npm-published) vs upcoming releases |
| 9 | Operations | 24/7 hosting options (terminal · Docker · launchd/NSSM · VPS), multi-workspace, multi-org, security checklist |
| 10 | Troubleshooting & FAQ | Install/runtime issues, migration failures, FAQ |

Every feature is tagged with a version badge.

For internal architecture, release planning, and decision history, see [`docs/prd/product-roadmap.md`](docs/prd/product-roadmap.md) + [`docs/prd/architecture.md`](docs/prd/architecture.md).

---

## What's new in v1.3.3 (2026-06-19)

**Cron terminology unification + a full cron lifecycle.** The two interchangeable names for scheduled jobs — *routine* (built-in) and *schedule* (user-authored) — are unified into one noun: **cron**, and crons gain a complete create/operate/observe lifecycle (referencing the OpenClaw + Hermes cron UX).

- **One `cron` command group (breaking)** — `solosquad cron start | run | list | new | edit | enable | disable | delete | runs | freq | show | validate` replaces the old `schedule` / `schedules` / `run-routine`. References take an **id or name**; friendly schedules (`@daily`, `every 1h`); a **next-run preview** on create/edit.
- **Operate without restarts** — the daemon **hot-reloads** crons on file change (chokidar); `enable`/`disable` is pause ≠ delete; `delete` archives by default.
- **Observe** — every run is recorded; `cron runs` shows status/when/duration, and a **dead-man's-switch** alerts on silently-missed crons. `[SILENT]`/empty output is logged but not posted.
- **One-shot** — `cron new <id> --at "20m"` (or an ISO time) runs once then auto-deletes.
- **Personal briefs** — set `timezone` + a `crons` block in a user's yaml to get briefs in their own `works-<handle>` channel at their own timezone. **`/create`** captures recent work as a reusable SKILL; `cron freq` surfaces (suggest-only) keyword-routing suggestions.
- **Migration** — `1.3.2 → 1.3.3` moves `.solosquad/{schedules,routines} → crons` and `memory/routine-logs → cron-logs` (idempotent; legacy dirs still read until then).

911 tests pass.

Full release notes: [CHANGELOG.md §1.3.3](CHANGELOG.md).

---

## Quick Start (5 minutes)

```bash
# 1. Prerequisites (one-time)
brew install node git                             # macOS — see master-guide §4.2 for Windows/Linux
npm install -g @anthropic-ai/claude-code

# 2. Install SoloSquad
npm install -g solosquad
mkdir ~/solosquad-workspace && cd ~/solosquad-workspace
solosquad init                                    # wizard handles Claude OAuth (Step 1.5) + Chief name + Discord token + invite URL auto-open
solosquad doctor                                  # verify environment
solosquad doctor --discord                        # focused 5-hop Discord diagnostic (v1.2)

# 3. Start the bot
solosquad bot                                     # foreground
# or
docker compose up -d --build                      # background + auto-restart (from workspace root; init dropped the compose file here)
```

When you invite the bot to a guild, the **guildCreate onboarding embed** appears in the system channel. Click **Auto-create channels** → the bot creates `#command-<handle>` and `#works-<handle>`, posts a first greeting in the command channel, and you're ready. Send a message — the Chief responds.

**Messenger token setup** takes 3–5 minutes (Discord). Follow [master-guide §5](manual/master-guide_en.html) step-by-step.

### Upgrading from v0.5.x

```bash
npm install -g solosquad@latest             # 0.5.x → 0.6.0
solosquad migrate --dry-run                 # Pass 1 simulation + report under <org>/memory/
# review the report, then:
solosquad migrate --apply --confirm         # 2-pass with human-review gate
```

Pass 2 automatically runs `solosquad agent validate --all`. Entries marked
`human_review_required: true` are *not* auto-applied — you reclassify them
manually after the migration. Migration LLM fallback costs accumulate in
`<org>/memory/migration-costs.jsonl` under a per-run cap.

---

## What you get

### 25 agents across 4 teams, frontmatter-routed automatically

| Team | Agents | Role |
|---|---|---|
| **Strategy** (7) | PMF Planner · Feature Planner · Data Analyst · Business Strategist · Idea Refiner · Scope Estimator · Policy Architect | Market analysis, hypothesis design, planning |
| **Growth** (4) | GTM Strategist · Content Writer · Brand Marketer · Paid Marketer | Marketing, branding, copy, paid acquisition |
| **Experience** (4) | User Researcher · Desk Researcher · UX Designer · UI Designer | Research, design |
| **Engineering** (10) | Creative Frontend · FDE · Architect · Backend · API · Data Collector · Data Engineer · Cloud Admin · QA · Security | Development, infra, quality, security |

```
You: "Write landing page copy"        → Content Writer (Growth)
You: "Analyze the signup funnel"      → Data Analyst (Strategy)
You: "Design the login UI"            → UI Designer (Experience)
You: "Design the signup API"          → API Developer (Engineering)
```

**v0.5 4-channel routing** (priority: `slash > explicit > keyword > freq`) decides which specialist's `SKILL.md` is injected each turn. Triggers live in each agent's frontmatter (`triggers.slash` / `.keyword` / `.freq`), collected at bot boot via a 3-tier scan (`<org>/.agents/` > `~/.solosquad/agents/` > bundled). The old hard-coded `AGENT_ROUTES` constant was removed in v0.5.

**v0.6 chokidar hot-reload** watches the same 3 tiers (forced polling on Windows + WSL, 300 ms debounce) and atomically swaps the router index — no bot restart on SKILL edits. Reload behaviour is configurable: `auto` (default) / `prompt` / `manual` with an optional `git_only` safe mode (`HEAD ≡ upstream + clean tree` only). `solosquad agent reload` triggers a manual rebuild.

### Six automated crons, runs while you sleep

| Default time | Cron | Output channel | Memory |
|---|---|---|---|
| 08:00 daily | Morning Brief | `#workflow` root | — |
| 12:00 daily | Signal Scan | `#workflow` → `system-daily-signals` thread | `signals.jsonl` |
| 16:00 daily | Experiment Check | `#workflow` → `system-experiments` thread | `experiments.jsonl` |
| 18:00 daily | Evening Brief | `#workflow` root | `decisions.jsonl` |
| Sun 20:00 | Weekly Review | `#workflow` → `system-weekly-review` thread | `decisions.jsonl` |
| 23:00 daily (v0.3) | PM Compaction | `#workflow` → `system-pm-compaction` thread | `memory/pm-skills/` |

All times configurable in `.solosquad/workspace.yaml` (timezone defaults to `Asia/Seoul`).

### 3-Layer context isolation

```
Layer 0 · Workspace (universal)    → Owner profile, principles, 25 agent definitions
   ↓
Layer 1 · Organization (per-product) → Memory, workflows, messenger channels
   ↓
Layer 2 · Repository (per-codebase) → Code + repo-specific skills
```

Product A's agents never see Product B's data. Multiple products coexist cleanly under one workspace.

### Self-hosted

Runs on your Mac Mini, PC, or VPS. Your data stays with you. Only outbound calls: Claude API and your messenger's servers.

---

## CLI Reference (v0.8.3)

```bash
# Workspace ops (v0.1+)
solosquad init                                    # workspace setup wizard
solosquad bot                                     # start messenger bot
solosquad cron start                              # start automated cron scheduler
solosquad status                                  # dashboard (orgs, workflows, recent activity)
solosquad doctor                                  # environment diagnostics
solosquad doctor --messenger-check                # validate tokens via live API
solosquad update                                  # check & install latest npm release
solosquad cron run [name]                         # manual cron execution

# PM mode (v0.3)
solosquad pm status                               # active PM sessions, cumulative cost
solosquad pm reset                                # archive a user's session, mint a new one
solosquad pm compact                              # externalize completed workflows
solosquad workflow list                           # list workflows
solosquad workflow show <wf-id>                   # stages + recent events
solosquad workflow focus <wf-id> [--clear]        # set/clear active workflow per session
solosquad rollback [--workflow <id>] [--to <sha>] [--list]   # git-snapshot revert

# Autonomous engine (v0.4)
solosquad goal new [goal-id]                      # scaffold goal.md from template
solosquad goal list                               # list goals
solosquad goal show <goal-id>                     # spec + recent cycles
solosquad goal run <goal-id> [--hours N | --cycles N]   # background autonomous loop
solosquad goal status [goal-id]                   # cycle counts, cost, ship candidate
solosquad goal stop <goal-id>                     # stop in-flight run (current cycle finishes)
solosquad goal verify <goal-id> --cycle N         # re-run evaluator, check determinism

# Agent authoring (v0.5 + v0.6)
solosquad agent validate <path>                   # validate one SKILL.md against v0.5 schema
solosquad agent validate --all [--corpus]         # validate every bundled + workspace SKILL.md
solosquad agent add --name <slug> --team <team>   # scaffold a new SKILL.md (no LLM)
solosquad agent list [--workspace]                # v1.3.2 — actors grouped by team
solosquad agent show <id> [--workspace]           # v1.3.2 — spec + delegation edges
solosquad agent reload [--org <slug>]             # v0.6 — manual router rebuild (manual fs.watch mode)
npm run validate-skills                           # CI gate (= agent validate --all --corpus)

# Asset managers + adoption (v1.3.2)
solosquad commands                                # full CLI tree + one-line descriptions
solosquad asset list [kind]                       # list assets (skill|agent|workflow|cron, or all)
solosquad asset show <kind> <id>                  # show one asset
solosquad asset validate [kind]                   # deterministic validation gate (all kinds, or one)
solosquad adopt <repo> [--apply] [--classify]     # discover + validate + adopt a repo's assets
solosquad cron new <id> [--cron …|--at …]         # scaffold a recurring (--cron "@daily"|"every 1h") or one-shot (--at "20m") cron
solosquad cron list|show|validate                 # inspect user-defined crons
solosquad cron edit <ref> [--cron|--name|…]       # patch fields, then re-validate
solosquad cron enable|disable <ref>               # resume / pause (pause ≠ delete)
solosquad cron delete <ref> [--hard]              # archive (default) or hard-remove
solosquad cron runs [ref] [-n N]                  # recent run history (status / when / duration)
solosquad cron freq [--apply <id>]                # freq-miner routing suggestions (suggest-only)

# Memory archive (v0.6)
solosquad readiness check [--target v0.6]         # v0.5 data + 4 default workflows + author SKILL counts → pass/short
solosquad memory search <query> [--limit N]       # FTS5 full-text search over archived events
                       [--event-type X]           #   routine_log | route_hit | route_miss | author_turn | spawn_decision
solosquad memory stats [--disk]                   # indexed row counts + per-event-type breakdown (+ sqlite file size)

# Repo analyzer (v0.5) + dry-run inspect (v0.8.3)
solosquad analyze repo <path> [--force] [--prune-orphans]    # scan .claude/skills/, classify, write report
solosquad add repo --from-report <report> --merge-policy <append|override|replace>
solosquad add repo <path> --dry-run               # v0.8.3 — simulate, print 5-scenario risk report
solosquad add repo <path> --keep-original         # v0.8.3 — copy instead of move (disk 2×)
                                                  # (v0.8.4: --inspect alias deprecated, removed in v1.0)

# Migration
solosquad migrate                                 # upgrade workspace layout (dry-run by default)
solosquad migrate --apply                         # perform migration
solosquad migrate --rollback                      # restore from backup

# Org / repo
solosquad add org <name>                          # add an organization
solosquad add repo <url|path>                     # clone or register a repository
solosquad sync                                    # sync repositories/ with .org.yaml

# Lifecycle (v0.7 + v0.8.1, surface frozen by v0.8.4)
solosquad uninstall [--mode full|keep|archive-only] [--dry-run] [--force]
                                                  # farewell archive + cleanup, user code untouchable
                                                  # default: full. keep = retain workflows/memory/knowledge,
                                                  # archive-only = zip only, no cleanup
solosquad import <archive.zip> [--workspace <path>] [--into <org>]
                               [--dry-run] [--mode merge|replace]
                                                  # v0.8.1 — restore farewell archive (paired with uninstall)
solosquad archive verify <archive.zip>            # v0.8.1 — manifest SHA × actual SHA + schema compat
solosquad archive info <archive.zip>              # v0.8.1 — metadata + per-class entry counts
solosquad archive list <archive.zip> [--class X]  # v0.8.1 — manifest entries

# Backup management (v0.8.4 — absorbs migrate/uninstall backup flags)
solosquad backup list                             # list ~/.solosquad-backups/ entries
solosquad backup delete <id>                      # remove a single backup
solosquad backup purge [--keep-recent N] [--dry-run] [-y]
                                                  # bulk delete (all, or keep N newest)

# Multi-user messenger (v0.8.0)
solosquad messenger broadcast-handover --to <handle>   # reassign designated broadcaster bot
                                                       # (broadcast cross-user feed §3.6 v2 — opt-in)

# Observability (v0.8.3)
solosquad logs [--level X] [--tail N] [--follow] [--since "1 hour ago"]
               [--type runtime|costs|spawn|stop-hook|dev-confirm|migration]
                                                  # structured logs + 4 ops jsonl unified view
```

See master-guide §6 for the per-command walkthrough and v1.0+ planned commands.

---

## Architecture Overview

Two long-running processes plus a file-based memory layer:

| Process | Role |
|---|---|
| `solosquad bot` | Receives messenger message → resumes the user's long-lived PM session (`orchestrator/SKILL.md`, v0.3) → 4-channel router resolves which specialist to load (`slash > explicit > keyword > freq`, v0.5) → delegates to a fresh subagent via Claude Code's native `Task` tool → synthesizes the tool result and replies |
| `solosquad cron start` | Runs scheduled crons (built-ins + user-defined), appends results to JSONL memory files. Set `timezone` + a `crons` block in a user's `.solosquad/users/<handle>.yaml` to get personalized morning/evening briefs in their own `works-<handle>` channel at their own timezone |

Two additional modes layer on top of the bot:

- **v0.5 author loop** — messenger-native skill creation. The `_meta/workflow-maker` meta-skill walks the user through `CLARIFY → DRAFT → SANDBOX_PROMPT → AWAIT_CONFIRM → APPLIED`, with paperclip-style budget caps logged to `<org>/memory/author-costs.jsonl`. Spec-gate drafts auto-emit a `<org>/goals/<goal-id>/goal.md`.
- **v0.4 goal-runner** — background autonomous cycle. `solosquad goal run <id>` boots a `bg-<goal-id>-<runId>` PM session that loops pipeline → evaluator (metric gate) → git-snapshot keep/discard until the time/cycle/cost budget runs out or all metrics pass `CONFIRMING`. `solosquad goal verify` re-runs the evaluator on a past cycle to check determinism.

v0.6 layers five more pieces over the v0.3–v0.5 base:

- **Spawn assembly** — `src/bot/spawn-assembler.ts` builds each Task prompt as an 8-layer JIT injection (knowledge → team KNOWLEDGE → SKILL → `<org>/core/` → `agent-profile.yaml` → `<org>/domain/` → handoff + memory recall → target repo) bounded by `workspace.yaml.spawn.max_context_tokens` (default `80000`). When the budget is exceeded, lower-priority layers drop in a fixed order and every decision is recorded to `<org>/memory/spawn-decisions.jsonl` (FTS5-indexed).
- **Budget envelope** — two separate namespaces: author-loop turns log to `author-costs.jsonl`, spawn calls log to `agent-costs.jsonl`. Per-agent caps in `<org>/agent-profile.yaml` can only *narrow* the workspace defaults, never widen them. Migration LLM fallback costs are isolated in `migration-costs.jsonl` so a misbehaving migration cannot starve the running bot.
- **FTS5 cold archive** — `src/memory/` rotates `cron-logs/*.jsonl` older than 8 days into `<org>/memory/archive.sqlite` once a day (`assets/routines/archive-rotate.md`, 00:00). Retention defaults to 365 days, with an optional `.zst` compress-before-delete step. Four event types are indexed (`route_hit / route_miss / author_turn / spawn_decision`); on a router miss the bot surfaces a single recall hint to the user.
- **Hot-reload** — `chokidar` 3-tier `fs.watch` (forced polling on Windows + WSL, 300 ms debounce) feeds `src/bot/reload-policy.ts`, which atomically swaps the router index in `auto` / `prompt` / `manual` mode. An optional `git_only` safe mode requires `HEAD ≡ upstream + clean tree` before any reload.
- **Stop-hook** — v0.5's `loop_mode.spec-gate` SKILL field is now executable through `src/engine/stop-hook-adapter.ts`. The DSL accepts three forms (`command` / `metric` / `natural`), runs with a 5-second timeout, and on ambiguity defaults to *continue* (conservative). Every evaluation is appended to `<org>/memory/stop-hook-events.jsonl` and threaded back into the v0.4 goal-runner.

For production-grade always-on, choose one of:
- Docker Compose (recommended, background + auto-restart) — `solosquad init` drops `docker-compose.yml` + `Dockerfile` in your workspace root; run `docker compose up -d --build` there. See [master-guide §Docker](manual/master-guide_en.html).
- macOS `launchd` plist / Windows NSSM service
- VPS + systemd (see [`docs/cloud-deployment.md`](docs/cloud-deployment.md))

Full details in master-guide §9.

---

## Versions

Current npm release: **v1.3.2** (npm registry: `1.3.2`).

v1.0 marked the formal release with stable API guarantees. Shipped + planned milestones (full history in [`CHANGELOG.md`](CHANGELOG.md), decision log in [`docs/prd/product-roadmap.md`](docs/prd/product-roadmap.md) §6):

| Version | Theme | Highlights |
|---|---|---|
| v0.3 (released) | PM mode + multi-agent orchestration | Long-lived PM session per (user, org); specialists delegated via Claude Code's native `Task` tool; slash chain `/think /plan /build /review /ship`; workflow reconciler on bot boot; `solosquad pm` / `workflow` / `rollback` CLIs; per-org `snapshot.git` |
| v0.4 (released) | Autonomous overnight engine | `goal.md` intent file + `solosquad goal run` background loop; metric-driven keep/discard with git-snapshot revert; `AGENTS.md` as the single immutable workspace guide (cross-tool); 3-tier guardrails (Input / Runtime / Output); `solosquad goal verify` for determinism checks |
| v0.5 (released) | Workflow maker + frontmatter routing | Messenger-native author loop (`_meta/workflow-maker`); 4-channel router (`slash > explicit > keyword > freq`) with paperclip budget envelope; repo analyzer (4-label classification + incremental ledger); 25 SKILL.md with Anthropic-compatible frontmatter; spec-gate ↔ `goal.md` integration |
| v0.6 (released) | Default workflow tuning + memory archive + pattern miner + Org Layer | Org Layer (`<org>/{core,domain,agent-profile.yaml}` + spawn-assembler 8-layer + budget generalization); FTS5 archive with 4-event-type indexing for cumulative memory recall; trajectory + freq miners that auto-extract repeated patterns into SKILL drafts (reuses v0.5 `applyDraft`); stop-hook DSL (`command / metric / natural`) making v0.5 spec-gate executable; chokidar hot-reload + CI PR review bot |
| v0.7 (released) | Uninstall & Lifecycle (Farewell Archive) | `solosquad uninstall`; data 5-classification (A/A*/B/C/D/E) with **user code untouchable** (class A); farewell archive with WAL-safe SQLite backup + streaming SHA256 manifest; concurrent-uninstall lockfile + stage progress journal (idempotent resume); REVOKE-CHECKLIST.md auto-generated; `--keep-workspace` class matrix; `solosquad reset`/`clean` permanently rejected (lifecycle is install ↔ uninstall). `solosquad logout` was added then **removed in v0.8.3** |
| **v0.8.0 (released)** | **Multi-User Messenger** | Same Discord server with N members each running their own bot. `command-<handle>` + `works-<handle>` channel pairs per user; bot multiplicity (1 user = 1 bot application); `author-guard` defense-in-depth (channel owner enforcement); explicit handle-collision rejection; opt-in broadcast channel (cross-user work feed in v1.x). Solo user remains a first-class citizen. *(Slack adapter exposes the same channel pair convention but ships outside the v1.0 SemVer promise.)* |
| **v0.8.1 (released)** | **Security & Lifecycle Pair** | `npm audit` 7 → 0 (discord.js 14.16 → 14.26 + undici 6.21 → 6.24 + overrides); `solosquad import <zip>` completes the v0.7 archive pair (dry-run + `--merge`/`--replace` + journal-idempotent resume); `solosquad archive verify/info/list` (yauzl-based); `docs/api-stability.md` 6 schema_version bump rules; SKILL.md `schema_version: 1` backfill |
| **v0.8.2 (released)** | **Dev Capability** | SKILL frontmatter `dev_capability` + `dev_permissions` (Bash allow/deny, network, push confirmation, **`merge.auto: false` permanently forbidden**); engineering 5 SKILLs (`backend-developer / fde / api-developer / creative-frontend / qa-engineer`) baked in `true`, others `false`; workspace master toggle; `src/bot/dev-confirm.ts` 30-min timeout gate; `gh auth status` doctor check |
| **v0.8.3 (released)** | **Onboarding UX + Observability** | `solosquad add repo --dry-run` + 5-scenario risk detection (lsof / symlinks / abs-paths / slug collision / IDE files); 5-step legacy repo migration guide; `solosquad logout` removed (replaced by `Ctrl+C` + `.env` mask + REVOKE-CHECKLIST); structured logger + `solosquad logs` CLI (level / JSON / file / 14-day rolling); master-guide §3/§6/§8/§9/§10 re-aligned for v0.7+v0.8; doctor CLI↔workspace version mismatch advisor; trajectory ROI gate measurement placeholder |
| **v1.0.0 (released)** | **Formal launch** | Stable API guarantees · 42 CLI surface freeze · `docs/api-stability.md` 공개 약속 발효 · Discord 단일 메신저 (Slack post-v1.0 슬롯) |
| v1.0.1 – v1.0.4 (released) | **Discord robustness patch chain** | discord.js v15 deprecation · `@<slug>` mention · author-guard 정합 · guild-org binding · category rename · config.yaml load-or-empty + 5-hop diagnostic + Slack author-guard cleanup |
| **v1.1.0 (released)** | **Multi-Agent Team Architecture** | Single PM session → Team-Centric. **Chief** (org-level supervisor, 사용자 대면) + **PM** (workspace-bundle, 자율 product manager) 분리. 4 main bot + 20 specialist + 18 skill + 4 team. 9-layer JIT (team OKR Layer 4a). Chief 6+1 stage state machine. open_questions[] async-batch protocol. Goal queue (1-active-per-org). 4 workflow templates. 외부 reference: Hermes V2 + gstack (Garry Tan) + RO-PNA pna-builders + phuryn pm-skills |
| **v1.2.6 (released)** | **Messenger Connection (Chief on Discord, auto-connect first)** | 조직 1개당 1 Chief 봇 (`OrgYaml.chief_name`) · OAuth Invite URL 1-click (`solosquad discord invite-url`) · handle 기반 채널 멀티-메신저 portable · owner-only 게이트 (v1.0.2 reversal, default ON 신규 / OFF 업그레이드) · TRIAGE kind 분기 → `works-<handle>` task card + thread + stage narration · `solosquad add-org` 가 v1.1.0 위계 + problem-definition workflow 기본 시드까지 완전 부트스트랩 · `solosquad doctor --discord` 5-hop diagnostic · guildCreate onboarding embed + 2 button · `/chat` slash fallback. 53 신규 test (728/728 pass) |
| **v1.3.0 (released)** | **Messenger UX overhaul** | dev-confirm push-approval 게이트 · 인터랙션 컴포넌트 · 🛑 stop 버튼 + 라이브 stage narration · 산출물 filing |
| **v1.3.1 (released)** | **Legacy asset cleanup** | v1.1 리오그가 절반만 끝낸 구 `assets/` 비우기 + CI/deps 하드닝 (사용자 대면 기능 0) |
| **v1.3.2 (released)** | **Asset lifecycle managers + asset adoption** | 5개 1급 자산(skill·agent·workflow·goal·cron) 공통 매니저 추상(validate/list/show + 공유 graph·validation·guardrail·naming 코어) · **agent 매니저 신설**(`validate --graph`) · **에셋 채택** `adopt <repo>`(discover→validate→additive apply, init/add-repo 인터랙티브 오퍼) · 통합 입구 `asset` + 일람 `commands` · conversational-first(LLM 동사는 `asset-review` 스킬로) · `skill-author→skill-manager`. 872 test pass |
| v1.2.1 (planned) | Messenger thread continuity | referencedMessage chain + LRU cache + thread token budget guard. messageCreate가 thread 메시지 수신 + thread→workflow_id reverse lookup. Slack adapter 동일 슬롯 |
| v1.3 (planned) | Schedule + Memo | n-jobber time/memory management. Calendar integration · todo · notes |
| v1.x (planned) | Dashboard interaction | Companion web dashboard (별도 리포 `solopreneur-dashboard` + `solopreneur-api`) |
| v1.x (planned) | Knowledge ontology + MCP | Graph backend + MCP external connectors (Notion, Obsidian, etc.) |
| v1.x (planned) | LLM backend abstraction | Multi-backend (single Claude → pluggable) |

Decision log: [`docs/prd/product-roadmap.md`](docs/prd/product-roadmap.md) §6.

---

## Multi-Workspace

Want separate Discord personas (e.g., business vs personal)? Create multiple workspaces:

```bash
~/solopreneur/      # Discord bot, business persona
~/personal-lab/     # Discord bot, hobby persona
```

Each has independent `.env`, tokens, memory, and messenger account. They run side-by-side without interference. (Note: a single workspace is bound to one messenger — the v0.1.x `MESSENGER=discord,slack` multi-target syntax is no longer supported. v1.0 ships only the Discord adapter under the SemVer promise; the Slack adapter remains in the codebase but is a post-v1.0 slot.)

---

## Repository Layout

Source tree (this repo):

```
package.json                      → npm package config (v1.2.6)
tsconfig.json                     → TypeScript config
bin/solosquad.ts                  → CLI entry point
AGENTS.md                         → canonical workspace guide (v0.4 — immutable, cross-tool)
CLAUDE.md                         → 3-line redirect to AGENTS.md (backward-compat)
src/
  cli/                            → CLI commands (init, bot, cron, doctor, doctor-discord,
                                     pm, workflow, goal, agent, analyze, add, sync, migrate,
                                     rollback, memory, readiness, discord)
  bot/                            → chief-runner, claude-process, session-store, events,
                                     agents-builder, workflow-reconciler, slash-commands,
                                     git-snapshot, skill-parser, agent-router,
                                     meta-skill-scanner, skill-author, author-budget,
                                     spawn-assembler (v0.6 8-layer JIT),
                                     agent-budget (v0.6 — author-budget generalized),
                                     fs-watcher + reload-policy (v0.6 hot-reload)
  engine/                         → v0.4 autonomous engine — goal-parser, agents-md-loader,
                                     guards, evaluator, tracker, reconciliation, goal-runner;
                                     stop-hook-adapter (v0.6 spec-gate DSL)
  memory/                         → v0.6 FTS5 archive — archive-db, archive-rotate,
                                     archive-search, route-event-sink
  analyze/                        → v0.5 repo analyzer — scanner, classifier, ledger,
                                     workflow-matcher, report-writer, applier
  messenger/                      → Discord adapter (v1.0). Slack adapter present but post-v1.0 slot
  scheduler/                      → Cron-based crons + memory append;
                                     trajectory-extractor + freq-keyword-miner (v0.6),
                                     v06-stats-extract (v0.6 retrospective ETL)
  util/                           → Config, paths, logger, platform, cost, agent-profile (v0.6)
  migrations/                     → Versioned workspace migration scripts (0.1.x → 0.6.0)
assets/                           → Bundled defaults (copied to user workspace on `solosquad init`)
  agents/{team}/{agent}/SKILL.md  → 25 specialist definitions (v0.5 frontmatter + v0.6
                                     collab_pattern)
  agents/{team}/KNOWLEDGE.md      → v0.6 — team(=domain) shared craft (moved from
                                     agents/_teams/{team}/TEAM_KNOWLEDGE.md, git mv)
  agents/_meta/workflow-maker/    → v0.5 author loop meta-skill + references
  knowledge/                      → v0.6 — bundled workspace knowledge starter
  core/                           → Owner profile, principles, voice (universal layer)
  routines/                       → Routine prompts (incl. v0.3 pm-compaction +
                                     v0.6 archive-rotate, v06-retrospective-stats)
  orchestrator/SKILL.md           → PM role definition (v0.3 + v0.4 goal-md-spec append)
  templates/                      → PRD / handoff (×3 variants) / status / goal.md /
                                     AGENTS.md / workflow.yaml / agent-profile.yaml /
                                     hooks.json / migration-redestination-report.md
deploy/
  docker/                         → Container deployment (Dockerfile + compose + README)
docs/
  manual/master-guide_{en,ko}.html → 📖 Canonical user manual (10 sections, EN + KO)
  plan/                           → Release planning + decision log (v0.1 → v1.2)
  plan/product-roadmap.md         → Master roadmap + decision log §4
  plan/architecture.md            → Internal system design
  plan/cloud-deployment.md        → VPS + systemd setup
  poc/                            → v0.3 PoC integration scripts (archive)
  reference/                      → Design vocabulary sources
  trend-record/                   → Peer-project comparisons
.github/workflows/                → CI + v0.6 skill-review.yml (PR diff frontmatter +
                                     keyword conflict + agent-profile schema lint)
scripts/                          → backfill-bundled-frontmatter,
                                     inject-collab-pattern (v0.6),
                                     skill-pr-review/ (v0.6 CI PR bot, 6 modules)
```

End-user workspace (created by `solosquad init`, evolved through migrations):

```
~/solosquad-workspace/
├── AGENTS.md                            (v0.4 — single persistent guide)
├── .solosquad/
│   ├── workspace.yaml                   (timezone, briefings, pm, skill_loader, author,
│   │                                       v0.6: spawn, fs_watch, archive)
│   ├── .env                             (messenger tokens, MESSENGER, …)
│   ├── agents/{team}/{agent}/SKILL.md   (v0.5 — bundled 25 + frontmatter + collab_pattern)
│   ├── agents/{team}/KNOWLEDGE.md       (v0.6 — team shared craft, co-located)
│   ├── agents/_meta/workflow-maker/     (v0.5 — author loop meta-skill)
│   ├── knowledge/                       (v0.6 — user-accumulated craft, decision frameworks)
│   └── routines/, core/                 (optional user overrides)
├── .agents/                             (v0.5 — optional workspace-wide SKILL override)
└── <org-slug>/
    ├── .org.yaml                        (schema_version: 1 — v0.6 forward-compat)
    ├── core/                            (v0.6 — org philosophy overrides workspace)
    │   ├── PRINCIPLES.md
    │   └── VOICE.md
    ├── agent-profile.yaml               (v0.6 — 25-agent modifier + budget cap, schema_version: 1)
    ├── domain/                          (v0.6 — org domain knowledge: market.md, customers.md, …)
    ├── .agents/                         (v0.5 — optional per-org SKILL override, highest priority)
    ├── memory/
    │   ├── signals.jsonl · experiments.jsonl · decisions.jsonl
    │   ├── author-costs.jsonl           (v0.5 — author loop cost log)
    │   ├── agent-costs.jsonl            (v0.6 — agent spawn cost log, separate namespace)
    │   ├── migration-costs.jsonl        (v0.6 — migration LLM fallback cost log)
    │   ├── spawn-decisions.jsonl        (v0.6 — 8-layer drop log, FTS5-indexed)
    │   ├── stop-hook-events.jsonl       (v0.6 — spec-gate evaluation log)
    │   ├── archive.sqlite               (v0.6 — FTS5 cold archive, 365d retention)
    │   ├── pm-skills/                   (v0.3 — PM compaction externalization)
    │   └── cron-logs/                   (hot tier — rotated into archive.sqlite after 8d)
    ├── workflows/<wf-id>/               (v0.3 — _status.yaml, _events.jsonl, stages)
    ├── goals/<goal-id>/                 (v0.4 — goal.md, results.tsv, _best.json, _last-run.md)
    ├── .solosquad/
    │   ├── sessions/<user>.json         (v0.3 PM session id + cost; v0.5 adds freqCooldowns)
    │   ├── snapshot.git                 (v0.3 — bare repo for memory/ + workflows/)
    │   ├── analysis/                    (v0.5 — analyze-repo Markdown reports)
    │   └── analysis-ledger.yaml         (v0.5 — incremental ledger, path + SHA256[:12])
    ├── repositories/<repo>/             (Layer 2 — user product code)
    ├── discord/                          (channel config — v1.0 default). slack/ available but post-v1.0 slot
    └── product/                         (per-org artifacts)

~/.solosquad/
├── agents/                              (v0.5 — user-global SKILL override across workspaces)
└── agent-profile-defaults.yaml          (v0.6 — user-global agent-profile defaults)
```

---

## References (peer-project inspirations)

| Project | Adopted pattern |
|---|---|
| [Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | initializer + coding agent split; context compaction; subagent spawning |
| [gstack](https://github.com/garrytan/gstack) | slash chain protocol — direct source for v0.3 `/think /plan /build /review /ship` |
| [Hermes Agent](https://github.com/nousresearch/hermes-agent) | hot+cold FTS5 memory archive, trajectory → skill auto-summary (adopted in v0.6) |
| [autoresearch](https://github.com/karpathy/autoresearch) | metric gate + git keep/rollback loop (adopted in v0.4) |
| [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | auto-load + slash dual-trigger SKILL routing (adopted in v0.5 4-channel router) |
| [OpenClaw](https://github.com/openclaw/openclaw) | npm publishing + `update` / `doctor` CLI patterns |

Explicitly rejected as over-engineered for solo founders: 3-repo physical splits, LangGraph v3 graph orchestration, MCP-based internal skill registries, Vector + Graph DB hybrids. See `docs/prd/product-roadmap.md` §4 for the reasoning.

---

## Contributing

Active solo development. Issues and pull requests welcome, but the API is unstable until v1.0. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
