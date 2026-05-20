# SoloSquad

🇰🇷 **한국어 README: [README.kr.md](README.kr.md)**

> A 24/7 AI assistant system for solo founders, small teams, and n-jobbers — Discord/Slack bot + scheduled routines + team-based agents, distributed as a single npm package.

Running a company alone doesn't mean working alone. SoloSquad gives you a virtual team of **25 specialist AI agents** across 4 disciplines (Strategy, Growth, Experience, Engineering), reachable from your messenger, with automated daily routines and per-product memory isolation.

```
Output ≠ Goal. Output = Means to achieve the goal.
```

**Platforms:** Windows · macOS · Linux (cross-platform CLI, CI-tested)
**Messenger:** Discord or Slack — one per workspace (Telegram support removed in v0.2.4)
**Stack:** TypeScript + Node.js 18+ · Claude Code as the AI engine · file-based memory (JSONL)

---

## Documentation

📖 **The canonical user guide is the menu-divided HTML manual:**

> **[`manual/master-guide.html`](manual/master-guide.html)** — open it in a browser.

It covers, in ten menu-divided sections:

| # | Section | What's inside |
|---|---|---|
| 1 | Getting Started | Project intent, core concepts, expected value |
| 2 | How It Works | System architecture, folder hierarchy, memory model, workflow definition |
| 3 | Concept Glossary | `SKILL.md`, `KNOWLEDGE.md`, `CLAUDE.md`, `AGENTS.md` comparison; per-layer file inventory; 4-channel routing |
| 4 | Onboarding | Branches for new users, existing-repo migration, and version upgrades |
| 5 | Messenger Setup | Full 9-step Slack and 8-step Discord token walkthroughs |
| 6 | Usage | CLI reference (current + planned), daily ops, first-run checklist, automated routines |
| 7 | Glossary | 60+ core terms, file-name dictionary, acronym dictionary — beginner-friendly |
| 8 | Version Differences | v0.8.3 (npm-published) vs v1.0+ (planned) |
| 9 | Operations | 24/7 hosting options (terminal · Docker · launchd/NSSM · VPS), multi-workspace, multi-org, security checklist |
| 10 | Troubleshooting & FAQ | Install/runtime issues, migration failures, FAQ |

Every feature is tagged with a version badge: 🟢 v0.8.3 (available now) · 🟡 v1.0+ (planned) · 🔴 removed (e.g. Telegram).

For internal architecture, release planning, and decision history, see [`docs/plan/product-roadmap.md`](docs/plan/product-roadmap.md).

---

## Quick Start (5 minutes)

```bash
# 1. Prerequisites (one-time)
brew install node git                             # macOS — see master-guide §4.2 for Windows/Linux
npm install -g @anthropic-ai/claude-code

# 2. Install SoloSquad
npm install -g solosquad
mkdir ~/solosquad-workspace && cd ~/solosquad-workspace
solosquad init                                    # wizard asks for messenger token
claude login                                      # v0.10 default backend (Claude Code Max). Codex backend planned in v1.x (see docs/plan/v0.10-llm-backend-abstraction.md)
solosquad doctor                                  # verify environment

# 3. Start the bot
solosquad bot                                     # foreground
# or
cd deploy/docker && docker compose up -d --build  # background + auto-restart
```

Then send `안녕` or `hello` to `#owner-command` in your Slack/Discord channel — a specialist agent responds.

**Messenger token setup** takes 5–10 minutes (Slack) or 3–5 minutes (Discord). Follow [master-guide.html §5](manual/master-guide.html) step-by-step.

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

### Six automated routines, runs while you sleep

| Default time | Routine | Output channel | Memory |
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
solosquad schedule                                # start automated routine scheduler
solosquad status                                  # dashboard (orgs, workflows, recent activity)
solosquad doctor                                  # environment diagnostics
solosquad doctor --messenger-check                # validate tokens via live API
solosquad update                                  # check & install latest npm release
solosquad run-routine [name]                      # manual routine execution

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
solosquad agent reload [--org <slug>]             # v0.6 — manual router rebuild (manual fs.watch mode)
npm run validate-skills                           # CI gate (= agent validate --all --corpus)

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
| `solosquad schedule` | Runs cron-based routines (6 default — see table above), appends results to JSONL memory files |

Two additional modes layer on top of the bot:

- **v0.5 author loop** — messenger-native skill creation. The `_meta/workflow-maker` meta-skill walks the user through `CLARIFY → DRAFT → SANDBOX_PROMPT → AWAIT_CONFIRM → APPLIED`, with paperclip-style budget caps logged to `<org>/memory/author-costs.jsonl`. Spec-gate drafts auto-emit a `<org>/goals/<goal-id>/goal.md`.
- **v0.4 goal-runner** — background autonomous cycle. `solosquad goal run <id>` boots a `bg-<goal-id>-<runId>` PM session that loops pipeline → evaluator (metric gate) → git-snapshot keep/discard until the time/cycle/cost budget runs out or all metrics pass `CONFIRMING`. `solosquad goal verify` re-runs the evaluator on a past cycle to check determinism.

v0.6 layers five more pieces over the v0.3–v0.5 base:

