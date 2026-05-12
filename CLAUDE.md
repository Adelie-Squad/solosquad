# SoloSquad

> A 24/7 AI assistant system for solo founders. Powered by Claude Code + messenger bot (Discord/Slack/Telegram) + automated routines + team-based agents.

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
```

## Project Structure

```
package.json                        → npm package config
tsconfig.json                       → TypeScript config
bin/solosquad.ts                    → CLI entry point
src/
  cli/                              → CLI commands (init, bot, schedule, status, update, doctor)
  bot/                              → Agent routing + Claude Code execution
  messenger/                        → Platform adapters (Discord, Slack)
  scheduler/                        → Cron-based routine execution + memory
  util/                             → Config, paths, logger
assets/                             → Bundled assets (copied on `solosquad init`)
  agents/{team}/SKILL.md            → Agent definitions (25 — v0.6: KNOWLEDGE.md co-located)
  agents/{team}/KNOWLEDGE.md        → Team(=domain) shared knowledge (v0.6 §2.1)
  knowledge/                        → Bundled workspace knowledge starter (v0.6 §2.3)
  core/                             → Owner profile, principles, writing style
  routines/                         → Routine prompts (editable)
  orchestrator/SKILL.md             → PM (orchestrator) role definition
  templates/                        → PRD, handoff, status file templates
```

## 3-Layer Context (v0.6 토폴로지)

```
Layer 0: Workspace / Universal
├── .solosquad/core/         → Owner profile, principles, voice
├── .solosquad/knowledge/    → User accumulated craft, decision frameworks (v0.6 §2.3)
├── .solosquad/agents/       → Per-user agent overrides (3-tier search)
└── assets/                  → Bundled defaults (read-only)

Layer 1: Organization (<workspace>/<org>/)
├── .org.yaml                → Org metadata
├── core/                    → Org philosophy, tone (override Layer 0 core) — v0.6 §2.2
├── agent-profile.yaml       → Per-agent modifier for this org — v0.6 §2.2
├── domain/                  → Org domain knowledge (market, customers, product) — v0.6 §2.2
├── memory/                  → Routine logs, decisions, signals (JSONL + FTS5 archive in v0.6)
├── workflows/<id>/          → Active workflows (status, handoff, events)
├── .solosquad/sessions/     → PM session IDs per user (v0.3)
├── slack/ | discord/        → Channel config
└── repositories/<repo>/     → See Layer 2

Layer 2: Repository (<workspace>/<org>/repositories/<repo>/)
├── code                     → User's actual product code
├── .claude/skills/          → Repo-specific skills (kept here, not bubbled up)
└── .solosquad/repo.yaml     → Repo metadata
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

**v1.3.0 (PM mode, Phase A):** `#owner-command` messages drive a long-lived
Claude Code PM session per (user, org) via `src/bot/pm-runner.ts`. The PM
delegates to specialists through Claude Code's native `Task` tool. Specialists
are auto-discovered from `<org>/.claude/agents/<name>.md` (synced from
`assets/agents/{team}/{agent}/SKILL.md` by `agents-builder.ts`). Each user
gets their own session-id stored in `<org>/.solosquad/sessions/<user>.json`.

Legacy keyword routing (`src/bot/agent-router.ts`) is retained for the
scheduler and as future fallback — 60+ keywords → 25 agent mappings.

- v0.3.1+: workflow reconciler + `pm`/`workflow`/`rollback` CLIs
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

Times are configurable per workspace in `workspace.yaml` (`briefings.morning.time`,
`briefings.evening.time`, `background_routines.*`). JSON blocks from routine results
are auto-extracted → appended to JSONL memory. All logs in `memory/routine-logs/`.

## Multi-Session Execution Rules

### Orchestrator Session (this session)
1. Load `orchestrator/SKILL.md`
2. User idea → clarifying questions → PRD generation
3. Create `projects/{id}/_status.yaml`
4. Create per-team session contexts (`sessions/`)
5. Guide which team sessions to run for each phase
6. After session completion, verify `_status.yaml` + `_handoff.md`

### Team Sessions (separate terminals)
1. Read `projects/{id}/sessions/{team}/CLAUDE.md`
2. Review previous stage's `_handoff.md`
3. Load the relevant agent's `SKILL.md` and perform work
4. Save artifacts to `projects/{id}/stage-N-{name}/`
5. Write `_handoff.md` (pass context to next agent)
6. Update the corresponding stage in `_status.yaml` to `completed`

## Handoff Protocol

All agents write a `_handoff.md` upon task completion:
- **Summary**: 3-line summary of key findings/decisions
- **Artifacts**: List of generated artifacts
- **Key Decisions**: Decisions made and their rationale
- **Context for Next Agent**: Context the next agent needs to know
- **Open Questions**: Unresolved questions

Template: `templates/handoff.md`

## Status Tracking

Track the entire workflow via `projects/{id}/_status.yaml`:
- `pending` → `in_progress` → `completed`
- `needs_revision`: Requires regeneration due to previous stage changes

Template: `templates/status.yaml`

## Workflow Types

| Type | Purpose | Key Phases |
|------|---------|------------|
| PMF Discovery | New product-market fit | Research → Planning → Design → Build → Launch |
| Feature Expansion | Add features to existing product | Analysis → Planning → Design → Build |
| Rebranding | Brand repositioning | Research → Branding → Design → Marketing |
| Rapid Prototype | Minimum viable validation | Refine → Build → Launch |
