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
```

## Project Structure

```
package.json                        → npm package config
tsconfig.json                       → TypeScript config
bin/solosquad.ts                  → CLI entry point
src/
  cli/                              → CLI commands (init, bot, schedule, status, update, doctor)
  bot/                              → Agent routing + Claude Code execution
  messenger/                        → Platform adapters (Discord, Slack, Telegram)
  scheduler/                        → Cron-based routine execution + memory
  util/                             → Config, paths, logger
assets/                             → Bundled assets (copied on `solosquad init`)
  agents/{team}/{agent}/SKILL.md    → Agent definitions (25)
  agents/_teams/{team}/TEAM_KNOWLEDGE.md → Shared team knowledge
  core/                             → Owner profile, principles, writing style
  routines/                         → Routine prompts (editable)
  orchestrator/SKILL.md             → Project workflow orchestration
  templates/                        → PRD, handoff, status file templates
```

## 3-Layer Context

```
Layer 0: Universal (core/)       → Shared across all sessions
Layer 1: Product (~/repos/{slug}/) → Per-product isolation
Layer 2: Project (projects/{id}/)  → Per-project isolation
```

## Team Composition

| Team | Agents | Role |
|------|--------|------|
| **Strategy** | PMF Planner, Feature Planner, Policy Architect, Data Analyst, Business Strategist, Idea Refiner, Scope Estimator | Strategy, planning, analysis |
| **Growth** | GTM Strategist, Content Writer, Brand Marketer, Paid Marketer | Marketing, branding |
| **Experience** | User Researcher, Desk Researcher, UX Designer, UI Designer | Research, design |
| **Engineering** | Creative Frontend, FDE, Architect, Backend Developer, API Developer, Data Collector, Data Engineer, Cloud Admin, QA Engineer, Security Engineer | Development, infrastructure, quality, security |

## Messenger Support

Set via `MESSENGER` env var: `discord` (default), `slack`, or `telegram`.
Multiple platforms: `MESSENGER=discord,slack` (comma-separated).
Adapter pattern in `src/messenger/` — all platforms share the same bot logic and routing.

## Agent Routing

Send a message in the command channel and `src/bot/agent-router.ts` analyzes keywords to auto-inject the appropriate agent's SKILL.md.
- 60+ keywords → 25 agent mappings (`AGENT_ROUTES` dictionary)
- Falls back to general mode if no match

## Automated Routines + Memory Storage

| Time | Routine | Channel | Memory Storage |
|------|---------|---------|----------------|
| 06:00 daily | Morning Brief | #daily-brief | - |
| 12:00 daily | Signal Scan | #signals | signals.jsonl |
| 16:00 daily | Experiment Check | #experiments | experiments.jsonl |
| 22:00 daily | Daily Log | #daily-brief | decisions.jsonl |
| Sun 20:00 | Weekly Review | #weekly-review | decisions.jsonl |

JSON blocks from routine results are auto-extracted → appended to JSONL memory. All logs are saved to `memory/routine-logs/`.

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