- **Spawn assembly** — `src/bot/spawn-assembler.ts` builds each Task prompt as an 8-layer JIT injection (knowledge → team KNOWLEDGE → SKILL → `<org>/core/` → `agent-profile.yaml` → `<org>/domain/` → handoff + memory recall → target repo) bounded by `workspace.yaml.spawn.max_context_tokens` (default `80000`). When the budget is exceeded, lower-priority layers drop in a fixed order and every decision is recorded to `<org>/memory/spawn-decisions.jsonl` (FTS5-indexed).
- **Budget envelope** — two separate namespaces: author-loop turns log to `author-costs.jsonl`, spawn calls log to `agent-costs.jsonl`. Per-agent caps in `<org>/agent-profile.yaml` can only *narrow* the workspace defaults, never widen them. Migration LLM fallback costs are isolated in `migration-costs.jsonl` so a misbehaving migration cannot starve the running bot.
- **FTS5 cold archive** — `src/memory/` rotates `routine-logs/*.jsonl` older than 8 days into `<org>/memory/archive.sqlite` once a day (`assets/routines/archive-rotate.md`, 00:00). Retention defaults to 365 days, with an optional `.zst` compress-before-delete step. Four event types are indexed (`route_hit / route_miss / author_turn / spawn_decision`); on a router miss the bot surfaces a single recall hint to the user.
- **Hot-reload** — `chokidar` 3-tier `fs.watch` (forced polling on Windows + WSL, 300 ms debounce) feeds `src/bot/reload-policy.ts`, which atomically swaps the router index in `auto` / `prompt` / `manual` mode. An optional `git_only` safe mode requires `HEAD ≡ upstream + clean tree` before any reload.
- **Stop-hook** — v0.5's `loop_mode.spec-gate` SKILL field is now executable through `src/engine/stop-hook-adapter.ts`. The DSL accepts three forms (`command` / `metric` / `natural`), runs with a 5-second timeout, and on ambiguity defaults to *continue* (conservative). Every evaluation is appended to `<org>/memory/stop-hook-events.jsonl` and threaded back into the v0.4 goal-runner.

For production-grade always-on, choose one of:
- Docker Compose (recommended, background + auto-restart) — see [`deploy/docker/README.md`](deploy/docker/README.md)
- macOS `launchd` plist / Windows NSSM service
- VPS + systemd (see [`docs/plan/cloud-deployment.md`](docs/plan/cloud-deployment.md))

Full details in master-guide §9.

---

## Versions

Current npm release: **v0.8.3** (npm registry: `0.8.3`).

The project is in pre-launch (v0.x). **v1.0 will mark formal release** with stable API guarantees. Shipped + planned milestones:

