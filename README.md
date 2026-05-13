# SoloSquad

> A 24/7 AI assistant system for solo founders — Discord/Slack bot + scheduled routines + team-based agents, distributed as a single npm package.

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

> **[`docs/manual/concept-guide.html`](docs/manual/concept-guide.html)** — open it in a browser.

It covers, in ten menu-divided sections:

| # | Section | What's inside |
|---|---|---|
| 1 | Getting Started | Project intent, core concepts, expected value |
| 2 | How It Works | System architecture, folder hierarchy, memory model, workflow definition |
| 3 | Concept Glossary | `SKILL.md`, `KNOWLEDGE.md`, `CLAUDE.md`, `agent.md` comparison; per-layer file inventory |
| 4 | Onboarding | Branches for new users, existing-repo migration, and version upgrades |
| 5 | Messenger Setup | Full 9-step Slack and 8-step Discord token walkthroughs |
| 6 | Usage | CLI reference (current + planned), daily ops, first-run checklist, automated routines |
| 7 | Glossary | 60+ core terms, file-name dictionary, acronym dictionary — beginner-friendly |
| 8 | Version Differences | v0.2.4 (npm-published) vs v0.3 / v0.4 / v0.5 / v0.6 / v1.0+ (planned) |
| 9 | Operations | 24/7 hosting options (terminal · Docker · launchd/NSSM · VPS), multi-workspace, multi-org, security checklist |
| 10 | Troubleshooting & FAQ | Install/runtime issues, migration failures, FAQ |

Every feature is tagged with a version badge: 🟢 v0.2.4 (available now) · 🟡 v0.3+ (planned) · 🔴 removed (e.g. Telegram).

For internal architecture, release planning, and decision history, see [`docs/product-roadmap.md`](docs/product-roadmap.md).

---

## Quick Start (5 minutes)

```bash
# 1. Prerequisites (one-time)
brew install node git                             # macOS — see concept-guide §4.2 for Windows/Linux
npm install -g @anthropic-ai/claude-code

# 2. Install SoloSquad
npm install -g solosquad
mkdir ~/solosquad-workspace && cd ~/solosquad-workspace
solosquad init                                    # wizard asks for messenger token
claude login                                      # browser opens for Claude Max account
solosquad doctor                                  # verify environment

# 3. Start the bot
solosquad bot                                     # foreground
# or
docker compose up -d --build                      # background + auto-restart
```

Then send `안녕` or `hello` to `#owner-command` in your Slack/Discord channel — a specialist agent responds.

**Messenger token setup** takes 5–10 minutes (Slack) or 3–5 minutes (Discord). Follow [concept-guide.html §5](docs/manual/concept-guide.html) step-by-step.

---

## What you get

### 25 agents across 4 teams, keyword-routed automatically

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

60+ keyword mappings route to the right specialist. No manual selection needed. Falls back to general mode when no match.

### Five automated routines, runs while you sleep

| Default time | Routine | Output channel | Memory |
|---|---|---|---|
| 08:00 daily | Morning Brief | `#workflow` root | — |
| 12:00 daily | Signal Scan | `#workflow` → `system-daily-signals` thread | `signals.jsonl` |
| 16:00 daily | Experiment Check | `#workflow` → `system-experiments` thread | `experiments.jsonl` |
| 18:00 daily | Evening Brief | `#workflow` root | `decisions.jsonl` |
| Sun 20:00 | Weekly Review | `#workflow` → `system-weekly-review` thread | `decisions.jsonl` |

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

## CLI Reference (v0.2.4)

```bash
solosquad init                   # workspace setup wizard
solosquad bot                    # start messenger bot
solosquad schedule               # start automated routine scheduler
solosquad status                 # dashboard (orgs, workflows, recent activity)
solosquad doctor                 # environment diagnostics
solosquad doctor --messenger-check  # validate tokens via live API
solosquad update                 # check & install latest npm release
solosquad run-routine [name]     # manual routine execution
solosquad migrate                # upgrade workspace layout (dry-run by default)
solosquad migrate --apply        # perform migration
solosquad migrate --rollback     # restore from backup
solosquad add org <name>         # add an organization
solosquad add repo <url|path>    # clone or register a repository
solosquad sync                   # sync repositories/ with .org.yaml
```

See concept-guide §6 for planned v0.3+ commands (PM mode, autonomous runs, workflow maker, memory search).

---

## Architecture Overview

Two long-running processes plus a file-based memory layer:

