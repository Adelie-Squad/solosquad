# SoloSquad — AGENTS.md

> **Canonical workspace guide.** Every AI tool working on this codebase
> (Claude Code, Codex, Aider, Cursor, OpenHands, etc.) reads this file.
> **Human-edited only — no AI agent may modify this file.** (CLAUDE.md
> at the repo root is a thin redirect kept for backward compatibility.)

A 24/7 AI assistant system for solo founders. Powered by Claude Code +
messenger bot (Discord/Slack) + automated routines + team-based agents.

## Core Philosophy

```
Output ≠ Goal. Output = Means to achieve the goal.
```

## Tech Stack

TypeScript + Node.js. Distributed as npm package.

```bash
npm install -g solosquad
solosquad init          # Setup wizard
solosquad bot           # Start messenger bot
solosquad schedule      # Start automated scheduler
solosquad status        # Dashboard
solosquad update        # Self-update (OpenClaw-style)
solosquad doctor        # Environment diagnostics
solosquad run-routine   # Manual routine execution
solosquad migrate       # Upgrade workspace layout across versions
solosquad add org       # Add another organization to workspace
solosquad add repo      # Clone (URL) or register (local path) a repository
solosquad sync          # Sync org/repositories/ with .org.yaml
solosquad pm status / reset / compact          # v0.3.0 — PM session ops
solosquad workflow list / show / focus         # v0.3.0 — workflow inspect
solosquad rollback --workflow <id>             # v0.3.0 — snapshot revert
solosquad goal new / list / show / run / status / stop / verify   # v0.4
```

## Project Structure

```
package.json                        → npm package config
tsconfig.json                       → TypeScript config
bin/solosquad.ts                    → CLI entry point
src/
  cli/                              → CLI commands (init, bot, schedule, status, update, doctor,
                                       agent, workflow, goal, memory, readiness)
  bot/                              → PM runner, claude-process factory, session-store,
                                       events, agents-builder, workflow-reconciler,
                                       slash-commands, git-snapshot, workspace-meta,
                                       spawn-assembler (v0.6 8-layer JIT),
                                       agent-budget (v0.6 — author-budget 일반화), mention-parser (v1.0.1 — @<slug> multi-repo intent), repo-registry (v1.0.1)
  messenger/                        → Platform adapters (Discord, Slack)
  scheduler/                        → Cron-based routine execution + memory,
                                       trajectory-extractor (v0.6 §3),
                                       freq-keyword-miner (v0.6 §3.4),
                                       v06-stats-extract (v0.6 §2.5)
  memory/                           → FTS5 archive schema + rotate (v0.6 §4)
  util/                             → Config, paths, logger, cost
  engine/                           → v0.4 autonomous engine + stop-hook-adapter (v0.6 §5b)
  migrations/scripts/               → 0.5.0-to-0.6.0.ts (dry-run + apply)
agents/                             → Agent definitions (v1.1 flat layout — canonical bundle)
  main/{agent}/SKILL.md             → 5 main bots: chief, pm, engineer, designer, marketer
  specialists/{agent}/SKILL.md      → 20 specialists, flat (no team folder nesting)
teams/{team}/                       → 4 teams (product/engineering/design/marketing)
  composition.yaml                  → Team membership (= data, not folders) + main supervisor
  KNOWLEDGE.md                      → Team(=domain) shared knowledge (v0.6 §2.1)
  OKR.md                            → Quarterly OKR (Chief-authored)
skills/{skill}/SKILL.md             → Reusable skills (PM Tier-1/2 + Chief-invoked)
assets/                             → Bundled defaults (copied into .solosquad/ on `solosquad init`)
  knowledge/                        → Bundled workspace knowledge starter (v0.6 §2.3)
  core/                             → Owner profile, principles, writing style
  routines/                         → Routine prompts (editable) — archive-rotate 신설 (v0.6 §4)
  orchestrator/SKILL.md             → PM (orchestrator) role definition
  templates/                        → PRD, handoff(×3 변형), status, goal.md, AGENTS.md
  docker/                           → Dockerfile + docker-compose.yml (v1.2.10)
```

> **Agent layout (v1.1):** specialists live flat at `agents/specialists/{name}/`;
> team membership is *data* in `teams/{team}/composition.yaml`, not folder nesting.
> The old team-nested `assets/agents/{team}/` roster was removed in v1.3.1.
> Path resolution (`util/paths.ts getAgentsDir`): `.solosquad/agents/` →
> top-level `agents/` → bundle.

