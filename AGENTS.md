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
solosquad goal new / list / show / run / status / stop / verify   # v0.4 (planned)
```

## Project Structure

```
package.json                        → npm package config
tsconfig.json                       → TypeScript config
bin/solosquad.ts                    → CLI entry point
src/
  cli/                              → CLI commands (init, bot, schedule, status, update, doctor)
  bot/                              → PM runner, claude-process factory, session-store,
                                       events, agents-builder, workflow-reconciler,
                                       slash-commands, git-snapshot, workspace-meta
  messenger/                        → Platform adapters (Discord, Slack)
  scheduler/                        → Cron-based routine execution + memory
  util/                             → Config, paths, logger
  engine/                           → v0.4 autonomous engine (planned — goal-parser,
                                       agents-md-loader, evaluator, tracker, reconciliation,
                                       guards, goal-runner)
assets/                             → Bundled assets (copied on `solosquad init`)
  agents/{team}/SKILL.md            → Agent definitions (25 — v0.6: KNOWLEDGE.md co-located)
  agents/{team}/KNOWLEDGE.md        → Team(=domain) shared knowledge (v0.6 §2.1)
  knowledge/                        → Bundled workspace knowledge starter (v0.6 §2.3)
  core/                             → Owner profile, principles, writing style
  routines/                         → Routine prompts (editable)
  orchestrator/SKILL.md             → PM (orchestrator) role definition
  templates/                        → PRD, handoff, status, goal.md, AGENTS.md templates
```

## 3-Layer Context (v0.6 topology)

```
Layer 0: Workspace / Universal
├── AGENTS.md                  → cross-tool persistent guide (this file's spec
│                                  for end-user workspaces — v0.4)
├── .solosquad/core/           → Owner profile, principles, voice
├── .solosquad/knowledge/      → User accumulated craft, decision frameworks (v0.6 §2.3)
├── .solosquad/agents/         → Per-user agent overrides (3-tier search)
└── assets/                    → Bundled defaults (read-only)

Layer 1: Organization (<workspace>/<org>/)
├── .org.yaml                  → Org metadata
├── core/                      → Org philosophy, tone (override Layer 0 core) — v0.6 §2.2
├── agent-profile.yaml         → Per-agent modifier for this org — v0.6 §2.2
├── domain/                    → Org domain knowledge — v0.6 §2.2
├── memory/                    → Routine logs, decisions, signals (JSONL + FTS5 archive in v0.6)
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

**Spawn-time context assembly (v0.6 §2.2)** — 8-layer JIT injection:
[1] `assets/knowledge/` + `.solosquad/knowledge/` (selective by keyword)
[2] `agents/{team}/KNOWLEDGE.md` (only if same team)
[3] `agents/{team}/{agent}/SKILL.md` (agent identity, immutable, workspace)
[4] `<org>/core/` (org philosophy)
[5] `<org>/agent-profile.yaml` (defaults + this agent's section)
[6] `<org>/domain/`
[7] `<org>/workflows/<id>/_handoff.md` slice + `<org>/memory/`
[8] target repo context (when target_repo set)

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

Legacy keyword routing (`src/bot/agent-router.ts`) is retained for the
scheduler and as future fallback — 60+ keywords → 25 agent mappings.

- v0.3.0 covers: workflow reconciler, slash commands (`/think /plan /build /review /ship`), `pm`/`workflow`/`rollback` CLIs, stage_id/focus markers
- v0.4 (planned): autonomous goal runner with metric-driven keep/discard cycles
- v0.5 onward: 4-channel triggers (slash / keyword / freq auto-load / explicit PM call), see `docs/plan/v0.5-workflow-maker.md` §7
- v0.6 onward: FTS5 archive fallback for past memory recall (`docs/plan/v0.6-default-workflow-tuning.md` §4)

## Automated Routines + Memory Storage (v0.2.4+)

Two messenger channels: `#owner-command` (user input + reply) and `#workflow`
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
- `docs/plan/`, `docs/manual/`
- `test/`
- New migration files in `src/migrations/scripts/` for the *current* in-flight
  version

### Build / Test

```bash
npm install
npm run build           # tsc emits dist/
npm test                # node --test, 75 cases as of v0.3.0
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