| Process | Role |
|---|---|
| `solosquad bot` | Receives messenger messages → keyword-routes to the right agent's `SKILL.md` → invokes `claude --print` → replies |
| `solosquad schedule` | Runs cron-based routines, appends results to JSONL memory files |

For production-grade always-on, choose one of:
- Docker Compose (recommended, background + auto-restart)
- macOS `launchd` plist / Windows NSSM service
- VPS + systemd (see [`docs/cloud-deployment.md`](docs/cloud-deployment.md))

Full details in concept-guide §9.

---

## Versions

Current npm release: **v0.2.4** (npm registry: `0.2.4`).

The project is in pre-launch (v0.x). **v1.0 will mark formal release** with stable API guarantees. Planned milestones:

| Version | Theme | Highlights |
|---|---|---|
| v0.3 (planned) | PM mode + multi-agent orchestration | PM session, ephemeral subagents, slash commands (`/think /plan /build /review /ship`), `solosquad rollback` |
| v0.4 (planned) | Autonomous overnight engine | `program.md`, metric gate + git rollback, Data Reconciliation, 3-tier guardrails |
| v0.5 (planned) | Workflow maker + skill system | New agents/workflows from messenger chat, repo `.claude/skills/` analyzer, 4-channel triggers |
| v0.6 (planned) | Topology stabilization + memory archive | `agents/{team}/KNOWLEDGE.md` co-location, `<org>/agent-profile.yaml` + `core/` + `domain/`, `.solosquad/knowledge/`, FTS5 cold archive |
| **v1.0** (planned) | **Formal launch** | Stable API · breaking-change policy starts |
| v1.1 (planned) | Dashboard interaction | Companion web dashboard (separate repo) |
| v1.2 (planned) | Knowledge ontology | Graph backend + MCP external connectors (Notion, Obsidian, etc.) |

Decision log: [`docs/product-roadmap.md`](docs/product-roadmap.md) §4.

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

```
package.json                      → npm package config
tsconfig.json                     → TypeScript config
bin/solosquad.ts                  → CLI entry point
src/
  cli/                            → CLI commands (init, bot, schedule, status, update, doctor, …)
  bot/                            → Agent routing + Claude Code execution
  messenger/                      → Discord / Slack adapters
  scheduler/                      → Cron-based routines + memory append
  util/                           → Config, paths, logger, platform helpers
  migrations/                     → Versioned workspace migration scripts
assets/                           → Bundled defaults (copied to user workspace on `solosquad init`)
  agents/{team}/{agent}/SKILL.md  → 25 specialist definitions
  agents/_teams/{team}/TEAM_KNOWLEDGE.md  → Shared team craft (relocates to agents/{team}/KNOWLEDGE.md in v0.6)
  core/                           → Owner profile, principles, voice (universal layer)
  routines/                       → Routine prompts (5 routines)
  orchestrator/SKILL.md           → PM role definition (activated in v0.3)
  templates/                      → PRD / handoff / status / session templates
  Dockerfile, docker-compose.yml  → Container deployment templates
docs/
  manual/concept-guide.html       → 📖 Canonical user manual (10 sections)
  product-roadmap.md              → Release status + planning + decision log
  architecture.md                 → Internal system design
  cloud-deployment.md             → VPS + systemd setup
  v0.3-…md … v1.2-…md             → Per-version planning specs
  reference/                      → Design vocabulary sources
  trend-record/                   → Peer-project comparisons
```

---

## References (peer-project inspirations)

| Project | Adopted pattern |
|---|---|
| [Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | initializer + coding agent split; context compaction; subagent spawning |
| [gstack](https://github.com/garrytan/gstack) | slash chain protocol — direct source for v0.3 `/think /plan /build /review /ship` |
| [Hermes Agent](https://github.com/nousresearch/hermes-agent) | hot+cold FTS5 memory archive, trajectory → skill auto-summary (planned for v0.6) |
| [autoresearch](https://github.com/karpathy/autoresearch) | metric gate + git keep/rollback loop (planned for v0.4) |
| [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | auto-load + slash dual-trigger SKILL routing (planned for v0.5) |
| [OpenClaw](https://github.com/openclaw/openclaw) | npm publishing + `update` / `doctor` CLI patterns |

Explicitly rejected as over-engineered for solo founders: 3-repo physical splits, LangGraph v3 graph orchestration, MCP-based internal skill registries, Vector + Graph DB hybrids. See `docs/product-roadmap.md` §4 for the reasoning.

---

## Contributing

Active solo development. Issues and pull requests welcome, but the API is unstable until v1.0. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