## 3-Layer Context (v0.6 topology)

```
Layer 0: Workspace / Universal
├── AGENTS.md                  → cross-tool persistent guide (human-edited only)
├── .solosquad/core/           → Owner profile, principles, voice
├── .solosquad/knowledge/      → User accumulated craft, decision frameworks (v0.6 §2.3)
├── .solosquad/agents/         → Per-user agent overrides (3-tier search)
├── agents/{main,specialists}/{agent}/SKILL.md → bundle agent definitions (v1.1 flat)
├── teams/{team}/{composition.yaml,KNOWLEDGE.md,OKR.md} → team membership = data
└── assets/                    → Bundled defaults (read-only: core, knowledge, routines,
                                  templates, orchestrator, docker)

Layer 1: Organization (<workspace>/<org>/)
├── .org.yaml                  → Org metadata (schema_version: 1 — v0.6 §6 forward-compat)
├── core/                      → Org philosophy, tone (override Layer 0 core) — v0.6 §2.2
│   ├── PRINCIPLES.md
│   └── VOICE.md
├── agent-profile.yaml         → Per-agent modifier (defaults + budget + agent별 섹션,
│                                  schema_version: 1) — v0.6 §2.2
├── domain/                    → Org domain knowledge (market.md, customers.md, …)
│                                  — v0.6 §2.2
├── memory/
│   ├── routine-logs/*.jsonl   → 최근 7일 hot (v0.6 §4.2)
│   ├── archive.sqlite         → FTS5 cold archive (v0.6 §4 — route_hit/route_miss/
│   │                              author_turn/spawn_decision 인덱싱)
│   ├── agent-costs.jsonl      → spawn 비용 누적 (v0.6 §2.2 budget)
│   ├── migration-costs.jsonl  → 마이그레이션 자체 cap (v0.6 §2.2 P0)
│   ├── spawn-decisions.jsonl  → 8-layer drop 로그 (v0.6 §2.2 P1)
│   └── stop-hook-events.jsonl → spec-gate 평가 로그 (v0.6 §5b)
├── workflows/<id>/            → Active workflows (status, handoff, events) — v0.3
├── goals/<goal-id>/           → Autonomous run intents + cycle results — v0.4
├── .solosquad/sessions/       → PM session IDs per user — v0.3
├── slack/ | discord/          → Channel config
└── repositories/<repo>/       → See Layer 2

Layer 2: Repository (<workspace>/<org>/repositories/<repo>/)
├── code                       → User's actual product code
├── .claude/skills/            → Repo-specific skills (kept here, not bubbled up)
└── .solosquad/repo.yaml       → Repo metadata
```

**Spawn-time context assembly (v0.6 §2.2)** — 8-layer JIT injection (in
order, with token cap + priority drop per v0.6 §2.2 P1):