| Version | Theme | Highlights |
|---|---|---|
| v0.3 (released) | PM mode + multi-agent orchestration | Long-lived PM session per (user, org); specialists delegated via Claude Code's native `Task` tool; slash chain `/think /plan /build /review /ship`; workflow reconciler on bot boot; `solosquad pm` / `workflow` / `rollback` CLIs; per-org `snapshot.git` |
| v0.4 (released) | Autonomous overnight engine | `goal.md` intent file + `solosquad goal run` background loop; metric-driven keep/discard with git-snapshot revert; `AGENTS.md` as the single immutable workspace guide (cross-tool); 3-tier guardrails (Input / Runtime / Output); `solosquad goal verify` for determinism checks |
| v0.5 (released) | Workflow maker + frontmatter routing | Messenger-native author loop (`_meta/workflow-maker`); 4-channel router (`slash > explicit > keyword > freq`) with paperclip budget envelope; repo analyzer (4-label classification + incremental ledger); 25 SKILL.md with Anthropic-compatible frontmatter; spec-gate ↔ `goal.md` integration |
| v0.6 (released) | Default workflow tuning + memory archive + pattern miner + Org Layer | Org Layer (`<org>/{core,domain,agent-profile.yaml}` + spawn-assembler 8-layer + budget generalization); FTS5 archive with 4-event-type indexing for cumulative memory recall; trajectory + freq miners that auto-extract repeated patterns into SKILL drafts (reuses v0.5 `applyDraft`); stop-hook DSL (`command / metric / natural`) making v0.5 spec-gate executable; chokidar hot-reload + CI PR review bot |
| v0.7 (released) | Uninstall & Lifecycle (Farewell Archive) | `solosquad uninstall`; data 5-classification (A/A*/B/C/D/E) with **user code untouchable** (class A); farewell archive with WAL-safe SQLite backup + streaming SHA256 manifest; concurrent-uninstall lockfile + stage progress journal (idempotent resume); REVOKE-CHECKLIST.md auto-generated; `--keep-workspace` class matrix; `solosquad reset`/`clean` permanently rejected (lifecycle is install ↔ uninstall). `solosquad logout` was added then **removed in v0.8.3** |
| **v0.8.0 (released)** | **Multi-User Messenger** | Same Discord server / Slack workspace with N members each running their own bot. `command-<handle>` + `works-<handle>` channel pairs per user; bot multiplicity (1 user = 1 bot application); `author-guard` defense-in-depth (channel owner enforcement); explicit handle-collision rejection; opt-in broadcast channel (cross-user work feed in v1.x). Solo user remains a first-class citizen |
| **v0.8.1 (released)** | **Security & Lifecycle Pair** | `npm audit` 7 → 0 (discord.js 14.16 → 14.26 + undici 6.21 → 6.24 + overrides); `solosquad import <zip>` completes the v0.7 archive pair (dry-run + `--merge`/`--replace` + journal-idempotent resume); `solosquad archive verify/info/list` (yauzl-based); `docs/api-stability.md` 6 schema_version bump rules; SKILL.md `schema_version: 1` backfill |
| **v0.8.2 (released)** | **Dev Capability** | SKILL frontmatter `dev_capability` + `dev_permissions` (Bash allow/deny, network, push confirmation, **`merge.auto: false` permanently forbidden**); engineering 5 SKILLs (`backend-developer / fde / api-developer / creative-frontend / qa-engineer`) baked in `true`, others `false`; workspace master toggle; `src/bot/dev-confirm.ts` 30-min timeout gate; `gh auth status` doctor check |
| **v0.8.3 (released)** | **Onboarding UX + Observability** | `solosquad add repo --dry-run` + 5-scenario risk detection (lsof / symlinks / abs-paths / slug collision / IDE files); 5-step legacy repo migration guide; `solosquad logout` removed (replaced by `Ctrl+C` + `.env` mask + REVOKE-CHECKLIST); structured logger + `solosquad logs` CLI (level / JSON / file / 14-day rolling); master-guide §3/§6/§8/§9/§10 re-aligned for v0.7+v0.8; doctor CLI↔workspace version mismatch advisor; trajectory ROI gate measurement placeholder |
| **v1.0** (planned) | **Formal launch** | Stable API · breaking-change policy starts |
| v1.x (planned) | Workflow / Goal / Routine evolution | `docs/plan/v1.x-workflow-goal-routine-evolution.md` — Q1~Q7 ideation: 24/7 자율 팀 leading indicator · `/save-as-skill` 명시 · goal cycle 중간 통지/개입 · 사용자별 루틴 · Amplitude-style 실험 인프라 |
| v1.1 (planned) | Dashboard interaction | Companion web dashboard (separate repo) |
| v1.2 (planned) | Knowledge ontology | Graph backend + MCP external connectors (Notion, Obsidian, etc.) |
| v1.3 (planned) | Schedule + Memo | n-jobber time/memory management. Calendar integration · todo · notes — aligned with knowledge ontology |

Decision log: [`docs/plan/product-roadmap.md`](docs/plan/product-roadmap.md) §6.

---

## Multi-Workspace

Want both Slack and Discord, or separate personas? Create multiple workspaces:

```bash
~/solopreneur/      # Slack bot, business persona
~/personal-lab/     # Discord bot, hobby persona
```

Each has independent `.env`, tokens, memory, and messenger account. They run side-by-side without interference. (Note: a single workspace is bound to one messenger — the v0.1.x `MESSENGER=discord,slack` syntax is no longer supported.)

---

## Repository Layout

Source tree (this repo):

```
package.json                      → npm package config (v0.8.3)
tsconfig.json                     → TypeScript config
bin/solosquad.ts                  → CLI entry point
AGENTS.md                         → canonical workspace guide (v0.4 — immutable, cross-tool)
CLAUDE.md                         → 3-line redirect to AGENTS.md (backward-compat)
src/
  cli/                            → CLI commands (init, bot, schedule, doctor, pm, workflow,
                                     goal, agent, analyze, add, sync, migrate, rollback,
                                     memory, readiness)
  bot/                            → pm-runner, claude-process, session-store, events,
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
  messenger/                      → Discord / Slack adapters
  scheduler/                      → Cron-based routines + memory append;
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
  manual/master-guide.html        → 📖 Canonical user manual (10 sections)
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
    │   └── routine-logs/                (hot tier — rotated into archive.sqlite after 8d)
    ├── workflows/<wf-id>/               (v0.3 — _status.yaml, _events.jsonl, stages)
    ├── goals/<goal-id>/                 (v0.4 — goal.md, results.tsv, _best.json, _last-run.md)
    ├── .solosquad/
    │   ├── sessions/<user>.json         (v0.3 PM session id + cost; v0.5 adds freqCooldowns)
    │   ├── snapshot.git                 (v0.3 — bare repo for memory/ + workflows/)
    │   ├── analysis/                    (v0.5 — analyze-repo Markdown reports)
    │   └── analysis-ledger.yaml         (v0.5 — incremental ledger, path + SHA256[:12])
    ├── repositories/<repo>/             (Layer 2 — user product code)
    ├── slack/  or  discord/             (channel config)
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

Explicitly rejected as over-engineered for solo founders: 3-repo physical splits, LangGraph v3 graph orchestration, MCP-based internal skill registries, Vector + Graph DB hybrids. See `docs/plan/product-roadmap.md` §4 for the reasoning.

---

## Contributing

Active solo development. Issues and pull requests welcome, but the API is unstable until v1.0. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