[1] `assets/knowledge/` + `.solosquad/knowledge/` (selective by keyword)
[2] `teams/{team}/KNOWLEDGE.md` (only if same team — membership via composition.yaml)
[3] `agents/{main,specialists}/{agent}/SKILL.md` (agent identity, immutable, workspace) — never drop
[4] `<org>/core/` (org philosophy) — never drop
[5] `<org>/agent-profile.yaml` (defaults + this agent's section) — never drop
[6] `<org>/domain/`
[7] `<org>/workflows/<id>/_handoff.md` slice + `<org>/memory/` (recent + FTS5 recall)
[8] target repo context (when `target_repo` set)

Drop policy: `workspace.yaml.spawn.max_context_tokens` (default 80000) —
도달 시 우선순위 낮은 layer부터 drop, 결정 로그는
`<org>/memory/spawn-decisions.jsonl` 에 기록 (FTS5 인덱싱 대상).

## Team Composition

| Team | Agents | Role |
|------|--------|------|
| **Strategy** | PMF Planner, Feature Planner, Policy Architect, Data Analyst, Business Strategist, Idea Refiner, Scope Estimator | Strategy, planning, analysis |
| **Growth** | GTM Strategist, Content Writer, Brand Marketer, Paid Marketer | Marketing, branding |
| **Experience** | User Researcher, Desk Researcher, UX Designer, UI Designer | Research, design |
| **Engineering** | Creative Frontend, FDE, Architect, Backend Developer, API Developer, Data Collector, Data Engineer, Cloud Admin, QA Engineer, Security Engineer | Development, infrastructure, quality, security |

## Messenger Support

Set via `MESSENGER` env var: `discord` (default) or `slack`. One per workspace (v0.2.0+).
Telegram support was removed in v0.2.4. Adapter pattern in `src/messenger/` — both
platforms share the same bot logic and routing.

## Agent Routing

**v0.3.0 (PM mode — v0.3 narrative):** `#owner-command` messages drive a long-lived
Claude Code PM session per (user, org) via `src/bot/pm-runner.ts`. The PM
delegates to specialists through Claude Code's native `Task` tool. Specialists
are auto-discovered from `<org>/.claude/agents/<name>.md` (synced from
`assets/agents/{team}/{agent}/SKILL.md` by `agents-builder.ts`). Each user
gets their own session-id stored in `<org>/.solosquad/sessions/<user>.json`.

Keyword routing now lives in each SKILL.md's frontmatter (`triggers.keyword`),
discovered at boot by `buildRoutes()` in `src/bot/agent-router.ts` (v0.5). The
former hardcoded `AGENT_ROUTES` map is gone. The router scans the 3-tier
search path (org-local · user-global · workspace-bundled) and resolves
incoming messages via the 4-channel priority order: slash > explicit > keyword
> freq. Scheduler routines reference agents by name in their prompts rather
than going through router resolution.

- v0.3.0 covers: workflow reconciler, slash commands (`/think /plan /build /review /ship`), `pm`/`workflow`/`rollback` CLIs, stage_id/focus markers
- v0.4: autonomous goal runner with metric-driven keep/discard cycles (`solosquad goal new/list/show/run/status/stop/verify`, engine in `src/engine/`)
- v0.5 onward: 4-channel triggers (slash / keyword / freq auto-load / explicit PM call), see `docs/plan/v0.5-workflow-maker.md` §7
- v0.6 onward: FTS5 archive fallback for past memory recall (`docs/plan/v0.6-default-workflow-tuning.md` §4)
- v1.0.1 onward: `@<slug>` mention pre-processor for multi-repo intent routing (`src/bot/mention-parser.ts`). Sits between slash and PM dispatch — resolves `@<slug>` tokens against the org's registered repos and injects a `[target_repo:<slug>]` (or `[target_repos:a,b]`) marker into the PM prompt. Zero LLM calls at routing time. See `docs/plan/v1.0.1-discord-ready-deprecation.md` §2.4 and PM SKILL.md §"Multi-Repo Intent (v1.0.1+)".

## Automated Routines + Memory Storage (v0.2.4+)

Three messenger channels: `#command-<handle>` (user input + reply), `#works-<handle>` and `#git-<handle>`
(briefs at channel root, background routines in system threads, per-workflow threads).

Default schedule (all times in workspace.yaml `timezone`, default `Asia/Seoul`):

| Time (default) | Routine | Kind | Where | Memory |
|---|---|---|---|---|
| 08:00 daily | Morning Brief | user-brief | #workflow root | — |
| 12:00 daily | Signal Scan | background | #workflow → `system-daily-signals` | signals.jsonl |
| 16:00 daily | Experiment Check | background | #workflow → `system-experiments` | experiments.jsonl |
| 18:00 daily | Evening Brief | user-brief | #workflow root | decisions.jsonl |
| Sun 20:00 | Weekly Review | background | #workflow → `system-weekly-review` | decisions.jsonl |
| 23:00 daily | PM Compaction (v0.3.0) | background | #workflow → `system-pm-compaction` | memory/pm-skills/ |

Times are configurable per workspace in `workspace.yaml` (`briefings.morning.time`,
`briefings.evening.time`, `background_routines.*`, `pm.compaction_time`). JSON
blocks from routine results are auto-extracted → appended to JSONL memory.
All logs in `memory/routine-logs/`.

## Multi-Session Execution Rules

### Orchestrator (PM) Session — v0.3.0+

1. Load `orchestrator/SKILL.md` (PM mode rewrite)
2. User idea → clarifying questions (≤2 in one turn) → PRD generation
3. Create `workflows/wf-YYYY-MM-DD-<slug>/_status.yaml` + `PRD.md`
4. Delegate stages via Claude Code native `Task` tool
   - Prefix each Task prompt with `[stage:<id> wf:<wf-id>]` for reconciler precision
   - Include target_repo absolute path in prompt (subagent inherits PM cwd)
5. Synthesize tool_result and report to user

### Team Sessions (separate terminals — legacy multi-session model)

1. Read `workflows/<wf-id>/sessions/{team}/CLAUDE.md`
2. Review previous stage's `_handoff.md`
3. Load the relevant agent's `SKILL.md` and perform work
4. Save artifacts to `workflows/<wf-id>/stage-N-<name>/`
5. Write `_handoff.md` (pass context to next agent)
6. Update the corresponding stage in `_status.yaml` to `completed`

## Handoff Protocol

All agents write a `_handoff.md` upon task completion:
- **Summary**: 3-line summary of key findings/decisions
- **Artifacts**: List of generated artifacts
- **Key Decisions**: Decisions made and their rationale
- **Context for Next Agent**: Context the next agent needs to know
- **Open Questions**: Unresolved questions

Template: `assets/templates/handoff.md`

## Status Tracking

Track the entire workflow via `workflows/<wf-id>/_status.yaml`:
- `pending` → `in_progress` → `completed`
- `needs_revision`: Requires regeneration due to previous stage changes (set by
  `WorkflowReconciler` on bot crash recovery — v0.3.0)

Template: `assets/templates/status.yaml`

## Workflow Types

| Type | Purpose | Key Phases |
|------|---------|------------|
| PMF Discovery | New product-market fit | Research → Planning → Design → Build → Launch |
| Feature Expansion | Add features to existing product | Analysis → Planning → Design → Build |
| Rebranding | Brand repositioning | Research → Branding → Design → Marketing |
| Rapid Prototype | Minimum viable validation | Refine → Build → Launch |

## Conventions for AI Tools Working on This Codebase

This section is the persistent guide that applies to any AI coding tool
(Claude Code, Codex, Aider, Cursor, OpenHands, etc.) operating on the SoloSquad
source.

### Immutable paths — never modify

These paths define the engine's own contracts. If an AI modifies them, the
metric-game / guardrail integrity collapses (Goodhart's Law).

- `src/engine/**` (v0.4 — parser, evaluator, tracker, reconciliation, guards)
- `src/migrations/scripts/**` once a script is published in a tagged release
  (0.1.x-to-0.2.0.ts, 0.2.0-to-0.2.1.ts, etc. — fix forward in a new
  migration; do not rewrite history)
- `AGENTS.md` (this file)
- `CHANGELOG.md` entries for already-published versions (0.3.0 and prior)
- Published git tags (v0.1.x, v0.2.x — semver immutability)

### Modifiable paths — normal work area

- `src/bot/`, `src/cli/`, `src/messenger/`, `src/scheduler/`, `src/util/`
- `assets/agents/{team}/{agent}/SKILL.md` (with care — agent identity is
  load-bearing)
- `assets/routines/`, `assets/templates/`
- `docs/plan/`, `manual/`
- `test/`
- New migration files in `src/migrations/scripts/` for the *current* in-flight
  version

### Build / Test

```bash
npm install
npm run build           # tsc emits dist/
npm test                # node --test, 588 cases as of v1.0.1
```

`prepublishOnly` script runs `npm run build` automatically before `npm publish`.

### Code conventions

- TypeScript strict mode, ES2022, Node16 modules (`.js` imports in `.ts` files)
- Cross-platform: `path.join` / `path.resolve`, never raw `/`; `normalizeLine`
  before splitting text files (CRLF safety); see `.claude/rules/cross-platform.md`
- Avoid `any` — prefer `unknown` + narrow, generics, or proper types
- `const` by default, `let` only when reassignment needed
- No emoji in code unless explicitly requested
- Comments: only when the WHY is non-obvious. Don't restate WHAT the code does.

### Output guards (when working on SoloSquad source)

- Never `git push --force` to `main` or any `v*` tag
- Never amend or rewrite published commits (anything in `main` or `v1.x.x` tags)
- Never `npm publish` without `--dry-run` first
- Never modify `package.json` `version` field without an accompanying
  CHANGELOG.md entry
- Never skip git hooks (`--no-verify`) without explicit human approval
- `npm install` / dependency changes: explain in the PR / commit body

### Cross-tool compatibility

- This file (`AGENTS.md`) is the canonical guide. The repo also keeps a thin
  `CLAUDE.md` redirect for backward compatibility with Claude Code's
  auto-load. Edit *AGENTS.md only*; CLAUDE.md is human-managed redirect.
- `.claude/rules/*.md` in this repo contains additional Claude-Code-specific
  hook rules (typescript, cross-platform, git-workflow) that are loaded by
  Claude Code when working here. Not relevant for other tools.
